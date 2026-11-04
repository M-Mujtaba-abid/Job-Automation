import { route } from "@/legacy/api";
import { runCron } from "@/legacy/ingest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron (daily) + cron-job.org (every 6h). Auth: Authorization: Bearer CRON_SECRET */
export const GET = route(async () => runCron("cron"), { auth: "cron" });
