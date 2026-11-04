import "server-only";
import { db } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

export type NewAuditLog = typeof auditLogs.$inferInsert;

export async function insertAuditLog(values: NewAuditLog): Promise<void> {
  await db().insert(auditLogs).values(values);
}
