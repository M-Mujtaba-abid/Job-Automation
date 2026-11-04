import { z } from "zod";
import { AiError, type DataClass, type LlmProvider, type ProviderId, type Usage } from "./provider";

export type ChainEntry = { provider: ProviderId; model: string };

/** A versioned AI task (prompt module). Schemas must use .nullable(), never .optional() (strict JSON mode). */
export type JsonTask<S extends z.ZodType> = {
  id: string; // e.g. "job.extract"
  version: string; // e.g. "v1"
  dataClass: DataClass;
  system: string;
  schema: S;
  maxOutputTokens: number;
};

export type RunOptions = {
  providers: ReadonlyMap<ProviderId, LlmProvider>;
  chain: readonly ChainEntry[];
  onUsage?: (u: { task: string; version: string; provider: ProviderId; model: string; usage: Usage; ok: boolean }) => void;
};

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/**
 * Runs a JSON task through the provider chain with the data-routing policy enforced:
 * personal data is never sent to a provider with allowsPersonalData = false.
 * Output is always validated with the task's Zod schema; the first valid answer wins.
 */
export async function runJsonTask<S extends z.ZodType>(task: JsonTask<S>, user: string, opts: RunOptions): Promise<z.infer<S>> {
  const allowed = opts.chain.filter((c) => {
    const p = opts.providers.get(c.provider);
    return p && (task.dataClass === "public" || p.allowsPersonalData);
  });
  if (allowed.length === 0) {
    throw new AiError("POLICY", `No configured provider may process ${task.dataClass} data for ${task.id}`);
  }

  const jsonSchema = jsonSchemaFor(task.schema);
  const failures: string[] = [];
  let shortestRetry: number | undefined;

  for (const entry of allowed) {
    const provider = opts.providers.get(entry.provider)!;
    try {
      const res = await provider.generateJson({
        model: entry.model,
        system: task.system,
        user,
        jsonSchema,
        schemaName: task.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
        maxOutputTokens: task.maxOutputTokens,
      });
      const parsed = task.schema.safeParse(parseJson(res.raw));
      opts.onUsage?.({ task: task.id, version: task.version, provider: entry.provider, model: entry.model, usage: res.usage, ok: parsed.success });
      if (parsed.success) return parsed.data;
      failures.push(`${entry.provider}: invalid output`);
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError("UNAVAILABLE", String(err));
      if (e.kind === "CONFIG") throw e; // misconfiguration: fail loudly, don't mask with fallbacks
      if (e.retryAfterMs !== undefined) shortestRetry = Math.min(shortestRetry ?? Infinity, e.retryAfterMs);
      failures.push(`${entry.provider}: ${e.kind}`);
    }
  }
  throw new AiError("EXHAUSTED", `${task.id}: all providers failed (${failures.join("; ")})`, shortestRetry);
}
