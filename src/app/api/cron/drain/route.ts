import { runDrain, scheduleDailyMaintenance } from "@/server/jobs";
import { isAuthorizedCron } from "@/server/lib/cron-auth";
import { serverEnv } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";

/** Must stay below cron-job.org's 30 s response timeout (the drain itself is capped by DRAIN_TIME_BUDGET_MS). */
export const maxDuration = 30;

const log = logger.child({ route: "cron.drain" });
const noStore = { "Cache-Control": "no-store" };

/**
 * Background-job runner for the zero-cost profile (ADR-023, API_DESIGN header).
 * Called by cron-job.org (every 30 min) and Vercel's daily cron with `Authorization: Bearer CRON_SECRET`.
 * Accepts no parameters from the caller. Handler failures still return 200 (they are retried
 * by the queue); only infrastructure failures return 503.
 */
export async function GET(req: Request): Promise<Response> {
  if (!isAuthorizedCron(req)) {
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "Unauthorized" } },
      { status: 401, headers: noStore },
    );
  }
  try {
    await scheduleDailyMaintenance();
    const summary = await runDrain(serverEnv().DRAIN_TIME_BUDGET_MS, "cron");
    log.info({ ...summary }, "drain.cron");
    return Response.json({ ok: true, ...summary }, { headers: noStore });
  } catch (err) {
    log.error({ error: err }, "drain.cron_failed");
    return Response.json(
      { error: { code: "SERVICE_UNAVAILABLE", message: "Job runner unavailable" } },
      { status: 503, headers: noStore },
    );
  }
}
