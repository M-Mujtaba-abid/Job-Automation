import { parseQuery, route } from "@/legacy/api";
import { jobFiltersSchema, matchingJobIds } from "@/legacy/queries/jobs";

/** "Select all N matching jobs" across pages. */
export const GET = route(async (req) => matchingJobIds(parseQuery(req, jobFiltersSchema)));
