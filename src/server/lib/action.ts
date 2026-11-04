import "server-only";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import type { TenantContext } from "@/server/auth/session";
import { toActionError } from "./errors";
import { logger } from "./logger";
import { enforceRateLimit, type Limit } from "./rate-limit";

type ActionDeps = {
  resolveContext: () => Promise<TenantContext>;
  rateLimit: (key: string, limit: Limit) => Promise<void>;
};

/** Loaded lazily and only when not injected (Better Auth is a heavy import). */
async function defaultResolveContext(): Promise<TenantContext> {
  const { getTenantContext } = await import("@/server/auth/session");
  return getTenantContext();
}
const defaultRateLimit: ActionDeps["rateLimit"] = (key, limit) => enforceRateLimit(key, limit);

export type AuthedActionOptions<S extends z.ZodType, T> = {
  /** "<domain>.<verb>", used for logs and rate-limit keys, e.g. "profile.update". */
  name: string;
  input: S;
  rateLimit?: Limit;
  handler: (args: { input: z.infer<S>; ctx: TenantContext }) => Promise<T>;
  /** Test seam: override session/rate-limit resolution. */
  deps?: Partial<ActionDeps>;
};

function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    const all = fd.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = all.length > 1 || key.endsWith("[]") ? all : all[0];
  }
  return out;
}

/**
 * The only way to define a Server Action (server-actions skill). Actions are public POST
 * endpoints: this resolves the session, rate-limits per user, validates input with Zod,
 * runs the handler and maps every failure to a safe ActionResult. It never throws to the client.
 */
export function authedAction<S extends z.ZodType, T>(opts: AuthedActionOptions<S, T>) {
  return async (raw: z.input<S> | FormData): Promise<ActionResult<T>> => {
    const started = performance.now();
    let userId: string | undefined;
    let outcome = "ok";
    try {
      const resolveContext = opts.deps?.resolveContext ?? defaultResolveContext;
      const rateLimit = opts.deps?.rateLimit ?? defaultRateLimit;
      const ctx = await resolveContext();
      userId = ctx.userId;
      if (opts.rateLimit) await rateLimit(`action:${opts.name}:${ctx.userId}`, opts.rateLimit);
      const input = opts.input.parse(raw instanceof FormData ? formDataToObject(raw) : raw);
      const data = await opts.handler({ input, ctx });
      return { ok: true, data };
    } catch (err) {
      const error = toActionError(err);
      outcome = error.code;
      if (error.code === "INTERNAL") logger.error({ action: opts.name, userId, error: err }, "action.internal_error");
      return { ok: false, error };
    } finally {
      logger.info(
        { action: opts.name, userId, outcome, durationMs: Math.round(performance.now() - started) },
        "action",
      );
    }
  };
}
