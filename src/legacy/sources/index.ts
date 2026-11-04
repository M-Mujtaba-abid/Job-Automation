import type { SourceType } from "@/legacy/db/schema";
import { apifySource } from "./apify";
import type { JobSource } from "./types";

/** Registry: add new adapters here (job board APIs, RSS, ...) without touching ingest. */
const ADAPTERS: JobSource[] = [apifySource];

export function adapterFor(type: SourceType): JobSource | null {
  return ADAPTERS.find((a) => a.types.includes(type)) ?? null;
}

export type { JobSource, RawJob } from "./types";
