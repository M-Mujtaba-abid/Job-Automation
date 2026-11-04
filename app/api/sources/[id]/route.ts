import { eq } from "drizzle-orm";
import { ApiError, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { sourceInputSchema } from "@/lib/validators";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const input = await parseBody(req, sourceInputSchema.partial());
  const [row] = await db().update(sources).set(input).where(eq(sources.id, params.id)).returning();
  if (!row) throw new ApiError(404, "Source not found");
  return row;
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const [row] = await db().delete(sources).where(eq(sources.id, params.id)).returning({ id: sources.id });
  if (!row) throw new ApiError(404, "Source not found");
  return { ok: true };
});
