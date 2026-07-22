import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginView from "@/components/yattoru/LoginView";

export const metadata: Metadata = {
  title: "YATTORU | ログイン",
  description: "YATTORUにログインします。",
};

export default async function Page() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  }

  return <LoginView />;
}
