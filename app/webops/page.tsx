import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_ROUTE } from "@/lib/routes";
import WebOpsOffice from "@/components/weboffice/WebOpsOffice";

export const metadata: Metadata = {
  title: "WEB事業運用オフィス | AI Company OS",
  description: "SNS運用チームの1日を可視化するシミュレーション画面。",
};

/**
 * A standalone demo screen, deliberately separate from the tenant-scoped AI
 * Company OS (/office): it needs a logged-in user (same login screen) but
 * touches no tenant tables at all — the whole thing is a scripted,
 * client-side simulation (see lib/weboffice/script.ts).
 */
export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(LOGIN_ROUTE);
  }

  return <WebOpsOffice />;
}
