import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: [".env.local", ".env"], quiet: true });

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in .env.local");

export default defineConfig({
  // v1 tables live in schema "public"; v2 tables in schema "app" (ADR-024).
  schema: ["./src/legacy/db/schema.ts", "./src/server/db/schema/index.ts"],
  schemaFilter: ["public", "app"],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
