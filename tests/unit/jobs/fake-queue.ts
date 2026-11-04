import type { ClaimedJob, EnqueueOptions, FailOutcome, JobQueue } from "@/server/jobs/types";

type Row = {
  id: string;
  queue: string;
  payload: Record<string, unknown>;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "DEAD";
  priority: number;
  attempts: number;
  maxAttempts: number;
  notBefore: number;
  dedupeKey: string | null;
  lastError: string | null;
};

/** In-memory JobQueue with the same semantics as the Postgres adapter (for drain unit tests). */
export function createFakeQueue(clock: () => number = Date.now) {
  const rows: Row[] = [];
  let seq = 0;

  const queue: JobQueue = {
    async enqueue(name, payload, opts: EnqueueOptions = {}) {
      if (opts.dedupeKey && rows.some((r) => r.dedupeKey === opts.dedupeKey)) return { id: null, deduped: true };
      const id = `job-${++seq}`;
      rows.push({
        id,
        queue: name,
        payload,
        status: "QUEUED",
        priority: opts.priority ?? 100,
        attempts: 0,
        maxAttempts: opts.maxAttempts ?? 5,
        notBefore: opts.notBefore?.getTime() ?? clock(),
        dedupeKey: opts.dedupeKey ?? null,
        lastError: null,
      });
      return { id, deduped: false };
    },
    async claimNext() {
      const due = rows
        .filter((r) => (r.status === "QUEUED" || r.status === "FAILED") && r.notBefore <= clock())
        .sort((a, b) => a.priority - b.priority || a.notBefore - b.notBefore)[0];
      if (!due) return null;
      due.status = "RUNNING";
      due.attempts++;
      return {
        id: due.id,
        queue: due.queue,
        payload: due.payload,
        attempts: due.attempts,
        maxAttempts: due.maxAttempts,
      };
    },
    async complete(id) {
      const r = find(id);
      r.status = "DONE";
      r.dedupeKey = null;
    },
    async fail(job: ClaimedJob, error, { retryable }): Promise<FailOutcome> {
      const r = find(job.id);
      r.lastError = error;
      if (retryable && job.attempts < job.maxAttempts) {
        r.status = "FAILED";
        r.notBefore = clock() + 1_000_000; // far enough that the same drain doesn't pick it up again
        return "retry";
      }
      r.status = "DEAD";
      r.dedupeKey = null;
      return "dead";
    },
    async defer(job, until) {
      const r = find(job.id);
      r.status = "QUEUED";
      r.notBefore = until.getTime();
      r.attempts = Math.max(0, r.attempts - 1);
    },
    async releaseStale() {
      return 0;
    },
    async pruneFinished() {
      return 0;
    },
    async countDue() {
      return rows.filter((r) => (r.status === "QUEUED" || r.status === "FAILED") && r.notBefore <= clock()).length;
    },
  };

  function find(id: string): Row {
    const r = rows.find((x) => x.id === id);
    if (!r) throw new Error(`unknown job ${id}`);
    return r;
  }

  return { queue, rows };
}
