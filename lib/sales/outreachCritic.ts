/**
 * Sales Critic checklist for outreach emails (spec §9), as a pure function
 * so it is independently unit-testable from the full graph. Combined with
 * `lib/sales/criticGate.ts`'s revision-loop cap the same way the Phase 3
 * hypothesis/draft critics are.
 */

const BANNED_CLAIM_PATTERN = /断言|保証|確実に|100%|絶対|必ず成功|実績多数|業界No\.?1/;
const PII_LIKE_PATTERN = /\d{2,4}-\d{2,4}-\d{4}|[0-9]{7,}/;

export interface OutreachDraftForReview {
  subject: string;
  personalizedObservation: string;
  problemHypothesis: string;
  valueProposition: string;
  evidence: unknown[];
  cta: string;
  body: string;
}

export interface OutreachCriticContext {
  isDuplicateRecent: boolean;
  isDoNotContact: boolean;
}

export interface OutreachCriticResult {
  passed: boolean;
  /** Each issue is prefixed with its checklist category (spec §9). */
  issues: string[];
}

/** Lighter checklist for a reply draft (spec §19-20): no CTA/evidence requirement — it's answering, not prospecting. */
export function checkReplyDraft(body: string, ctx: { isDoNotContact: boolean }): OutreachCriticResult {
  const issues: string[] = [];
  if (ctx.isDoNotContact) issues.push("DNC: Do Not Contactリストに一致する企業のため返信できません。");
  if (BANNED_CLAIM_PATTERN.test(body)) issues.push("CLAIM_RISK: 誇張・断定的な表現、根拠のない成果保証を含みます。");
  if (body.length > 800) issues.push("LENGTH: 返信としては長すぎます。");
  if (PII_LIKE_PATTERN.test(body)) issues.push("PRIVACY: 個人情報らしき文字列が含まれています。");
  return { passed: issues.length === 0, issues };
}

export function checkOutreachDraft(draft: OutreachDraftForReview, ctx: OutreachCriticContext): OutreachCriticResult {
  const issues: string[] = [];

  if (ctx.isDoNotContact) {
    issues.push("DNC: Do Not Contactリストに一致する企業のため送信できません。");
  }
  if (ctx.isDuplicateRecent) {
    issues.push("DUPLICATE_OUTREACH: 直近に同一Leadへ営業メールを送信済みです。");
  }

  const claimText = `${draft.subject} ${draft.problemHypothesis} ${draft.valueProposition}`;
  if (BANNED_CLAIM_PATTERN.test(claimText)) {
    issues.push("CLAIM_RISK: 誇張・断定的な表現、根拠のない成果保証を含みます。");
  }
  if (/[!?]{2,}/.test(draft.subject)) {
    issues.push("BRAND_SAFETY: 件名に過度な感嘆符・疑問符があります。");
  }

  if (draft.evidence.length === 0) {
    issues.push("PERSONALIZATION: 根拠となるEvidenceがありません。");
  }
  if (!draft.personalizedObservation || draft.personalizedObservation.trim().length < 5) {
    issues.push("TONE: パーソナライズ部分が不十分です。");
  }
  if (PII_LIKE_PATTERN.test(draft.personalizedObservation)) {
    issues.push("PRIVACY: パーソナライズ部分に個人情報らしき文字列が含まれています。");
  }

  if (draft.body.length > 800) {
    issues.push("LENGTH: 初回営業メールとしては長すぎます。");
  }

  const ctaSentences = draft.cta.split(/[。.!?]/).map((s) => s.trim()).filter(Boolean);
  if (ctaSentences.length === 0) {
    issues.push("CTA: CTAがありません。");
  } else if (ctaSentences.length > 1) {
    issues.push("CTA: CTAは1つに絞ってください。");
  }

  return { passed: issues.length === 0, issues };
}
