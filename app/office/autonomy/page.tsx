import type { Metadata } from "next";
import { getTenantContext } from "@/lib/server/tenant";
import { getAutonomyCockpitState } from "@/lib/server/autonomyCockpit";
import AutonomyPilotPanel from "@/components/office/AutonomyPilotPanel";

export const metadata: Metadata = {
  title: "Autonomy Cockpit | AI Company OS",
  description: "AI Company OSのAutonomy Runtime Pilot Cockpit。",
};

export default async function AutonomyCockpitPage() {
  const ctx = await getTenantContext();
  const initialState = await getAutonomyCockpitState(ctx);

  return (
    <div className="ai-office min-h-screen p-4" style={{ background: "var(--office-bg-primary)" }}>
      <div className="mx-auto max-w-5xl">
        <AutonomyPilotPanel initialState={initialState} role={ctx.role} />
      </div>
    </div>
  );
}
