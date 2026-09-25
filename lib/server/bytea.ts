/**
 * Postgres `bytea` columns round-trip through PostgREST/supabase-js as text
 * strings in hex format (`\x` + hex digits — Postgres's default
 * `bytea_output = hex`). This is the only binary encoding this codebase
 * needs (no client ever sends multipart/binary), so it lives here as two
 * small, explicit, symmetric helpers rather than a dependency.
 */
export function encodeBytea(buffer: Buffer): string {
  return `\\x${buffer.toString("hex")}`;
}

export function decodeBytea(value: string): Buffer {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex");
}
