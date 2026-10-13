import { describe, expect, it } from "vitest";
import { renderTemplate, toJstInputValue } from "./notify";

describe("renderTemplate", () => {
  const at = new Date("2026-10-20T05:00:00Z");
  it("fills known variables and leaves unknown ones untouched", () => {
    const out = renderTemplate("{{name}}様 {{job}} {{datetime}} {{other}}", { name: "山田", job: "カフェ", datetime: at });
    expect(out).toContain("山田様 カフェ");
    expect(out).toContain("14:00");
    expect(out).toContain("{{other}}");
  });
  it("falls back when name or datetime is missing", () => {
    const out = renderTemplate("{{name}}/{{datetime}}", { name: null, job: "x", datetime: null });
    expect(out).toBe("応募者/日程は追ってご連絡します");
  });
});

describe("toJstInputValue", () => {
  it("formats in JST for datetime-local inputs", () => {
    expect(toJstInputValue(new Date("2026-10-20T05:00:00Z"))).toBe("2026-10-20T14:00");
    expect(toJstInputValue(null)).toBe("");
  });
});
