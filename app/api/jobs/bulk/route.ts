import { inArray } from "drizzle-orm";
import { z } from "zod";
import { parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { jobIdsSchema } from "@/lib/validators";

export const POST = route(async (req) => {
  const { ids, status } = await parseBody(
    req,
    z.object({ ids: jobIdsSchema, status: z.enum(["new", "saved", "applied", "hidden"]) }),
  );
  const rows = await db().update(jobs).set({ status }).where(inArray(jobs.id, ids)).returning({ id: jobs.id });
  return { updated: rows.length };
});
