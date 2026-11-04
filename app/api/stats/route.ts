import { route } from "@/lib/api";
import { getStats } from "@/lib/queries/stats";

export const GET = route(async () => getStats());
