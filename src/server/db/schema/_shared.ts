import { customType, pgSchema, timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "../../lib/uuid"; // relative: drizzle-kit loads schema files without tsconfig paths

/** All v2 tables live in Postgres schema "app"; v1 stays in "public" (ADR-024). */
export const app = pgSchema("app");

export const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** precision 3 (ms) so the value round-trips exactly through JS Date: needed for optimistic-concurrency checks. */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, precision: 3 })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const citext = customType<{ data: string }>({ dataType: () => "citext" });
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
