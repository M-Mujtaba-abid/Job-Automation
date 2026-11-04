import { describe, expect, it, vi } from "vitest";
import { drain } from "@/server/jobs/drain";
import { createMaintenanceHandler } from "@/server/jobs/handlers/maintenance";
import type { JobHandler } from "@/server/jobs/types";
import { createLogger } from "@/server/lib/logger";
import { createFakeQueue } from "./fake-queue";

describe("maintenance handler", () => {
  it("releases stale jobs, prunes finished jobs and expired rate-limit buckets", async () => {
    const { queue } = createFakeQueue();
    const releaseStale = vi.spyOn(queue, "releaseStale");
    const pruneFinished = vi.spyOn(queue, "pruneFinished");
    const rateLimiter = { consume: vi.fn(), prune: vi.fn(async () => 3) };
    const handler = createMaintenanceHandler({ rateLimiter }) as JobHandler;

    await queue.enqueue("maintenance", { day: "2026-11-04" }, { dedupeKey: "maintenance:2026-11-04" });
    process.env.LOG_LEVEL = "error";
    const s = await drain({
      queue,
      handlers: new Map([[handler.queue, handler]]),
      workerId: "t",
      budgetMs: 5_000,
      logger: createLogger(),
    });

    expect(s.succeeded).toBe(1);
    expect(releaseStale).toHaveBeenCalledWith(5 * 60_000);
    expect(pruneFinished).toHaveBeenCalledWith({ doneOlderThanMs: 14 * 86_400_000, deadOlderThanMs: 30 * 86_400_000 });
    expect(rateLimiter.prune).toHaveBeenCalledOnce();
  });

  it("rejects a malformed payload", () => {
    const handler = createMaintenanceHandler({ rateLimiter: { consume: vi.fn(), prune: vi.fn() } });
    expect(handler.payload.safeParse({ day: "yesterday" }).success).toBe(false);
  });
});
