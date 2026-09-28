// 架空体験の捏造を防ぐためのガード(セクション3・11・17)。
// AIは Experience Library に存在するID以外を experience_ids_used として返してはならず、
// 一人称の体験談マーカーを含む文章には対応する experience_ids_used が必要になる。
// 「AI自身がそう言っている」だけでは信用しない、というフェーズ2からの一貫方針をここでも適用する。

const FIRST_PERSON_EXPERIENCE_MARKERS = [
  /私は.{0,15}(年|ヶ月|か月)前/,
  /実際に.{0,10}(した|やった|経験)/,
  /私も.{0,10}(経験|体験)/,
  /私自身.{0,10}(経験|体験)/,
  /以前、私は/,
  /私が.{0,10}会社員だった(頃|とき)/,
];

export interface ExperienceGuardInput {
  text: string;
  experienceIdsUsed: string[];
  /** プロンプトで実際に提供したExperience LibraryのID一覧。この集合外のIDはすべて捏造とみなす。 */
  availableExperienceIds: string[];
}

export interface ExperienceGuardViolation {
  type: "HALLUCINATED_ID" | "UNGROUNDED_FIRST_PERSON";
  detail: string;
}

export interface ExperienceGuardResult {
  ok: boolean;
  violations: ExperienceGuardViolation[];
}

/**
 * 1. experience_ids_used に、提供していないID(=AIの捏造)が含まれていないか検査する。
 * 2. 一人称体験マーカーを含む文章なのに experience_ids_used が空の場合、
 *    「体験を捏造した」疑いがあるため違反として検出する(ルールベースの安全網。AI自己申告だけに頼らない)。
 */
export function checkExperienceGuard(input: ExperienceGuardInput): ExperienceGuardResult {
  const violations: ExperienceGuardViolation[] = [];
  const availableSet = new Set(input.availableExperienceIds);

  for (const id of input.experienceIdsUsed) {
    if (!availableSet.has(id)) {
      violations.push({
        type: "HALLUCINATED_ID",
        detail: `Experience Libraryに存在しないID "${id}" が使用されています`,
      });
    }
  }

  const hasFirstPersonMarker = FIRST_PERSON_EXPERIENCE_MARKERS.some((re) => re.test(input.text));
  if (hasFirstPersonMarker && input.experienceIdsUsed.length === 0) {
    violations.push({
      type: "UNGROUNDED_FIRST_PERSON",
      detail: "一人称の体験談らしき表現がありますが、根拠となるExperience Libraryの項目が紐付いていません",
    });
  }

  return { ok: violations.length === 0, violations };
}

/** experience_ids_used のうち、実在するものだけを残す(捏造IDをDBへ保存しないための最終防波堤)。 */
export function sanitizeExperienceIds(experienceIdsUsed: string[], availableExperienceIds: string[]): string[] {
  const availableSet = new Set(availableExperienceIds);
  return experienceIdsUsed.filter((id) => availableSet.has(id));
}
