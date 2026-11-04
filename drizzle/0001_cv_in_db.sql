CREATE TABLE "cv_file" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "cv_blob_url";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "cv_file_name";