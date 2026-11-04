import "server-only";
import { z } from "zod";
import { serverEnv } from "@/server/lib/env";
import { AiError, type DataClass, type EmbeddingProvider, type LlmProvider, type ProviderId } from "./provider";
import { createFakeEmbeddings, createFakeLlm } from "./providers/fake";
import { createGeminiEmbeddings, createGeminiLlm } from "./providers/gemini";
import { createGroqLlm } from "./providers/groq";
import { runJsonTask, type ChainEntry, type JsonTask } from "./router";

export { AiError };
export type { JsonTask } from "./router";

/**
 * Default models (verified free-tier names, docs/setup/free-tier-limits.md, 2026-11-04).
 * Override with LLM_MODEL_* / EMBEDDING_MODEL env vars; never hard-code models in tasks.
 */
const DEFAULTS = {
  publicPrimary: "gemini-3.5-flash-lite", // high-volume public extraction (job descriptions)
  publicFallback: "openai/gpt-oss-20b", // Groq
  personal: "openai/gpt-oss-120b", // Groq only (resumes, profiles, explanations)
  embedding: "gemini-embedding-2",
} as const;

const modelEnv = z.object({
  LLM_MODEL_JOB_EXTRACT: z.string().min(1).optional(),
  LLM_MODEL_RESUME_EXTRACT: z.string().min(1).optional(),
  LLM_MODEL_FALLBACK: z.string().min(1).optional(),
  EMBEDDING_MODEL: z.string().min(1).optional(),
});

let providersCache: Map<ProviderId, LlmProvider> | null = null;

export function llmProviders(): ReadonlyMap<ProviderId, LlmProvider> {
  if (providersCache) return providersCache;
  const env = serverEnv();
  const map = new Map<ProviderId, LlmProvider>();
  if (env.LLM_PRIMARY_PROVIDER === "fake") {
    map.set("fake", createFakeLlm(() => "{}"));
  } else {
    if (env.GEMINI_API_KEY) map.set("gemini", createGeminiLlm(env.GEMINI_API_KEY));
    if (env.GROQ_API_KEY) map.set("groq", createGroqLlm(env.GROQ_API_KEY));
  }
  providersCache = map;
  return map;
}

/** Provider chain per data class (ADR-023 routing): public → Gemini then Groq; personal → Groq only. */
export function chainFor(dataClass: DataClass): ChainEntry[] {
  const m = modelEnv.parse(process.env);
  if (serverEnv().LLM_PRIMARY_PROVIDER === "fake") return [{ provider: "fake", model: "fake" }];
  return dataClass === "public"
    ? [
        { provider: "gemini", model: m.LLM_MODEL_JOB_EXTRACT ?? DEFAULTS.publicPrimary },
        { provider: "groq", model: m.LLM_MODEL_FALLBACK ?? DEFAULTS.publicFallback },
      ]
    : [{ provider: "groq", model: m.LLM_MODEL_RESUME_EXTRACT ?? DEFAULTS.personal }];
}

export function runTask<S extends z.ZodType>(task: JsonTask<S>, user: string): Promise<z.infer<S>> {
  return runJsonTask(task, user, { providers: llmProviders(), chain: chainFor(task.dataClass) });
}

let embeddingsCache: EmbeddingProvider | null = null;

/** Embeddings for PUBLIC text only (job documents, target titles, skill lists). */
export function embeddings(): EmbeddingProvider {
  if (embeddingsCache) return embeddingsCache;
  const env = serverEnv();
  const model = modelEnv.parse(process.env).EMBEDDING_MODEL ?? DEFAULTS.embedding;
  if (env.LLM_PRIMARY_PROVIDER === "fake") {
    embeddingsCache = createFakeEmbeddings(env.EMBEDDING_DIM);
  } else if (env.GEMINI_API_KEY) {
    embeddingsCache = createGeminiEmbeddings(env.GEMINI_API_KEY, model, env.EMBEDDING_DIM);
  } else {
    // Never silently fall back to fake vectors outside fake mode.
    throw new AiError("CONFIG", "GEMINI_API_KEY is not set (required for embeddings)");
  }
  return embeddingsCache;
}
