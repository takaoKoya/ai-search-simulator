export type OutreachChannel = "EMAIL" | "CONTACT_FORM" | "MANUAL_PHONE" | "LINKEDIN" | "OTHER";

export interface ChannelRecommendation {
  channel: OutreachChannel;
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  availableContact: string | null;
  risk: string | null;
}

/**
 * Channel selection (spec §4): EMAIL is preferred in Phase 4, but only when
 * a contact address actually exists. Contact-form/SNS-DM send automation is
 * explicitly not rushed (spec §4), so a lead with no derivable address never
 * gets an EMAIL recommendation — it falls back to CONTACT_FORM with a
 * visible risk note instead of guessing an address.
 *
 * `testMode` candidates get a clearly-synthetic test address
 * (`info@<domain>`) so the vertical slice can exercise the EMAIL path
 * end-to-end without ever inventing a real person's contact information
 * (spec §13 Contact Information minimalism carried over from Phase 3).
 */
export function recommendChannel(input: {
  normalizedDomain: string | null;
  websiteUrl: string | null;
  testMode: boolean;
}): ChannelRecommendation {
  if (input.testMode && input.normalizedDomain) {
    return {
      channel: "EMAIL",
      reason: "テストモードのため、ドメインから合成した検証用アドレスへEMAIL送信を行います。",
      confidence: "HIGH",
      availableContact: `info@${input.normalizedDomain}`,
      risk: null,
    };
  }
  if (input.websiteUrl) {
    return {
      channel: "CONTACT_FORM",
      reason: "実在の連絡先メールアドレスが未確認のため、Webサイトの問い合わせフォームを優先します。",
      confidence: "LOW",
      availableContact: null,
      risk: "宛先メールアドレスが未確認。フォーム送信の自動化は本フェーズでは行わない。",
    };
  }
  return {
    channel: "OTHER",
    reason: "確認可能な連絡経路がありません。",
    confidence: "LOW",
    availableContact: null,
    risk: "連絡経路が未確認のため送信不可。",
  };
}
