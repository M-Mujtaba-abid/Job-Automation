import "server-only";

/**
 * Minimal structured JSON logger with PII/secret redaction (SECURITY_DESIGN §5).
 * Dependency-free on purpose (zero-cost profile); can be swapped for pino later.
 */

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are never logged, at any depth (case-insensitive). */
const REDACT_KEYS = new Set([
  "email",
  "phone",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authorization",
  "cookie",
  "secret",
  "apikey",
  "extractedtext",
  "bodytext",
  "body",
  "coverletter",
  "answers",
  "resume",
  "data",
  "payload",
  "prompt",
  "completion",
]);

const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const lvl = (process.env.LOG_LEVEL ?? "info") as Level;
  return LEVELS[lvl] ?? LEVELS.info;
}

export type Logger = Record<Level, (fields: Record<string, unknown>, msg: string) => void> & {
  child(bindings: Record<string, unknown>): Logger;
};

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const write = (level: Level) => (fields: Record<string, unknown>, msg: string) => {
    if (LEVELS[level] < threshold()) return;
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      msg,
      ...(redact({ ...bindings, ...fields }) as Record<string, unknown>),
    });
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (more) => createLogger({ ...bindings, ...more }),
  };
}

export const logger = createLogger();
