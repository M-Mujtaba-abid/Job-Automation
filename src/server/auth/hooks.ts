import "server-only";
import { recordAudit } from "@/server/modules/audit";
import { createEmptyProfile } from "@/server/modules/profile/repository";

/** New account: create the empty profile row (onboarding fills it) and audit the sign-up. */
export async function onUserCreated(userId: string): Promise<void> {
  await createEmptyProfile(userId);
  await recordAudit({
    actorUserId: userId,
    actorType: "USER",
    action: "auth.user.created",
    targetType: "user",
    targetId: userId,
  });
}

/** Every sign-in creates a session row; audit it with a hashed IP (SECURITY_DESIGN §13). */
export async function onSessionCreated(session: {
  userId: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}): Promise<void> {
  await recordAudit({
    actorUserId: session.userId,
    actorType: "USER",
    action: "auth.login",
    targetType: "user",
    targetId: session.userId,
    ip: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
  });
}
