import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { GrowthOsShell } from "@/components/growth-os/layout/GrowthOsShell";

export const metadata: Metadata = {
  title: "note Growth OS",
  description: "50代会社員向けnoteコンテンツ事業運営OS",
};

export default async function GrowthOsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <GrowthOsShell userEmail={user?.email ?? null}>{children}</GrowthOsShell>;
}
