import { inArray } from "drizzle-orm";
import { z } from "zod";
import { parseBody, route } from "@/legacy/api";
import { db } from "@/legacy/db";
import { jobs } from "@/legacy/db/schema";
import { jobIdsSchema } from "@/legacy/validators";

export const POST = route(async (req) => {
  const { ids, status } = await parseBody(
    req,
    z.object({ ids: jobIdsSchema, status: z.enum(["new", "saved", "applied", "hidden"]) }),
  );
  const rows = await db().update(jobs).set({ status }).where(inArray(jobs.id, ids)).returning({ id: jobs.id });
  return { updated: rows.length };
});
