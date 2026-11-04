import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/server/lib/errors";
import { auth } from "./auth";

/**
 * The authenticated tenant (ADR-006). Services receive this explicitly and scope every query
 * by `userId`; it is never built from client input.
 */
export type TenantContext = { userId: string; role: "USER" | "ADMIN"; email: string; name: string };

async function readContext(): Promise<TenantContext | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = session.user as typeof session.user & { role?: string; deletionRequestedAt?: Date | null };
  if (user.deletionRequestedAt) return null; // pending deletion = signed out everywhere
  return { userId: user.id, role: user.role === "ADMIN" ? "ADMIN" : "USER", email: user.email, name: user.name };
}

/** For Server Actions and Route Handlers: throws UNAUTHENTICATED (mapped to 401 / ActionResult). */
export async function getTenantContext(): Promise<TenantContext> {
  const ctx = await readContext();
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
  return ctx;
}

/** For Server Components/pages: redirects to /sign-in when there is no valid session. */
export async function requireUser(nextPath?: string): Promise<TenantContext> {
  const ctx = await readContext();
  if (!ctx) redirect(nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in");
  return ctx;
}

/** Optional session (e.g. sign-in page redirecting signed-in users away). */
export async function getOptionalTenantContext(): Promise<TenantContext | null> {
  return readContext();
}

export function requireAdmin(ctx: TenantContext): void {
  if (ctx.role !== "ADMIN") throw new AppError("FORBIDDEN", "Admins only.");
}
