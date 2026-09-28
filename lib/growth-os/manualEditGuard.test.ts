import { describe, it, expect } from "vitest";
import { canAiRegenerate, canRewriteThreadsPost } from "./manualEditGuard";

describe("canAiRegenerate", () => {
  it("手動編集済みならfalse", () => {
    expect(canAiRegenerate(true)).toBe(false);
  });

  it("未編集ならtrue", () => {
    expect(canAiRegenerate(false)).toBe(true);
  });
});

describe("canRewriteThreadsPost", () => {
  it("手動編集済みなら常にfalse(上限未達でも)", () => {
    expect(canRewriteThreadsPost(true, 0)).toBe(false);
  });

  it("リライト回数が上限(2回)未満なら許可する", () => {
    expect(canRewriteThreadsPost(false, 0)).toBe(true);
    expect(canRewriteThreadsPost(false, 1)).toBe(true);
  });

  it("リライト回数が上限に達したら禁止する(無限ループ防止)", () => {
    expect(canRewriteThreadsPost(false, 2)).toBe(false);
    expect(canRewriteThreadsPost(false, 3)).toBe(false);
  });
});
