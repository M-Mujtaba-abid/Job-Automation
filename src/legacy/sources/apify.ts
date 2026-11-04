import { z } from "zod";
import type { Source } from "@/legacy/db/schema";
import { env } from "@/legacy/env";
import { fetchWithRetry } from "@/legacy/http";
import type { JobSource, RawJob, RemoteRunState, StartedRun } from "./types";

const API = "https://api.apify.com/v2";
const PAGE_SIZE = 500;

function headers() {
  return {
    Authorization: `Bearer ${env().APIFY_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/** Apify accepts "username~actor-name" in URLs; the Store shows "username/actor-name". */
export function actorPath(actorId: string) {
  return encodeURIComponent(actorId.trim().replace("/", "~"));
}

const runResponse = z.object({
  data: z.object({
    id: z.string(),
    status: z.string(),
    defaultDatasetId: z.string().optional(),
    statusMessage: z.string().nullish(),
  }),
});

async function apifyJson<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (body as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
    throw new Error(`Apify ${what} failed (${res.status}): ${msg}`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`Apify ${what}: unexpected response shape`);
  return parsed.data;
}

// ---------- item mapping ----------

const str = z.string().trim().min(1);

/** Loose item shape: different actors use different field names. */
const item = z
  .object({
    text: str.optional(),
    postText: str.optional(),
    content: str.optional(),
    message: str.optional(),
    commentary: str.optional(),
    url: str.optional(),
    postUrl: str.optional(),
    linkedinUrl: str.optional(), // harvestapi/linkedin-post-search

    link: str.optional(),
    shareUrl: str.optional(),
    facebookUrl: str.optional(),
    id: z.union([str, z.number()]).optional(),
    postId: z.union([str, z.number()]).optional(),
    urn: str.optional(),
    authorName: str.optional(),
    groupName: str.optional(),
    pageName: str.optional(),
    author: z
      .union([str, z.object({ name: str.optional(), firstName: str.optional(), lastName: str.optional(), companyName: str.optional() }).passthrough()])
      .optional(),
    user: z.object({ name: str.optional() }).passthrough().optional(),
    postedAt: z.union([str, z.number(), z.object({ date: str.optional(), timestamp: z.number().optional() }).passthrough()]).optional(),
    date: z.union([str, z.number()]).optional(),
    time: z.union([str, z.number()]).optional(),
    timestamp: z.union([str, z.number()]).optional(),
    postedAtISO: str.optional(),
    postedAtTimestamp: z.number().optional(),
  })
  .passthrough();

function toDate(v: unknown): Date | undefined {
  if (v == null) return undefined;
  if (typeof v === "object") {
    const o = v as { date?: unknown; timestamp?: unknown };
    return toDate(o.timestamp ?? o.date);
  }
  if (typeof v === "number") {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return toDate(Number(v));
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

export function mapApifyItem(raw: unknown): RawJob | null {
  const parsed = item.safeParse(raw);
  if (!parsed.success) return null;
  const i = parsed.data;

  const text = i.text ?? i.postText ?? i.content ?? i.message ?? i.commentary;
  if (!text) return null;

  let author: string | undefined;
  if (typeof i.author === "string") author = i.author;
  else if (i.author) {
    author =
      i.author.companyName ??
      i.author.name ??
      ([i.author.firstName, i.author.lastName].filter(Boolean).join(" ") || undefined);
  }
  author ??= i.authorName ?? i.pageName ?? i.user?.name ?? i.groupName;

  const id = i.postId ?? i.id ?? i.urn;

  return {
    externalId: id != null ? String(id) : undefined,
    company: author,
    descriptionHtmlOrText: text,
    // facebookUrl last: in apify/facebook-groups-scraper it's the *group* URL, `url` is the post.
    applyUrl: i.url ?? i.postUrl ?? i.linkedinUrl ?? i.link ?? i.shareUrl ?? i.facebookUrl,
    postedAt: toDate(i.postedAtISO ?? i.postedAtTimestamp ?? i.postedAt ?? i.date ?? i.time ?? i.timestamp),
    raw,
  };
}

// ---------- adapter ----------

export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "[::1]") return false;
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0)/.test(h);
}

function mapStatus(status: string, message?: string | null, datasetId?: string): RemoteRunState {
  const base = { rawStatus: status, datasetId, message: message ?? undefined };
  if (status === "SUCCEEDED") return { ...base, status: "succeeded" };
  // A timed-out run still has whatever it scraped so far — treat as succeeded (partial).
  if (status === "TIMED-OUT" || status === "TIMED_OUT") return { ...base, status: "succeeded" };
  if (status === "FAILED" || status === "ABORTED" || status === "ABORTING") return { ...base, status: "failed" };
  return { ...base, status: "pending" };
}

export const apifySource: JobSource = {
  types: ["apify_linkedin", "apify_facebook"],

  isConfigured() {
    return Boolean(process.env.APIFY_TOKEN);
  },

  async start(source: Source, fetchRunId: string): Promise<StartedRun> {
    const { actorId, input, maxResults } = source.config;
    if (!actorId) throw new Error(`Source "${source.name}" has no actorId`);
    const e = env();

    const url = new URL(`${API}/acts/${actorPath(actorId)}/runs`);

    // Apify rejects webhook URLs it can't reach (localhost), so locally we rely on Collect / the cron fallback.
    const hookUrl = new URL("/api/webhooks/apify", e.NEXT_PUBLIC_APP_URL);
    if (isPublicHost(hookUrl.hostname)) {
      hookUrl.searchParams.set("secret", e.CRON_SECRET);
      hookUrl.searchParams.set("runId", fetchRunId);
      const webhooks = Buffer.from(
        JSON.stringify([
          {
            eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
            requestUrl: hookUrl.toString(),
          },
        ]),
      ).toString("base64");
      url.searchParams.set("webhooks", webhooks);
    }
    if (maxResults) url.searchParams.set("maxItems", String(maxResults));

    const res = await fetchWithRetry(url.toString(), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(input ?? {}),
    });
    const { data } = await apifyJson(res, runResponse, "start run");
    if (!data.defaultDatasetId) throw new Error("Apify run has no dataset id");
    return { apifyRunId: data.id, datasetId: data.defaultDatasetId };
  },

  async getRun(apifyRunId: string) {
    const res = await fetchWithRetry(`${API}/actor-runs/${encodeURIComponent(apifyRunId)}`, {
      headers: headers(),
    });
    const { data } = await apifyJson(res, runResponse, "get run");
    return mapStatus(data.status, data.statusMessage, data.defaultDatasetId);
  },

  async *items(datasetId: string) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const url = `${API}/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${PAGE_SIZE}`;
      const res = await fetchWithRetry(url, { headers: headers() }, { timeoutMs: 30_000 });
      const page = await apifyJson(res, z.array(z.unknown()), "dataset items");
      if (page.length) yield page;
      if (page.length < PAGE_SIZE) return;
    }
  },

  mapItem: mapApifyItem,

  runUrl(apifyRunId: string) {
    return `https://console.apify.com/view/runs/${apifyRunId}`;
  },
};
