import { parseQuery, route } from "@/lib/api";
import { jobFiltersSchema, listJobs } from "@/lib/queries/jobs";

export const GET = route(async (req) => listJobs(parseQuery(req, jobFiltersSchema)));
