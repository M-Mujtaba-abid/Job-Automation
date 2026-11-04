/** fetch with a timeout and one retry (with backoff) on 429 / 5xx / network errors. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { timeoutMs = 15_000, retries = 1 }: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(backoff(attempt, res.headers.get("retry-after")));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(backoff(attempt, null));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function backoff(attempt: number, retryAfter: string | null) {
  const s = Number(retryAfter);
  if (Number.isFinite(s) && s > 0) return Math.min(s * 1000, 10_000);
  return 1000 * 2 ** attempt;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
