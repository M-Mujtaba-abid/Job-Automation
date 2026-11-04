// Barrel for all v2 tables (schema "app"). drizzle.config.ts points here.
// `app` must be exported so drizzle-kit emits CREATE SCHEMA "app".
export { app } from "./_shared";
export * from "./platform";
