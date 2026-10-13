import { messagingApi, type webhook } from "@line/bot-sdk";
import { prisma } from "@/lib/db";
import { scoreApplicant } from "@/lib/applicants/score";
import { lineQuestionSchema } from "@/lib/jobs/schema";
import { z } from "zod";
import {
  applyAnswer,
  buildCompletion,
  buildInterviewPrompt,
  buildJobSelection,
  buildQuestion,
  DONE_STEP,
  INTERVIEW_STEP,
  parseInterviewDate,
  parsePostbackData,
  QUESTION_COUNT,
} from "./flow";

type Message = messagingApi.Message;

const questionsSchema = z.array(lineQuestionSchema).length(QUESTION_COUNT);

let client: messagingApi.MessagingApiClient | undefined;
function getClient() {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelAccessToken) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  return (client ??= new messagingApi.MessagingApiClient({ channelAccessToken }));
}

type Outcome = { messages: Message[]; afterReply?: () => Promise<void> };

/** プロフィール取得の失敗（ブロック済み・権限なし等）で応募フローを止めない。 */
async function fetchProfile(userId: string): Promise<{ lineDisplayName?: string; linePictureUrl?: string }> {
  try {
    const profile = await getClient().getProfile(userId);
    return { lineDisplayName: profile.displayName, linePictureUrl: profile.pictureUrl };
  } catch (e) {
    console.error("LINE getProfile failed", e);
    return {};
  }
}

async function scoreAndSave(applicantId: string): Promise<void> {
  try {
    const applicant = await prisma.applicant.findUniqueOrThrow({
      where: { id: applicantId },
      include: { job: true },
    });
    const questions = questionsSchema.parse(applicant.job.lineQuestions);
    const result = await scoreApplicant({
      job: applicant.job,
      questions,
      answers: z.array(z.string()).parse(applicant.answers),
      interviewAt: applicant.interviewAt ?? new Date(),
    });
    await prisma.applicant.update({
      where: { id: applicantId },
      data: { score: result.score, evaluation: result.evaluation, status: result.status },
    });
  } catch (e) {
    // status stays PENDING (set at completion) so a human picks it up
    console.error("applicant scoring failed", applicantId, e);
  }
}

async function replyJobSelection(): Promise<Message[]> {
  const jobs = await prisma.job.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: 13,
    select: { id: true, title: true },
  });
  return [buildJobSelection(jobs)];
}

/** 現在のステップに応じた次のメッセージを返す（再開・不正入力時の再送にも使う）。 */
function promptFor(step: number, questions: z.infer<typeof questionsSchema>, retry = false): Message {
  return step < QUESTION_COUNT ? buildQuestion(questions, step) : buildInterviewPrompt(retry);
}

async function startApplication(userId: string, jobId: string): Promise<Message[]> {
  const job = await prisma.job.findFirst({ where: { id: jobId, status: "PUBLISHED" } });
  if (!job) return replyJobSelection();
  const questions = questionsSchema.safeParse(job.lineQuestions);
  if (!questions.success) {
    return [{ type: "text", text: "この求人は現在応募を受け付けていません。" }];
  }

  const existing = await prisma.applicant.findUnique({
    where: { jobId_lineUserId: { jobId, lineUserId: userId } },
  });
  if (existing && existing.step >= DONE_STEP) {
    return [{ type: "text", text: "この求人にはすでにご応募いただいています。" }];
  }
  const applicant =
    existing ??
    (await prisma.applicant.create({
      data: {
        jobId,
        lineUserId: userId,
        status: "SCREENING",
        step: 0,
        answers: [],
        ...(await fetchProfile(userId)),
      },
    }));
  return [promptFor(applicant.step, questions.data)];
}

async function continueApplication(
  applicant: NonNullable<Awaited<ReturnType<typeof findActiveApplicant>>>,
  event: webhook.MessageEvent | webhook.PostbackEvent,
): Promise<Outcome> {
  const questions = questionsSchema.safeParse(applicant.job.lineQuestions);
  if (!questions.success) {
    return { messages: [{ type: "text", text: "この求人は現在応募を受け付けていません。" }] };
  }
  const answers = z.array(z.string()).catch([]).parse(applicant.answers);
  const q = questions.data;

  if (applicant.step < QUESTION_COUNT) {
    if (event.type === "postback") {
      const data = parsePostbackData(event.postback.data);
      if (data.action === "answer") {
        const next = applyAnswer(q, applicant.step, answers, {
          step: Number(data.step),
          value: Number(data.value),
        });
        if (next) {
          // step guard makes a double-tap / redelivery a no-op
          const { count } = await prisma.applicant.updateMany({
            where: { id: applicant.id, step: applicant.step },
            data: { step: next.step, answers: next.answers },
          });
          return { messages: count === 0 ? [] : [promptFor(next.step, q)] };
        }
      }
    }
    return { messages: [promptFor(applicant.step, q)] };
  }

  // interview date
  let raw: string | undefined;
  if (event.type === "postback" && parsePostbackData(event.postback.data).action === "interview") {
    raw = event.postback.params?.datetime;
  } else if (event.type === "message" && event.message.type === "text") {
    raw = event.message.text;
  }
  const date = raw ? parseInterviewDate(raw) : null;
  if (!date) return { messages: [promptFor(INTERVIEW_STEP, q, raw !== undefined)] };

  const { count } = await prisma.applicant.updateMany({
    where: { id: applicant.id, step: INTERVIEW_STEP },
    data: { interviewAt: date, step: DONE_STEP, status: "PENDING" },
  });
  if (count === 0) return { messages: [] };
  // reply first (the reply token expires quickly), then score
  return { messages: [buildCompletion(date)], afterReply: () => scoreAndSave(applicant.id) };
}

function findActiveApplicant(userId: string) {
  return prisma.applicant.findFirst({
    where: { lineUserId: userId, step: { lt: DONE_STEP } },
    orderBy: { updatedAt: "desc" },
    include: { job: true },
  });
}

async function handleEvent(event: webhook.Event): Promise<void> {
  if (event.type !== "message" && event.type !== "postback") return;
  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  if (!userId || !replyToken) return;

  let outcome: Outcome;
  const data = event.type === "postback" ? parsePostbackData(event.postback.data) : null;
  if (data?.action === "job" && data.id) {
    outcome = { messages: await startApplication(userId, data.id) };
  } else {
    const active = await findActiveApplicant(userId);
    outcome = active ? await continueApplication(active, event) : { messages: await replyJobSelection() };
  }

  if (outcome.messages.length > 0) {
    await getClient().replyMessage({ replyToken, messages: outcome.messages });
  }
  await outcome.afterReply?.();
}

export async function handleLineEvents(events: webhook.Event[]): Promise<void> {
  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (e) {
      console.error("LINE event handling failed", e);
    }
  }
}
