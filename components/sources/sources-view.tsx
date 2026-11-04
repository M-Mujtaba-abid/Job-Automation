"use client";

import { formatDistanceToNow } from "date-fns";
import { Database, ExternalLink, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, useApi } from "@/lib/client";
import type { RunRow, SourceRow } from "@/lib/types";
import { RunStatusBadge } from "@/components/runs/runs-view";

type SourceType = "apify_linkedin" | "apify_facebook";
type Draft = {
  id?: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  actorId: string;
  keywords: string;
  maxResults: string;
  input: string;
};

const INPUT_EXAMPLES: Record<SourceType, object> = {
  // harvestapi/linkedin-post-search
  apify_linkedin: {
    searchQueries: ["hiring react developer Pakistan", "hiring next.js developer Pakistan"],
    maxPosts: 20,
    postedLimit: "24h",
    sortBy: "date",
  },
  // apify/facebook-groups-scraper
  apify_facebook: {
    startUrls: [{ url: "https://www.facebook.com/groups/YOUR_GROUP_ID" }],
    resultsLimit: 30,
    viewOption: "CHRONOLOGICAL",
    onlyPostsNewerThan: "3 days",
  },
};

const TYPE_LABEL: Record<SourceType, string> = { apify_linkedin: "LinkedIn", apify_facebook: "Facebook" };

function emptyDraft(type: SourceType = "apify_linkedin"): Draft {
  return {
    name: "",
    type,
    enabled: true,
    actorId: type === "apify_facebook" ? "apify~facebook-groups-scraper" : "harvestapi~linkedin-post-search",
    keywords: "",
    maxResults: "60",
    input: JSON.stringify(INPUT_EXAMPLES[type], null, 2),
  };
}

function toDraft(s: SourceRow): Draft {
  return {
    id: s.id,
    name: s.name,
    type: s.type === "apify_facebook" ? "apify_facebook" : "apify_linkedin",
    enabled: s.enabled,
    actorId: s.config.actorId,
    keywords: s.config.keywords.join(", "),
    maxResults: s.config.maxResults ? String(s.config.maxResults) : "",
    input: JSON.stringify(s.config.input ?? {}, null, 2),
  };
}

