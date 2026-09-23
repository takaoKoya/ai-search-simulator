/** http(s)以外のスキーム(javascript:等)を弾く簡易URLバリデーション。空文字/nullはnullを返す。 */
export function parseHttpUrl(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("有効なURL(https://...)を入力してください");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URLはhttp/httpsのみ使用できます");
  }

  return url.toString();
}
