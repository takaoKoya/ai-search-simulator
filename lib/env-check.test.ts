import { describe, expect, it } from "vitest";
import { checkEnv, formatReport, hasErrors, REQUIRED_ENV_NAMES } from "./env-check";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/recruit",
  OPENAI_API_KEY: "sk-test",
  LINE_CHANNEL_SECRET: "secret",
  LINE_CHANNEL_ACCESS_TOKEN: "token",
  LINE_OA_BASIC_ID: "@123abcde",
  NEXT_PUBLIC_APP_URL: "https://example.ngrok-free.app",
};

const find = (env: Record<string, string | undefined>, name: string) =>
  checkEnv(env).find((r) => r.name === name)!;

describe("checkEnv", () => {
  it("checks all six required variables", () => {
    expect(REQUIRED_ENV_NAMES).toEqual(Object.keys(valid));
    expect(hasErrors(checkEnv(valid))).toBe(false);
  });

  it("flags missing, empty, and whitespace-only values", () => {
    expect(find({ ...valid, OPENAI_API_KEY: undefined }, "OPENAI_API_KEY").status).toBe("missing");
    expect(find({ ...valid, OPENAI_API_KEY: "" }, "OPENAI_API_KEY").status).toBe("missing");
    expect(find({ ...valid, OPENAI_API_KEY: "   " }, "OPENAI_API_KEY").status).toBe("missing");
  });

  it("requires LINE_OA_BASIC_ID to start with @", () => {
    expect(find({ ...valid, LINE_OA_BASIC_ID: "123abcde" }, "LINE_OA_BASIC_ID").status).toBe("invalid");
    expect(find({ ...valid, LINE_OA_BASIC_ID: "@" }, "LINE_OA_BASIC_ID").status).toBe("invalid");
    expect(find({ ...valid, LINE_OA_BASIC_ID: "@12 3" }, "LINE_OA_BASIC_ID").status).toBe("invalid");
  });

  it("validates NEXT_PUBLIC_APP_URL as an http(s) URL", () => {
    expect(find({ ...valid, NEXT_PUBLIC_APP_URL: "example.com" }, "NEXT_PUBLIC_APP_URL").status).toBe("invalid");
    expect(find({ ...valid, NEXT_PUBLIC_APP_URL: "ftp://example.com" }, "NEXT_PUBLIC_APP_URL").status).toBe("invalid");
    expect(find({ ...valid, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, "NEXT_PUBLIC_APP_URL")).toMatchObject({
      status: "ok",
      warning: undefined,
    });
  });

  it("warns (without failing) on non-https remote URLs and trailing slashes", () => {
    expect(find({ ...valid, NEXT_PUBLIC_APP_URL: "http://example.com" }, "NEXT_PUBLIC_APP_URL").warning).toMatch(/https/);
    const slash = find({ ...valid, NEXT_PUBLIC_APP_URL: "https://example.com/" }, "NEXT_PUBLIC_APP_URL");
    expect(slash.status).toBe("ok");
    expect(slash.warning).toMatch(/\//);
  });

  it("requires DATABASE_URL to be a postgres URL", () => {
    expect(find({ ...valid, DATABASE_URL: "mysql://localhost/db" }, "DATABASE_URL").status).toBe("invalid");
    expect(find({ ...valid, DATABASE_URL: "not a url" }, "DATABASE_URL").status).toBe("invalid");
    expect(find({ ...valid, DATABASE_URL: "postgres://localhost/db" }, "DATABASE_URL").status).toBe("ok");
  });

  it("rejects secrets that contain whitespace or newlines", () => {
    expect(find({ ...valid, LINE_CHANNEL_ACCESS_TOKEN: "ab\ncd" }, "LINE_CHANNEL_ACCESS_TOKEN").status).toBe("invalid");
    expect(find({ ...valid, LINE_CHANNEL_ACCESS_TOKEN: "abcd\n" }, "LINE_CHANNEL_ACCESS_TOKEN").status).toBe("ok"); // edges are trimmed
    expect(find({ ...valid, LINE_CHANNEL_ACCESS_TOKEN: "ab cd" }, "LINE_CHANNEL_ACCESS_TOKEN").status).toBe("invalid");
  });
});

describe("formatReport", () => {
  it("never prints secret values", () => {
    const report = formatReport(checkEnv(valid));
    for (const secret of ["sk-test", "secret", "token", "pass"]) {
      expect(report).not.toContain(`${secret}@`);
    }
    expect(report).not.toContain("sk-test");
    expect(report).not.toContain("user:pass");
    expect(report).toContain("全6件OK");
  });
  it("summarises failures", () => {
    expect(formatReport(checkEnv({}))).toContain("6件に問題があります");
  });
});
