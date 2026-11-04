import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- Enums ----------

export const sourceType = pgEnum("source_type", ["apify_linkedin", "apify_facebook", "manual"]);
export const contactType = pgEnum("contact_type", ["email", "phone", "google_form", "other_link"]);
export const jobStatus = pgEnum("job_status", ["new", "saved", "applied", "hidden"]);
export const applicationChannel = pgEnum("application_channel", ["email", "whatsapp", "google_form"]);
export const applicationStatus = pgEnum("application_status", [
  "queued",
  "sending",
  "sent",
  "failed",
  "opened",
]);
export const runStatus = pgEnum("run_status", ["running", "success", "partial", "failed"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------- Tables ----------

export type SourceConfig = {
  actorId: string;
  input: Record<string, unknown>;
  keywords: string[];
  maxResults?: number;
};

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: sourceType("type").notNull(),
  config: jsonb("config").$type<SourceConfig>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    dedupeHash: text("dedupe_hash").notNull().unique(),
    title: text("title").notNull(),
    company: text("company"),
    location: text("location"),
    employmentType: text("employment_type"),
    isRemote: boolean("is_remote").notNull().default(false),
    description: text("description"),
    applyUrl: text("apply_url"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    hasEmail: boolean("has_email").notNull().default(false),
    hasPhone: boolean("has_phone").notNull().default(false),
    hasForm: boolean("has_form").notNull().default(false),
    status: jobStatus("status").notNull().default("new"),
    raw: jsonb("raw"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_status_created_idx").on(t.status, t.createdAt.desc()),
    index("jobs_has_email_idx").on(t.hasEmail),
    index("jobs_has_phone_idx").on(t.hasPhone),
    index("jobs_has_form_idx").on(t.hasForm),
    index("jobs_source_idx").on(t.sourceId),
    index("jobs_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${t.title} || ' ' || coalesce(${t.company}, '') || ' ' || coalesce(${t.description}, ''))`,
    ),
  ],
);

export const jobContacts = pgTable(
  "job_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: contactType("type").notNull(),
    value: text("value").notNull(),
    normalized: text("normalized").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("job_contacts_unique_idx").on(t.jobId, t.type, t.normalized),
    index("job_contacts_normalized_idx").on(t.type, t.normalized),
  ],
);

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  attachCv: boolean("attach_cv").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => jobContacts.id, { onDelete: "set null" }),
    channel: applicationChannel("channel").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    body: text("body"),
    templateId: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    attachCv: boolean("attach_cv").notNull().default(false),
    batchId: uuid("batch_id"),
    status: applicationStatus("status").notNull().default("queued"),
    error: text("error"),
    messageId: text("message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("applications_status_idx").on(t.status),
    index("applications_batch_idx").on(t.batchId),
    index("applications_job_idx").on(t.jobId),
    index("applications_to_idx").on(t.toAddress),
    uniqueIndex("applications_no_double_apply_idx")
      .on(t.jobId, t.channel, t.toAddress)
      .where(sql`${t.status} in ('queued', 'sending', 'sent')`),
  ],
);

export const fetchRuns = pgTable(
  "fetch_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    trigger: text("trigger").notNull(),
    status: runStatus("status").notNull().default("running"),
    apifyRunId: text("apify_run_id").unique(),
    datasetId: text("dataset_id"),
    fetchedCount: integer("fetched_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("fetch_runs_status_idx").on(t.status, t.startedAt),
    index("fetch_runs_source_idx").on(t.sourceId),
  ],
);

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  fullName: text("full_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  portfolioUrl: text("portfolio_url").notNull().default(""),
  linkedinUrl: text("linkedin_url").notNull().default(""),
  whatsappMessageTemplate: text("whatsapp_message_template").notNull().default(""),
  updatedAt: updatedAt(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** The single CV (id = 1), stored in Postgres so no external file storage is needed. */
export const cvFile = pgTable("cv_file", {
  id: integer("id").primaryKey().default(1),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  updatedAt: updatedAt(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ip: text("ip").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_ip_idx").on(t.ip, t.createdAt)],
);

// ---------- Types ----------

export type Source = typeof sources.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobContact = typeof jobContacts.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type FetchRun = typeof fetchRuns.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type SourceType = (typeof sourceType.enumValues)[number];
export type ContactType = (typeof contactType.enumValues)[number];
export type JobStatus = (typeof jobStatus.enumValues)[number];
export type ApplicationChannel = (typeof applicationChannel.enumValues)[number];
export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];
