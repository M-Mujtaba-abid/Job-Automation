import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const csv = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  APP_PASSWORD: z.string().min(6),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 characters"),

  APIFY_TOKEN: z.string().min(1),
  APIFY_LINKEDIN_ACTOR_ID: z.string().default(""),
  APIFY_FACEBOOK_ACTOR_ID: z.string().default(""),

  DEFAULT_KEYWORDS: csv,
  DEFAULT_LOCATION: z.string().default("Pakistan"),
  DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default("92"),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: bool.default(true),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  MAIL_DELAY_MS: z.coerce.number().int().min(0).default(4000),
  MAIL_DAILY_LIMIT: z.coerce.number().int().positive().default(150),

  FETCH_MIN_INTERVAL_HOURS: z.coerce.number().min(0).default(6),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Parsed, validated env. Lazy so `next build` doesn't need every secret present.
 * Empty strings are treated as "unset" so optional vars can be left blank in .env.
 */
export function env(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
