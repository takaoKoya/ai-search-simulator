import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { computeWorkIdempotencyKey, createAndAuthorizeWork, evaluateAuthority } from "@/lib/autonomy/authorityEngine";
import { AutonomyStoppedError } from "@/lib/autonomy/killSwitch";
import type { ApprovalPolicyRow } from "@/lib/server/approvalPolicy";

const TENANT = "t1";
const SKILL_ID = "11111111-1111-4111-8111-111111111111";

function seedTenant(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: TENANT,
    feature_enabled: true,
    autonomy_mode: "SHADOW",
    emergency_stop: false,
    max_works_per_cycle: 1,
    ...overrides,
  });
}

function seedSkill(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("skill_definitions").push({
    id: SKILL_ID,
    tenant_id: TENANT,
    enabled: true,
    name: "Measurement",
    risk_level: "LOW",
    approval_policy_code: null,
    ...overrides,
  });
}

function seedCycle(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("autonomy_cycles").push({ id: "cyc-1", tenant_id: TENANT, objective_id: "obj-1", cycle_number: 1, status: "RUNNING", ...overrides });
}

const PROPOSED_WORK = {
  title: "Improve CVR",
  skillDefinitionId: SKILL_ID,
  priority: "high" as const,
  estimatedCost: 0,
};

describe("evaluateAuthority (pure)", () => {
  it("is AUTO when the skill names no approval policy at all", () => {
    const result = evaluateAuthority({ skillApprovalPolicyCode: null, estimatedCost: 0, policies: [] });
    expect(result).toEqual({ decision: "AUTO", policyCode: null, matchedPolicy: null });
  });

  it("is APPROVAL when the skill names a policy family but nothing matches it (never a silent AUTO default)", () => {
    const result = evaluateAuthority({ skillApprovalPolicyCode: "deal_won", estimatedCost: 0, policies: [] });
    expect(result.decision).toBe("APPROVAL");
    expect(result.matchedPolicy).toBeNull();
  });

  it("is AUTO when the matched policy has an empty step chain", () => {
    const policies: ApprovalPolicyRow[] = [{ code: "deal_won", conditions: {}, steps: [], is_active: true, hard_deny: false }];
    const result = evaluateAuthority({ skillApprovalPolicyCode: "deal_won", estimatedCost: 0, policies });
    expect(result.decision).toBe("AUTO");
    expect(result.policyCode).toBe("deal_won");
  });

  it("is APPROVAL when the matched policy has a non-empty step chain", () => {
    const policies: ApprovalPolicyRow[] = [{ code: "deal_won", conditions: {}, steps: [{ role: "ceo" }], is_active: true, hard_deny: false }];
    const result = evaluateAuthority({ skillApprovalPolicyCode: "deal_won", estimatedCost: 0, policies });
    expect(result.decision).toBe("APPROVAL");
  });

  it("is DENY, unconditionally, when the matched policy is hard_deny — regardless of its step chain", () => {
    const policies: ApprovalPolicyRow[] = [{ code: "deal_won", conditions: {}, steps: [], is_active: true, hard_deny: true }];
    const result = evaluateAuthority({ skillApprovalPolicyCode: "deal_won", estimatedCost: 0, policies });
    expect(result.decision).toBe("DENY");
    expect(result.policyCode).toBe("deal_won");
  });

  it("never reads a `confidence` field — its input type has none, by construction", () => {
    const input = { skillApprovalPolicyCode: null, estimatedCost: 0, policies: [] };
    expect("confidence" in input).toBe(false);
  });
});

describe("computeWorkIdempotencyKey", () => {
  it("is deterministic for the same inputs", () => {
    const parts = { tenantId: "t1", objectiveId: "o1", observationId: "obs1", skillDefinitionId: "s1", cycleId: "c1" };
    expect(computeWorkIdempotencyKey(parts)).toBe(computeWorkIdempotencyKey({ ...parts }));
  });

  it("differs when any part differs", () => {
    const base = { tenantId: "t1", objectiveId: "o1", observationId: "obs1", skillDefinitionId: "s1", cycleId: "c1" };
    expect(computeWorkIdempotencyKey(base)).not.toBe(computeWorkIdempotencyKey({ ...base, cycleId: "c2" }));
  });
});

