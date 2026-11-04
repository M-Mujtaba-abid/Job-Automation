import { describe, expect, it } from "vitest";
import { prepareJob, type PreparedJob } from "@/lib/ingest";
import { deriveTitle, isHiringPost } from "@/lib/extract/post";
import { isPublicHost, mapApifyItem } from "@/lib/sources/apify";
import facebook from "./fixtures/facebook-items.json";
import linkedin from "./fixtures/linkedin-items.json";

const now = new Date("2026-10-06T00:00:00Z");

function prepare(item: unknown) {
  const raw = mapApifyItem(item);
  if (!raw) return { skip: "unmappable" as const };
  return prepareJob(raw, { countryCode: "92", now });
}

const contactsOf = (p: PreparedJob) => p.contacts.map((c) => `${c.type}:${c.normalized}`).sort();

describe("Apify LinkedIn fixture", () => {
  it("maps the typical PK hiring post to one job with email, phone and form", () => {
    const p = prepare(linkedin[0]);
    if ("skip" in p) throw new Error(`skipped: ${p.skip}`);
    expect(contactsOf(p)).toEqual([
      "email:hr@acme.pk",
      "google_form:https://forms.gle/abc123",
      "phone:923001234567",
    ]);
    expect(p.job.title).toBe("React Developer");
    expect(p.job.company).toBe("Acme Pvt Ltd");
    expect(p.job.location).toBe("Lahore");
    expect(p.job.hasEmail && p.job.hasPhone && p.job.hasForm).toBe(true);
    expect(p.job.externalId).toBe("urn:li:activity:7300000000000000001");
  });

  it("de-obfuscates email, detects remote/full-time and timestamp dates", () => {
    const p = prepare(linkedin[1]);
    if ("skip" in p) throw new Error(`skipped: ${p.skip}`);
    expect(contactsOf(p)).toEqual(["email:careers@devstudio.io"]);
    expect(p.job.title).toBe("Next.js Developer");
    expect(p.job.isRemote).toBe(true);
    expect(p.job.employmentType).toBe("Full-time");
    expect(p.job.postedAt).toBeInstanceOf(Date);
  });

  it("skips non-hiring posts", () => {
    expect(prepare(linkedin[2])).toEqual({ skip: "not_hiring" });
  });

  it("skips posts older than 14 days", () => {
    expect(prepare(linkedin[3])).toEqual({ skip: "too_old" });
  });

  it("returns null for items without text", () => {
    expect(mapApifyItem(linkedin[4])).toBeNull();
  });

  it("produces the same dedupe hash when tracking params change", () => {
    const a = prepare(linkedin[0]);
    const b = prepare({ ...linkedin[0], url: linkedin[0].url!.replace("utm_source=share", "utm_source=copy") });
    if ("skip" in a || "skip" in b) throw new Error("skipped");
    expect(a.job.dedupeHash).toBe(b.job.dedupeHash);
  });
});

describe("real actor output shapes", () => {
  it("maps harvestapi/linkedin-post-search items (content, linkedinUrl, postedAt object)", () => {
    const raw = mapApifyItem({
      type: "post",
      id: "7330988768578920448",
      linkedinUrl: "https://www.linkedin.com/posts/acme_hiring-activity-7330988768578920448-Je01",
      content: "We're #hiring a Frontend Developer in Islamabad. Send your CV to jobs@acme.pk",
      author: {
        type: "profile",
        name: "Nick Bennett",
        linkedinUrl: "https://www.linkedin.com/in/nickbennett05",
      },
      postedAt: { timestamp: 1791000000000, date: "2026-10-03T00:00:00.000Z", postedAgoShort: "3d" },
    });
    expect(raw?.applyUrl).toBe("https://www.linkedin.com/posts/acme_hiring-activity-7330988768578920448-Je01");
    expect(raw?.externalId).toBe("7330988768578920448");
    expect(raw?.company).toBe("Nick Bennett");
    expect(raw?.postedAt?.getTime()).toBe(1791000000000);
    const p = prepareJob(raw!, { now });
    if ("skip" in p) throw new Error(`skipped: ${p.skip}`);
    expect(p.contacts.map((c) => c.normalized)).toEqual(["jobs@acme.pk"]);
    expect(p.job.location).toBe("Islamabad");
  });

  it("maps apify/facebook-groups-scraper items using the post url, not the group url", () => {
    const raw = mapApifyItem({
      facebookUrl: "https://www.facebook.com/groups/pkdevjobs",
      url: "https://www.facebook.com/groups/pkdevjobs/posts/987654321",
      id: "987654321",
      time: "2026-10-05T10:00:00.000Z",
      user: { id: "100012345678901", name: "HR Desk" },
      text: "Hiring Laravel developer. WhatsApp 0333-1112223",
    });
    expect(raw?.applyUrl).toBe("https://www.facebook.com/groups/pkdevjobs/posts/987654321");
    expect(raw?.company).toBe("HR Desk");
  });
});

