import { and, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/legacy/db";
import { applications, jobs } from "@/legacy/db/schema";

export async function getStats() {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [[j], [a]] = await Promise.all([
    db()
      .select({
        newToday: sql<number>`(count(*) filter (where ${jobs.createdAt} >= ${dayAgo}))::int`,
        withEmail: sql<number>`(count(*) filter (where ${jobs.hasEmail}))::int`,
        withPhone: sql<number>`(count(*) filter (where ${jobs.hasPhone}))::int`,
        withForm: sql<number>`(count(*) filter (where ${jobs.hasForm}))::int`,
      })
      .from(jobs)
      .where(notInArray(jobs.status, ["hidden", "applied"])),
    db()
      .select({ appliedThisWeek: sql<number>`count(distinct ${applications.jobId})::int` })
      .from(applications)
      .where(and(inArray(applications.status, ["sent", "opened"]), gte(applications.createdAt, weekAgo))),
  ]);
  return { ...j, appliedThisWeek: a.appliedThisWeek };
}
