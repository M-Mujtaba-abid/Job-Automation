import { z } from "zod";
import { parseBody, route } from "@/legacy/api";
import { processQueue } from "@/legacy/applications";

export const maxDuration = 120;

/** Sends up to `limit` queued emails. The compose dialog calls this in a loop. */
export const POST = route(async (req) => {
  const input = await parseBody(
    req,
    z.object({ batchId: z.uuid().optional(), limit: z.number().int().min(1).max(10).default(5) }),
  );
  return processQueue(input);
});
