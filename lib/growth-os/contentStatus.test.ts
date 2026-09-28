import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, InvalidContentStatusTransitionError, isAwaitingHumanApproval } from "./contentStatus";

describe("canTransition", () => {
  it("正規の工程順の遷移は許可される", () => {
    expect(canTransition("IDEA", "STRATEGY")).toBe(true);
    expect(canTransition("STRATEGY", "OUTLINE")).toBe(true);
    expect(canTransition("OUTLINE", "DRAFT")).toBe(true);
    expect(canTransition("DRAFT", "AI_REVIEW")).toBe(true);
    expect(canTransition("AI_REVIEW", "FACT_CHECK")).toBe(true);
    expect(canTransition("FACT_CHECK", "WAITING_APPROVAL")).toBe(true);
    expect(canTransition("WAITING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "PUBLISHED")).toBe(true);
    expect(canTransition("PUBLISHED", "ANALYZED")).toBe(true);
  });

  it("AI_REVIEWでの大きな修正はDRAFTへ差し戻せる", () => {
    expect(canTransition("AI_REVIEW", "DRAFT")).toBe(true);
  });

  it("工程を飛ばした遷移は禁止される", () => {
    expect(canTransition("STRATEGY", "WAITING_APPROVAL")).toBe(false);
    expect(canTransition("IDEA", "PUBLISHED")).toBe(false);
    expect(canTransition("OUTLINE", "FACT_CHECK")).toBe(false);
  });

  it("終端状態からはどこにも遷移できない(REJECTED/ANALYZED)", () => {
    expect(canTransition("REJECTED", "STRATEGY")).toBe(false);
    expect(canTransition("ANALYZED", "PUBLISHED")).toBe(false);
  });

  it("同じ状態への遷移は常に許可される(冪等)", () => {
    expect(canTransition("DRAFT", "DRAFT")).toBe(true);
  });
});

describe("assertTransition", () => {
  it("不正な遷移はInvalidContentStatusTransitionErrorを投げる", () => {
    expect(() => assertTransition("STRATEGY", "PUBLISHED")).toThrow(InvalidContentStatusTransitionError);
  });

  it("正規の遷移は例外を投げない", () => {
    expect(() => assertTransition("DRAFT", "AI_REVIEW")).not.toThrow();
  });
});

describe("isAwaitingHumanApproval", () => {
  it("OUTLINEとWAITING_APPROVALはtrue", () => {
    expect(isAwaitingHumanApproval("OUTLINE")).toBe(true);
    expect(isAwaitingHumanApproval("WAITING_APPROVAL")).toBe(true);
  });

  it("それ以外はfalse", () => {
    expect(isAwaitingHumanApproval("DRAFT")).toBe(false);
    expect(isAwaitingHumanApproval("PUBLISHED")).toBe(false);
  });
});
