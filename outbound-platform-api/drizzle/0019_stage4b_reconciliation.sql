CREATE TYPE "public"."task_reconciliation_status" AS ENUM('PENDING', 'RUNNING', 'STABLE_ONCE', 'RECONCILED', 'MANUAL_REVIEW', 'FAILED');--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "company_id" varchar(128);--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "call_job_id" varchar(128);--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "call_instance_id" varchar(128);--> statement-breakpoint
CREATE INDEX "callback_inbox_task_idx" ON "callback_inbox" USING btree ("company_id","call_job_id","process_status");--> statement-breakpoint
CREATE TABLE "task_reconciliation" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"status" "task_reconciliation_status" DEFAULT 'PENDING' NOT NULL,
	"provider_state" varchar(32),
	"expected_call_count" integer NOT NULL,
	"provider_call_count" integer,
	"platform_call_count" integer DEFAULT 0 NOT NULL,
	"pending_inbox_count" integer DEFAULT 0 NOT NULL,
	"stable_rounds" integer DEFAULT 0 NOT NULL,
	"mismatch_since" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now(),
	"last_successful_at" timestamp with time zone,
	"last_provider_request_id" varchar(128),
	"failure_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"manual_review_at" timestamp with time zone,
	"repair_count" integer DEFAULT 0 NOT NULL,
	"last_repair_requested_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reconciliation_counts_ck" CHECK ("task_reconciliation"."expected_call_count" >= 0 AND "task_reconciliation"."provider_call_count" >= 0 AND "task_reconciliation"."platform_call_count" >= 0 AND "task_reconciliation"."pending_inbox_count" >= 0 AND "task_reconciliation"."stable_rounds" >= 0 AND "task_reconciliation"."failure_attempts" >= 0 AND "task_reconciliation"."repair_count" >= 0)
);--> statement-breakpoint
ALTER TABLE "task_reconciliation" ADD CONSTRAINT "task_reconciliation_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_reconciliation_pending_idx" ON "task_reconciliation" USING btree ("status","next_check_at","locked_at");
