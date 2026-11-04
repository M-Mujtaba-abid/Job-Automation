/**
 * Provider-agnostic AI seams (SYSTEM_ARCHITECTURE §8.4, llm-integration skill).
 * Data-routing policy (ADR-023, owner decision 2026-11-04): personal data (resumes, candidate
 * profiles, match explanations) may only go to providers with `allowsPersonalData = true`
 * (Groq with Zero Data Retention). Gemini's free tier is used for public data only.
 */

export type ProviderId = "gemini" | "groq" | "fake";
export type DataClass = "public" | "personal";

export type JsonRequest = {
  model: string;
  system: string;
  user: string;
  /** JSON Schema derived from the task's Zod schema (z.toJSONSchema). */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
};

export type Usage = { inputTokens: number | null; outputTokens: number | null };

export interface LlmProvider {
  readonly id: ProviderId;
  /** Only providers whose data terms allow personal data (e.g. Groq with ZDR enabled). */
  readonly allowsPersonalData: boolean;
  generateJson(req: JsonRequest): Promise<{ raw: string; usage: Usage }>;
}

export type EmbeddingKind = "query" | "document";

export interface EmbeddingProvider {
  readonly id: ProviderId;
  readonly model: string;
  readonly dimensions: number;
  /** Unit-length vectors, one per input, length === dimensions. Public data only. */
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

export type AiErrorKind =
  | "RATE_LIMITED" // 429 / quota: try next provider, defer the job if all are limited
  | "UNAVAILABLE" // 5xx / network / timeout: retryable
  | "INVALID_OUTPUT" // not JSON / failed schema: try next provider
  | "CONFIG" // 400/401/403, missing key: not retryable, alert
  | "POLICY" // no provider allowed for this data class
  | "EXHAUSTED"; // every provider in the chain failed

export class AiError extends Error {
  override name = "AiError";
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return (
      this.kind === "RATE_LIMITED" ||
      this.kind === "UNAVAILABLE" ||
      this.kind === "INVALID_OUTPUT" ||
      this.kind === "EXHAUSTED"
    );
  }
}

/** Maps an SDK error carrying an HTTP `status` (both Gemini and Groq SDKs expose one) to AiError. */
export function aiErrorFromStatus(provider: ProviderId, err: unknown): AiError {
  const status =
    typeof err === "object" && err !== null && "status" in err ? Number((err as { status: unknown }).status) : NaN;
  const msg = `${provider}: ${err instanceof Error ? err.message.slice(0, 300) : "request failed"}`;
  if (status === 429) return new AiError("RATE_LIMITED", msg, 60_000);
  if (status === 400 || status === 401 || status === 403 || status === 404) return new AiError("CONFIG", msg);
  return new AiError("UNAVAILABLE", msg);
}

/** Validates count, dimension and finiteness, then L2-normalises (harmless if already unit length). */
export function normaliseVectors(vectors: number[][], expectedCount: number, dimensions: number): number[][] {
  if (vectors.length !== expectedCount)
    throw new AiError("INVALID_OUTPUT", `expected ${expectedCount} vectors, got ${vectors.length}`);
  return vectors.map((v) => {
    if (v.length !== dimensions)
      throw new AiError("INVALID_OUTPUT", `expected ${dimensions} dimensions, got ${v.length}`);
    let sum = 0;
    for (const x of v) {
      if (!Number.isFinite(x)) throw new AiError("INVALID_OUTPUT", "non-finite value in embedding");
      sum += x * x;
    }
    const norm = Math.sqrt(sum);
    if (norm === 0) throw new AiError("INVALID_OUTPUT", "zero vector");
    return v.map((x) => x / norm);
  });
}
