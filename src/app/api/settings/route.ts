import { eq } from "drizzle-orm";
import { parseBody, route } from "@/legacy/api";
import { getCvMeta } from "@/legacy/cv";
import { db } from "@/legacy/db";
import { settings } from "@/legacy/db/schema";
import { getSettings } from "@/legacy/settings";
import { settingsInputSchema } from "@/legacy/validators";

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
