import { createHash } from "node:crypto";

/** 「内容変更なしなら再解析しない」判定用のハッシュ(セクション17)。Route Handler等サーバー専用。 */
export function computeContentHash(...parts: (string | null | undefined)[]): string {
  const normalized = parts.filter((p): p is string => Boolean(p)).join("␟");
  return createHash("sha256").update(normalized).digest("hex");
}
