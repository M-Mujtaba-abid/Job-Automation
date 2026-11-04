import "server-only";
import Groq from "groq-sdk";
import { aiErrorFromStatus, type JsonRequest, type LlmProvider } from "../provider";

/**
 * Groq (free tier). Allowed for personal data on the owner's decision of 2026-11-04,
 * on the condition that Zero Data Retention is enabled in Groq → Settings → Data Controls.
 * Uses strict json_schema structured outputs (supported by openai/gpt-oss-* models).
 */
export function createGroqLlm(apiKey: string): LlmProvider {
  const groq = new Groq({ apiKey, timeout: 30_000, maxRetries: 1 });
  return {
    id: "groq",
    allowsPersonalData: true,
    async generateJson(req: JsonRequest) {
      try {
        const res = await groq.chat.completions.create({
          model: req.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true },
          },
          max_completion_tokens: req.maxOutputTokens,
        });
        return {
          raw: res.choices[0]?.message?.content ?? "",
          usage: { inputTokens: res.usage?.prompt_tokens ?? null, outputTokens: res.usage?.completion_tokens ?? null },
        };
      } catch (err) {
        throw aiErrorFromStatus("groq", err);
      }
    },
  };
}
