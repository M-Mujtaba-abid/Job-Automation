/** Exponential backoff with full jitter: base · 2^(attempt-1), capped. Pure (unit-tested). */
export function retryDelayMs(attempt: number, random: () => number = Math.random, baseMs = 30_000, capMs = 6 * 3_600_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}
