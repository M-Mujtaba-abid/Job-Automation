import { route } from "@/lib/api";
import { collectRun } from "@/lib/ingest";

export const maxDuration = 300;

/** Manual "Collect": ingest a finished Apify run (webhooks can't reach localhost). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const force = req.nextUrl.searchParams.get("force") === "true";
  return collectRun(params.id, { force });
});
