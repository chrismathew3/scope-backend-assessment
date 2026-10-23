CREATE TABLE "login_failure" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"ip" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_failure_ip_idx" ON "login_failure" USING btree ("ip","created_at");--> statement-breakpoint
-- Written before sign-in, so no row-level security; the app only inserts, counts and prunes.
GRANT SELECT, INSERT, DELETE ON "login_failure" TO scope_app;
