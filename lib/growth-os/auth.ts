import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_ROUTE } from "@/lib/routes";

/**
 * proxy.ts が /os 配下を既に保護しているが、Server Action は直接呼び出される
 * 可能性もあるため、DBアクセス直前にも本人確認を行う(defense-in-depth)。
 */
export async function requireGrowthOsUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(LOGIN_ROUTE);
  }

  return { supabase, userId: user.id };
}
