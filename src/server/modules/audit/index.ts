import "server-only";
import { createHmac } from "node:crypto";
import { logger } from "@/server/lib/logger";
import { insertAuditLog } from "./repository";

export type AuditEntry = {
  actorUserId: string | null;
  actorType: "USER" | "SYSTEM" | "AUTOMATION" | "ADMIN";
  /** Dotted verb, e.g. "auth.login", "account.deletion_requested", "mail.account.connected". */
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  userAgent?: string | null;
  /** No secrets, no resume text, no message bodies. */
  metadata?: Record<string, unknown>;
};

/** Keyed hash so raw IPs are never stored but repeat offenders can still be correlated. */
export function hashIp(ip: string, key: string): string {
  return createHmac("sha256", `audit-ip:${key}`).update(ip).digest("hex").slice(0, 32);
}

/** Append-only security log (SECURITY_DESIGN §13). Never throws: auditing must not break the user flow. */
export async function recordAudit(e: AuditEntry): Promise<void> {
  try {
    const key = process.env.BETTER_AUTH_SECRET;
    await insertAuditLog({
      actorUserId: e.actorUserId,
      actorType: e.actorType,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      ipHash: e.ip && key ? hashIp(e.ip, key) : null,
      userAgent: e.userAgent?.slice(0, 300) ?? null,
      metadata: e.metadata ?? {},
    });
  } catch (err) {
    logger.error({ action: e.action, error: err }, "audit.write_failed");
  }
}
