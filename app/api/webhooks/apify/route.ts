import { z } from "zod";
import { ApiError, parseQuery, route } from "@/lib/api";
import { safeEqual } from "@/lib/auth";
import { collectRun } from "@/lib/ingest";

export const maxDuration = 300;

/**
 * Apify ad-hoc webhook (run finished). The payload is ignored on purpose:
 * we re-read the run status from the Apify API, so a forged body can't inject data.
 */
export const POST = route(
  async (req) => {
    const { secret, runId } = parseQuery(req, z.object({ secret: z.string(), runId: z.uuid() }));
    if (!process.env.CRON_SECRET || !safeEqual(secret, process.env.CRON_SECRET)) {
      throw new ApiError(401, "Unauthorized");
    }
    const result = await collectRun(runId);
    return { ok: true, state: result.state };
  },
  { auth: "none" },
);
