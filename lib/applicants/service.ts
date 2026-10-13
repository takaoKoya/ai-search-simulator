import { z } from "zod";
import { prisma } from "@/lib/db";
import { getLineClient } from "@/lib/line/client";
import { fetchLineProfile } from "@/lib/line/profile";
import { lineQuestionSchema } from "@/lib/jobs/schema";
import { DONE_STEP, QUESTION_COUNT } from "@/lib/line/flow";
import { renderTemplate } from "./notify";
import { scoreApplicant } from "./score";

const questionsSchema = z.array(lineQuestionSchema).length(QUESTION_COUNT);

export class ApplicantError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Runs the AI scoring for a completed application and saves score/evaluation.
 * The AI verdict only overwrites `status` while no human has set it manually,
 * so a re-run never clobbers a person's decision.
 */
export async function scoreAndSave(applicantId: string) {
  const applicant = await prisma.applicant.findUnique({ where: { id: applicantId }, include: { job: true } });
  if (!applicant) throw new ApplicantError("応募者が見つかりません", 404);
  if (applicant.step < DONE_STEP) throw new ApplicantError("応募がまだ完了していません", 409);

  const questions = questionsSchema.parse(applicant.job.lineQuestions);
  const result = await scoreApplicant({
    job: applicant.job,
    questions,
    answers: z.array(z.string()).parse(applicant.answers),
    interviewAt: applicant.interviewAt ?? new Date(),
  });
  return prisma.applicant.update({
    where: { id: applicantId },
    data: {
      score: result.score,
      evaluation: result.evaluation,
      ...(applicant.statusManual ? {} : { status: result.status }),
    },
  });
}

/** Pushes an interview guidance message to the applicant's LINE. */
export async function sendInterviewNotice(
  applicantId: string,
  input: { template: string; confirmedAt?: Date | null },
) {
  const applicant = await prisma.applicant.findUnique({ where: { id: applicantId }, include: { job: true } });
  if (!applicant) throw new ApplicantError("応募者が見つかりません", 404);
  if (applicant.status === "REJECTED") {
    throw new ApplicantError("不通過の応募者には面接案内を送信できません", 409);
  }

  const confirmedAt = input.confirmedAt ?? applicant.interviewConfirmedAt ?? null;
  const text = renderTemplate(input.template, {
    name: applicant.lineDisplayName,
    job: applicant.job.title,
    datetime: confirmedAt ?? applicant.interviewAt,
  });
  if (text.length > 5000) throw new ApplicantError("メッセージが長すぎます（5000文字まで）", 400);

  try {
    await getLineClient().pushMessage({ to: applicant.lineUserId, messages: [{ type: "text", text }] });
  } catch (e) {
    console.error("LINE push failed", applicantId, e);
    throw new ApplicantError("LINE送信に失敗しました（ブロックされている可能性があります）", 502);
  }

  return prisma.applicant.update({
    where: { id: applicantId },
    data: {
      notifiedAt: new Date(),
      statusManual: true,
      ...(confirmedAt ? { interviewConfirmedAt: confirmedAt, status: "INTERVIEW_SCHEDULED" } : {}),
    },
  });
}

/** Re-fetches displayName / pictureUrl from LINE and stores them. */
export async function syncProfile(applicantId: string) {
  const applicant = await prisma.applicant.findUnique({ where: { id: applicantId } });
  if (!applicant) throw new ApplicantError("応募者が見つかりません", 404);

  let profile;
  try {
    profile = await fetchLineProfile(applicant.lineUserId);
  } catch (e) {
    console.error("LINE profile sync failed", applicantId, e);
    throw new ApplicantError("LINEプロフィールを取得できませんでした（ブロック・友だち解除の可能性があります）", 502);
  }
  return prisma.applicant.update({
    where: { id: applicantId },
    data: { lineDisplayName: profile.lineDisplayName, linePictureUrl: profile.linePictureUrl ?? null },
  });
}
