import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { checkFollowupsForTenant } from "@/lib/server/followupCheck";
import type { BusinessCalendar } from "@/lib/server/businessCalendar";

const CALENDAR: BusinessCalendar = { timezone: "Asia/Tokyo", workingDays: [1, 2, 3, 4, 5], businessHours: { start: "09:00", end: "18:00" }, holidays: [] };

// A fixed "now" far enough after sentAt to guarantee several business days
// have elapsed regardless of which day of the week the test happens to run.
const NOW = new Date("2026-01-20T00:00:00Z"); // a Tuesday
const OLD_SENT_AT = "2026-01-05T01:00:00Z"; // a Monday, 2 weeks earlier

describe("checkFollowupsForTenant", () => {
  it("creates a candidate for an unanswered outbound message sent long enough ago", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("sales_messages").push({
      id: "msg-1",
      tenant_id: tenantId,
      conversation_id: "conv-1",
      lead_id: "lead-1",
      direction: "OUTBOUND",
      status: "SENT",
      subject: "ご提案",
      recipient_name: null,
      sent_at: OLD_SENT_AT,
    });

    const result = await checkFollowupsForTenant(fake as unknown as never, tenantId, CALENDAR, NOW);
    expect(result.created).toBe(1);

    const candidate = fake.table("followup_candidates")[0];
    expect(candidate.status).toBe("CANDIDATE");
    expect(candidate.original_message_id).toBe("msg-1");
    expect(candidate.sequence_number).toBe(1);
    expect(candidate.draft_subject).toBe("Re: ご提案");
  });

  it("does not create a candidate when the lead already replied", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("sales_messages").push(
      { id: "msg-1", tenant_id: tenantId, conversation_id: "conv-1", lead_id: "lead-1", direction: "OUTBOUND", status: "SENT", subject: "ご提案", sent_at: OLD_SENT_AT },
      { id: "msg-2", tenant_id: tenantId, conversation_id: "conv-1", lead_id: "lead-1", direction: "INBOUND", status: "DELIVERED", created_at: "2026-01-06T01:00:00Z" }
    );

    const result = await checkFollowupsForTenant(fake as unknown as never, tenantId, CALENDAR, NOW);
    expect(result.created).toBe(0);
  });

  it("does not create a candidate before the minimum business-day threshold", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("sales_messages").push({
      id: "msg-1",
      tenant_id: tenantId,
      conversation_id: "conv-1",
      lead_id: "lead-1",
      direction: "OUTBOUND",
      status: "SENT",
      subject: "ご提案",
      sent_at: "2026-01-19T01:00:00Z", // yesterday relative to NOW
    });

    const result = await checkFollowupsForTenant(fake as unknown as never, tenantId, CALENDAR, NOW);
    expect(result.created).toBe(0);
  });

  it("stops creating candidates once the max follow-up count is reached", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("sales_messages").push({ id: "msg-1", tenant_id: tenantId, conversation_id: "conv-1", lead_id: "lead-1", direction: "OUTBOUND", status: "SENT", subject: "ご提案", sent_at: OLD_SENT_AT });
    fake.table("followup_candidates").push(
      { id: "fc-1", tenant_id: tenantId, original_message_id: "msg-1" },
      { id: "fc-2", tenant_id: tenantId, original_message_id: "msg-1" }
    );

    const result = await checkFollowupsForTenant(fake as unknown as never, tenantId, CALENDAR, NOW);
    expect(result.created).toBe(0);
  });

  it("never touches sales_messages.status or sends anything — only inserts CANDIDATE rows", async () => {
    const fake = new FakeSupabase();
    const tenantId = "t1";
    fake.table("leads").push({ id: "lead-1", tenant_id: tenantId, company_name: "テスト株式会社" });
    fake.table("sales_messages").push({ id: "msg-1", tenant_id: tenantId, conversation_id: "conv-1", lead_id: "lead-1", direction: "OUTBOUND", status: "SENT", subject: "ご提案", sent_at: OLD_SENT_AT });

    await checkFollowupsForTenant(fake as unknown as never, tenantId, CALENDAR, NOW);

    expect(fake.table("sales_messages")[0].status).toBe("SENT");
  });
});
