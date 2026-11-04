import { parseQuery, route } from "@/lib/api";
import { jobFiltersSchema, matchingJobIds } from "@/lib/queries/jobs";

/** "Select all N matching jobs" across pages. */
export const GET = route(async (req) => matchingJobIds(parseQuery(req, jobFiltersSchema)));
