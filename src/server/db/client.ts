import "server-only";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { serverEnv } from "@/server/lib/env";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

export type Db = NeonDatabase<typeof schema>;
/** Transaction handle type, for repository functions that join a caller's transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const globalForDb = globalThis as unknown as { __v2db?: Db };

/** Lazily created singleton (survives HMR in dev; reused across warm invocations). Pooled URL. */
export function db(): Db {
  globalForDb.__v2db ??= drizzle({ client: new Pool({ connectionString: serverEnv().DATABASE_URL }), schema });
  return globalForDb.__v2db;
}

export { schema };
