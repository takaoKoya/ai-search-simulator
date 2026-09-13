import type { Metadata } from "next";
import { getTenantContext } from "@/lib/server/tenant";
import { getOfficeState } from "@/lib/server/officeState";
import OfficeApp from "@/components/office/OfficeApp";

export const metadata: Metadata = {
  title: "AI Office | AI Company OS",
  description: "AI社員が働いている様子を可視化するAI Companyのメイン画面。",
};

export default async function OfficePage() {
  const ctx = await getTenantContext();
  const initialState = await getOfficeState(ctx);

  return <OfficeApp initialState={initialState} role={ctx.role} />;
}
