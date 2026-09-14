/**
 * Exponential backoff + Retry-After handling for Google API calls (spec
 * §10-11): a 429 (quota) or 5xx gets retried with capped exponential
 * backoff, honoring a numeric `Retry-After` header when Google sends one. A
 * non-429 4xx (bad request, invalid_grant, permission denied, etc.) never
 * retries — retrying those would just repeat the same failure. Bounded by
 * MAX_RETRIES so a persistent outage surfaces as an error instead of
 * hanging a request indefinitely.
 */
const MAX_RETRIES = 4;
const BASE_DELAY_MS = 500;

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, init);
    if (res.ok || (res.status !== 429 && res.status < 500)) return res;
    if (attempt >= MAX_RETRIES) return res;

    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const delayMs = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : BASE_DELAY_MS * 2 ** attempt;
    await sleep(delayMs);
    attempt += 1;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
