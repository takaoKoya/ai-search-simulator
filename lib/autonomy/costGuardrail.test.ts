import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { reconcile, release, reserve } from "@/lib/autonomy/costGuardrail";

const TENANT = "t1";
const NOW = new Date("2026-02-01T12:00:00Z");

function seedTenant(fake: FakeSupabase, overrides: Record<string, unknown> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: TENANT,
    feature_enabled: true,
    autonomy_mode: "ACTIVE",
    emergency_stop: false,
    per_execution_cost_limit_usd: null,
    per_cycle_cost_limit_usd: null,
    daily_cost_limit_usd: null,
    ...overrides,
  });
}

describe("costGuardrail.reserve", () => {
  it("allows a reservation with no limits configured, and creates both the ledger row and the cost_reservations detail row", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);

    const result = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 1, now: NOW });

    expect(result.allowed).toBe(true);
    if (!result.allowed) throw new Error("unreachable");
    expect(fake.table("cost_reservations")).toHaveLength(1);
    expect(fake.table("cost_reservations")[0].status).toBe("RESERVED");
    const ledger = fake.table("cost_ledgers").find((r) => r.tenant_id === TENANT && r.ledger_date === "2026-02-01");
    expect(ledger?.reserved_total_usd).toBe(1);
  });

  it("denies a reservation over per_execution_cost_limit_usd, without touching the ledger", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { per_execution_cost_limit_usd: 5 });

    const result = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 10, now: NOW });

    expect(result).toEqual({ allowed: false, reason: "PER_EXECUTION_LIMIT_EXCEEDED" });
    expect(fake.table("cost_reservations")).toHaveLength(0);
    expect(fake.table("cost_ledgers")).toHaveLength(0);
  });

  it("denies a reservation over per_cycle_cost_limit_usd once prior reservations in the same cycle already committed enough", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { per_cycle_cost_limit_usd: 3 });

    const first = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 2, now: NOW });
    expect(first.allowed).toBe(true);

    const second = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 2, now: NOW });
    expect(second).toEqual({ allowed: false, reason: "PER_CYCLE_LIMIT_EXCEEDED" });
  });

  it("denies a reservation once the daily ledger total would exceed daily_cost_limit_usd", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { daily_cost_limit_usd: 3 });

    const first = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 2, now: NOW });
    expect(first.allowed).toBe(true);

    const second = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-2", estimatedCostUsd: 2, now: NOW });
    expect(second).toEqual({ allowed: false, reason: "DAILY_LIMIT_EXCEEDED" });

    // The denied attempt must not have moved the ledger at all.
    const ledger = fake.table("cost_ledgers").find((r) => r.tenant_id === TENANT);
    expect(ledger?.reserved_total_usd).toBe(2);
  });

  it("Cost Concurrency: of two simultaneous reserve() calls that would together exceed the daily limit, exactly one succeeds", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake, { daily_cost_limit_usd: 3 });

    const [a, b] = await Promise.all([
      reserve(fake as unknown as never, TENANT, { cycleId: "cyc-a", estimatedCostUsd: 2, now: NOW }),
      reserve(fake as unknown as never, TENANT, { cycleId: "cyc-b", estimatedCostUsd: 2, now: NOW }),
    ]);

    const allowedCount = [a, b].filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);
    expect(fake.table("cost_reservations")).toHaveLength(1);
    const ledger = fake.table("cost_ledgers").find((r) => r.tenant_id === TENANT);
    expect(ledger?.reserved_total_usd).toBe(2);
  });

  it("separates ledgers by tenant and by day", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    seedTenant(fake, { tenant_id: "t2" });

    await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 1, now: NOW });
    await reserve(fake as unknown as never, "t2", { cycleId: "cyc-1", estimatedCostUsd: 1, now: NOW });
    await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 1, now: new Date("2026-02-02T00:00:00Z") });

    expect(fake.table("cost_ledgers")).toHaveLength(3);
  });
});

describe("costGuardrail.reconcile / release", () => {
  it("reconcile moves the estimate out of reserved_total and the actual cost into reconciled_total", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    const reservation = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 2, now: NOW });
    if (!reservation.allowed) throw new Error("unreachable");

    await reconcile(fake as unknown as never, TENANT, reservation.reservationId, 1.5);

    const ledger = fake.table("cost_ledgers").find((r) => r.tenant_id === TENANT);
    expect(ledger?.reserved_total_usd).toBe(0);
    expect(ledger?.reconciled_total_usd).toBe(1.5);
    const row = fake.table("cost_reservations").find((r) => r.id === reservation.reservationId);
    expect(row?.status).toBe("RECONCILED");
    expect(row?.actual_cost_usd).toBe(1.5);
  });

  it("release moves the estimate out of reserved_total without touching reconciled_total", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    const reservation = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 2, now: NOW });
    if (!reservation.allowed) throw new Error("unreachable");

    await release(fake as unknown as never, TENANT, reservation.reservationId);

    const ledger = fake.table("cost_ledgers").find((r) => r.tenant_id === TENANT);
    expect(ledger?.reserved_total_usd).toBe(0);
    expect(ledger?.reconciled_total_usd).toBe(0);
    const row = fake.table("cost_reservations").find((r) => r.id === reservation.reservationId);
    expect(row?.status).toBe("RELEASED");
  });

  it("rejects reconciling/releasing a reservation that is not RESERVED", async () => {
    const fake = new FakeSupabase();
    seedTenant(fake);
    const reservation = await reserve(fake as unknown as never, TENANT, { cycleId: "cyc-1", estimatedCostUsd: 2, now: NOW });
    if (!reservation.allowed) throw new Error("unreachable");
    await reconcile(fake as unknown as never, TENANT, reservation.reservationId, 2);

    await expect(reconcile(fake as unknown as never, TENANT, reservation.reservationId, 2)).rejects.toThrow();
    await expect(release(fake as unknown as never, TENANT, reservation.reservationId)).rejects.toThrow();
  });
});
