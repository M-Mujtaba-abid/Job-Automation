import type { EmbeddingProvider, JsonRequest, LlmProvider, ProviderId } from "../provider";

/** Deterministic provider for tests and offline development (never calls the network). */
export function createFakeLlm(
  respond: (req: JsonRequest) => string | Promise<string>,
  opts: { id?: ProviderId; allowsPersonalData?: boolean } = {},
): LlmProvider & { calls: JsonRequest[] } {
  const calls: JsonRequest[] = [];
  return {
    id: opts.id ?? "fake",
    allowsPersonalData: opts.allowsPersonalData ?? true,
    calls,
    async generateJson(req) {
      calls.push(req);
      return { raw: await respond(req), usage: { inputTokens: req.user.length, outputTokens: 1 } };
    },
  };
}

/** Hash-seeded unit vectors: identical text → identical vector. */
export function createFakeEmbeddings(dimensions = 768): EmbeddingProvider {
  return {
    id: "fake",
    model: "fake-embedding",
    dimensions,
    async embed(texts) {
      return texts.map((t) => {
        let seed = 2166136261;
        for (let i = 0; i < t.length; i++) seed = Math.imul(seed ^ t.charCodeAt(i), 16777619);
        const v = Array.from({ length: dimensions }, (_, i) => Math.sin(seed + i * 12.9898));
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        return v.map((x) => x / norm);
      });
    },
  };
}
