import { eq } from "drizzle-orm";
import { ApiError, parseBody, route } from "@/legacy/api";
import { db } from "@/legacy/db";
import { sources } from "@/legacy/db/schema";
import { sourceInputSchema } from "@/legacy/validators";

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
