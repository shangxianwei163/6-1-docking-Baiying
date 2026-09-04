CREATE TYPE "public"."empty_policy" AS ENUM('BLOCK', 'DEFAULT');--> statement-breakpoint
CREATE TYPE "public"."mapping_change_type" AS ENUM('UPSERT', 'REMOVE');--> statement-breakpoint
CREATE TYPE "public"."mapping_rule_status" AS ENUM('PUBLISHED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."scene_readiness_status" AS ENUM('ACTIVE', 'PENDING_MAPPING', 'DRIFT_DETECTED', 'STALE_SYNC', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."scene_sync_status" AS ENUM('SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"actor_id" varchar(128) NOT NULL,
	"action" varchar(128) NOT NULL,
	"object_type" varchar(128) NOT NULL,
	"object_id" varchar(256) NOT NULL,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baiying_scene_company" (
	"scene_def_id" varchar(128) NOT NULL,
	"company_id" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baiying_scene_company_scene_def_id_company_id_pk" PRIMARY KEY("scene_def_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "baiying_scene" (
	"scene_def_id" varchar(128) PRIMARY KEY NOT NULL,
	"robot_def_id" varchar(128) NOT NULL,
	"scene_name" varchar(200) NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_sequence" (
	"name" varchar(64) PRIMARY KEY NOT NULL,
	"value" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_record" (
	"source_system" varchar(32) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"response_status" integer NOT NULL,
	"response_body_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_record_source_system_idempotency_key_pk" PRIMARY KEY("source_system","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "global_variable_mapping_draft" (
	"baiying_variable_name" varchar(128) PRIMARY KEY NOT NULL,
	"erp_field" varchar(128),
	"crm_field" varchar(128),
	"transform_config" jsonb,
	"empty_policy" "empty_policy",
	"default_value" text,
	"change_type" "mapping_change_type" NOT NULL,
	"removal_reason" text,
	"updated_by" varchar(128) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_variable_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_version_id" uuid NOT NULL,
	"baiying_variable_name" varchar(128) NOT NULL,
	"erp_field" varchar(128),
	"crm_field" varchar(128),
	"transform_config" jsonb NOT NULL,
	"empty_policy" "empty_policy" NOT NULL,
	"default_value" text,
	"status" "mapping_rule_status" DEFAULT 'PUBLISHED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"publisher_id" varchar(128) NOT NULL,
	"change_summary" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"queue_name" varchar(128) NOT NULL,
	"payload_json" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene_mapping_readiness" (
	"scene_def_id" varchar(128) PRIMARY KEY NOT NULL,
	"status" "scene_readiness_status" NOT NULL,
	"expected_variables_hash" varchar(64),
	"published_mapping_version_id" uuid,
	"variables_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_variables_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_successful_sync_at" timestamp with time zone,
	"issue_summary" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baiying_scene_variable_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar(64) NOT NULL,
	"robot_def_id" varchar(128) NOT NULL,
	"scene_def_id" varchar(128) NOT NULL,
	"variables_json" jsonb NOT NULL,
	"variables_hash" varchar(64) NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"sync_status" "scene_sync_status" NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_mapping_snapshot" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"mapping_version_id" uuid NOT NULL,
	"variables_json" jsonb NOT NULL,
	"mapping_rules_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "baiying_scene_company" ADD CONSTRAINT "baiying_scene_company_scene_def_id_baiying_scene_scene_def_id_fk" FOREIGN KEY ("scene_def_id") REFERENCES "public"."baiying_scene"("scene_def_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_variable_mapping" ADD CONSTRAINT "global_variable_mapping_mapping_version_id_mapping_version_id_fk" FOREIGN KEY ("mapping_version_id") REFERENCES "public"."mapping_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_mapping_readiness" ADD CONSTRAINT "scene_mapping_readiness_scene_def_id_baiying_scene_scene_def_id_fk" FOREIGN KEY ("scene_def_id") REFERENCES "public"."baiying_scene"("scene_def_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_mapping_readiness" ADD CONSTRAINT "scene_mapping_readiness_published_mapping_version_id_mapping_version_id_fk" FOREIGN KEY ("published_mapping_version_id") REFERENCES "public"."mapping_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baiying_scene_variable_snapshot" ADD CONSTRAINT "baiying_scene_variable_snapshot_scene_def_id_baiying_scene_scene_def_id_fk" FOREIGN KEY ("scene_def_id") REFERENCES "public"."baiying_scene"("scene_def_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_mapping_snapshot" ADD CONSTRAINT "task_mapping_snapshot_mapping_version_id_mapping_version_id_fk" FOREIGN KEY ("mapping_version_id") REFERENCES "public"."mapping_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_record" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_rule_version_variable_uq" ON "global_variable_mapping" USING btree ("mapping_version_id","baiying_variable_name");--> statement-breakpoint
CREATE INDEX "mapping_rule_variable_idx" ON "global_variable_mapping" USING btree ("baiying_variable_name");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_version_number_uq" ON "mapping_version" USING btree ("version");--> statement-breakpoint
CREATE INDEX "queue_outbox_pending_idx" ON "queue_outbox" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE INDEX "scene_snapshot_lookup_idx" ON "baiying_scene_variable_snapshot" USING btree ("scene_def_id","company_id","synced_at");