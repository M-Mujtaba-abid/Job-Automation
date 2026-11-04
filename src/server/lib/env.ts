import "server-only";
import { z } from "zod";

/**
 * v2 server environment (zero-cost profile, ADR-023). Grows per milestone.
 * Lazy so `next build` does not need every secret; empty strings count as unset.
 * Variables for later milestones are optional until the milestone that needs them.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  DATABASE_URL_UNPOOLED: z.url().optional(),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),
  DRAIN_TIME_BUDGET_MS: z.coerce.number().int().min(1_000).max(25_000).default(20_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // M1+
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // M2+ (free AI tiers)
  LLM_PRIMARY_PROVIDER: z.enum(["gemini", "groq", "fake"]).default("gemini"),
  LLM_FALLBACK_PROVIDER: z.enum(["gemini", "groq", "fake", "none"]).default("groq"),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  // Observability
  SENTRY_DSN: z.url().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Names only; never echo values.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper. */
export function resetServerEnvCache(): void {
  cached = null;
}
