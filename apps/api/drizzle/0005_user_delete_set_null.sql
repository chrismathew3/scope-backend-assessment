ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_actor_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "theater_membership" DROP CONSTRAINT "theater_membership_granted_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theater_membership" ADD CONSTRAINT "theater_membership_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;