import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/legacy/auth";
import { applySecurityHeaders, REQUEST_ID_HEADER } from "@/lib/security-headers";

// v1 routes that authenticate themselves (password, CRON_SECRET, webhook secret) + Better Auth endpoints.
const PUBLIC_PREFIXES = ["/login", "/api/auth/", "/api/cron/", "/api/webhooks/"];

// v2 pages (Better Auth session). They live beside v1 until M6 replaces the v1 UI.
const V2_PUBLIC = ["/sign-in"];
const V2_PROTECTED = ["/onboarding", "/account", "/dashboard"];

const matches = (pathname: string, prefixes: string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));

/**
 * Optimistic auth check (cookie presence only) + security headers + request id.
 * Not an authorization boundary: pages, route handlers and actions verify the session again.
 * v1 pages use v1's shared-password session (src/legacy/auth); v2 pages use Better Auth.
 */
export async function proxy(req: NextRequest) {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const forwarded = new Headers(req.headers);
  forwarded.set(REQUEST_ID_HEADER, requestId);
  const next = () => NextResponse.next({ request: { headers: forwarded } });
  const done = (res: NextResponse) =>
    applySecurityHeaders(res.headers, { requestId, production: process.env.NODE_ENV === "production" }) && res;

  const { pathname, search } = req.nextUrl;

  // ---- v2 (Better Auth) ----
  if (matches(pathname, V2_PUBLIC)) return done(next());
  if (matches(pathname, V2_PROTECTED)) {
    if (getSessionCookie(req)) return done(next());
    const signIn = new URL("/sign-in", req.url);
    signIn.searchParams.set("next", pathname + search);
    return done(NextResponse.redirect(signIn));
  }

  // ---- v1 (legacy shared password) ----
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
