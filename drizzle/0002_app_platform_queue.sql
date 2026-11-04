CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."background_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"queue" text NOT NULL,
	"dedupe_key" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "background_jobs_dedupe_key_key" UNIQUE("dedupe_key"),
	CONSTRAINT "background_jobs_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'DEAD'))
);
--> statement-breakpoint
CREATE TABLE "app"."rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"points" integer NOT NULL,
	"expire_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "app"."background_jobs" USING btree ("status","not_before","priority");--> statement-breakpoint
CREATE INDEX "background_jobs_queue_status_idx" ON "app"."background_jobs" USING btree ("queue","status");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expire_at_idx" ON "app"."rate_limit_buckets" USING btree ("expire_at");