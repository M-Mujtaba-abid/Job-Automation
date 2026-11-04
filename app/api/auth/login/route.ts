import { and, eq, gte, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { ApiError, parseBody, route } from "@/lib/api";
import { createSession, safeEqual, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export const POST = route(
  async (req) => {
    const { password } = await parseBody(req, z.object({ password: z.string().min(1).max(200) }));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

    const since = new Date(Date.now() - WINDOW_MS);
    const [{ n }] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.ip, ip), gte(loginAttempts.createdAt, since)));
    if (n >= MAX_ATTEMPTS) throw new ApiError(429, "Too many attempts. Try again in 15 minutes.");

    const expected = process.env.APP_PASSWORD;
    if (!expected) throw new ApiError(500, "APP_PASSWORD is not set");
    if (!safeEqual(password, expected)) {
      await db().insert(loginAttempts).values({ ip });
      throw new ApiError(401, "Wrong password");
    }

    await db().delete(loginAttempts).where(eq(loginAttempts.ip, ip));
    (await cookies()).set(SESSION_COOKIE, await createSession(), sessionCookieOptions());
    return { ok: true };
  },
  { auth: "none" },
);
