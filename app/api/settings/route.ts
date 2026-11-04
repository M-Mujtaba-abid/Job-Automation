import { eq } from "drizzle-orm";
import { parseBody, route } from "@/lib/api";
import { getCvMeta } from "@/lib/cv";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getSettings } from "@/lib/settings";
import { settingsInputSchema } from "@/lib/validators";

export const GET = route(async () => {
  const [s, cv] = await Promise.all([getSettings(), getCvMeta()]);
  return { ...s, cv };
});

export const PUT = route(async (req) => {
  const input = await parseBody(req, settingsInputSchema);
  await getSettings(); // ensure row exists
  const [row] = await db().update(settings).set(input).where(eq(settings.id, 1)).returning();
  return row;
});
