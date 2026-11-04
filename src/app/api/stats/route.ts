import { route } from "@/legacy/api";
import { getStats } from "@/legacy/queries/stats";

export const GET = route(async () => getStats());
