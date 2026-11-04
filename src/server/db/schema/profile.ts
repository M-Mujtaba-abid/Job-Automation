import { boolean, char, index, integer, jsonb, numeric, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, id, updatedAt } from "./_shared";
import { users } from "./identity";

/** Job-search preferences (DATABASE_DESIGN §5, M1 subset). Embedding/primary-resume columns arrive in M2/M4. */
export const workMode = app.enum("work_mode", ["REMOTE", "HYBRID", "ONSITE"]);
export const employmentType = app.enum("employment_type", [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "INTERNSHIP",
  "TEMPORARY",
  "FREELANCE",
]);
export const seniorityLevel = app.enum("seniority_level", [
  "INTERN",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "PRINCIPAL",
  "EXECUTIVE",
]);
export const salaryPeriod = app.enum("salary_period", ["HOUR", "MONTH", "YEAR"]);

export type TargetLocation = {
  city: string | null;
  region: string | null;
  countryCode: string;
  radiusKm: number | null;
};

export const userProfiles = app.table("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  headline: text("headline"),
  targetTitles: text("target_titles").array().notNull().default([]),
  targetLocations: jsonb("target_locations").$type<TargetLocation[]>().notNull().default([]),
  workModes: workMode("work_modes").array().notNull().default([]),
  employmentTypes: employmentType("employment_types").array().notNull().default([]),
  seniority: seniorityLevel("seniority"),
  totalYearsExperience: numeric("total_years_experience", { precision: 4, scale: 1 }),
  salaryMin: integer("salary_min"),
  salaryCurrency: char("salary_currency", { length: 3 }),
  salaryPeriod: salaryPeriod("salary_period"),
  willingToRelocate: boolean("willing_to_relocate").notNull().default(false),
  /** ISO 3166-1 alpha-2 country of residence (sign-up gating for the Gemini free tier, ADR-023). */
  countryCode: char("country_code", { length: 2 }),
  excludedCompanyIds: uuid("excluded_company_ids").array().notNull().default([]),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const consentKind = app.enum("consent_kind", ["TERMS", "PRIVACY", "AUTOMATION_AUTHORIZATION", "MARKETING"]);

export const userConsents = app.table(
  "user_consents",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: consentKind("kind").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ipHash: text("ip_hash"),
  },
  (t) => [index("user_consents_user_kind_idx").on(t.userId, t.kind)],
);

export const actorType = app.enum("actor_type", ["USER", "SYSTEM", "AUTOMATION", "ADMIN"]);

/** Append-only security log (SECURITY_DESIGN §13). Actor is nulled (pseudonymised) on account deletion. */
export const auditLogs = app.table(
  "audit_logs",
  {
    id: id(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: actorType("actor_type").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    /** No secrets, no resume text. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_actor_created_idx").on(t.actorUserId, t.createdAt.desc()),
    index("audit_logs_action_created_idx").on(t.action, t.createdAt.desc()),
  ],
);
