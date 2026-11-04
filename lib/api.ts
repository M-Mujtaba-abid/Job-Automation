import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, verifyCronAuth, verifySession } from "@/lib/auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Auth = "session" | "cron" | "none";
type Handler<P> = (req: NextRequest, ctx: { params: P }) => Promise<Response | object | null | void>;

/**
 * Wraps a route handler: auth check, Zod/ApiError → JSON errors, plain objects → JSON.
 * Usage: export const GET = route(async (req, { params }) => ({ ok: true }));
 */
export function route<P extends Record<string, string> = Record<string, never>>(
  fn: Handler<P>,
  { auth = "session" }: { auth?: Auth } = {},
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      if (auth === "session") {
        const token = (await cookies()).get(SESSION_COOKIE)?.value;
        if (!(await verifySession(token))) throw new ApiError(401, "Unauthorized");
      } else if (auth === "cron" && !verifyCronAuth(req)) {
        throw new ApiError(401, "Unauthorized");
      }
      const result = await fn(req, { params: await ctx.params });
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    return Response.json(
      { error: "Invalid input", details: z.flattenError(err).fieldErrors },
      { status: 400 },
    );
  }
  console.error("[api] unhandled error", err);
  const message = err instanceof Error ? err.message : "Internal error";
  return Response.json({ error: message }, { status: 500 });
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const body: unknown = await req.json().catch(() => {
    throw new ApiError(400, "Body must be valid JSON");
  });
  return schema.parse(body);
}

export function parseQuery<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}

export const uuidParam = z.object({ id: z.uuid() });
