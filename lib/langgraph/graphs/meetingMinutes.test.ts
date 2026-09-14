import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { createGraphRunCtx } from "@/lib/langgraph/context";
import { materializeActionItemCandidates } from "@/lib/langgraph/graphs/meetingMinutes";

describe("materializeActionItemCandidates", () => {
  it("inserts one CANDIDATE row per extracted action item, owner/due_date left null", async () => {
    const fake = new FakeSupabase();
    const ctx = createGraphRunCtx(fake as unknown as never, "t1", "run-1");

    await materializeActionItemCandidates(ctx, {
      meetingId: "meeting-1",
      opportunityId: "opp-1",
      candidates: [{ description: "見積書を送付する" }, { description: "資料を準備する" }],
    });

    const rows = fake.table("meeting_action_items");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("CANDIDATE");
      expect(row.owner).toBeUndefined();
      expect(row.due_date).toBeUndefined();
      expect(row.opportunity_id).toBe("opp-1");
      expect(row.meeting_id).toBe("meeting-1");
    }
  });

  it("does nothing when there are no candidates", async () => {
    const fake = new FakeSupabase();
    const ctx = createGraphRunCtx(fake as unknown as never, "t1", "run-1");
    await materializeActionItemCandidates(ctx, { meetingId: "meeting-1", opportunityId: "opp-1", candidates: [] });
    expect(fake.table("meeting_action_items")).toHaveLength(0);
  });

  it("flags a possible duplicate against an existing non-rejected action item on the same opportunity", async () => {
    const fake = new FakeSupabase();
    fake.table("meeting_action_items").push({
      id: "existing-1",
      tenant_id: "t1",
      opportunity_id: "opp-1",
      meeting_id: "earlier-meeting",
      description: "見積書を送付する",
      status: "CONFIRMED",
    });
    const ctx = createGraphRunCtx(fake as unknown as never, "t1", "run-1");

    await materializeActionItemCandidates(ctx, { meetingId: "meeting-2", opportunityId: "opp-1", candidates: [{ description: "見積書を送付する" }] });

    const newRow = fake.table("meeting_action_items").find((r) => r.meeting_id === "meeting-2")!;
    expect(newRow.possible_duplicate_of).toBe("existing-1");
  });

  it("ignores a REJECTED existing item when checking for duplicates", async () => {
    const fake = new FakeSupabase();
    fake.table("meeting_action_items").push({
      id: "existing-1",
      tenant_id: "t1",
      opportunity_id: "opp-1",
      meeting_id: "earlier-meeting",
      description: "見積書を送付する",
      status: "REJECTED",
    });
    const ctx = createGraphRunCtx(fake as unknown as never, "t1", "run-1");

    await materializeActionItemCandidates(ctx, { meetingId: "meeting-2", opportunityId: "opp-1", candidates: [{ description: "見積書を送付する" }] });

    const newRow = fake.table("meeting_action_items").find((r) => r.meeting_id === "meeting-2")!;
    expect(newRow.possible_duplicate_of).toBeNull();
  });

  it("skips duplicate lookup entirely when the meeting has no opportunity yet", async () => {
    const fake = new FakeSupabase();
    const ctx = createGraphRunCtx(fake as unknown as never, "t1", "run-1");
    await materializeActionItemCandidates(ctx, { meetingId: "meeting-1", opportunityId: null, candidates: [{ description: "見積書を送付する" }] });
    const row = fake.table("meeting_action_items")[0];
    expect(row.possible_duplicate_of).toBeNull();
  });
});
