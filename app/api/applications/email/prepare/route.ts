import { z } from "zod";
import { parseBody, route } from "@/lib/api";
import { prepareEmail } from "@/lib/applications";
import { jobIdsSchema } from "@/lib/validators";

export const POST = route(async (req) => {
  const { jobIds, templateId } = await parseBody(
    req,
    z.object({ jobIds: jobIdsSchema, templateId: z.uuid().nullish() }),
  );
  return prepareEmail(jobIds, templateId);
});
