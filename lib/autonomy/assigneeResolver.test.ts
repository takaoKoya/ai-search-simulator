import { describe, expect, it } from "vitest";
import { resolveAssignee } from "@/lib/autonomy/assigneeResolver";

describe("resolveAssignee", () => {
  it("always returns SYSTEM_ASSIGNEE in PHASE 1", () => {
    expect(resolveAssignee()).toEqual({ assigneeType: "SYSTEM", assigneeRef: "SYSTEM_ASSIGNEE" });
  });

  it("is stable across repeated calls (no hidden state/randomness)", () => {
    expect(resolveAssignee()).toEqual(resolveAssignee());
  });
});
