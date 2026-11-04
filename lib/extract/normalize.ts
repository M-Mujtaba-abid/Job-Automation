import { createHash } from "node:crypto";
import { convert } from "html-to-text";

const HTML_TAG = /<\/?[a-z][\s\S]*?>/i;

/** HTML (or plain text) → clean plain text that keeps line breaks. */
export function toPlainText(input: string | null | undefined): string {
  if (!input) return "";
  let text = input;
  if (HTML_TAG.test(text)) {
    text = convert(text, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { hideLinkHrefIfSameAsText: true, ignoreHref: false } },
        { selector: "img", format: "skip" },
      ],
    });
  }
  return text
    // NFKC folds LinkedIn's "𝗕𝗼𝗹𝗱" / "𝐉𝐨𝐛" math-alphanumeric letters (and full-width chars) to plain ASCII,
    // so titles read normally and emails/phones written in them are found.
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|trk|trackingId|refId|lipi|rcm|mibextid|__cft__|__tn__)/i;

/** Strip tracking params, hash and trailing slash so the same post hashes the same way. */
export function canonicalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function dedupeHash(job: {
  title: string;
  company?: string | null;
  applyUrl?: string | null;
  description?: string | null;
}): string {
  // The post URL alone identifies a post; the derived title must not affect dedupe
  // (otherwise improving title extraction would re-insert every post).
  const url = canonicalUrl(job.applyUrl);
  if (url) return sha256(`url|${url}`);
  const desc = (job.description ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return sha256(`desc|${desc || job.title.toLowerCase()}`);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
