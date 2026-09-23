/**
 * AssigneeResolver — PHASE 1 always resolves to the system itself; there is
 * no per-AI-employee routing yet. Kept as its own module/function (rather
 * than inlined into the Execution Adapter) so a later phase's
 * `AI_EMPLOYEE` branch is a pure addition, not a rewrite of the Execution
 * Adapter's contract.
 */

export interface AssigneeResolution {
  assigneeType: "SYSTEM" | "AI_EMPLOYEE";
  assigneeRef: string;
}

export function resolveAssignee(): AssigneeResolution {
  return { assigneeType: "SYSTEM", assigneeRef: "SYSTEM_ASSIGNEE" };
}