describe("createAndAuthorizeWork", () => {
  it("throws AutonomyStoppedError when the kill switch is engaged, and creates no Work row", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { emergency_stop: true });
    seedSkill(fake);
    seedCycle(fake);

    await expect(
      createAndAuthorizeWork(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1", planProposalId: "pp-1", observationId: "obs-1", proposedWork: PROPOSED_WORK })
    ).rejects.toBeInstanceOf(AutonomyStoppedError);
    expect(fake.table("works")).toHaveLength(0);
  });

  it("AUTO: a skill with no approval_policy_code goes straight to APPROVED, no approval_requests row created", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedCycle(fake);

    const result = await createAndAuthorizeWork(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      planProposalId: "pp-1",
      observationId: "obs-1",
      proposedWork: PROPOSED_WORK,
    });

    expect(result.authorityDecision).toBe("AUTO");
    expect(result.status).toBe("APPROVED");
    expect(result.duplicate).toBe(false);
    expect(fake.table("works")[0].status).toBe("APPROVED");
    expect(fake.table("approval_requests")).toHaveLength(0);
    const log = fake.table("decision_logs").find((r) => r.stage === "AUTHORIZE");
    expect(log?.action).toBe("AUTO");
  });

  it("APPROVAL: a skill naming a policy with a step chain goes to AUTHORITY_PENDING and creates a work_creation approval_requests row", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake, { approval_policy_code: "work_creation" });
    seedCycle(fake);
    fake.table("approval_policies").push({ tenant_id: TENANT, code: "work_creation", conditions: {}, steps: [{ role: "manager" }], is_active: true, hard_deny: false });

    const result = await createAndAuthorizeWork(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      planProposalId: "pp-1",
      observationId: "obs-1",
      proposedWork: PROPOSED_WORK,
    });

    expect(result.authorityDecision).toBe("APPROVAL");
    expect(result.status).toBe("AUTHORITY_PENDING");
    const approvals = fake.table("approval_requests");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].type).toBe("work_creation");
    expect(approvals[0].subject_id).toBe(result.workId);
    expect(approvals[0].cycle_id).toBe("cyc-1");
  });

  it("DENY: a hard_deny-matched policy denies the Work immediately, with no approval_requests row (nothing to ask a human)", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake, { approval_policy_code: "work_creation" });
    seedCycle(fake);
    fake.table("approval_policies").push({ tenant_id: TENANT, code: "work_creation", conditions: {}, steps: [{ role: "manager" }], is_active: true, hard_deny: true });

    const result = await createAndAuthorizeWork(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      planProposalId: "pp-1",
      observationId: "obs-1",
      proposedWork: PROPOSED_WORK,
    });

    expect(result.authorityDecision).toBe("DENY");
    expect(result.status).toBe("DENIED");
    expect(fake.table("approval_requests")).toHaveLength(0);
  });

  it("Idempotency: a retried call with the same (objective, observation, skill, cycle) resolves to the existing Work, not a second one", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedSkill(fake);
    seedCycle(fake);

    const first = await createAndAuthorizeWork(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      planProposalId: "pp-1",
      observationId: "obs-1",
      proposedWork: PROPOSED_WORK,
    });
    const second = await createAndAuthorizeWork(fake as unknown as never, TENANT, {
      cycleId: "cyc-1",
      objectiveId: "obj-1",
      planProposalId: "pp-1",
      observationId: "obs-1",
      proposedWork: PROPOSED_WORK,
    });

    expect(second.duplicate).toBe(true);
    expect(second.workId).toBe(first.workId);
    expect(fake.table("works")).toHaveLength(1);
  });

  it("transitions the cycle to FAILED (and never creates a Work row) when the skill is missing or disabled", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedCycle(fake);
    // No skill_definitions row seeded at all for SKILL_ID.

    await expect(
      createAndAuthorizeWork(fake as unknown as never, TENANT, { cycleId: "cyc-1", objectiveId: "obj-1", planProposalId: "pp-1", observationId: "obs-1", proposedWork: PROPOSED_WORK })
    ).rejects.toThrow();

    expect(fake.table("works")).toHaveLength(0);
    expect(fake.table("autonomy_cycles")[0].status).toBe("FAILED");
    const failureLog = fake.table("decision_logs").find((r) => r.action === "AUTHORIZE_FAILED");
    expect(failureLog?.actor_type).toBe("SYSTEM");
  });
});
