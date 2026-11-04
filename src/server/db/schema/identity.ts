import { boolean, index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, id, updatedAt } from "./_shared";

/**
 * Better Auth core tables (ADR-005, DATABASE_DESIGN §5), in schema "app" (ADR-024).
 * Column set matches Better Auth 1.7 `getAuthTables()`; our extra user fields are declared
 * to Better Auth as `user.additionalFields` (input: false) in src/server/auth/auth.ts.
 */
export const userRole = app.enum("user_role", ["USER", "ADMIN"]);

export const users = app.table(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    /** Better Auth lower-cases emails before storing them. */
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: userRole("role").notNull().default("USER"),
    timezone: text("timezone").notNull().default("UTC"),
    locale: text("locale").notNull().default("en"),
    /** Set by "delete my account"; purged after the grace period (DATABASE_DESIGN §8). */
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const sessions = app.table(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sessions_token_key").on(t.token), index("sessions_user_id_idx").on(t.userId)],
);

/** OAuth sign-in links (Google). Tokens are encrypted by Better Auth (encryptOAuthTokens). Not mailbox connections. */
export const accounts = app.table(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    /** Unused in the zero-cost profile (Google sign-in only). */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accounts_provider_account_key").on(t.providerId, t.accountId),
    index("accounts_user_id_idx").on(t.userId),
  ],
);

export const verifications = app.table(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export type UserRow = typeof users.$inferSelect;
