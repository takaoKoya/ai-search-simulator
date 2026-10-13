export type EnvEnv = Record<string, string | undefined>;

export type EnvResult = {
  name: string;
  status: "ok" | "missing" | "invalid";
  /** Secret-safe description of the value, or the reason it failed. */
  detail: string;
  /** Non-fatal advice shown next to an OK result. */
  warning?: string;
};

type Rule = {
  name: string;
  /** Returns an error message, or null when valid. */
  validate: (value: string) => string | null;
  /** Never echo secrets back to the terminal. */
  secret: boolean;
  warn?: (value: string) => string | null;
};

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

const RULES: Rule[] = [
  {
    name: "DATABASE_URL",
    secret: true,
    validate: (v) => {
      const url = parseUrl(v);
      return url && ["postgres:", "postgresql:"].includes(url.protocol)
        ? null
        : "postgresql:// または postgres:// で始まる接続URLを指定してください";
    },
  },
  {
    name: "OPENAI_API_KEY",
    secret: true,
    validate: (v) => (/\s/.test(v) ? "空白・改行が含まれています（コピー時の混入に注意）" : null),
  },
  {
    name: "LINE_CHANNEL_SECRET",
    secret: true,
    validate: (v) => (/\s/.test(v) ? "空白・改行が含まれています" : null),
  },
  {
    name: "LINE_CHANNEL_ACCESS_TOKEN",
    secret: true,
    validate: (v) => (/\s/.test(v) ? "空白・改行が含まれています" : null),
  },
  {
    name: "LINE_OA_BASIC_ID",
    secret: false,
    validate: (v) =>
      /^@[^\s@]+$/.test(v) ? null : "「@」で始まるベーシックID（例: @123abcde）を指定してください",
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    secret: false,
    validate: (v) => {
      const url = parseUrl(v);
      return url && ["http:", "https:"].includes(url.protocol) && url.host
        ? null
        : "http(s):// から始まるURL（例: https://xxxx.ngrok-free.app）を指定してください";
    },
    warn: (v) => {
      const url = parseUrl(v);
      if (!url) return null;
      const local = ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.protocol === "http:" && !local) return "LINE Webhook には https が必要です";
      if (v.endsWith("/")) return "末尾の「/」は不要です（計測リンクが // になります）";
      return null;
    },
  },
];

export const REQUIRED_ENV_NAMES = RULES.map((r) => r.name);

function describe(rule: Rule, value: string): string {
  if (!rule.secret) return value;
  const url = rule.name === "DATABASE_URL" ? parseUrl(value) : null;
  if (url) return `${url.protocol}//${url.username ? "***@" : ""}${url.host}${url.pathname}`;
  return `設定済み（${value.length}文字）`;
}

export function checkEnv(env: EnvEnv): EnvResult[] {
  return RULES.map((rule) => {
    const value = (env[rule.name] ?? "").trim();
    if (value === "") {
      return { name: rule.name, status: "missing", detail: "未設定です" };
    }
    const error = rule.validate(value);
    if (error) return { name: rule.name, status: "invalid", detail: error };
    return {
      name: rule.name,
      status: "ok",
      detail: describe(rule, value),
      warning: rule.warn?.(value) ?? undefined,
    };
  });
}

export function formatReport(results: EnvResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = results.map((r) => {
    const mark = r.status === "ok" ? "✅" : r.status === "missing" ? "❌" : "⚠️ ";
    const warn = r.warning ? `\n     ${" ".repeat(width)} ↳ 注意: ${r.warning}` : "";
    return `  ${mark} ${r.name.padEnd(width)}  ${r.detail}${warn}`;
  });
  const failed = results.filter((r) => r.status !== "ok").length;
  const summary =
    failed === 0
      ? `全${results.length}件OK`
      : `${failed}件に問題があります（${results.length - failed}/${results.length} OK）`;
  return ["環境変数チェック", ...lines, "", summary].join("\n");
}

export function hasErrors(results: EnvResult[]): boolean {
  return results.some((r) => r.status !== "ok");
}
