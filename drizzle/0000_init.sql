CREATE TYPE "public"."application_channel" AS ENUM('email', 'whatsapp', 'google_form');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'opened');--> statement-breakpoint
CREATE TYPE "public"."contact_type" AS ENUM('email', 'phone', 'google_form', 'other_link');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('new', 'saved', 'applied', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'success', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('apify_linkedin', 'apify_facebook', 'manual');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"contact_id" uuid,
	"channel" "application_channel" NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"body" text,
	"template_id" uuid,
	"attach_cv" boolean DEFAULT false NOT NULL,
	"batch_id" uuid,
	"status" "application_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"attach_cv" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"trigger" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"apify_run_id" text,
	"dataset_id" text,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fetch_runs_apify_run_id_unique" UNIQUE("apify_run_id")
);
--> statement-breakpoint
CREATE TABLE "job_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "contact_type" NOT NULL,
	"value" text NOT NULL,
	"normalized" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"dedupe_hash" text NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"location" text,
	"employment_type" text,
	"is_remote" boolean DEFAULT false NOT NULL,
	"description" text,
	"apply_url" text,
	"posted_at" timestamp with time zone,
	"has_email" boolean DEFAULT false NOT NULL,
	"has_phone" boolean DEFAULT false NOT NULL,
	"has_form" boolean DEFAULT false NOT NULL,
	"status" "job_status" DEFAULT 'new' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_dedupe_hash_unique" UNIQUE("dedupe_hash")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"portfolio_url" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"cv_blob_url" text,
	"cv_file_name" text,
	"whatsapp_message_template" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "source_type" NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_contact_id_job_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."job_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD CONSTRAINT "fetch_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_contacts" ADD CONSTRAINT "job_contacts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_batch_idx" ON "applications" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "applications_job_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "applications_to_idx" ON "applications" USING btree ("to_address");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_no_double_apply_idx" ON "applications" USING btree ("job_id","channel","to_address") WHERE "applications"."status" in ('queued', 'sending', 'sent');--> statement-breakpoint
CREATE INDEX "fetch_runs_status_idx" ON "fetch_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "fetch_runs_source_idx" ON "fetch_runs" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_contacts_unique_idx" ON "job_contacts" USING btree ("job_id","type","normalized");--> statement-breakpoint
CREATE INDEX "job_contacts_normalized_idx" ON "job_contacts" USING btree ("type","normalized");--> statement-breakpoint
CREATE INDEX "jobs_status_created_idx" ON "jobs" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_has_email_idx" ON "jobs" USING btree ("has_email");--> statement-breakpoint
CREATE INDEX "jobs_has_phone_idx" ON "jobs" USING btree ("has_phone");--> statement-breakpoint
CREATE INDEX "jobs_has_form_idx" ON "jobs" USING btree ("has_form");--> statement-breakpoint
CREATE INDEX "jobs_source_idx" ON "jobs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "jobs_search_idx" ON "jobs" USING gin (to_tsvector('english', "title" || ' ' || coalesce("company", '') || ' ' || coalesce("description", '')));--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");