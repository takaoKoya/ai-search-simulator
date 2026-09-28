import { describe, it, expect } from "vitest";
import { checkExperienceGuard, sanitizeExperienceIds } from "./experienceGuard";

describe("checkExperienceGuard", () => {
  it("Experience Libraryが空で一人称の体験談を書くと違反になる", () => {
    const result = checkExperienceGuard({
      text: "私は3年前に会社を辞めて、実際に転職活動をした経験があります。",
      experienceIdsUsed: [],
      availableExperienceIds: [],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.type === "UNGROUNDED_FIRST_PERSON")).toBe(true);
  });

  it("提供していないIDをexperience_ids_usedに入れるとHALLUCINATED_ID違反になる", () => {
    const result = checkExperienceGuard({
      text: "一般的なケースでは、50代の転職は難しいと言われています。",
      experienceIdsUsed: ["exp-fake"],
      availableExperienceIds: ["exp-real"],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.type === "HALLUCINATED_ID")).toBe(true);
  });

  it("登録済みの体験を正しく引用していれば違反なし", () => {
    const result = checkExperienceGuard({
      text: "私は3年前に転職活動をして苦労しました。",
      experienceIdsUsed: ["exp-real"],
      availableExperienceIds: ["exp-real"],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("一人称マーカーが無い一般論の文章は体験の紐付けが無くても違反にしない", () => {
    const result = checkExperienceGuard({
      text: "調査で見えてきたこととして、50代の転職市場は年々厳しくなっています。",
      experienceIdsUsed: [],
      availableExperienceIds: [],
    });
    expect(result.ok).toBe(true);
  });
});

describe("sanitizeExperienceIds", () => {
  it("提供済みIDの集合に無いものは除去する", () => {
    const result = sanitizeExperienceIds(["a", "b", "c"], ["a", "c"]);
    expect(result).toEqual(["a", "c"]);
  });

  it("すべて捏造なら空配列になる", () => {
    expect(sanitizeExperienceIds(["x", "y"], [])).toEqual([]);
  });
});
