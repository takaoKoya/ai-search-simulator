import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, ProductStatus } from "@/lib/growth-os/types";

export async function listProducts(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("gos_products")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Product[];
}

export async function getProduct(supabase: SupabaseClient, userId: string, id: string) {
  const { data, error } = await supabase
    .from("gos_products")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as Product | null;
}

export interface InsertProductInput {
  source_content_id: string | null;
  product_name: string;
  recommended_price: number | null;
  target: string | null;
  problem: string | null;
  solution: string | null;
  product_score: number | null;
  outline: unknown;
}

export async function createProduct(supabase: SupabaseClient, userId: string, input: InsertProductInput) {
  const { data, error } = await supabase
    .from("gos_products")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw error;
  return data as Product;
}

export async function updateProductStatus(supabase: SupabaseClient, id: string, status: ProductStatus) {
  const { data, error } = await supabase
    .from("gos_products")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as Product;
}
