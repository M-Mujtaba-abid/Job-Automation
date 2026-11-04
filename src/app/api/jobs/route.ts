import { parseQuery, route } from "@/legacy/api";
import { jobFiltersSchema, listJobs } from "@/legacy/queries/jobs";

export const GET = route(async (req) => listJobs(parseQuery(req, jobFiltersSchema)));
