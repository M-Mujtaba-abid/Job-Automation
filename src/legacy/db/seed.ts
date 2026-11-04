import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const DEFAULT_TEMPLATE = {
  name: "Default application",
  subject: "Application for {{job_title}} – {{my_name}}",
  body: `Dear Hiring Team at {{company}},

I came across your post for the {{job_title}} position and I'd like to apply. I have hands-on experience building production web apps with React, Next.js and TypeScript, and I'm confident I can contribute from day one.

My CV is attached. You can also see my work here: {{portfolio_url}}
LinkedIn: {{linkedin_url}}

I'd be glad to discuss how I can help your team. Thank you for your time.

Best regards,
{{my_name}}
{{my_phone}}
{{my_email}}`,
  isDefault: true,
  attachCv: true,
};

async function main() {
  // Imported after dotenv so env() sees the values.
  const { db } = await import("./index");
  const { emailTemplates, sources } = await import("./schema");
  const { getSettings } = await import("@/legacy/settings");

  // Only what seeding needs — SMTP etc. can be configured later.
  const e = {
    DEFAULT_KEYWORDS: (process.env.DEFAULT_KEYWORDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    DEFAULT_LOCATION: process.env.DEFAULT_LOCATION || "Pakistan",
    APIFY_LINKEDIN_ACTOR_ID: process.env.APIFY_LINKEDIN_ACTOR_ID ?? "",
    APIFY_FACEBOOK_ACTOR_ID: process.env.APIFY_FACEBOOK_ACTOR_ID ?? "",
  };
  await getSettings();
  console.log("✓ settings row");

  const templates = await db().select({ id: emailTemplates.id }).from(emailTemplates).limit(1);
  if (!templates.length) {
    await db().insert(emailTemplates).values(DEFAULT_TEMPLATE);
    console.log("✓ default email template");
  } else {
    console.log("• templates already exist, skipped");
  }

  const existing = await db().select({ id: sources.id }).from(sources).limit(1);
  if (existing.length) {
    console.log("• sources already exist, skipped");
  } else {
    const keywords = e.DEFAULT_KEYWORDS.length ? e.DEFAULT_KEYWORDS : ["react developer"];
    const location = e.DEFAULT_LOCATION;
    await db()
      .insert(sources)
      .values([
        {
          name: `LinkedIn – ${keywords[0]} (${location})`,
          type: "apify_linkedin",
          enabled: true,
          config: {
            actorId: e.APIFY_LINKEDIN_ACTOR_ID || "harvestapi~linkedin-post-search",
            keywords,
            maxResults: 60, // hard cap on billed results per run
            // Input schema of harvestapi/linkedin-post-search (≈ $1.50 / 1,000 posts).
            input: {
              searchQueries: keywords.map((k) => `hiring ${k} ${location}`),
              maxPosts: 20, // per query
              postedLimit: "24h",
              sortBy: "date",
            },
          },
        },
        {
          name: `Facebook groups – ${location} dev jobs`,
          type: "apify_facebook",
          enabled: false, // enable after adding real group URLs
          config: {
            actorId: e.APIFY_FACEBOOK_ACTOR_ID || "apify~facebook-groups-scraper",
            keywords,
            maxResults: 60,
            // Input schema of apify/facebook-groups-scraper (≈ $2.60 / 1,000 posts). Public groups only.
            input: {
              startUrls: [{ url: "https://www.facebook.com/groups/REPLACE_WITH_GROUP_ID" }],
              resultsLimit: 30, // per group
              viewOption: "CHRONOLOGICAL",
              onlyPostsNewerThan: "3 days",
            },
          },
        },
      ]);
    console.log("✓ 2 Apify sources (edit actor input + group URLs on the Sources page)");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
