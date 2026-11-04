import "server-only";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";
import { serverEnv } from "@/server/lib/env";
import { logger } from "@/server/lib/logger";
import { uuidv7 } from "@/server/lib/uuid";
import { onSessionCreated, onUserCreated } from "./hooks";

const log = logger.child({ module: "auth" });

/**
 * Better Auth (ADR-005), zero-cost profile: Google sign-in only, no passwords, no system email
 * (ADR-023). Sessions are database rows (revocable). Built lazily so `next build` and tests do
 * not need auth secrets.
 */
export function authOptions() {
  const env = serverEnv();
  const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (!googleConfigured) log.warn({}, "auth.google_not_configured");

  return {
    appName: "JobFinder AI",
    ...(env.BETTER_AUTH_SECRET && { secret: env.BETTER_AUTH_SECRET }),
    baseURL: env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: { enabled: false },
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            prompt: "select_account",
          },
        }
      : {},
    account: {
      // Sign-in tokens are low-value (openid/email/profile) but still encrypted at rest.
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days, sliding
      updateAge: 60 * 60 * 24, // extend at most once a day
      freshAge: 60 * 60 * 12, // sensitive actions need a sign-in within 12 h (SECURITY_DESIGN §2)
    },
    user: {
      additionalFields: {
        role: { type: "string", input: false, defaultValue: "USER" },
        timezone: { type: "string", input: false, defaultValue: "UTC" },
        locale: { type: "string", input: false, defaultValue: "en" },
        deletionRequestedAt: { type: "date", required: false, input: false },
      },
    },
    advanced: { database: { generateId: () => uuidv7() } },
    databaseHooks: {
      user: { create: { after: async (user) => onUserCreated(user.id) } },
      session: { create: { after: async (session) => onSessionCreated(session) } },
    },
    plugins: [nextCookies()],
  } satisfies BetterAuthOptions;
}

/** Shared options (also used by the integration test, which adds a test-only sign-in method). */
function createAuth() {
  return betterAuth(authOptions());
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | null = null;

export function auth(): Auth {
  instance ??= createAuth();
  return instance;
}

export function isGoogleSignInConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
