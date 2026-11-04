import { eq, ne } from "drizzle-orm";
import { ApiError, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db";
import { emailTemplates } from "@/lib/db/schema";
import { templateInputSchema } from "@/lib/validators";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const input = await parseBody(req, templateInputSchema.partial());
  return db().transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(emailTemplates).set({ isDefault: false }).where(ne(emailTemplates.id, params.id));
    }
    const [row] = await tx.update(emailTemplates).set(input).where(eq(emailTemplates.id, params.id)).returning();
    if (!row) throw new ApiError(404, "Template not found");
    return row;
  });
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const [row] = await db()
    .delete(emailTemplates)
    .where(eq(emailTemplates.id, params.id))
    .returning({ id: emailTemplates.id });
  if (!row) throw new ApiError(404, "Template not found");
  return { ok: true };
});
