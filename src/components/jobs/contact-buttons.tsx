"use client";

import { ExternalLink, FileText, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { jobVars, renderTemplate, whatsappLink, type TemplateVars } from "@/legacy/template";
import { cn } from "@/lib/utils";

type Contact = { type: string; value: string; normalized: string };
type JobForButtons = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  applyUrl: string | null;
  contacts: Contact[];
};

export type WhatsAppConfig = { template: string; profileVars: TemplateVars };

/** Fire-and-forget log of a WhatsApp / Form click. */
function track(jobId: string, channel: "whatsapp" | "google_form", to: string) {
  void fetch("/api/applications/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, channel, to }),
    keepalive: true,
  }).catch(() => undefined);
}

export function formatPhone(digits: string) {
  if (digits.startsWith("92") && digits.length === 12) return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `+${digits}`;
}

export function ContactButtons({
  job,
  whatsapp,
  onEmail,
  size = "xs",
  showLabels = false,
  className,
}: {
  job: JobForButtons;
  whatsapp: WhatsAppConfig | null;
  onEmail?: () => void;
  size?: "xs" | "sm";
  showLabels?: boolean;
  className?: string;
}) {
  const emails = job.contacts.filter((c) => c.type === "email");
  const phones = job.contacts.filter((c) => c.type === "phone");
  const forms = job.contacts.filter((c) => c.type === "google_form");

  const waMessage = whatsapp
    ? renderTemplate(whatsapp.template, { ...whatsapp.profileVars, ...jobVars([job]) })
    : "";

  const openWhatsApp = (phone: Contact) => {
    track(job.id, "whatsapp", phone.normalized);
    window.open(whatsappLink(phone.normalized, waMessage), "_blank", "noopener,noreferrer");
  };
  const openForm = (form: Contact) => {
    track(job.id, "google_form", form.normalized);
    window.open(form.value, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {emails.length > 0 && onEmail && (
        <Button size={size} variant="outline" onClick={onEmail} title={emails.map((e) => e.normalized).join(", ")}>
          <Mail />
          {showLabels && "Email"}
        </Button>
      )}

      {phones.length === 1 && (
        <Button size={size} variant="whatsapp" onClick={() => openWhatsApp(phones[0])} title={formatPhone(phones[0].normalized)}>
          <MessageCircle />
          {showLabels ? "WhatsApp" : <span className="sr-only">WhatsApp</span>}
        </Button>
      )}
      {phones.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size={size} variant="whatsapp">
              <MessageCircle />
              {showLabels ? `WhatsApp (${phones.length})` : phones.length}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Choose a number</DropdownMenuLabel>
            {phones.map((p) => (
              <DropdownMenuItem key={p.normalized} onSelect={() => openWhatsApp(p)}>
                <MessageCircle />
                {formatPhone(p.normalized)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {forms.length === 1 && (
        <Button size={size} variant="outline" className="border-purple-500/40 text-purple-700 dark:text-purple-300" onClick={() => openForm(forms[0])}>
          <FileText />
          {showLabels ? "Apply on Form" : "Form"}
        </Button>
      )}
      {forms.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size={size} variant="outline" className="border-purple-500/40 text-purple-700 dark:text-purple-300">
              <FileText />
              Forms ({forms.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {forms.map((f, i) => (
              <DropdownMenuItem key={f.normalized} onSelect={() => openForm(f)}>
                <FileText />
                Form {i + 1}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {job.applyUrl && (
        <Button size={size} variant="ghost" asChild>
          <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" title="View original post">
            <ExternalLink />
            {showLabels ? "View post" : <span className="sr-only">View post</span>}
          </a>
        </Button>
      )}
    </div>
  );
}
