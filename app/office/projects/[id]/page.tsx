import type { Metadata } from "next";
import { getTenantContext } from "@/lib/server/tenant";
import { getProjectRoomState } from "@/lib/server/projectRoom";
import ProjectRoom from "@/components/office/ProjectRoom";

export const metadata: Metadata = {
  title: "Project Room | AI Company OS",
  description: "個別案件だけを見るためのProject Room。",
};

export default async function ProjectRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getTenantContext();
  const initialState = await getProjectRoomState(ctx, id);

  return <ProjectRoom projectId={id} initialState={initialState} role={ctx.role} />;
}
