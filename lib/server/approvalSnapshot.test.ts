import { describe, expect, it } from "vitest";
import { checkSnapshot, computeSnapshotHash } from "@/lib/server/approvalSnapshot";

describe("computeSnapshotHash", () => {
  it("is stable regardless of key order", () => {
    const a = computeSnapshotHash({ to: "x@example.com", subject: "Hi" });
    const b = computeSnapshotHash({ subject: "Hi", to: "x@example.com" });
    expect(a).toBe(b);
  });

  it("changes when any field value changes", () => {
    const a = computeSnapshotHash({ to: "x@example.com", subject: "Hi" });
    const b = computeSnapshotHash({ to: "y@example.com", subject: "Hi" });
    expect(a).not.toBe(b);
  });

  it("distinguishes nested object/array structure, not just flattened values", () => {
    const a = computeSnapshotHash({ items: [{ a: 1 }, { b: 2 }] });
    const b = computeSnapshotHash({ items: [{ b: 2 }, { a: 1 }] });
    expect(a).not.toBe(b);
  });
});

describe("checkSnapshot", () => {
  it("passes when no snapshotHash was ever computed (legacy approval types)", () => {
    const result = checkSnapshot({ snapshotHash: null, expiresAt: null, currentFields: { to: "x@example.com" } });
    expect(result.valid).toBe(true);
  });

  it("passes when the current fields still hash to the stored snapshot", () => {
    const fields = { to: "x@example.com", subject: "Hi", body: "Body" };
    const hash = computeSnapshotHash(fields);
    const result = checkSnapshot({ snapshotHash: hash, expiresAt: null, currentFields: fields });
    expect(result.valid).toBe(true);
  });

  it("fails with APPROVAL_INVALIDATED when the recipient changed since approval", () => {
    const approvedFields = { to: "x@example.com", subject: "Hi", body: "Body" };
    const hash = computeSnapshotHash(approvedFields);
    const currentFields = { ...approvedFields, to: "attacker@example.com" };
    const result = checkSnapshot({ snapshotHash: hash, expiresAt: null, currentFields });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("APPROVAL_INVALIDATED");
  });

  it("fails with APPROVAL_INVALIDATED when the body changed since approval", () => {
    const approvedFields = { to: "x@example.com", subject: "Hi", body: "Original body" };
    const hash = computeSnapshotHash(approvedFields);
    const currentFields = { ...approvedFields, body: "Edited body" };
    const result = checkSnapshot({ snapshotHash: hash, expiresAt: null, currentFields });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("APPROVAL_INVALIDATED");
  });

  it("fails with APPROVAL_EXPIRED when past expiresAt, even if content is unchanged", () => {
    const fields = { to: "x@example.com" };
    const hash = computeSnapshotHash(fields);
    const result = checkSnapshot({ snapshotHash: hash, expiresAt: new Date(Date.now() - 1000).toISOString(), currentFields: fields });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("APPROVAL_EXPIRED");
  });

  it("passes when expiresAt is in the future", () => {
    const fields = { to: "x@example.com" };
    const hash = computeSnapshotHash(fields);
    const result = checkSnapshot({ snapshotHash: hash, expiresAt: new Date(Date.now() + 3600_000).toISOString(), currentFields: fields });
    expect(result.valid).toBe(true);
  });
});
