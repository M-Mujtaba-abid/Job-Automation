"use client";

import { format } from "date-fns";
import { FileText, Loader2, Mail, MessageCircle, Play, RotateCw, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorText, useApi } from "@/lib/client";
import type { ApplicationRow, ProcessResponse } from "@/lib/types";

type Resp = { items: ApplicationRow[]; total: number; queued: number; page: number; pageSize: number };

const CHANNEL = {
  email: { icon: Mail, label: "Email" },
  whatsapp: { icon: MessageCircle, label: "WhatsApp" },
  google_form: { icon: FileText, label: "Form" },
} as const;

const STATUS_VARIANT = {
  sent: "success",
  opened: "info",
  queued: "secondary",
  sending: "warning",
  failed: "destructive",
} as const;

export function ApplicationsView() {
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const qs = new URLSearchParams({ page: String(page) });
  if (channel !== "all") qs.set("channel", channel);
  if (status !== "all") qs.set("status", status);
  const apps = useApi<Resp>(`/api/applications?${qs}`);

  async function processLoop(batchId?: string) {
    let total = 0;
    for (;;) {
      const res = await api<ProcessResponse>("/api/applications/email/process", {
        method: "POST",
        json: { batchId, limit: 3 },
      });
      total += res.sent;
      if (res.failed) toast.error(`${res.failed} failed: ${res.results.find((r) => !r.ok)?.error ?? ""}`);
      if (res.limitReached) {
        toast.warning("Daily email limit reached. The rest stay queued.");
        break;
      }
      if (res.remaining === 0 || res.sent + res.failed === 0) break;
      void apps.reload();
    }
    return total;
  }

  async function resume() {
    setBusy("resume");
    try {
      const sent = await processLoop();
      toast.success(`Sent ${sent} queued email${sent === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
      void apps.reload();
    }
  }

  async function retry(row: ApplicationRow) {
    setBusy(row.id);
    try {
      const res = await api<{ batchId: string | null }>(`/api/applications/${row.id}/retry`, { method: "POST" });
      const sent = await processLoop(res.batchId ?? undefined);
      if (sent) toast.success(`Re-sent to ${row.toAddress}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
      void apps.reload();
    }
  }

  const data = apps.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Applications"
        description="Everything you sent by email or opened on WhatsApp / Google Forms."
        actions={
          data && data.queued > 0 ? (
            <Button onClick={resume} disabled={busy !== null}>
              {busy === "resume" ? <Loader2 className="animate-spin" /> : <Play />}
              Resume sending ({data.queued} queued)
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={channel} onValueChange={(v) => { setChannel(v); setPage(1); }}>
          <SelectTrigger className="w-36" aria-label="Channel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="google_form">Google Form</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="opened">Opened</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {apps.error && <p className="mb-3 text-sm text-destructive">{apps.error}</p>}

      {!data ? (
        <Skeleton className="h-64" />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No applications yet"
          description="Select jobs on the Jobs page and click Apply via Email, or use the WhatsApp / Form buttons."
          action={
            <Button asChild>
              <Link href="/jobs?filter=email">Go to jobs with email</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((a) => {
                  const C = CHANNEL[a.channel];
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="max-w-64">
                        <Link href={`/jobs/${a.jobId}`} className="line-clamp-1 font-medium hover:underline">
                          {a.jobTitle}
                        </Link>
                        {a.company && <div className="text-xs text-muted-foreground">{a.company}</div>}
                        {a.subject && <div className="line-clamp-1 text-xs text-muted-foreground">“{a.subject}”</div>}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <C.icon className="size-4 text-muted-foreground" />
                          {C.label}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-sm">{a.toAddress}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[a.status]}>{a.status}</Badge>
                        {a.error && <div className="mt-1 max-w-56 text-xs text-destructive">{a.error}</div>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                        {format(new Date(a.sentAt ?? a.createdAt), "d MMM, HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        {a.status === "failed" && a.channel === "email" && (
                          <Button size="xs" variant="outline" onClick={() => retry(a)} disabled={busy !== null}>
                            {busy === a.id ? <Loader2 className="animate-spin" /> : <RotateCw />}
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="tabular-nums text-muted-foreground">
                {page} / {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
