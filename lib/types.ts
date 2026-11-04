// Client-side shapes of API responses (Dates arrive as ISO strings).
import type { CronReport } from "@/lib/ingest";
import type { JobListItem } from "@/lib/queries/jobs";
import type {
  Application,
  EmailTemplate,
  FetchRun,
  JobContact,
  Job,
  Settings,
  Source,
} from "@/lib/db/schema";
import type { TemplateVars } from "@/lib/template";

export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type JobRow = Serialized<JobListItem>;
export type JobFilterTab = "all" | "email" | "phone" | "form";

export type JobsResponse = {
  items: JobRow[];
  total: number;
  counts: { all: number; email: number; phone: number; form: number };
  page: number;
  pageSize: number;
};

export type JobIdsResponse = { ids: string[]; emails: { jobId: string; email: string }[]; truncated: boolean };

export type JobDetail = Serialized<
  Omit<Job, "raw"> & {
    sourceName: string | null;
    sourceType: string | null;
    contacts: JobContact[];
    applications: Application[];
  }
>;

export type StatsResponse = {
  newToday: number;
  withEmail: number;
  withPhone: number;
  withForm: number;
  appliedThisWeek: number;
};

export type SettingsResponse = Serialized<Settings> & {
  cv: { fileName: string; size: number; updatedAt: string } | null;
};
export type TemplateRow = Serialized<EmailTemplate>;

export type SourceRow = Serialized<Source> & {
  lastRun: { status: FetchRun["status"]; startedAt: string; error: string | null; insertedCount: number } | null;
  jobCount: number;
};

export type RunRow = Serialized<FetchRun> & { sourceName: string | null; apifyUrl: string | null };

export type ApplicationRow = {
  id: string;
  jobId: string;
  jobTitle: string;
  company: string | null;
  channel: Application["channel"];
  toAddress: string;
  subject: string | null;
  status: Application["status"];
  error: string | null;
  batchId: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type PrepareResponse = {
  template: TemplateRow | null;
  profileVars: TemplateVars;
  cv: { fileName: string } | null;
  recipients: {
    email: string;
    jobs: { id: string; title: string; company: string | null }[];
    vars: TemplateVars;
    lastEmailedAt: string | null;
  }[];
  jobsWithoutEmail: { id: string; title: string }[];
};

export type QueueResponse = {
  batchId: string;
  queued: number;
  skipped: { email: string; jobTitle: string; reason: string }[];
};

export type ProcessResponse = {
  sent: number;
  failed: number;
  remaining: number;
  limitReached: boolean;
  results: { email: string; ok: boolean; error?: string }[];
};

export type { CronReport };
