import { z } from "zod";
import { parseBody, route } from "@/lib/api";
import { queueEmails } from "@/lib/applications";
import { jobIdsSchema } from "@/lib/validators";

/** Queue personalized emails (one per unique address). Sending happens via /process. */
export const POST = route(async (req) => {
  const input = await parseBody(
    req,
    z.object({
      jobIds: jobIdsSchema,
      subject: z.string().trim().min(1).max(300),
      body: z.string().trim().min(1).max(20_000),
      templateId: z.uuid().nullish(),
      attachCv: z.boolean().default(true),
      excludeEmails: z.array(z.string().toLowerCase()).default([]),
      mode: z.literal("individual").default("individual"),
    }),
  );
  return queueEmails(input);
});
