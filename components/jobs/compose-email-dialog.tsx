"use client";

import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mail,
  Paperclip,
  Send,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, useApi } from "@/lib/client";
import { gmailComposeUrls, mailtoUrl, PLACEHOLDERS, renderTemplate } from "@/lib/template";
import type { PrepareResponse, ProcessResponse, QueueResponse, TemplateRow } from "@/lib/types";

type Phase = "compose" | "sending" | "done";
type Progress = { total: number; sent: number; failed: number; failures: { email: string; error?: string }[] };

export function ComposeEmailDialog({
  open,
  jobIds,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  jobIds: string[];
  onOpenChange: (open: boolean) => void;
  onSent: (sentJobIds: string[]) => void;
}) {
  const [prep, setPrep] = useState<PrepareResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachCv, setAttachCv] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [previewIdx, setPreviewIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("compose");
  const [progress, setProgress] = useState<Progress>({ total: 0, sent: 0, failed: 0, failures: [] });
  const [skipped, setSkipped] = useState<QueueResponse["skipped"]>([]);
  const [limitReached, setLimitReached] = useState(false);
  const cancelled = useRef(false);

  const templates = useApi<{ items: TemplateRow[] }>(open ? "/api/templates" : null);

  // Load compose payload whenever the dialog opens with a new selection.
  useEffect(() => {
    if (!open) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when the dialog (re)opens
    setPrep(null);
    setLoadError(null);
    setPhase("compose");
    setExcluded(new Set());
    setPreviewIdx(0);
    setSkipped([]);
    setLimitReached(false);
    api<PrepareResponse>("/api/applications/email/prepare", { method: "POST", json: { jobIds } })
      .then((res) => {
        if (!active) return;
        setPrep(res);
        setTemplateId(res.template?.id ?? null);
        setSubject(res.template?.subject ?? "Application for {{job_title}}");
        setBody(res.template?.body ?? "Dear Hiring Team at {{company}},\n\n...\n\nBest regards,\n{{my_name}}");
        setAttachCv(Boolean(res.cv) && (res.template?.attachCv ?? true));
      })
      .catch((err) => active && setLoadError(errorText(err)));
    return () => {
      active = false;
    };
  }, [open, jobIds]);

  const activeRecipients = useMemo(
    () => (prep?.recipients ?? []).filter((r) => !excluded.has(r.email)),
    [prep, excluded],
  );
  const preview = activeRecipients[Math.min(previewIdx, Math.max(activeRecipients.length - 1, 0))];
  const previewVars = preview ? { ...prep?.profileVars, ...preview.vars } : (prep?.profileVars ?? {});
  const recentlyEmailed = activeRecipients.filter((r) => r.lastEmailedAt);
  const cvMissing = attachCv && !prep?.cv;

  function applyTemplate(id: string) {
    const t = templates.data?.items.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(t.id);
    setSubject(t.subject);
    setBody(t.body);
    setAttachCv(Boolean(prep?.cv) && t.attachCv);
  }

  function toggleRecipient(email: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  async function send() {
    if (!prep) return;
    cancelled.current = false;
    setPhase("sending");
    try {
      const queued = await api<QueueResponse>("/api/applications/email", {
        method: "POST",
        json: {
          jobIds: activeRecipients.flatMap((r) => r.jobs.map((j) => j.id)),
          subject,
          body,
          templateId,
          attachCv,
          excludeEmails: [...excluded],
        },
      });
      setSkipped(queued.skipped);
      const state: Progress = { total: queued.queued, sent: 0, failed: 0, failures: [] };
      setProgress(state);

      let remaining = queued.queued;
      while (remaining > 0 && !cancelled.current) {
        const res = await api<ProcessResponse>("/api/applications/email/process", {
          method: "POST",
          json: { batchId: queued.batchId, limit: 3 },
        });
        state.sent += res.sent;
        state.failed += res.failed;
        state.failures.push(...res.results.filter((r) => !r.ok));
        setProgress({ ...state });
        remaining = res.remaining;
        if (res.limitReached) {
          setLimitReached(true);
          break;
        }
        if (res.sent + res.failed === 0) break; // nothing claimable (another tab is sending)
      }

      setPhase("done");
      const failedEmails = new Set(state.failures.map((f) => f.email));
      const sentJobIds = activeRecipients.filter((r) => !failedEmails.has(r.email)).flatMap((r) => r.jobs.map((j) => j.id));
      if (state.sent) {
        toast.success(`Sent ${state.sent} email${state.sent === 1 ? "" : "s"}`);
        onSent(sentJobIds);
      }
      if (state.failed) toast.error(`${state.failed} email${state.failed === 1 ? "" : "s"} failed`);
    } catch (err) {
      toast.error(errorText(err));
      setPhase("compose");
    }
  }

  function openGmail() {
    const emails = activeRecipients.map((r) => r.email);
    const vars = activeRecipients.length === 1 ? previewVars : (prep?.profileVars ?? {});
    const urls = gmailComposeUrls(emails, renderTemplate(subject, vars), renderTemplate(body, vars));
    if (urls.some((u) => !u.includes("&body="))) toast.info("Body too long for a Gmail link: paste it manually.");
    if (urls.length > 1) toast.info(`Opening ${urls.length} Gmail windows (max 20 recipients each)`);
    urls.forEach((u) => window.open(u, "_blank", "noopener,noreferrer"));
  }

  function openMailto() {
    const vars = activeRecipients.length === 1 ? previewVars : (prep?.profileVars ?? {});
    window.location.href = mailtoUrl(
      activeRecipients.map((r) => r.email),
      renderTemplate(subject, vars),
      renderTemplate(body, vars),
    );
  }

  const busy = phase === "sending";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-5" /> Apply via Email
          </DialogTitle>
          <DialogDescription>
            Every recipient gets their own personalized email (no CC/BCC). If several selected jobs share an address,
            they get one email with the job titles combined.
          </DialogDescription>
        </DialogHeader>

        {loadError && (
          <Alert variant="destructive">
            <XCircle />
            <AlertTitle>Couldn&apos;t prepare emails</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {!prep && !loadError && (
          <div className="grid gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-9" />
            <Skeleton className="h-40" />
          </div>
        )}

        {prep && phase === "compose" && (
          <div className="grid gap-4">
            {/* Recipients */}
            <div className="grid gap-2">
              <Label>
                To <span className="font-normal text-muted-foreground">({activeRecipients.length} unique)</span>
              </Label>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
                {prep.recipients.map((r) => {
                  const off = excluded.has(r.email);
                  return (
                    <span
                      key={r.email}
                      title={r.jobs.map((j) => j.title).join(", ")}
                      className={
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs " +
                        (off
                          ? "text-muted-foreground line-through opacity-60"
                          : r.lastEmailedAt
                            ? "border-amber-500/50 bg-amber-500/10"
                            : "bg-muted")
                      }
                    >
                      {r.lastEmailedAt && !off && <AlertTriangle className="size-3 text-amber-600" />}
                      {r.email}
                      {r.jobs.length > 1 && <Badge variant="secondary" className="px-1 py-0">{r.jobs.length} jobs</Badge>}
                      <button
                        type="button"
                        onClick={() => toggleRecipient(r.email)}
                        className="rounded-full p-0.5 hover:bg-background"
                        aria-label={off ? `Include ${r.email}` : `Remove ${r.email}`}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  );
                })}
                {!prep.recipients.length && (
                  <span className="text-sm text-muted-foreground">None of the selected jobs have an email.</span>
                )}
              </div>
              {recentlyEmailed.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  You already emailed{" "}
                  {recentlyEmailed
                    .slice(0, 3)
                    .map((r) => `${r.email} (${formatDistanceToNow(new Date(r.lastEmailedAt!), { addSuffix: true })})`)
                    .join(", ")}
                  {recentlyEmailed.length > 3 && ` and ${recentlyEmailed.length - 3} more`}. Remove them if you
                  don&apos;t want to email again.
                </p>
              )}
              {prep.jobsWithoutEmail.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {prep.jobsWithoutEmail.length} selected job{prep.jobsWithoutEmail.length === 1 ? " has" : "s have"} no
                  email and will be skipped.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="grid gap-2">
                <Label>Template</Label>
                <Select value={templateId ?? undefined} onValueChange={applyTemplate}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={templates.loading ? "Loading…" : "Choose a template"} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.data?.items.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex h-9 items-center gap-2 text-sm">
                <Switch checked={attachCv} onCheckedChange={setAttachCv} disabled={!prep.cv} />
                <Paperclip className="size-4 text-muted-foreground" />
                {prep.cv ? prep.cv.fileName : "No CV uploaded"}
              </label>
            </div>
            {cvMissing && (
              <p className="text-xs text-destructive">
                No CV uploaded. <Link className="underline" href="/settings">Upload one in Settings</Link> or turn
                off Attach CV.
              </p>
            )}

            <Tabs defaultValue="edit">
              <TabsList>
                <TabsTrigger value="edit">Edit</TabsTrigger>
                <TabsTrigger value="preview" disabled={!activeRecipients.length}>
                  Preview
                </TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="grid gap-3 pt-2">
                <div className="grid gap-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="body">Body</Label>
                  <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-56 font-mono text-[13px]" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Placeholders: {PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ")}
                </p>
              </TabsContent>
              <TabsContent value="preview" className="pt-2">
                {preview && (
                  <div className="rounded-lg border">
                    <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">
                          <span className="text-muted-foreground">To:</span> {preview.email}
                        </div>
                        <div className="truncate font-medium">{renderTemplate(subject, previewVars)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button size="icon-sm" variant="ghost" disabled={previewIdx === 0} onClick={() => setPreviewIdx((i) => i - 1)} aria-label="Previous">
                          <ChevronLeft />
                        </Button>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Math.min(previewIdx, activeRecipients.length - 1) + 1}/{activeRecipients.length}
                        </span>
                        <Button size="icon-sm" variant="ghost" disabled={previewIdx >= activeRecipients.length - 1} onClick={() => setPreviewIdx((i) => i + 1)} aria-label="Next">
                          <ChevronRight />
                        </Button>
                      </div>
                    </div>
                    <pre className="max-h-72 overflow-y-auto px-3 py-3 font-sans text-sm whitespace-pre-wrap">
                      {renderTemplate(body, previewVars)}
                    </pre>
                    {attachCv && prep.cv && (
                      <div className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground">
                        <Paperclip className="size-3.5" /> {prep.cv.fileName}
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}

        {prep && phase !== "compose" && (
          <div className="grid gap-4 py-2">
            <div className="flex items-center gap-3">
              {phase === "sending" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : progress.failed ? (
                <AlertTriangle className="size-5 text-amber-600" />
              ) : (
                <CheckCircle2 className="size-5 text-success" />
              )}
              <div className="text-sm">
                {phase === "sending" ? "Sending… keep this window open." : "Done."}{" "}
                <span className="tabular-nums text-muted-foreground">
                  {progress.sent + progress.failed} / {progress.total}
                </span>
              </div>
            </div>
            <Progress value={progress.total ? ((progress.sent + progress.failed) / progress.total) * 100 : 0} />
            <div className="flex gap-4 text-sm">
              <span className="text-success">✓ {progress.sent} sent</span>
              {progress.failed > 0 && <span className="text-destructive">✕ {progress.failed} failed</span>}
            </div>
            {limitReached && (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>Daily email limit reached</AlertTitle>
                <AlertDescription>
                  The rest stay queued. Resume from the Applications page tomorrow.
                </AlertDescription>
              </Alert>
            )}
            {progress.failures.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
                {progress.failures.map((f) => (
                  <li key={f.email}>
                    <span className="font-medium">{f.email}</span>: <span className="text-destructive">{f.error}</span>
                  </li>
                ))}
              </ul>
            )}
            {skipped.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Skipped {skipped.length} (already applied): {skipped.slice(0, 3).map((s) => s.email).join(", ")}
                {skipped.length > 3 && "…"}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {phase === "compose" ? (
            <>
              <div className="flex gap-2">
                <Button variant="outline" disabled={!activeRecipients.length} onClick={openGmail}>
                  <ExternalLink /> Open in Gmail
                </Button>
                <Button variant="ghost" disabled={!activeRecipients.length} onClick={openMailto}>
                  mailto:
                </Button>
              </div>
              <Button disabled={!prep || !activeRecipients.length || !subject.trim() || !body.trim() || cvMissing} onClick={send}>
                <Send /> Send {activeRecipients.length} email{activeRecipients.length === 1 ? "" : "s"}
              </Button>
            </>
          ) : phase === "sending" ? (
            <Button variant="outline" className="ml-auto" onClick={() => (cancelled.current = true)}>
              Stop after current batch
            </Button>
          ) : (
            <Button className="ml-auto" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
