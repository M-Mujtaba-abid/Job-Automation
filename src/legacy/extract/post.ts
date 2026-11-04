import { truncate } from "./normalize";

// Weak signal: enough when the post also has a contact (email / phone / form).
const HIRING_RE =
  /(hiring|vacanc|\bjobs?\b|position|opening|required|looking for|join our team|apply|send (your )?(cv|resume)|\bresume\b|\bcv\b|internship)/i;

// Strong signal: needed when the post has no contact at all (filters out opinion posts about "hiring").
const STRONG_HIRING_RE =
  /(we(?:'|’)?re hiring|we are hiring|\bis hiring|#hiring|now hiring|hiring\s*[:|!—–-]|vacanc(?:y|ies)|job opening|opening for|\b(?:position|job title|designation|role)\s*:|internship|job opportunity|looking for (?:an?\s+|the\s+)?(?:\w+\s+){0,3}(?:developer|engineer|designer|intern)|join our team|apply (?:now|here|at|via|on|directly|through)|send (?:your )?(?:cv|resume)|share (?:your )?(?:cv|resume)|interested candidates)/i;

/** Keep a post if it reads like a job post: weak signal + contact, or a strong hiring signal. */
export function isHiringPost(text: string, contactCount: number): boolean {
  if (contactCount > 0) return HIRING_RE.test(text);
  return STRONG_HIRING_RE.test(text);
}

const ROLE_NOUNS =
  "developers?|devs?|engineers?|designers?|interns?|internships?|managers?|analysts?|architects?|leads?|specialists?|consultants?|administrators?|programmers?|testers?|officers?|executives?|associates?|scientists?|writers?|marketers?|representatives?|coordinators?|trainees?|freelancers?";

/** Up to 5 "title-ish" tokens ending in a role noun, e.g. "Junior Full Stack Developer". */
const ROLE_PHRASE_RE = new RegExp(
  `((?:[A-Za-z0-9.+#/'-]+\\s+|&\\s+){0,5}(?:${ROLE_NOUNS})(?:\\s+interns?)?)\\b`,
  "i",
);

const LABEL_RE = /^\s*(?:position|role|job title|designation|title|post|vacancy)\s*[:\-–—]\s*(.{3,100})$/im;

/** Leading words that are never part of a job title. */
const STOP_WORDS = new Set(
  (
    "a an the for of our to and is are am be we were we're looking hiring hire need needs needed urgently urgent " +
    "motivated talented skilled experienced passionate dedicated enthusiastic energetic young smart creative " +
    "open at as join new remote onsite on-site hybrid immediate seeking require required requires vacancy " +
    "opportunity job post position role available some few multiple two three"
  ).split(" "),
);

const LEADING_JUNK = /^[\s#*•\-–—:|>!🚀📢🔥✨💼📌👉✅⭐️🎯📣🚨🔹📍]+/u;

function cleanTitle(s: string): string {
  let t = s
    .replace(/[*_`~]/g, "")
    .replace(/\([^)]*\)?/g, " ") // drop "(Onsite)", "(Generative AI)"
    .replace(/\s+/g, " ")
    .trim();
  const words = t.split(" ");
  while (words.length > 1 && STOP_WORDS.has(words[0].toLowerCase().replace(/[^a-z'-]/g, ""))) words.shift();
  t = words.join(" ");
  return t.replace(/[\s:–—|,.-]+$/, "").replace(LEADING_JUNK, "").trim();
}

/**
 * Best-effort job title from free text:
 * 1. an explicit "Position: / Role: / Job Title:" line
 * 2. the first role phrase ("… Developer", "… Engineer", "… Intern") in the first lines
 * 3. the first non-empty line
 */
export function deriveTitle(text: string): string {
  const plain = text.replace(/[*_`]/g, "").replace(/[‘’]/g, "'");

  const label = plain.match(LABEL_RE)?.[1];
  if (label) {
    const t = cleanTitle(label);
    if (t.length >= 3) return truncate(t, 120);
  }

  const lines = plain
    .split("\n")
    .map((l) => l.replace(LEADING_JUNK, "").trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 10)) {
    // Split on separators so "Opportunity at X – React Developer" yields just the role part.
    for (const segment of line.split(/\s[|–—-]\s|[|–—]/)) {
      const phrase = segment.match(ROLE_PHRASE_RE)?.[1];
      if (!phrase) continue;
      const t = cleanTitle(phrase);
      if (t.length >= 3 && new RegExp(`(${ROLE_NOUNS})`, "i").test(t)) return truncate(t, 120);
    }
  }

  return truncate(cleanTitle(lines[0] ?? "Job post") || "Job post", 120);
}

const CITIES = [
  "Lahore",
  "Karachi",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Quetta",
  "Sialkot",
  "Gujranwala",
  "Hyderabad",
  "Bahawalpur",
  "Abbottabad",
  "Dubai",
  "Riyadh",
];
const CITY_RE = new RegExp(`\\b(${CITIES.join("|")})\\b`, "i");

export function detectLocation(text: string): string | undefined {
  const m = text.match(CITY_RE);
  return m ? CITIES.find((c) => c.toLowerCase() === m[1].toLowerCase()) : undefined;
}

export function detectRemote(text: string): boolean {
  return /\bremote(ly)?\b|work from home|\bwfh\b/i.test(text);
}

export function detectEmploymentType(text: string): string | undefined {
  if (/\bintern(s|ship)?\b/i.test(text)) return "Internship";
  if (/\bpart[\s-]?time\b/i.test(text)) return "Part-time";
  if (/\bcontract(ual)?\b|\bfreelance\b/i.test(text)) return "Contract";
  if (/\bfull[\s-]?time\b/i.test(text)) return "Full-time";
  return undefined;
}
