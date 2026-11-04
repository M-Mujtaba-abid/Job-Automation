import "server-only";
import { rateLimiter } from "@/server/lib/rate-limit";
import { createMaintenanceHandler } from "./handlers/maintenance";
import type { JobHandler } from "./types";

/** Every background job handler, keyed by queue name. Add new handlers here. */
export const handlers: ReadonlyMap<string, JobHandler> = new Map<string, JobHandler>(
  [createMaintenanceHandler({ rateLimiter }) as JobHandler].map((h) => [h.queue, h]),
);
