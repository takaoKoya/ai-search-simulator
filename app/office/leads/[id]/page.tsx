import type { Metadata } from "next";
import { getTenantContext } from "@/lib/server/tenant";
import { getLeadDetailState } from "@/lib/server/leadDetail";
import LeadDetail from "@/components/office/LeadDetail";

export const metadata: Metadata = {
  title: "Lead Detail | AI Company OS",
  description: "AI営業部が発見・評価したLead候補の詳細。",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getTenantContext();
  const initialState = await getLeadDetailState(ctx, id);

  return <LeadDetail leadId={id} initialState={initialState} role={ctx.role} />;
}
