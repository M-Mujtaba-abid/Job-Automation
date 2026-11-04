"use client";

import { BriefcaseBusiness, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, useApi } from "@/legacy/client";
import type {
  JobFilterTab,
  JobIdsResponse,
  JobRow,
  JobsResponse,
  SettingsResponse,
  SourceRow,
  StatsResponse,
} from "@/legacy/types";
import { BulkActionBar } from "./bulk-action-bar";
import { ComposeEmailDialog } from "./compose-email-dialog";
import type { WhatsAppConfig } from "./contact-buttons";
import { JobFilters, type FilterState } from "./job-filters";
import { JobsTable } from "./jobs-table";
import { StatsCards } from "./stats-cards";

const PAGE_SIZE = 25;
const TABS: JobFilterTab[] = ["all", "email", "phone", "form"];

function readFilters(sp: URLSearchParams): FilterState {
  const filter = sp.get("filter") as JobFilterTab;
  return {
    filter: TABS.includes(filter) ? filter : "all",
    q: sp.get("q") ?? "",
    sourceId: sp.get("sourceId") ?? "",
    status: sp.get("status") ?? "",
    from: sp.get("from") ?? "",
    to: sp.get("to") ?? "",
    hideApplied: sp.get("hideApplied") !== "false",
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
}

function toQuery(f: FilterState, extra: Record<string, string> = {}) {
  const p = new URLSearchParams();
  if (f.filter !== "all") p.set("filter", f.filter);
  if (f.q) p.set("q", f.q);
  if (f.sourceId) p.set("sourceId", f.sourceId);
  if (f.status) p.set("status", f.status);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (!f.hideApplied) p.set("hideApplied", "false");
  if (f.page > 1) p.set("page", String(f.page));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

export function JobsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readFilters(new URLSearchParams(searchParams.toString())), [searchParams]);

  const jobs = useApi<JobsResponse>(`/api/jobs?${toQuery(filters, { pageSize: String(PAGE_SIZE) })}`);
  const stats = useApi<StatsResponse>("/api/stats");
  const sources = useApi<{ items: SourceRow[] }>("/api/sources");
  const settings = useApi<SettingsResponse>("/api/settings");

  const [selection, setSelection] = useState<Map<string, string[]>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [compose, setCompose] = useState<{ open: boolean; jobIds: string[] }>({ open: false, jobIds: [] });

  const whatsapp: WhatsAppConfig | null = useMemo(
    () =>
      settings.data
        ? {
            template: settings.data.whatsappMessageTemplate,
            profileVars: {
              my_name: settings.data.fullName,
              my_phone: settings.data.phone,
              my_email: settings.data.email,
              portfolio_url: settings.data.portfolioUrl,
              linkedin_url: settings.data.linkedinUrl,
            },
          }
        : null,
    [settings.data],
  );

  const setFilters = useCallback(
    (patch: Partial<FilterState>) => {
      const next = { ...filters, ...patch };
      const qs = toQuery(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      // Changing the result set (not the page) clears the selection to avoid surprises.
      if (Object.keys(patch).some((k) => k !== "page")) setSelection(new Map());
    },
    [filters, pathname, router],
  );

  const { reload: reloadJobs } = jobs;
  const { reload: reloadStats } = stats;
  const refresh = useCallback(() => {
    void reloadJobs();
    void reloadStats();
  }, [reloadJobs, reloadStats]);

  const rows = jobs.data?.items ?? [];
  const total = jobs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const uniqueEmails = useMemo(() => new Set([...selection.values()].flat()).size, [selection]);
  const allPageSelected = rows.length > 0 && rows.every((r) => selection.has(r.id));

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const res = await api<JobIdsResponse>(`/api/jobs/ids?${toQuery({ ...filters, page: 1 })}`);
      const next = new Map<string, string[]>(res.ids.map((id) => [id, []]));
      for (const { jobId, email } of res.emails) next.get(jobId)?.push(email);
      setSelection(next);
      if (res.truncated) toast.info(`Selected the first ${res.ids.length} jobs`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSelectingAll(false);
    }
  }

  async function bulkStatus(status: "saved" | "hidden") {
    const ids = [...selection.keys()];
    try {
      await api("/api/jobs/bulk", { method: "POST", json: { ids, status } });
      toast.success(`${status === "saved" ? "Saved" : "Hid"} ${ids.length} job${ids.length === 1 ? "" : "s"}`);
      setSelection(new Map());
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  const setStatus = useCallback(
    async (job: JobRow, status: JobRow["status"]) => {
      try {
        await api(`/api/jobs/${job.id}`, { method: "PATCH", json: { status } });
        toast.success(`Marked “${job.title}” as ${status}`);
        refresh();
      } catch (err) {
        toast.error(errorText(err));
      }
    },
    [refresh],
  );

  const emailJob = useCallback((job: JobRow) => setCompose({ open: true, jobIds: [job.id] }), []);

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Hiring posts from LinkedIn & Facebook with extracted emails, WhatsApp numbers and Google Forms."
        actions={
          <Button variant="outline" onClick={refresh} disabled={jobs.loading}>
            <RefreshCw className={jobs.loading ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />

      <StatsCards stats={stats.data} />

      <JobFilters
        state={filters}
        counts={jobs.data?.counts ?? null}
        sources={(sources.data?.items ?? []).map((s) => ({ id: s.id, name: s.name }))}
        onChange={setFilters}
      />

      {allPageSelected && total > rows.length && selection.size < total && (
        <div className="mb-3 flex flex-wrap items-center justify-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm">
          All {rows.length} jobs on this page are selected.
          <Button variant="link" className="h-auto p-0" onClick={selectAllMatching} disabled={selectingAll}>
            {selectingAll && <Loader2 className="animate-spin" />}
            Select all {total} matching jobs
          </Button>
        </div>
      )}
      {selection.size > rows.length && selection.size === total && total > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm">
          All {total} matching jobs are selected.
          <Button variant="link" className="h-auto p-0" onClick={() => setSelection(new Map())}>
            Clear selection
          </Button>
        </div>
      )}

      {jobs.error && <p className="mb-3 text-sm text-destructive">{jobs.error}</p>}

      {!jobs.data && jobs.loading ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title={filters.q || filters.filter !== "all" ? "No jobs match these filters" : "No jobs yet"}
          description={
            filters.q || filters.filter !== "all" ? (
              "Try another tab or clear the search."
            ) : (
              <>
                Add an Apify source and press <b>Run now</b>, or wait for the daily cron.
              </>
            )
          }
          action={
            !(filters.q || filters.filter !== "all") && (
              <Button asChild>
                <Link href="/sources">Go to Sources</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <JobsTable
            rows={rows}
            filter={filters.filter}
            selection={selection}
            onSelectionChange={setSelection}
            whatsapp={whatsapp}
            onEmailJob={emailJob}
            onSetStatus={setStatus}
          />
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span className="tabular-nums">
              {(filters.page - 1) * PAGE_SIZE + 1}–{Math.min(filters.page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={filters.page <= 1}
                onClick={() => setFilters({ page: filters.page - 1 })}
                aria-label="Previous page"
              >
                <ChevronLeft />
              </Button>
              <span className="px-2 tabular-nums">
                {filters.page} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={filters.page >= pageCount}
                onClick={() => setFilters({ page: filters.page + 1 })}
                aria-label="Next page"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}

      <BulkActionBar
        jobCount={selection.size}
        emailCount={uniqueEmails}
        onApplyEmail={() =>
          setCompose({ open: true, jobIds: [...selection.entries()].filter(([, e]) => e.length).map(([id]) => id) })
        }
        onSave={() => bulkStatus("saved")}
        onHide={() => bulkStatus("hidden")}
        onClear={() => setSelection(new Map())}
      />

      <ComposeEmailDialog
        open={compose.open}
        jobIds={compose.jobIds}
        onOpenChange={(open) => setCompose((c) => ({ ...c, open }))}
        onSent={(sentIds) => {
          setSelection((prev) => {
            const next = new Map(prev);
            sentIds.forEach((id) => next.delete(id));
            return next;
          });
          refresh();
        }}
      />
    </>
  );
}
