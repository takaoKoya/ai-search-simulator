import type { messagingApi } from "@line/bot-sdk";
import type { LineQuestion } from "@/lib/jobs/schema";

type Message = messagingApi.Message;
type QuickReplyItem = messagingApi.QuickReplyItem;

export const QUESTION_COUNT = 3;
/** step が QUESTION_COUNT のとき面接日時の入力待ち、それ以降は完了 */
export const INTERVIEW_STEP = QUESTION_COUNT;
export const DONE_STEP = QUESTION_COUNT + 1;

const LABEL_MAX = 20; // LINE quick reply label limit

function label(text: string): string {
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
}

export function postbackData(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
}

export function parsePostbackData(data: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(data));
}

export function buildJobSelection(jobs: { id: string; title: string }[]): Message {
  if (jobs.length === 0) {
    return { type: "text", text: "現在募集中の求人はありません。" };
  }
  return {
    type: "text",
    text: "ご応募ありがとうございます！応募したい求人を選んでください。",
    quickReply: {
      // LINE allows at most 13 quick reply items
      items: jobs.slice(0, 13).map((job) => ({
        type: "action",
        action: {
          type: "postback",
          label: label(job.title),
          data: postbackData({ action: "job", id: job.id }),
          displayText: job.title,
        },
      })),
    },
  };
}

export function buildQuestion(questions: LineQuestion[], step: number): Message {
  const q = questions[step];
  const items: QuickReplyItem[] = q.options.map((option, i) => ({
    type: "action",
    action: {
      type: "postback",
      label: label(option),
      data: postbackData({ action: "answer", step, value: i }),
      displayText: option,
    },
  }));
  return { type: "text", text: `Q${step + 1}/${QUESTION_COUNT}\n${q.question}`, quickReply: { items } };
}

export function buildInterviewPrompt(retry = false): Message {
  return {
    type: "text",
    text:
      (retry ? "日時を読み取れませんでした。" : "ご回答ありがとうございました！") +
      "\n面接の希望日時を選択してください。（「2026-10-20 14:00」の形式でも入力できます）",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "datetimepicker",
            label: "日時を選ぶ",
            data: postbackData({ action: "interview" }),
            mode: "datetime",
          },
        },
      ],
    },
  };
}

/** LINE の datetimepicker は "2026-10-20T14:00" 形式（タイムゾーンなし）で返す。JST として扱う。 */
export function parseInterviewDate(input: string): Date | null {
  const m = input.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T|\s+)(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
  // reject overflowed dates such as 2026-02-31 or 25:00
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  if (jst.getUTCMonth() !== mo - 1 || jst.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return date;
}

export function formatInterviewDate(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function buildCompletion(date: Date): Message {
  return {
    type: "text",
    text: `面接のご希望日時を承りました。\n${formatInterviewDate(date)}\n\n担当者より改めてご連絡いたします。`,
  };
}

/** 回答を受け付ける。step が現在の質問と一致しない（古いボタンの再タップ等）場合は null。 */
export function applyAnswer(
  questions: LineQuestion[],
  currentStep: number,
  answers: string[],
  tap: { step: number; value: number },
): { step: number; answers: string[] } | null {
  if (currentStep >= QUESTION_COUNT || tap.step !== currentStep) return null;
  const option = questions[currentStep]?.options[tap.value];
  if (option === undefined) return null;
  return { step: currentStep + 1, answers: [...answers, option] };
}
