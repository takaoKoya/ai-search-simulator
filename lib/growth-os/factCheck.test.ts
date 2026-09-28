import { describe, it, expect } from "vitest";
import { enforceFactClaimClassification, resolveSourceHint, hasUnverifiedClaims } from "./factCheck";
import type { SourceEntryInput } from "./ai/types";

describe("enforceFactClaimClassification", () => {
  it("数字を含む主張がVERIFIEDでもSourceが無ければUNVERIFIEDへ強制降格する", () => {
    const result = enforceFactClaimClassification({
      claim: "50代の転職成功率は30%です",
      aiClassification: "VERIFIED",
      sourceHintIndex: null,
    });
    expect(result.classification).toBe("UNVERIFIED");
    expect(result.downgraded).toBe(true);
  });

  it("Sourceが示されていれば数字を含む主張でもVERIFIEDのまま", () => {
    const result = enforceFactClaimClassification({
      claim: "50代の転職成功率は30%です",
      aiClassification: "VERIFIED",
      sourceHintIndex: 0,
    });
    expect(result.classification).toBe("VERIFIED");
    expect(result.downgraded).toBe(false);
  });

  it("Sourceなしの自己申告SUPPORTEDも降格する(AI自身の正しい宣言だけでは信用しない)", () => {
    const result = enforceFactClaimClassification({
      claim: "転職活動は年々厳しくなっていると言われています",
      aiClassification: "SUPPORTED",
      sourceHintIndex: null,
    });
    expect(result.classification).toBe("UNVERIFIED");
    expect(result.downgraded).toBe(true);
  });

  it("OPINION/EXPERIENCEはそもそも事実確認の対象外なので降格しない", () => {
    const opinion = enforceFactClaimClassification({
      claim: "私はこの考え方が好きです",
      aiClassification: "OPINION",
      sourceHintIndex: null,
    });
    expect(opinion.classification).toBe("OPINION");
    expect(opinion.downgraded).toBe(false);

    const experience = enforceFactClaimClassification({
      claim: "私は3年前に転職した",
      aiClassification: "EXPERIENCE",
      sourceHintIndex: null,
    });
    expect(experience.classification).toBe("EXPERIENCE");
    expect(experience.downgraded).toBe(false);
  });
});

describe("resolveSourceHint", () => {
  const sources: SourceEntryInput[] = [
    { id: "src-1", title: "調査A", summary: null },
    { id: "src-2", title: "調査B", summary: null },
  ];

  it("有効なindexは対応するSource IDへ解決する", () => {
    expect(resolveSourceHint(1, sources)).toBe("src-2");
  });

  it("nullは常にnullを返す", () => {
    expect(resolveSourceHint(null, sources)).toBeNull();
  });

  it("範囲外のindex(AIの捏造)はnullを返す", () => {
    expect(resolveSourceHint(5, sources)).toBeNull();
  });
});

describe("hasUnverifiedClaims", () => {
  it("UNVERIFIEDが1件でもあればtrue", () => {
    expect(hasUnverifiedClaims(["VERIFIED", "UNVERIFIED", "OPINION"])).toBe(true);
  });

  it("UNVERIFIEDが無ければfalse", () => {
    expect(hasUnverifiedClaims(["VERIFIED", "SUPPORTED", "OPINION"])).toBe(false);
  });
});
