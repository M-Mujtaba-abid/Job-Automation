import { betterAuth } from "better-auth";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { authOptions } from "@/server/auth/auth";
import { db } from "@/server/db/client";
import { accounts, auditLogs, sessions, userProfiles, users } from "@/server/db/schema";

/**
 * Better Auth + our Drizzle tables in schema "app" (ADR-005/024), against real Postgres.
 * Uses the production options plus a TEST-ONLY email/password method (production is Google-only),
 * so the adapter mapping, uuidv7 ids and sign-up hooks are exercised without Google credentials.
 * Every user created here uses the reserved ".invalid" domain and is deleted afterwards.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const DOMAIN = "itest.jobfinder.invalid";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function cleanup() {
  const ids = (
    await db()
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `%@${DOMAIN}`))
  ).map((r) => r.id);
  if (ids.length === 0) return;
  await db().delete(auditLogs).where(inArray(auditLogs.targetId, ids));
  await db().delete(users).where(inArray(users.id, ids)); // cascades sessions, accounts, profiles, consents
}

describe.skipIf(!hasDb)("Better Auth on the app schema", () => {
  const testAuth = hasDb
    ? betterAuth({
        ...authOptions(),
        secret: "integration-test-secret-".padEnd(48, "x"),
        emailAndPassword: { enabled: true }, // test only
        plugins: [], // nextCookies() needs a Next.js request context
      })
    : null;

  afterAll(cleanup);

  it("signs up a user with a uuidv7 id, runs the hooks, and resolves the session cookie", async () => {
    const email = `user-${Date.now()}@${DOMAIN}`;
    const { headers, response } = await testAuth!.api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Integration Test" },
      returnHeaders: true,
    });

    const userId = response.user.id;
    expect(userId).toMatch(UUID_V7);

    const [row] = await db().select().from(users).where(eq(users.id, userId));
    expect(row).toMatchObject({ email, role: "USER", timezone: "UTC", locale: "en", deletionRequestedAt: null });

    // Hooks: empty profile row + audit entries for sign-up and the auto sign-in session.
    const [profile] = await db().select().from(userProfiles).where(eq(userProfiles.userId, userId));
    expect(profile).toMatchObject({ userId, targetTitles: [], workModes: [], onboardingCompletedAt: null });
    const audit = await db().select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.targetId, userId));
    expect(audit.map((a) => a.action).sort()).toEqual(["auth.login", "auth.user.created"]);

    const [account] = await db().select().from(accounts).where(eq(accounts.userId, userId));
    expect(account?.providerId).toBe("credential");
    expect(account?.id).toMatch(UUID_V7);

    // The session cookie set by sign-up resolves back to the same user.
    const cookie = headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const session = await testAuth!.api.getSession({ headers: new Headers({ cookie: cookie! }) });
    expect(session?.user.id).toBe(userId);
    expect(session?.session.id).toMatch(UUID_V7);
  });

  it("revoking sessions signs the user out; deleting the user cascades its rows", async () => {
    const email = `revoke-${Date.now()}@${DOMAIN}`;
    const { headers, response } = await testAuth!.api.signUpEmail({
      body: { email, password: "correct-horse-battery-staple", name: "Revoke Test" },
      returnHeaders: true,
    });
    const cookie = headers.get("set-cookie")!.split(";")[0]!;
    const userId = response.user.id;

    await db().delete(sessions).where(eq(sessions.userId, userId)); // server-side revocation (DB sessions)
    expect(await testAuth!.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();

    await db().delete(auditLogs).where(eq(auditLogs.targetId, userId)); // test rows only
    await db().delete(users).where(eq(users.id, userId));
    expect(await db().select().from(userProfiles).where(eq(userProfiles.userId, userId))).toHaveLength(0);
    expect(await db().select().from(accounts).where(eq(accounts.userId, userId))).toHaveLength(0);
  });
});
