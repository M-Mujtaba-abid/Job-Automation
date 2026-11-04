import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { applications, jobContacts, jobs } from "@/lib/db/schema";

/** Logs a WhatsApp / Google Form click as an "opened" application. */
export const POST = route(async (req) => {
  const { jobId, channel, to } = await parseBody(
    req,
    z.object({ jobId: z.uuid(), channel: z.enum(["whatsapp", "google_form"]), to: z.string().min(1).max(2000) }),
  );
  const job = await db().query.jobs.findFirst({ where: eq(jobs.id, jobId), columns: { id: true } });
  if (!job) throw new ApiError(404, "Job not found");

  const contact = await db().query.jobContacts.findFirst({
    where: and(eq(jobContacts.jobId, jobId), eq(jobContacts.normalized, to)),
    columns: { id: true },
  });
  const [row] = await db()
    .insert(applications)
    .values({ jobId, channel, toAddress: to, contactId: contact?.id ?? null, status: "opened" })
    .returning({ id: applications.id });
  return { id: row.id };
});
