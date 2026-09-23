import { describe, expect, it } from "vitest";
import { FakeSupabase } from "@/lib/testing/fakeSupabase";
import { assertNotStopped, AutonomyStoppedError } from "@/lib/autonomy/killSwitch";

const TENANT = "t1";

function seedSettings(fake: FakeSupabase, overrides: Partial<Record<string, unknown>> = {}) {
  fake.table("tenant_autonomy_settings").push({
    tenant_id: TENANT,
    feature_enabled: true,
    autonomy_mode: "ASSISTED",
    emergency_stop: false,
    ...overrides,
  });
}

describe("assertNotStopped", () => {
  it("passes through the settings when enabled, mode set, and not stopped", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake);
    const settings = await assertNotStopped(fake as unknown as never, TENANT);
    expect(settings.autonomy_mode).toBe("ASSISTED");
  });

  it("blocks when feature_enabled is false", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, { feature_enabled: false });
    await expect(assertNotStopped(fake as unknown as never, TENANT)).rejects.toBeInstanceOf(AutonomyStoppedError);
  });

  it("blocks when emergency_stop is true even if mode is ACTIVE", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, { autonomy_mode: "ACTIVE", emergency_stop: true });
    await expect(assertNotStopped(fake as unknown as never, TENANT)).rejects.toBeInstanceOf(AutonomyStoppedError);
  });

  it("blocks when autonomy_mode is OFF", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, { autonomy_mode: "OFF" });
    await expect(assertNotStopped(fake as unknown as never, TENANT)).rejects.toBeInstanceOf(AutonomyStoppedError);
  });

  it("blocks when no settings row exists at all", async () => {
    const fake = new FakeSupabase();
    await expect(assertNotStopped(fake as unknown as never, TENANT)).rejects.toBeInstanceOf(AutonomyStoppedError);
  });

  it("never lets one tenant read another tenant's settings", async () => {
    const fake = new FakeSupabase();
    seedSettings(fake, { tenant_id: "other-tenant" });
    await expect(assertNotStopped(fake as unknown as never, TENANT)).rejects.toBeInstanceOf(AutonomyStoppedError);
  });
});
