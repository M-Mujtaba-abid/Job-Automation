import { findPhoneNumbersInText, parsePhoneNumberFromString } from "libphonenumber-js/max";
import type { ContactType } from "@/lib/db/schema";

export type ExtractedContact = {
  type: ContactType;
  value: string;
  normalized: string;
};

export type ExtractOptions = {
  /** Calling code used for local numbers like 0300-1234567. Default "92" (Pakistan). */
  countryCode?: string;
};

// ---------- Email ----------

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const JUNK_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "domain.com",
  "email.com",
  "yourdomain.com",
  "yourcompany.com",
  "company.com",
  "linkedin.com",
  "facebook.com",
  "fb.com",
  "apify.com",
  "sentry.io",
  "wixpress.com",
]);
const JUNK_EMAIL_LOCAL = /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster)$/i;
const IMAGE_TLD = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

/** Undo common obfuscations: name [at] domain [dot] com, name(at)domain.com, name @ domain.com */
export function deobfuscateEmails(text: string): string {
  return text
    .replace(/\s*[[({<]\s*at\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*dot\s*[\])}>]\s*/gi, ".")
    .replace(/([A-Z0-9._%+-])\s+@\s*([A-Z0-9-])/gi, "$1@$2")
    .replace(/([A-Z0-9._%+-])\s*@\s+([A-Z0-9-])/gi, "$1@$2");
}

export function extractEmails(text: string): ExtractedContact[] {
  const out: ExtractedContact[] = [];
  for (const match of deobfuscateEmails(text).matchAll(EMAIL_RE)) {
    const value = match[0].replace(/^[.\-_]+/, "").replace(/[.\-_]+$/, "");
    const email = value.toLowerCase();
    const [local, domain] = email.split("@");
    if (!local || !domain) continue;
    if (JUNK_EMAIL_DOMAINS.has(domain)) continue;
    if (JUNK_EMAIL_LOCAL.test(local)) continue;
    if (IMAGE_TLD.test(email)) continue;
    if (domain.includes("..") || local.includes("..")) continue;
    out.push({ type: "email", value, normalized: email });
  }
  return out;
}

// ---------- Phone ----------

const WHATSAPP_LINK_RE =
  /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp\.com\/send\/?\?phone=)\+?(\d{8,15})/gi;

const MOBILE_TYPES = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);

function acceptPhone(e164: string | undefined): string | null {
  if (!e164) return null;
  const pn = parsePhoneNumberFromString(e164);
  if (!pn || !pn.isValid()) return null;
  const type = pn.getType();
  // WhatsApp needs a mobile number. Unknown type is accepted only outside PK (sparse metadata).
  if (type && !MOBILE_TYPES.has(type)) return null;
  if (!type && pn.countryCallingCode === "92") return null;
  return pn.number.replace(/^\+/, "");
}

export function extractPhones(text: string, opts: ExtractOptions = {}): ExtractedContact[] {
  const cc = opts.countryCode ?? "92";
  const out: ExtractedContact[] = [];

  for (const m of text.matchAll(WHATSAPP_LINK_RE)) {
    const normalized = acceptPhone(`+${m[1]}`);
    if (normalized) out.push({ type: "phone", value: m[0], normalized });
  }

  // libphonenumber's matcher handles separators/adjacent numbers far better than a regex.
  for (const found of findPhoneNumbersInText(text, { defaultCallingCode: cc })) {
    const normalized = acceptPhone(found.number.number);
    if (normalized) {
      out.push({ type: "phone", value: text.slice(found.startsAt, found.endsAt), normalized });
    }
  }

  // Numbers written with the country code but no "+" (e.g. 923001234567, 0092 300 1234567)
  // are often missed by the matcher, so pick them up explicitly.
  const bareCc = new RegExp(
    `(?<![\\d+])(?:00)?${cc}[\\s-]?\\d{2,4}[\\s-]?\\d{3,4}[\\s-]?\\d{3,4}(?!\\d)`,
    "g",
  );
  for (const m of text.matchAll(bareCc)) {
    const normalized = acceptPhone(`+${m[0].replace(/\D/g, "").replace(/^00/, "")}`);
    if (normalized) out.push({ type: "phone", value: m[0], normalized });
  }

  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.normalized) && seen.add(c.normalized));
}

// ---------- Google Forms ----------

const FORM_RE = /https?:\/\/(?:docs\.google\.com\/forms\/[^\s"'<>)\]]+|forms\.gle\/[A-Za-z0-9_-]+)/gi;
const TRAILING_PUNCT = /[.,;:!?)\]}'"»”’]+$/;

export function canonicalFormUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if (u.hostname === "docs.google.com") u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function extractForms(text: string): ExtractedContact[] {
  const out: ExtractedContact[] = [];
  for (const m of text.matchAll(FORM_RE)) {
    const value = m[0].replace(TRAILING_PUNCT, "");
    out.push({ type: "google_form", value, normalized: canonicalFormUrl(value) });
  }
  return out;
}

// ---------- All ----------

export function extractContacts(text: string, opts: ExtractOptions = {}): ExtractedContact[] {
  const all = [...extractEmails(text), ...extractPhones(text, opts), ...extractForms(text)];
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = `${c.type}:${c.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
