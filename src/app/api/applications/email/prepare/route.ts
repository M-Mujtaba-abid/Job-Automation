import { z } from "zod";
import { parseBody, route } from "@/legacy/api";
import { prepareEmail } from "@/legacy/applications";
import { jobIdsSchema } from "@/legacy/validators";

export const POST = route(async (req) => {
  const { jobIds, templateId } = await parseBody(
    req,
    z.object({ jobIds: jobIdsSchema, templateId: z.uuid().nullish() }),
  );
  return prepareEmail(jobIds, templateId);
});
