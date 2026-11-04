import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

/**
 * Better Auth endpoints (sign-in with Google, callback, session, sign-out).
 * More specific v1 routes (/api/auth/login, /api/auth/logout) still win over this catch-all until M6.
 * The handler is created lazily so `next build` does not need auth secrets.
 */
let handler: ReturnType<typeof toNextJsHandler> | null = null;
const h = () => (handler ??= toNextJsHandler(auth()));

export async function GET(req: Request): Promise<Response> {
  return h().GET(req);
}

export async function POST(req: Request): Promise<Response> {
  return h().POST(req);
}
