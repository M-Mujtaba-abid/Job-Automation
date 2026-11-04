import { desc } from "drizzle-orm";
import { parseBody, route } from "@/legacy/api";
import { db } from "@/legacy/db";
import { emailTemplates } from "@/legacy/db/schema";
import { templateInputSchema } from "@/legacy/validators";

export const GET = route(async () => ({
  items: await db().select().from(emailTemplates).orderBy(desc(emailTemplates.isDefault), emailTemplates.name),
}));

export const POST = route(async (req) => {
  const input = await parseBody(req, templateInputSchema);
  return db().transaction(async (tx) => {
    if (input.isDefault) await tx.update(emailTemplates).set({ isDefault: false });
    const [row] = await tx.insert(emailTemplates).values(input).returning();
    return row;
  });
});
