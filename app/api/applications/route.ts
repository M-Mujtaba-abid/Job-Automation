import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { db } from "@/lib/db";
import { applications, jobs } from "@/lib/db/schema";

const query = z.object({
  channel: z.enum(["email", "whatsapp", "google_form"]).optional(),
  status: z.enum(["queued", "sending", "sent", "failed", "opened"]).optional(),
  batchId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = route(async (req) => {
  const q = parseQuery(req, query);
  const where = and(
    q.channel ? eq(applications.channel, q.channel) : undefined,
    q.status ? eq(applications.status, q.status) : undefined,
    q.batchId ? eq(applications.batchId, q.batchId) : undefined,
  );
  const [rows, [{ total }], [{ queued }]] = await Promise.all([
    db()
      .select({
        id: applications.id,
        jobId: applications.jobId,
        jobTitle: jobs.title,
        company: jobs.company,
        channel: applications.channel,
        toAddress: applications.toAddress,
        subject: applications.subject,
        status: applications.status,
        error: applications.error,
        batchId: applications.batchId,
        sentAt: applications.sentAt,
        createdAt: applications.createdAt,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(where)
      .orderBy(desc(applications.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db().select({ total: sql<number>`count(*)::int` }).from(applications).where(where),
    db()
      .select({ queued: sql<number>`count(*)::int` })
      .from(applications)
      .where(eq(applications.status, "queued")),
  ]);
  return { items: rows, total, queued, page: q.page, pageSize: q.pageSize };
});
