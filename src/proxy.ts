import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/legacy/auth";
import { applySecurityHeaders, REQUEST_ID_HEADER } from "@/lib/security-headers";

// Routes that authenticate themselves (password, CRON_SECRET, webhook secret).
const PUBLIC_PREFIXES = ["/login", "/api/auth/login", "/api/cron/", "/api/webhooks/"];

/**
 * Optimistic auth check (cookie only) + security headers + request id.
 * Not an authorization boundary: route handlers and actions verify the session again.
 * The session check is v1's (src/legacy/auth) until Better Auth replaces it in M1.
 */
export async function proxy(req: NextRequest) {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const forwarded = new Headers(req.headers);
  forwarded.set(REQUEST_ID_HEADER, requestId);
  const next = () => NextResponse.next({ request: { headers: forwarded } });
  const done = (res: NextResponse) => applySecurityHeaders(res.headers, { requestId, production: process.env.NODE_ENV === "production" }) && res;

  const { pathname, search } = req.nextUrl;
  const authed = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login" && authed) {
    return done(NextResponse.redirect(new URL("/jobs", req.url)));
  }
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return done(next());
  }
  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return done(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return done(NextResponse.redirect(login));
  }
  return done(next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