function parseInput(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const v: unknown = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Input must be a JSON object" };
    return { ok: true, value: v as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

export function SourcesView() {
  const router = useRouter();
  const sources = useApi<{ items: SourceRow[] }>("/api/sources");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const inputCheck = draft ? parseInput(draft.input) : null;

  async function save() {
    if (!draft || !inputCheck?.ok) return;
    setSaving(true);
    try {
      const body = {
        name: draft.name,
        type: draft.type,
        enabled: draft.enabled,
        config: {
          actorId: draft.actorId,
          input: inputCheck.value,
          keywords: draft.keywords.split(",").map((k) => k.trim()).filter(Boolean),
          maxResults: draft.maxResults ? Number(draft.maxResults) : undefined,
        },
      };
      await api(draft.id ? `/api/sources/${draft.id}` : "/api/sources", {
        method: draft.id ? "PATCH" : "POST",
        json: body,
      });
      toast.success("Source saved");
      setDraft(null);
      void sources.reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggle(s: SourceRow, enabled: boolean) {
    try {
      await api(`/api/sources/${s.id}`, { method: "PATCH", json: { enabled } });
      void sources.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function run(s: SourceRow) {
    setRunning(s.id);
    try {
      await api<RunRow>(`/api/sources/${s.id}/run`, { method: "POST" });
      toast.success("Apify run started", {
        description: "Results arrive automatically via webhook. Locally, press Collect on the Runs page when it finishes.",
        action: { label: "Runs", onClick: () => router.push("/runs") },
      });
      void sources.reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setRunning(null);
    }
  }

  async function remove(s: SourceRow) {
    if (!confirm(`Delete source “${s.name}”? Its jobs are kept.`)) return;
    try {
      await api(`/api/sources/${s.id}`, { method: "DELETE" });
      void sources.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Sources"
        description={
          <>
            Apify actors that scrape LinkedIn / Facebook hiring posts. Find actors in the{" "}
            <a className="underline" href="https://apify.com/store" target="_blank" rel="noopener noreferrer">
              Apify Store
            </a>{" "}
            and copy their id + input here.
          </>
        }
        actions={
          <Button onClick={() => setDraft(emptyDraft())}>
            <Plus /> Add source
          </Button>
        }
      />

      {sources.error && <p className="mb-3 text-sm text-destructive">{sources.error}</p>}

      {!sources.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : sources.data.items.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No sources yet"
          description="Add a LinkedIn or Facebook Apify actor, or run npm run db:seed to create two starter sources."
          action={<Button onClick={() => setDraft(emptyDraft())}>Add source</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sources.data.items.map((s) => (
            <Card key={s.id} className="gap-4">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      <span className="truncate">{s.name}</span>
                      <Badge variant={s.type === "apify_facebook" ? "info" : "purple"}>
                        {TYPE_LABEL[s.type as SourceType] ?? s.type}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="mt-1 truncate font-mono text-xs">{s.config.actorId}</CardDescription>
                  </div>
                  <Switch checked={s.enabled} onCheckedChange={(v) => toggle(s, v)} aria-label="Enabled" />
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>{s.jobCount} jobs</span>
                  <span>
                    Last fetched:{" "}
                    {s.lastFetchedAt ? formatDistanceToNow(new Date(s.lastFetchedAt), { addSuffix: true }) : "never"}
                  </span>
                  {s.config.maxResults && <span>max {s.config.maxResults} results</span>}
                </div>
                {s.lastRun && (
                  <div className="flex flex-wrap items-center gap-2">
                    Last run: <RunStatusBadge status={s.lastRun.status} />
                    {s.lastRun.status !== "running" && s.lastRun.status !== "failed" && (
                      <span className="text-muted-foreground">+{s.lastRun.insertedCount} new</span>
                    )}
                    {s.lastRun.error && <span className="line-clamp-2 text-xs text-destructive">{s.lastRun.error}</span>}
                  </div>
                )}
                {s.config.actorId.startsWith("REPLACE") && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">Set a real Apify actor id before running.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => run(s)} disabled={running !== null || s.config.actorId.startsWith("REPLACE")}>
                    {running === s.id ? <Loader2 className="animate-spin" /> : <Play />}
                    Run now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft(toDraft(s))}>
                    <Pencil /> Edit
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/jobs?sourceId=${s.id}`}>View jobs</Link>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s)} aria-label="Delete source">
                    <Trash2 />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit source" : "Add source"}</DialogTitle>
            <DialogDescription>
              The JSON input is sent to the actor as-is. Field names differ per actor, so copy them from the actor&apos;s
              Input tab on Apify.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="s-name">Name</Label>
                  <Input
                    id="s-name"
                    value={draft.name}
                    placeholder="LinkedIn – React hiring PK"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select
                    value={draft.type}
                    onValueChange={(v) => {
                      const type = v as SourceType;
                      const untouched = draft.input === JSON.stringify(INPUT_EXAMPLES[draft.type], null, 2);
                      setDraft({
                        ...draft,
                        type,
                        input: untouched ? JSON.stringify(INPUT_EXAMPLES[type], null, 2) : draft.input,
                      });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apify_linkedin">LinkedIn posts</SelectItem>
                      <SelectItem value="apify_facebook">Facebook groups / posts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <div className="grid gap-2">
                  <Label htmlFor="s-actor">Apify actor id</Label>
                  <Input
                    id="s-actor"
                    className="font-mono"
                    placeholder="username~actor-name"
                    value={draft.actorId}
                    onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="s-max">Max results</Label>
                  <Input
                    id="s-max"
                    type="number"
                    min={1}
                    max={1000}
                    value={draft.maxResults}
                    onChange={(e) => setDraft({ ...draft, maxResults: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="s-kw">Keywords (comma separated, for your reference)</Label>
                <Input
                  id="s-kw"
                  value={draft.keywords}
                  placeholder="react developer, next.js developer"
                  onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="s-input">Actor input (JSON)</Label>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={!inputCheck?.ok}
                    onClick={() => inputCheck?.ok && setDraft({ ...draft, input: JSON.stringify(inputCheck.value, null, 2) })}
                  >
                    Prettify
                  </Button>
                </div>
                <Textarea
                  id="s-input"
                  value={draft.input}
                  onChange={(e) => setDraft({ ...draft, input: e.target.value })}
                  className="min-h-56 font-mono text-xs"
                  aria-invalid={inputCheck ? !inputCheck.ok : undefined}
                  spellCheck={false}
                />
                {inputCheck && !inputCheck.ok && <p className="text-xs text-destructive">{inputCheck.error}</p>}
              </div>
              <Label className="gap-2 font-normal">
                <Switch checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
                Enabled (included in cron runs)
              </Label>
              <a
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline"
                href="https://docs.apify.com/platform/actors/running/input-and-output"
                target="_blank"
                rel="noopener noreferrer"
              >
                About actor input <ExternalLink className="size-3" />
              </a>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !draft?.name.trim() || !draft?.actorId.trim() || !inputCheck?.ok}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
