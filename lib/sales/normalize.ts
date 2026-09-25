const CORPORATE_AFFIXES = /株式会社|（株）|\(株\)|有限会社|（有）|\(有\)|合同会社|（同）|\(同\)/g;

/**
 * Normalizes a company name for duplicate-detection purposes: full-width →
 * half-width (NFKC), corporate-entity affixes stripped, whitespace
 * collapsed, case-folded. "株式会社ABC", "ABC株式会社", and "株式会社ＡＢＣ"
 * all normalize to the same string.
 */
export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(CORPORATE_AFFIXES, "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Extracts a bare, comparable domain from a URL or raw domain string:
 * lowercased, protocol/`www.`/path/query stripped. Returns null for empty
 * input rather than guessing.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  return s || null;
}
