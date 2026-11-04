import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison that does not leak length via early return. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** `Authorization: Bearer <CRON_SECRET>` check for /api/cron/* (SECURITY_DESIGN §17). */
export function isAuthorizedCron(req: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16) return false;
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}
