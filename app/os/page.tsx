import { redirect } from "next/navigation";
import { GROWTH_OS_DASHBOARD_ROUTE } from "@/lib/routes";

export default function GrowthOsIndexPage() {
  redirect(GROWTH_OS_DASHBOARD_ROUTE);
}
