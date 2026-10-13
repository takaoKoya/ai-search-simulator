import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  buildQuestion,
  parseInterviewDate,
  parsePostbackData,
  postbackData,
} from "./flow";

const questions = Array.from({ length: 3 }, (_, i) => ({
  question: `Q${i}`,
  options: ["とても長い選択肢のラベルはここで切られます", "B"],
}));

describe("postback data", () => {
  it("round-trips", () => {
    expect(parsePostbackData(postbackData({ action: "answer", step: 1, value: 0 }))).toEqual({
      action: "answer",
      step: "1",
      value: "0",
    });
  });
});

describe("buildQuestion", () => {
  it("truncates quick reply labels to 20 chars", () => {
    const msg = buildQuestion(questions, 0);
    const first = msg.type === "text" && msg.quickReply?.items?.[0].action;
    expect(first && "label" in first && first.label?.length).toBeLessThanOrEqual(20);
  });
});

describe("applyAnswer", () => {
  it("advances and records the chosen option", () => {
    expect(applyAnswer(questions, 0, [], { step: 0, value: 1 })).toEqual({ step: 1, answers: ["B"] });
  });
  it("ignores stale taps and invalid options", () => {
    expect(applyAnswer(questions, 1, ["B"], { step: 0, value: 0 })).toBeNull();
    expect(applyAnswer(questions, 0, [], { step: 0, value: 9 })).toBeNull();
    expect(applyAnswer(questions, 3, ["a", "b", "c"], { step: 3, value: 0 })).toBeNull();
  });
});

describe("parseInterviewDate", () => {
  it("parses picker and typed formats as JST", () => {
    expect(parseInterviewDate("2026-10-20T14:00")?.toISOString()).toBe("2026-10-20T05:00:00.000Z");
    expect(parseInterviewDate("2026/10/20 9:30")?.toISOString()).toBe("2026-10-20T00:30:00.000Z");
  });
  it("rejects garbage and impossible dates", () => {
    expect(parseInterviewDate("明日")).toBeNull();
    expect(parseInterviewDate("2026-02-31 10:00")).toBeNull();
    expect(parseInterviewDate("2026-10-20 25:00")).toBeNull();
  });
});
