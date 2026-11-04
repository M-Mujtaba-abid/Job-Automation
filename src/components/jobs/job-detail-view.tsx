"use client";

import { format, formatDistanceToNow } from "date-fns";
import { ArrowLeft, Bookmark, CheckCheck, EyeOff, FileText, Mail, MapPin, MessageCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, useApi } from "@/legacy/client";
import type { JobDetail, SettingsResponse } from "@/legacy/types";
import { ComposeEmailDialog } from "./compose-email-dialog";
import { ContactButtons, formatPhone } from "./contact-buttons";
import { StatusBadge } from "./jobs-table";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Render the description as text with contact values highlighted (no HTML injection). */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    const uniq = [...new Set(terms.filter((t) => t.length > 3))].sort((a, b) => b.length - a.length);
    if (!uniq.length) return [text];
    return text.split(new RegExp(`(${uniq.map(escapeRe).join("|")})`, "gi"));
  }, [text, terms]);
  const lower = new Set(terms.map((t) => t.toLowerCase()));
  return (
    <>
      {parts.map((p, i) =>
        lower.has(p.toLowerCase()) ? (
          <mark key={i} className="rounded bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/30">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const CHANNEL_ICON = { email: Mail, whatsapp: MessageCircle, google_form: FileText } as const;

export function JobDetailView({ id }: { id: string }) {
  const job = useApi<JobDetail>(`/api/jobs/${id}`);
  const settings = useApi<SettingsResponse>("/api/settings");
  const [composeOpen, setComposeOpen] = useState(false);
  const jobIds = useMemo(() => [id], [id]);

  async function setStatus(status: JobDetail["status"]) {
    try {
      await api(`/api/jobs/${id}`, { method: "PATCH", json: { status } });
      toast.success(`Marked as ${status}`);
      void job.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  if (job.error) return <p className="text-destructive">{job.error}</p>;
  if (!job.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const j = job.data;
  const s = settings.data;
  const whatsapp = s
    ? {
        template: s.whatsappMessageTemplate,
        profileVars: {
          my_name: s.fullName,
          my_phone: s.phone,
          my_email: s.email,
          portfolio_url: s.portfolioUrl,
          linkedin_url: s.linkedinUrl,
        },
      }
    : null;

  return (
    <div className="grid gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/jobs">
            <ArrowLeft /> Back to jobs
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{j.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {j.company && <span>{j.company}</span>}
              {j.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {j.location}
                </span>
              )}
              {j.isRemote && <Badge variant="info">Remote</Badge>}
              {j.employmentType && <Badge variant="outline">{j.employmentType}</Badge>}
              <StatusBadge status={j.status} />
              {j.sourceName && <span>via {j.sourceName}</span>}
              <span title={new Date(j.postedAt ?? j.createdAt).toLocaleString()}>
                {formatDistanceToNow(new Date(j.postedAt ?? j.createdAt), { addSuffix: true })}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {j.status !== "saved" && (
              <Button variant="outline" size="sm" onClick={() => setStatus("saved")}>
                <Bookmark /> Save
              </Button>
            )}
            {j.status !== "applied" && (
              <Button variant="outline" size="sm" onClick={() => setStatus("applied")}>
                <CheckCheck /> Mark applied
              </Button>
            )}
            {j.status !== "hidden" ? (
              <Button variant="outline" size="sm" onClick={() => setStatus("hidden")}>
                <EyeOff /> Hide
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setStatus("new")}>
                <RotateCcw /> Unhide
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Post</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              <Highlighted text={j.description ?? ""} terms={j.contacts.map((c) => c.value)} />
            </p>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Apply</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ContactButtons job={j} whatsapp={whatsapp} onEmail={() => setComposeOpen(true)} size="sm" showLabels />
              {j.contacts.length === 0 && (
                <p className="text-sm text-muted-foreground">No contact details found in this post.</p>
              )}
              <ul className="grid gap-1.5 text-sm">
                {j.contacts.map((c) => {
                  const Icon = c.type === "email" ? Mail : c.type === "phone" ? MessageCircle : FileText;
                  return (
                    <li key={c.id} className="flex min-w-0 items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {c.type === "phone" ? formatPhone(c.normalized) : c.type === "email" ? c.normalized : c.value}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {j.applications.length === 0 ? (
                <p className="text-sm text-muted-foreground">You haven&apos;t applied yet.</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {j.applications.map((a) => {
                    const Icon = CHANNEL_ICON[a.channel];
                    return (
                      <li key={a.id} className="flex items-start gap-2">
                        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="truncate">{a.toAddress}</div>
                          <div className="text-xs text-muted-foreground">
                            {a.status} · {format(new Date(a.sentAt ?? a.createdAt), "d MMM yyyy, HH:mm")}
                          </div>
                          {a.error && <div className="text-xs text-destructive">{a.error}</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ComposeEmailDialog
        open={composeOpen}
        jobIds={jobIds}
        onOpenChange={setComposeOpen}
        onSent={() => void job.reload()}
      />
    </div>
  );
}
