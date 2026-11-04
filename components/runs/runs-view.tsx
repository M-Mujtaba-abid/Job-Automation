"use client";

import { format, formatDistanceStrict } from "date-fns";
import { Download, ExternalLink, History, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorText, useApi } from "@/lib/client";
import type { RunRow } from "@/lib/types";

export function RunStatusBadge({ status }: { status: RunRow["status"] }) {
  const variant = { running: "warning", success: "success", partial: "info", failed: "destructive" } as const;
  return (
    <Badge variant={variant[status]}>
      {status === "running" && <Loader2 className="animate-spin" />}
      {status}
    </Badge>
  );
}

type CollectResult =
  | { state: "pending"; rawStatus: string }
  | { state: "done"; run: RunRow }
  | { state: "skipped"; reason: string };

export function RunsView() {
  const runs = useApi<{ items: RunRow[] }>("/api/runs");
  const [collecting, setCollecting] = useState<string | null>(null);

  async function collect(run: RunRow, force = false) {
    setCollecting(run.id);
    try {
      const res = await api<CollectResult>(`/api/runs/${run.id}/collect${force ? "?force=true" : ""}`, { method: "POST" });
      if (res.state === "pending") toast.info(`Apify run is still ${res.rawStatus.toLowerCase()}. Try again in a minute.`);
      else if (res.state === "skipped") toast.info(`Skipped: ${res.reason}`);
      else if (res.run.status === "failed") toast.error(res.run.error ?? "Run failed");
      else toast.success(`Collected: ${res.run.insertedCount} new, ${res.run.duplicateCount} duplicates, ${res.run.skippedCount} skipped`);
      void runs.reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setCollecting(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Fetch runs"
        description="Each cron / Run now starts an Apify run. Results are ingested by webhook. Use Collect when developing locally."
        actions={
          <Button variant="outline" onClick={() => runs.reload()} disabled={runs.loading}>
            <RefreshCw className={runs.loading ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />

      {runs.error && <p className="mb-3 text-sm text-destructive">{runs.error}</p>}

      {!runs.data ? (
        <Skeleton className="h-64" />
      ) : runs.data.items.length === 0 ? (
        <EmptyState icon={History} title="No runs yet" description="Start one with Run now on the Sources page." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Fetched</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Dupes</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead>Started</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.sourceName ?? "Deleted source"}</div>
                    <div className="text-xs text-muted-foreground">{r.trigger}</div>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
                    {r.error && <div className="mt-1 max-w-72 text-xs text-destructive">{r.error}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.fetchedCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{r.insertedCount}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.duplicateCount}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.skippedCount}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                    {format(new Date(r.startedAt), "d MMM, HH:mm")}
                    {r.finishedAt && <div>took {formatDistanceStrict(new Date(r.finishedAt), new Date(r.startedAt))}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {r.status === "running" && r.apifyRunId && (
                        <Button size="xs" onClick={() => collect(r)} disabled={collecting !== null}>
                          {collecting === r.id ? <Loader2 className="animate-spin" /> : <Download />}
                          Collect
                        </Button>
                      )}
                      {r.status !== "running" && r.apifyRunId && (
                        <Button size="xs" variant="ghost" onClick={() => collect(r, true)} disabled={collecting !== null} title="Re-ingest (duplicates are ignored)">
                          {collecting === r.id ? <Loader2 className="animate-spin" /> : <Download />}
                        </Button>
                      )}
                      {r.apifyUrl && (
                        <Button size="xs" variant="ghost" asChild>
                          <a href={r.apifyUrl} target="_blank" rel="noopener noreferrer" title="Open in Apify console">
                            <ExternalLink />
                          </a>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
