"use client";

import { Loader2, Mail, Paperclip, Pencil, Plus, Star, Trash2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, useApi } from "@/legacy/client";
import { PLACEHOLDERS, renderTemplate, type TemplateVars } from "@/legacy/template";
import type { SettingsResponse, TemplateRow } from "@/legacy/types";

type Draft = { id?: string; name: string; subject: string; body: string; isDefault: boolean; attachCv: boolean };

const EMPTY: Draft = {
  name: "",
  subject: "Application for {{job_title}} – {{my_name}}",
  body: "Dear Hiring Team at {{company}},\n\nI'd like to apply for the {{job_title}} role.\n\nBest regards,\n{{my_name}}\n{{my_phone}}",
  isDefault: false,
  attachCv: true,
};

const SAMPLE_JOB: TemplateVars = { job_title: "React Developer", company: "Acme Pvt Ltd", location: "Lahore" };

export function TemplatesView() {
  const templates = useApi<{ items: TemplateRow[] }>("/api/templates");
  const settings = useApi<SettingsResponse>("/api/settings");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const s = settings.data;
  const sampleVars: TemplateVars = {
    ...SAMPLE_JOB,
    my_name: s?.fullName || "Your Name",
    my_phone: s?.phone || "+92 300 0000000",
    my_email: s?.email || "you@example.com",
    portfolio_url: s?.portfolioUrl || "https://your-portfolio.dev",
    linkedin_url: s?.linkedinUrl || "https://linkedin.com/in/you",
  };

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const { id, ...body } = draft;
      await api(id ? `/api/templates/${id}` : "/api/templates", { method: id ? "PATCH" : "POST", json: body });
      toast.success("Template saved");
      setDraft(null);
      void templates.reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: TemplateRow) {
    if (!confirm(`Delete template “${t.name}”?`)) return;
    try {
      await api(`/api/templates/${t.id}`, { method: "DELETE" });
      toast.success("Template deleted");
      void templates.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function makeDefault(t: TemplateRow) {
    try {
      await api(`/api/templates/${t.id}`, { method: "PATCH", json: { isDefault: true } });
      void templates.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Email templates"
        description={<>Use placeholders like <code>{"{{job_title}}"}</code> and <code>{"{{company}}"}</code>. They are filled per recipient.</>}
        actions={
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus /> New template
          </Button>
        }
      />

      {templates.error && <p className="mb-3 text-sm text-destructive">{templates.error}</p>}

      {!templates.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : templates.data.items.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No templates yet"
          description="Create one (or run npm run db:seed for a ready-made default)."
          action={<Button onClick={() => setDraft({ ...EMPTY, isDefault: true })}>Create template</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.data.items.map((t) => (
            <Card key={t.id} className="gap-3">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2">
                      {t.name}
                      {t.isDefault && <Badge variant="success">Default</Badge>}
                      {t.attachCv && <Paperclip className="size-3.5 text-muted-foreground" aria-label="Attaches CV" />}
                    </CardTitle>
                    <CardDescription className="mt-1 truncate">{renderTemplate(t.subject, sampleVars)}</CardDescription>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!t.isDefault && (
                      <Button size="icon-sm" variant="ghost" onClick={() => makeDefault(t)} title="Make default">
                        <Star />
                      </Button>
                    )}
                    <Button size="icon-sm" variant="ghost" onClick={() => setDraft({ ...t })} title="Edit">
                      <Pencil />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => remove(t)} title="Delete">
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="line-clamp-6 font-sans text-sm whitespace-pre-wrap text-muted-foreground">
                  {renderTemplate(t.body, sampleVars)}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit template" : "New template"}</DialogTitle>
            <DialogDescription>Placeholders: {PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ")}</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="t-name">Name</Label>
                  <Input id="t-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="t-subject">Subject</Label>
                  <Input id="t-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="t-body">Body</Label>
                  <Textarea
                    id="t-body"
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    className="min-h-72 font-mono text-[13px]"
                  />
                </div>
                <div className="flex flex-wrap gap-6">
                  <Label className="gap-2 font-normal">
                    <Switch checked={draft.isDefault} onCheckedChange={(v) => setDraft({ ...draft, isDefault: v })} />
                    Default template
                  </Label>
                  <Label className="gap-2 font-normal">
                    <Switch checked={draft.attachCv} onCheckedChange={(v) => setDraft({ ...draft, attachCv: v })} />
                    Attach CV
                  </Label>
                </div>
              </div>
              <div className="grid content-start gap-2">
                <Label>Live preview (sample job)</Label>
                <div className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-sm font-medium">{renderTemplate(draft.subject, sampleVars)}</div>
                  <pre className="max-h-96 overflow-y-auto px-3 py-3 font-sans text-sm whitespace-pre-wrap">
                    {renderTemplate(draft.body, sampleVars)}
                  </pre>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !draft?.name.trim() || !draft?.subject.trim() || !draft?.body.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
