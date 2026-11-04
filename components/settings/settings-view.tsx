"use client";

import { FileUp, Loader2, MailCheck, MessageCircle, Paperclip, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText, useApi } from "@/lib/client";
import { renderTemplate } from "@/lib/template";
import type { SettingsResponse } from "@/lib/types";

type Form = {
  fullName: string;
  email: string;
  phone: string;
  portfolioUrl: string;
  linkedinUrl: string;
  whatsappMessageTemplate: string;
};

export function SettingsView() {
  const settings = useApi<SettingsResponse>("/api/settings");
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const s = settings.data;
    if (!s || form) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the form once data loads
    setForm({
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      portfolioUrl: s.portfolioUrl,
      linkedinUrl: s.linkedinUrl,
      whatsappMessageTemplate: s.whatsappMessageTemplate,
    });
  }, [settings.data, form]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", json: form });
      toast.success("Settings saved");
      void settings.reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api("/api/settings/cv", { method: "POST", body: fd });
      toast.success("CV uploaded");
      void settings.reload();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeCv() {
    if (!confirm("Remove your CV?")) return;
    try {
      await api("/api/settings/cv", { method: "DELETE" });
      void settings.reload();
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  async function testEmail() {
    setTesting(true);
    try {
      const res = await api<{ to: string }>("/api/settings/test-email", { method: "POST" });
      toast.success(`Test email sent to ${res.to}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setTesting(false);
    }
  }

  const s = settings.data;
  if (settings.error) return <p className="text-destructive">{settings.error}</p>;
  if (!s || !form) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const waPreview = renderTemplate(form.whatsappMessageTemplate, {
    job_title: "React Developer",
    company: "Acme Pvt Ltd",
    location: "Lahore",
    my_name: form.fullName,
    my_phone: form.phone,
    my_email: form.email,
    portfolio_url: form.portfolioUrl,
    linkedin_url: form.linkedinUrl,
  });

  return (
    <>
      <PageHeader title="Settings" description="Your details fill the {{my_*}} placeholders in emails and WhatsApp messages." />

      <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Used in templates and as the Reply-To address.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" value={form.fullName} onChange={set("fullName")} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={form.email} onChange={set("email")} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={form.phone} onChange={set("phone")} placeholder="+92 300 1234567" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="portfolioUrl">Portfolio URL</Label>
              <Input id="portfolioUrl" type="url" value={form.portfolioUrl} onChange={set("portfolioUrl")} placeholder="https://" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
              <Input id="linkedinUrl" type="url" value={form.linkedinUrl} onChange={set("linkedinUrl")} placeholder="https://linkedin.com/in/…" />
            </div>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>CV</CardTitle>
              <CardDescription>PDF, max 4 MB. Stored privately in your database and attached to application emails.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {s.cv ? (
                <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                  <a href="/api/settings/cv" target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 hover:underline">
                    <Paperclip className="size-4 shrink-0" />
                    <span className="truncate">{s.cv.fileName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{(s.cv.size / 1024).toFixed(0)} KB</span>
                  </a>
                  <Button type="button" size="icon-sm" variant="ghost" onClick={removeCv} aria-label="Remove CV">
                    <Trash2 />
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No CV uploaded yet.</p>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="animate-spin" /> : <FileUp />}
                {s.cv ? "Replace CV" : "Upload CV"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email (SMTP)</CardTitle>
              <CardDescription>Sends the default template with sample data to your own address.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline" onClick={testEmail} disabled={testing}>
                {testing ? <Loader2 className="animate-spin" /> : <MailCheck />}
                Send test email to myself
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="size-4 text-whatsapp" /> WhatsApp message
            </CardTitle>
            <CardDescription>Pre-filled when you click a WhatsApp button. Same placeholders as emails.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Textarea value={form.whatsappMessageTemplate} onChange={set("whatsappMessageTemplate")} className="min-h-36" />
            <div className="rounded-lg bg-whatsapp/10 p-3 text-sm whitespace-pre-wrap">{waPreview}</div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save settings
          </Button>
        </div>
      </form>
    </>
  );
}
