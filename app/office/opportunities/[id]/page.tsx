import type { Metadata } from "next";
import { getTenantContext } from "@/lib/server/tenant";
import { getOpportunityDetailState } from "@/lib/server/opportunityDetail";
import OpportunityDetail from "@/components/office/OpportunityDetail";

export const metadata: Metadata = {
  title: "Opportunity Detail | AI Company OS",
  description: "商談〜受注/失注までを一元管理するOpportunity Detail。",
};

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getTenantContext();
  const initialState = await getOpportunityDetailState(ctx, id);

  return <OpportunityDetail opportunityId={id} initialState={initialState} role={ctx.role} />;
}
