import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { resolveCandidateSkills } from "@/lib/autonomy/skillCandidateResolver";

const TENANT = "t1";

function seedSkill(fake: FakeSupabase, overrides: Record<string, unknown>) {
  fake.table("skill_definitions").push({
    id: `skill-${fake.table("skill_definitions").length}`,
    tenant_id: TENANT,
    enabled: true,
    department: "production",
    risk_level: "LOW",
    executor_ref: "measurement_graph",
    name: "Measurement",
    description: null,
    ...overrides,
  });
}

describe("resolveCandidateSkills", () => {
  it("excludes disabled skills and skills from other tenants", async () => {
    const fake = new FakeSupabase();
    seedSkill(fake, { name: "A" });
    seedSkill(fake, { name: "B", enabled: false });
    seedSkill(fake, { name: "C", tenant_id: "other-tenant" });

    const result = await resolveCandidateSkills(fake as unknown as never, TENANT);
    expect(result.map((s) => s.name)).toEqual(["A"]);
  });

  it("filters by department when given", async () => {
    const fake = new FakeSupabase();
    seedSkill(fake, { name: "Sales Draft", department: "sales" });
    seedSkill(fake, { name: "Measurement", department: "production" });

    const result = await resolveCandidateSkills(fake as unknown as never, TENANT, { department: "sales" });
    expect(result.map((s) => s.name)).toEqual(["Sales Draft"]);
  });

  it("filters out skills above the given risk ceiling", async () => {
    const fake = new FakeSupabase();
    seedSkill(fake, { name: "Low Risk", risk_level: "LOW" });
    seedSkill(fake, { name: "High Risk", risk_level: "HIGH" });

    const result = await resolveCandidateSkills(fake as unknown as never, TENANT, { maxRiskLevel: "MEDIUM" });
    expect(result.map((s) => s.name)).toEqual(["Low Risk"]);
  });

  it("stays bounded by `limit` regardless of registry size (the contract that keeps this correct at 1000+ skills)", async () => {
    const fake = new FakeSupabase();
    for (let i = 0; i < 1000; i += 1) seedSkill(fake, { name: `Skill ${i}` });

    const result = await resolveCandidateSkills(fake as unknown as never, TENANT, { limit: 20 });
    expect(result).toHaveLength(20);
  });
});
