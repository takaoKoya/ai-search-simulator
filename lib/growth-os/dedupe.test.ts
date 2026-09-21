import { describe, it, expect } from "vitest";
import { LexicalSimilarityDetector, findMostSimilarIdea, isDuplicate, DUPLICATE_SCORE_THRESHOLD } from "./dedupe";
import type { IdeaSimilarityCandidate } from "./dedupe";

const detector = new LexicalSimilarityDetector();

function candidate(overrides: Partial<IdeaSimilarityCandidate>): IdeaSimilarityCandidate {
  return {
    id: "id",
    title: "",
    hook: null,
    coreProblem: null,
    targetPersona: null,
    ...overrides,
  };
}

describe("LexicalSimilarityDetector", () => {
  it("完全に同一のテキストは類似度1", () => {
    const a = candidate({ id: "a", title: "50代。会社がなくなったら何が残る?" });
    const b = candidate({ id: "b", title: "50代。会社がなくなったら何が残る?" });
    expect(detector.computeSimilarity(a, b)).toBe(1);
  });

    it("全く異なるテーマは類似度が低い", () => {
    const a = candidate({ id: "a", title: "50代。会社がなくなったら何が残る?" });
    const b = candidate({ id: "b", title: "新NISAで始める資産形成入門ガイド" });
    expect(detector.computeSimilarity(a, b)).toBeLessThan(0.3);
  });

  it("表現が少し違うだけの類似テーマは高い類似度になる", () => {
    const a = candidate({ id: "a", title: "50代。会社がなくなったら自分には何が残るのか" });
    const b = candidate({ id: "b", title: "50代。会社がなくなったら私には何が残るのか" });
    expect(detector.computeSimilarity(a, b)).toBeGreaterThan(0.7);
  });

  it("titleが同じ空文字同士は0を返す(0除算しない)", () => {
    const a = candidate({ id: "a" });
    const b = candidate({ id: "b" });
    expect(detector.computeSimilarity(a, b)).toBe(0);
  });
});

describe("findMostSimilarIdea", () => {
  it("自分自身は候補から除外する", () => {
    const target = candidate({ id: "self", title: "同じテーマ" });
    const result = findMostSimilarIdea(target, [target]);
    expect(result).toBeNull();
  });

  it("最も類似度の高いIdeaを返す", () => {
    const target = candidate({ id: "target", title: "50代の会社依存への不安" });
    const close = candidate({ id: "close", title: "50代の会社依存に対する不安" });
    const far = candidate({ id: "far", title: "新NISA完全ガイド" });
    const result = findMostSimilarIdea(target, [close, far]);
    expect(result?.idea.id).toBe("close");
  });
});

describe("isDuplicate", () => {
  it("閾値以上はtrue、未満はfalse", () => {
    expect(isDuplicate(DUPLICATE_SCORE_THRESHOLD)).toBe(true);
    expect(isDuplicate(DUPLICATE_SCORE_THRESHOLD - 0.01)).toBe(false);
  });
});
