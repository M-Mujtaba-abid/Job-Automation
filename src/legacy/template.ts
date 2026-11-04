// Shared by server (sending) and client (live preview). No server-only imports here.

export const PLACEHOLDERS = [
  "job_title",
  "company",
  "location",
  "my_name",
  "my_phone",
  "my_email",
  "portfolio_url",
  "linkedin_url",
] as const;

export type Placeholder = (typeof PLACEHOLDERS)[number];
export type TemplateVars = Partial<Record<Placeholder, string | null | undefined>>;

const FALLBACKS: TemplateVars = {
  company: "your team",
  job_title: "the open position",
  location: "",
};

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const k = key.toLowerCase() as Placeholder;
    if (!PLACEHOLDERS.includes(k)) return match;
    const v = vars[k];
    return v && v.trim() ? v.trim() : (FALLBACKS[k] ?? "");
  });
}

export type JobLike = { title: string; company?: string | null; location?: string | null };
export type ProfileLike = {
  fullName: string;
  phone: string;
  email: string;
  portfolioUrl: string;
  linkedinUrl: string;
};

export function profileVars(p: ProfileLike): TemplateVars {
  return {
    my_name: p.fullName,
    my_phone: p.phone,
    my_email: p.email,
    portfolio_url: p.portfolioUrl,
    linkedin_url: p.linkedinUrl,
  };
}

/** Vars for one job, or several jobs sharing one recipient (titles combined). */
export function jobVars(jobs: JobLike[]): TemplateVars {
  const titles = [...new Set(jobs.map((j) => j.title.trim()))];
  const shown = titles.slice(0, 3).join(" / ");
  return {
    job_title: titles.length > 3 ? `${shown} (+${titles.length - 3} more)` : shown,
    company: jobs.find((j) => j.company)?.company ?? null,
    location: jobs.find((j) => j.location)?.location ?? null,
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain-text body → minimal, safe HTML (escaped, linkified, line breaks kept). */
export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
  const paragraphs = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${paragraphs}</div>`;
}

export function whatsappLink(phoneDigits: string, message: string): string {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
}

/** Gmail compose URLs, split so each stays under ~1800 chars and ≤ 20 recipients. */
export function gmailComposeUrls(emails: string[], subject: string, body: string): string[] {
  const base = "https://mail.google.com/mail/?view=cm&fs=1";
  const build = (chunk: string[], withBody: boolean) =>
    `${base}&bcc=${encodeURIComponent(chunk.join(","))}&su=${encodeURIComponent(subject)}${
      withBody ? `&body=${encodeURIComponent(body)}` : ""
    }`;

  const urls: string[] = [];
  let chunk: string[] = [];
  for (const email of emails) {
    const next = [...chunk, email];
    if (chunk.length && (next.length > 20 || build(next, true).length > 1800)) {
      urls.push(build(chunk, true));
      chunk = [email];
    } else {
      chunk = next;
    }
  }
  if (chunk.length) urls.push(build(chunk, true));
  // If the body alone is too long, drop it (user pastes it in Gmail).
  return urls.map((u) => (u.length > 1800 ? u.replace(/&body=[^&]*/, "") : u));
}

export function mailtoUrl(emails: string[], subject: string, body: string): string {
  return `mailto:?bcc=${encodeURIComponent(emails.join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
