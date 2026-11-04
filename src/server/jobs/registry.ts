import type { JobHandler } from "./types";
import { maintenanceHandler } from "./handlers/maintenance";

/** Every background job handler, keyed by queue name. Add new handlers here. */
export const handlers: ReadonlyMap<string, JobHandler> = new Map<string, JobHandler>(
  [maintenanceHandler as JobHandler].map((h) => [h.queue, h]),
);
