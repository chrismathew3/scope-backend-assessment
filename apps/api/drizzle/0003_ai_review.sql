ALTER TABLE "import_row" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "decision_source" text DEFAULT 'rules' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "ai_overrode_rules" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "duplicate_of" integer;--> statement-breakpoint
ALTER TABLE "import_row" ADD COLUMN "accepted" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "archive_proposals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import" ADD COLUMN "agent" jsonb DEFAULT '{"status":"off","model":null,"summary":null,"error":null,"durationMs":null,"overrides":0,"corrections":0,"trace":[]}'::jsonb NOT NULL;