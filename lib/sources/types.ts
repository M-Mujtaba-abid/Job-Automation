import type { Source, SourceType } from "@/lib/db/schema";

export interface RawJob {
  externalId?: string;
  title?: string; // derived from the text when missing
  company?: string;
  location?: string;
  employmentType?: string;
  isRemote?: boolean;
  descriptionHtmlOrText: string;
  applyUrl?: string;
  postedAt?: Date;
  raw: unknown;
}

export type StartedRun = { apifyRunId: string; datasetId: string };

export type RemoteRunState = {
  status: "pending" | "succeeded" | "failed";
  /** Apify's own status string, e.g. RUNNING, SUCCEEDED, TIMED-OUT */
  rawStatus: string;
  datasetId?: string;
  message?: string;
};

export interface JobSource {
  types: SourceType[];
  isConfigured(): boolean;
  start(source: Source, fetchRunId: string): Promise<StartedRun>;
  getRun(apifyRunId: string): Promise<RemoteRunState>;
  /** Yields pages of raw dataset items. */
  items(datasetId: string): AsyncGenerator<unknown[]>;
  /** null = not usable / not a hiring post */
  mapItem(item: unknown): RawJob | null;
  runUrl(apifyRunId: string): string;
}
