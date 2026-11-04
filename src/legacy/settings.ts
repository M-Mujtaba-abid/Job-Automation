import { eq } from "drizzle-orm";
import { db } from "@/legacy/db";
import { settings, type Settings } from "@/legacy/db/schema";

export const DEFAULT_WHATSAPP_MESSAGE =
  "Assalam o Alaikum! I came across your post for the {{job_title}} role at {{company}}. " +
  "I'm {{my_name}} and I'd love to apply. Portfolio: {{portfolio_url}}. Can I share my CV here? Thank you!";

/** The single settings row (id = 1), created on first access. */
export async function getSettings(): Promise<Settings> {
  const row = await db().query.settings.findFirst({ where: eq(settings.id, 1) });
  if (row) return row;
  const [created] = await db()
    .insert(settings)
    .values({ id: 1, whatsappMessageTemplate: DEFAULT_WHATSAPP_MESSAGE })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db().query.settings.findFirst({ where: eq(settings.id, 1) }))!;
}
