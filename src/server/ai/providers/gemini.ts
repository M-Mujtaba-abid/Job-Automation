import "server-only";
import { GoogleGenAI } from "@google/genai";
import {
  aiErrorFromStatus,
  normaliseVectors,
  type EmbeddingKind,
  type EmbeddingProvider,
  type JsonRequest,
  type LlmProvider,
} from "../provider";

/**
 * Gemini API (free tier). PUBLIC DATA ONLY: free-tier terms say not to submit personal
 * information (docs/setup/free-tier-limits.md §1), so allowsPersonalData = false.
 */
export function createGeminiLlm(apiKey: string): LlmProvider {
  const ai = new GoogleGenAI({ apiKey });
  return {
    id: "gemini",
    allowsPersonalData: false,
    async generateJson(req: JsonRequest) {
      try {
        const res = await ai.models.generateContent({
          model: req.model,
          contents: req.user,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            maxOutputTokens: req.maxOutputTokens,
          },
        });
        return {
          raw: res.text ?? "",
          usage: {
            inputTokens: res.usageMetadata?.promptTokenCount ?? null,
            outputTokens: res.usageMetadata?.candidatesTokenCount ?? null,
          },
        };
      } catch (err) {
        throw aiErrorFromStatus("gemini", err);
      }
    },
  };
}

/**
 * gemini-embedding-2: no taskType parameter; the task is expressed as a text prefix
 * (free-tier-limits.md §1). Vectors from different models are not comparable.
 */
export function createGeminiEmbeddings(apiKey: string, model: string, dimensions: number): EmbeddingProvider {
  const ai = new GoogleGenAI({ apiKey });
  const prefix = (kind: EmbeddingKind, text: string) =>
    kind === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}`;
  return {
    id: "gemini",
    model,
    dimensions,
    async embed(texts, kind) {
      if (texts.length === 0) return [];
      try {
        // One Content object per text: a bare string[] is treated as ONE multi-part input by
        // gemini-embedding-2 and returns a single vector (verified live 2026-11-04).
        const res = await ai.models.embedContent({
          model,
          contents: texts.map((t) => ({ parts: [{ text: prefix(kind, t) }] })),
          config: { outputDimensionality: dimensions },
        });
        return normaliseVectors((res.embeddings ?? []).map((e) => e.values ?? []), texts.length, dimensions);
      } catch (err) {
        if (err instanceof Error && err.name === "AiError") throw err;
        throw aiErrorFromStatus("gemini", err);
      }
    },
  };
}
