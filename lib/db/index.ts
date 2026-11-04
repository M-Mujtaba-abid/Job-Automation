import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

export type DB = NeonDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: DB; __pool?: Pool };

function create(): DB {
  // Only DATABASE_URL is needed to browse; SMTP/Apify are validated (via env()) when used.
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  const pool = new Pool({ connectionString: url });
  globalForDb.__pool = pool;
  return drizzle({ client: pool, schema });
}

/** Lazily-created singleton (survives HMR in dev, reused across invocations on Vercel). */
export function db(): DB {
  globalForDb.__db ??= create();
  return globalForDb.__db;
}

export { schema };
