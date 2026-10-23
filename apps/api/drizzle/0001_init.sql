CREATE TYPE "public"."import_row_outcome" AS ENUM('add', 'update', 'unchanged', 'duplicate', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('previewed', 'applied', 'discarded', 'stale');--> statement-breakpoint
CREATE TYPE "public"."movie_status" AS ENUM('approved', 'draft', 'flagged', 'needs-review');--> statement-breakpoint
CREATE TYPE "public"."showtime_status" AS ENUM('active', 'inactive', 'archived');--> statement-breakpoint
CREATE TYPE "public"."theater_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"theater_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"import_id" text NOT NULL,
	"line_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"normalized" jsonb,
	"outcome" "import_row_outcome" NOT NULL,
	"showtime_id" text,
	"match_method" text,
	"diffs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "import_row_import_id_line_number_pk" PRIMARY KEY("import_id","line_number")
);
--> statement-breakpoint
CREATE TABLE "import" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"theater_id" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"filename" text NOT NULL,
	"file_sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" "import_status" DEFAULT 'previewed' NOT NULL,
	"base_schedule_version" integer NOT NULL,
	"total_rows" integer NOT NULL,
	"add_count" integer DEFAULT 0 NOT NULL,
	"update_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"archive_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"active_before" integer DEFAULT 0 NOT NULL,
	"notices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archive_showtime_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_by" text,
	"applied_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "showtime" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"theater_id" text NOT NULL,
	"movie_title" text NOT NULL,
	"movie_title_key" text NOT NULL,
	"movie_status" "movie_status" DEFAULT 'needs-review' NOT NULL,
	"auditorium" text NOT NULL,
	"auditorium_key" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"language" text NOT NULL,
	"format" text NOT NULL,
	"rating" text NOT NULL,
	"status" "showtime_status" DEFAULT 'active' NOT NULL,
	"source_updated_at" timestamp with time zone,
	"last_import_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "showtime_time_order" CHECK ("showtime"."end_time" > "showtime"."start_time")
);
--> statement-breakpoint
CREATE TABLE "theater_membership" (
	"user_id" text NOT NULL,
	"theater_id" text NOT NULL,
	"role" "theater_role" NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theater_membership_user_id_theater_id_pk" PRIMARY KEY("user_id","theater_id")
);
--> statement-breakpoint
CREATE TABLE "theater" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"timezone" text NOT NULL,
	"schedule_version" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_import_id_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_theater_id_theater_id_fk" FOREIGN KEY ("theater_id") REFERENCES "public"."theater"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_applied_by_user_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "showtime" ADD CONSTRAINT "showtime_theater_id_theater_id_fk" FOREIGN KEY ("theater_id") REFERENCES "public"."theater"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theater_membership" ADD CONSTRAINT "theater_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theater_membership" ADD CONSTRAINT "theater_membership_theater_id_theater_id_fk" FOREIGN KEY ("theater_id") REFERENCES "public"."theater"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theater_membership" ADD CONSTRAINT "theater_membership_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_theater_idx" ON "audit_log" USING btree ("theater_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_theater_idx" ON "import" USING btree ("theater_id","created_at");--> statement-breakpoint
CREATE INDEX "import_hash_idx" ON "import" USING btree ("theater_id","file_sha256");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "showtime_active_uq" ON "showtime" USING btree ("theater_id","movie_title_key","start_time") WHERE "showtime"."status" = 'active';--> statement-breakpoint
CREATE INDEX "showtime_scope_idx" ON "showtime" USING btree ("theater_id","status","start_time","id");--> statement-breakpoint
CREATE INDEX "showtime_start_idx" ON "showtime" USING btree ("start_time","id");--> statement-breakpoint
CREATE INDEX "showtime_title_trgm_idx" ON "showtime" USING gin ("movie_title_key" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "showtime_title_sort_idx" ON "showtime" USING btree ("movie_title_key","id");--> statement-breakpoint
CREATE INDEX "showtime_updated_idx" ON "showtime" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "membership_theater_idx" ON "theater_membership" USING btree ("theater_id");--> statement-breakpoint
CREATE UNIQUE INDEX "theater_name_lower_uq" ON "theater" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_uq" ON "user" USING btree (lower("email"));