import { formatDateTime } from "@/lib/jobs/labels";

export const DEFAULT_INTERVIEW_TEMPLATE = `{{name}}様

この度は「{{job}}」にご応募いただきありがとうございます。
選考の結果、面接にお進みいただくことになりました。

■ 面接日時
{{datetime}}

ご都合が悪い場合は、このLINEにご返信ください。
お会いできることを楽しみにしております。`;

export const TEMPLATE_VARIABLES = ["name", "job", "datetime"] as const;

export function renderTemplate(
  template: string,
  vars: { name: string | null; job: string; datetime: Date | null },
): string {
  const values: Record<(typeof TEMPLATE_VARIABLES)[number], string> = {
    name: vars.name ?? "応募者",
    job: vars.job,
    datetime: vars.datetime ? formatDateTime(vars.datetime) : "日程は追ってご連絡します",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in values ? values[key as keyof typeof values] : whole,
  );
}

/** Value for <input type="datetime-local">, in JST. */
export function toJstInputValue(date: Date | null): string {
  if (!date) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
