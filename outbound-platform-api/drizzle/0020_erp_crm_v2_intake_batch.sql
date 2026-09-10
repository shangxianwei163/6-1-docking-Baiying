ALTER TYPE "public"."empty_policy" ADD VALUE IF NOT EXISTS 'OMIT';--> statement-breakpoint
CREATE TYPE "public"."intake_batch_status" AS ENUM('ACCEPTED', 'PREPARING', 'RUNNING', 'PARTIAL_FAILED', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."callback_match_method" AS ENUM('ITEM_TOKEN', 'ITEM_PHONE', 'PHONE_FALLBACK');--> statement-breakpoint
CREATE TABLE "intake_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"integration_client_id" uuid NOT NULL,
	"studio_id" uuid NOT NULL,
	"mc_code_snapshot" varchar(64) NOT NULL,
	"main_category" varchar(200) NOT NULL,
	"sub_category" varchar(200) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_body_sha256" char(64) NOT NULL,
	"phone_count" integer NOT NULL,
	"task_count" integer NOT NULL,
	"execution_status" "intake_batch_status" DEFAULT 'ACCEPTED' NOT NULL,
	"failure_code" varchar(128),
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "intake_batch_source_ck" CHECK ("intake_batch"."source_system" IN ('ERP', 'CRM')),
	CONSTRAINT "intake_batch_counts_ck" CHECK ("intake_batch"."phone_count" > 0 AND "intake_batch"."phone_count" <= 10000 AND "intake_batch"."task_count" > 0)
);--> statement-breakpoint
ALTER TABLE "intake_batch" ADD CONSTRAINT "intake_batch_integration_client_id_integration_client_id_fk" FOREIGN KEY ("integration_client_id") REFERENCES "public"."integration_client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_batch" ADD CONSTRAINT "intake_batch_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_batch_idempotency_idx" ON "intake_batch" USING btree ("integration_client_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "intake_batch_studio_created_idx" ON "intake_batch" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE INDEX "intake_batch_status_idx" ON "intake_batch" USING btree ("execution_status","updated_at");--> statement-breakpoint
ALTER TABLE "platform_task" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_task" ADD COLUMN "route_key" char(64);--> statement-breakpoint
ALTER TABLE "platform_task" ADD COLUMN "contract_version" varchar(16) DEFAULT '1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_batch_id_intake_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_task_batch_route_uq" ON "platform_task" USING btree ("batch_id","route_key") WHERE "platform_task"."batch_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "task_call_item" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "task_call_item" ADD COLUMN "category_snapshot_json" jsonb;--> statement-breakpoint
ALTER TABLE "task_call_item" ADD COLUMN "result_event_id" uuid;--> statement-breakpoint
ALTER TABLE "task_call_item" ADD CONSTRAINT "task_call_item_batch_id_intake_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."intake_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_call_item_batch_customer_uq" ON "task_call_item" USING btree ("batch_id","external_customer_id") WHERE "task_call_item"."batch_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_call_item_batch_phone_uq" ON "task_call_item" USING btree ("batch_id","phone_hmac") WHERE "task_call_item"."batch_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "task_call_item_result_event_uq" ON "task_call_item" USING btree ("result_event_id") WHERE "task_call_item"."result_event_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "call_instance" ADD COLUMN "task_results_json" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "call_instance" ADD COLUMN "result_complete" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "call_instance" ADD COLUMN "match_method" "callback_match_method";