describe("Apify Facebook fixture", () => {
  it("maps a group post with WhatsApp and a docs.google.com form", () => {
    const p = prepare(facebook[0]);
    if ("skip" in p) throw new Error(`skipped: ${p.skip}`);
    expect(contactsOf(p)).toEqual([
      "google_form:https://docs.google.com/forms/d/e/1FAIpQLSf_xyz/viewform",
      "phone:923217654321",
    ]);
    expect(p.job.title).toBe("MERN Stack Developer");
    expect(p.job.company).toBe("Bilal Ahmed");
    expect(p.job.location).toBe("Karachi");
    expect(p.job.employmentType).toBe("Internship");
    expect(p.job.applyUrl).toBe("https://www.facebook.com/groups/pkdevjobs/posts/1234567890/");
  });

  it("skips non-hiring group chatter", () => {
    expect(prepare(facebook[1])).toEqual({ skip: "not_hiring" });
  });
});

describe("isPublicHost (Apify webhooks)", () => {
  it("rejects local hosts and accepts public ones", () => {
    for (const h of ["localhost", "127.0.0.1", "192.168.1.5", "10.0.0.2", "my.local"]) expect(isPublicHost(h)).toBe(false);
    for (const h of ["job-automation.vercel.app", "example.com"]) expect(isPublicHost(h)).toBe(true);
  });
});

describe("post helpers", () => {
  it("falls back to the first line for titles", () => {
    expect(deriveTitle("📢 Senior Flutter Engineer\nDetails below")).toBe("Senior Flutter Engineer");
  });

  it("needs a strong hiring signal when there is no contact", () => {
    expect(isHiringPost("Hiring is tough these days, stay tuned", 0)).toBe(false);
    expect(isHiringPost("Hiring is tough these days, stay tuned", 1)).toBe(true);
    expect(isHiringPost("We're hiring a React dev, apply now on our site", 0)).toBe(true);
  });
});

// Real LinkedIn posts from the first live run (Oct 2026).
describe("real-world titles", () => {
  const cases: [string, string][] = [
    ["Tron AI is hiring — *Full Stack Developer (Generative AI)*\n\nAre you a developer…", "Full Stack Developer"],
    ["🚀 We’re Hiring WordPress & Shopify Developer\n📍 Location: Lahore, Pakistan", "WordPress & Shopify Developer"],
    [
      "Job Opportunity at Appcrates – React Native Developer (Onsite)\nPosition: React Native Developer\nExperience: 03–06 Months",
      "React Native Developer",
    ],
    [
      "*Junior Software Developer*\nDepartment: Software Development\nHuruf Tech is looking for motivated and talented Junior Software Developers",
      "Junior Software Developer",
    ],
    [
      "🚀 We’re Hiring | Virtual Interns – Digital Marketing, Flutter, React & Web Development 🇵🇰\nSkillAura is looking for motivated, enthusiastic…",
      "Virtual Interns",
    ],
  ];
  it.each(cases)("%#: derives a clean title", (text, expected) => {
    expect(deriveTitle(text)).toBe(expected);
  });

  it("folds LinkedIn bold unicode before deriving the title", () => {
    const raw = mapApifyItem({
      id: "1",
      linkedinUrl: "https://www.linkedin.com/posts/x_activity-1",
      content:
        "🚨 𝗥𝗲𝗺𝗼𝘁𝗲 𝐉𝐨𝐛 𝐀𝐥𝐞𝐫𝐭\n𝐉𝐮𝐧𝐢𝐨𝐫 𝐅𝐮𝐥𝐥 𝐒𝐭𝐚𝐜𝐤 𝐃𝐞𝐯𝐬, your next opportunity…\n📩 Apply directly: hr.codebasesols@gmail.com",
      author: { name: "Sharya Javed" },
    });
    const p = prepareJob(raw!, { now });
    if ("skip" in p) throw new Error(`skipped: ${p.skip}`);
    expect(p.job.title).toBe("Junior Full Stack Devs");
    expect(p.job.description?.startsWith("🚨 Remote Job Alert")).toBe(true);
  });

  it("skips an opinion post about hiring with no contact", () => {
    const raw = mapApifyItem({
      id: "2",
      linkedinUrl: "https://www.linkedin.com/posts/y_activity-2",
      content:
        "Hi, I'm Abdul Rehman. Software Developer, mostly React and Node.\n\nHiring in Pakistan is broken in ways nobody talks about out loud.\n\nYou send 50 applications and hear back from 2.\nJob ads sit online for months.\n\nSo I built SafeApply.AI. A full portal for job seekers recruiters freelancers and people who are hiring freelancers.\n\nSo I'm looking for volunteers. comment or dm me and I'll send you the link.",
      author: { name: "Abdur Rehman" },
    });
    expect(prepareJob(raw!, { now })).toEqual({ skip: "not_hiring" });
  });
});
