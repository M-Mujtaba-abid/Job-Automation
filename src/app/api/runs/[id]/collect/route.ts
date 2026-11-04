import { route } from "@/legacy/api";
import { collectRun } from "@/legacy/ingest";

export const maxDuration = 300;

/** Manual "Collect": ingest a finished Apify run (webhooks can't reach localhost). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const force = req.nextUrl.searchParams.get("force") === "true";
  return collectRun(params.id, { force });
});
