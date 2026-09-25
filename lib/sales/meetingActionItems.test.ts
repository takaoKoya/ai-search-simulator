import { describe, expect, it } from "vitest";
import { extractActionItemCandidates, findPossibleDuplicate } from "@/lib/sales/meetingActionItems";

describe("extractActionItemCandidates", () => {
  it("extracts sentences containing an explicit action-cue phrase", () => {
    const transcript = "本日はありがとうございました。来週までに見積書を送付する。次回は来月に設定しましょう。";
    const candidates = extractActionItemCandidates(transcript);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].description).toContain("見積書を送付する");
  });

  it("never fabricates a candidate from a transcript with no action-cue phrase", () => {
    const transcript = "本日はお時間いただきありがとうございました。とても有意義な議論でした。";
    expect(extractActionItemCandidates(transcript)).toEqual([]);
  });

  it("deduplicates identical sentences within the same transcript", () => {
    const transcript = "資料を準備する。資料を準備する。";
    const candidates = extractActionItemCandidates(transcript);
    expect(candidates).toHaveLength(1);
  });

  it("caps the number of candidates at 10", () => {
    const sentence = "資料を準備する";
    const transcript = Array.from({ length: 20 }, (_, i) => `${sentence}${i}`).join("。");
    const candidates = extractActionItemCandidates(transcript);
    expect(candidates.length).toBeLessThanOrEqual(10);
  });
});

describe("findPossibleDuplicate", () => {
  it("flags an exact normalized match", () => {
    const existing = [{ id: "item-1", description: "見積書を送付する" }];
    expect(findPossibleDuplicate("見積書を送付する", existing)).toBe("item-1");
  });

  it("flags a substring match (whitespace/case-insensitive)", () => {
    const existing = [{ id: "item-1", description: "来週までに 見積書を送付する" }];
    expect(findPossibleDuplicate("見積書を送付する", existing)).toBe("item-1");
  });

  it("returns null when nothing matches", () => {
    const existing = [{ id: "item-1", description: "議事録を確認する" }];
    expect(findPossibleDuplicate("見積書を送付する", existing)).toBeNull();
  });

  it("returns null against an empty existing list", () => {
    expect(findPossibleDuplicate("見積書を送付する", [])).toBeNull();
  });
});
