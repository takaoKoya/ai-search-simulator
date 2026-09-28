// 統一Content Status(セクション20)の状態遷移を一元管理するService層。
// UIやRoute Handlerから直接 status を書き換えることを禁止し、必ず
// canTransition/assertTransition を通すことで、工程を飛ばした不正な遷移を防ぐ。

import type { NoteArticleStatus } from "@/lib/growth-os/types";

const ALLOWED_TRANSITIONS: Record<NoteArticleStatus, NoteArticleStatus[]> = {
  IDEA: ["STRATEGY", "REJECTED"],
  STRATEGY: ["OUTLINE", "REJECTED"],
  OUTLINE: ["DRAFT", "REJECTED"],
  // AI_REVIEW/FACT_CHECKでの修正指示はSection単位の再生成にとどめ(セクション15)、
  // Outlineまで差し戻すことはしない。DRAFTへ戻れるのはAI_REVIEWでの大きな書き直しのみ。
  DRAFT: ["AI_REVIEW", "REJECTED"],
  AI_REVIEW: ["DRAFT", "FACT_CHECK", "REJECTED"],
  FACT_CHECK: ["AI_REVIEW", "WAITING_APPROVAL", "REJECTED"],
  WAITING_APPROVAL: ["APPROVED", "DRAFT", "REJECTED"],
  APPROVED: ["PUBLISHED", "WAITING_APPROVAL", "REJECTED"],
  PUBLISHED: ["ANALYZED"],
  ANALYZED: [],
  REJECTED: [],
};

export function canTransition(from: NoteArticleStatus, to: NoteArticleStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidContentStatusTransitionError extends Error {
  constructor(from: NoteArticleStatus, to: NoteArticleStatus) {
    super(`Content Statusを ${from} から ${to} へ直接遷移することはできません`);
    this.name = "InvalidContentStatusTransitionError";
  }
}

export function assertTransition(from: NoteArticleStatus, to: NoteArticleStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidContentStatusTransitionError(from, to);
  }
}

/** WAITING_APPROVALに到達しているか(Approval Queueの対象かどうか)の判定。 */
export function isAwaitingHumanApproval(status: NoteArticleStatus): boolean {
  return status === "WAITING_APPROVAL" || status === "OUTLINE";
}
