import "server-only";
import { db } from "@/server/db/client";
import { userProfiles } from "@/server/db/schema";

/** Idempotent: the profile row is created once per user (sign-up hook) and filled by onboarding. */
export async function createEmptyProfile(userId: string): Promise<void> {
  await db().insert(userProfiles).values({ userId }).onConflictDoNothing();
}
