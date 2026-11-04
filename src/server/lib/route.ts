import "server-only";
import { z } from "zod";
import { REQUEST_ID_HEADER } from "@/lib/security-headers";
import type { TenantContext } from "@/server/auth/session";
import { isAuthorizedCron } from "./cron-auth";
import { AppError, HTTP_STATUS, toActionError } from "./errors";
import { logger } from "./logger";
import { enforceRateLimit, type Limit } from "./rate-limit";

type AuthMode = "session" | "cron" | "none";

type RouteOptions<P extends z.ZodType> = {
  name: string;
  auth: AuthMode;
  params?: P;
  rateLimit?: Limit;
  /** Test seam. */
  resolveContext?: () => Promise<TenantContext>;
};

type HandlerArgs<P extends z.ZodType, A extends AuthMode> = {
  req: Request;
  params: z.infer<P>;
  ctx: A extends "session" ? TenantContext : null;
};

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Route Handler wrapper (api-design skill): auth mode, params validation, rate limiting,
 * uniform error JSON `{ error: { code, message, details?, requestId } }`, no internal messages on 500.
 * Plain objects are returned as JSON; a Response is passed through.
 */
export function route<P extends z.ZodType = z.ZodObject<Record<string, never>>, A extends AuthMode = AuthMode>(
  opts: RouteOptions<P> & { auth: A },
  handler: (args: HandlerArgs<P, A>) => Promise<Response | object | null>,
) {
  return async (req: Request, segment: { params: Promise<Record<string, string | string[]>> }): Promise<Response> => {
    const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    let userId: string | undefined;
    try {
      let ctx: TenantContext | null = null;
      if (opts.auth === "session") {
        const resolve = opts.resolveContext ?? (await import("@/server/auth/session")).getTenantContext;
        ctx = await resolve();
        userId = ctx.userId;
      } else if (opts.auth === "cron" && !isAuthorizedCron(req)) {
        throw new AppError("UNAUTHENTICATED", "Unauthorized");
      }
      if (opts.rateLimit) {
        const who = ctx?.userId ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anon";
        await enforceRateLimit(`route:${opts.name}:${who}`, opts.rateLimit);
      }
      const rawParams = segment?.params ? await segment.params : {};
      const params = (opts.params ?? z.object({})).parse(rawParams) as z.infer<P>;
      const result = await handler({ req, params, ctx: ctx as HandlerArgs<P, A>["ctx"] });
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true }, { headers: { ...NO_STORE, [REQUEST_ID_HEADER]: requestId } });
    } catch (err) {
      const e = toActionError(err);
      if (e.code === "INTERNAL")
        logger.error({ route: opts.name, userId, requestId, error: err }, "route.internal_error");
      const headers: Record<string, string> = { ...NO_STORE, [REQUEST_ID_HEADER]: requestId };
      if (e.retryAfterSec) headers["Retry-After"] = String(e.retryAfterSec);
      return Response.json(
        { error: { code: e.code, message: e.message, ...(e.fieldErrors && { details: e.fieldErrors }), requestId } },
        { status: HTTP_STATUS[e.code], headers },
      );
    }
  };
}
