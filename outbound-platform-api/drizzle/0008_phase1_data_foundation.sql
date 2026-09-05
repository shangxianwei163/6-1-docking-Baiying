CREATE TYPE "public"."account_ledger_entry_type" AS ENUM('TOP_UP', 'TASK_HOLD', 'TASK_HOLD_RELEASE', 'CALL_CHARGE', 'OVERAGE_DEBIT', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."billing_status" AS ENUM('RESERVED', 'SETTLING', 'SETTLED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."callback_parse_status" AS ENUM('PENDING', 'VALID', 'INVALID', 'UNKNOWN_TYPE');--> statement-breakpoint
CREATE TYPE "public"."callback_process_status" AS ENUM('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."dead_letter_source_type" AS ENUM('OUTBOX', 'CALLBACK', 'RECORDING', 'DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."dead_letter_status" AS ENUM('OPEN', 'REPLAYING', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TYPE "public"."delivery_attempt_status" AS ENUM('SUCCEEDED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('PENDING', 'DELIVERING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED');--> statement-breakpoint
CREATE TYPE "public"."delivery_target" AS ENUM('RESULT', 'RECORDING');--> statement-breakpoint
CREATE TYPE "public"."fund_hold_status" AS ENUM('ACTIVE', 'CAPTURED', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."idempotency_processing_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."integration_client_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."integration_endpoint_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."normalized_call_status" AS ENUM('PENDING', 'ANSWERED', 'NO_ANSWER', 'BUSY', 'REJECTED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."pricing_source_mode" AS ENUM('UNIFORM', 'PER_STUDIO');--> statement-breakpoint
CREATE TYPE "public"."pricing_status" AS ENUM('SCHEDULED', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."recording_archive_status" AS ENUM('PENDING', 'DOWNLOADING', 'ARCHIVED', 'PARTIAL', 'FAILED', 'NOT_AVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."recording_delivery_status" AS ENUM('PENDING', 'DELIVERING', 'SUCCEEDED', 'FAILED', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."recording_kind" AS ENUM('FULL', 'USER_ONLY');--> statement-breakpoint
CREATE TYPE "public"."result_delivery_status" AS ENUM('PENDING', 'DELIVERING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."script_binding_status" AS ENUM('ACTIVE', 'RETIRED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."studio_account_status" AS ENUM('ACTIVE', 'LOW_BALANCE', 'OVERDUE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."studio_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."task_execution_status" AS ENUM('ACCEPTED', 'BAIYING_CREATING', 'BAIYING_CREATED', 'IMPORTING', 'IMPORTED', 'STARTING', 'CALLING', 'PAUSED', 'CALL_COMPLETED', 'RECONCILING', 'COMPLETED', 'CREATE_FAILED', 'IMPORT_FAILED', 'START_FAILED', 'CANCELLED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."task_import_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'DUPLICATED');--> statement-breakpoint
CREATE TYPE "public"."task_operation_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."task_operation_type" AS ENUM('CREATE', 'IMPORT', 'START', 'PAUSE', 'RESUME', 'TERMINATE', 'QUERY');--> statement-breakpoint
CREATE TABLE "account_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"task_id" uuid,
	"call_instance_id" uuid,
	"entry_type" "account_ledger_entry_type" NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"balance_after" numeric(18, 6) NOT NULL,
	"available_balance_after" numeric(18, 6) NOT NULL,
	"business_key" varchar(256) NOT NULL,
	"operator_id" varchar(128),
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_instance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar(64) NOT NULL,
	"call_instance_id" varchar(64) NOT NULL,
	"task_id" uuid NOT NULL,
	"task_call_item_id" uuid NOT NULL,
	"callback_inbox_id" uuid,
	"call_status" "normalized_call_status" NOT NULL,
	"provider_call_status" integer,
	"finish_status" integer,
	"called_times" integer,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"billing_minutes" integer DEFAULT 0 NOT NULL,
	"customer_charge" numeric(18, 6) DEFAULT '0' NOT NULL,
	"collect_properties_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_instance_duration_ck" CHECK ("call_instance"."duration_seconds" >= 0 AND "call_instance"."billing_minutes" >= 0 AND "call_instance"."customer_charge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "callback_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(64) DEFAULT 'BAIYING' NOT NULL,
	"callback_type" varchar(128) NOT NULL,
	"event_key" varchar(512) NOT NULL,
	"raw_body_ciphertext" text NOT NULL,
	"raw_body_sha256" char(64) NOT NULL,
	"headers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parse_status" "callback_parse_status" DEFAULT 'PENDING' NOT NULL,
	"process_status" "callback_process_status" DEFAULT 'PENDING' NOT NULL,
	"parse_error" text,
	"process_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dead_letter_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "dead_letter_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"original_event_json" jsonb,
	"original_object_key" varchar(1024),
	"final_error" text NOT NULL,
	"suggested_action" text,
	"status" "dead_letter_status" DEFAULT 'OPEN' NOT NULL,
	"replay_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" varchar(128),
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	CONSTRAINT "dead_letter_payload_ck" CHECK ("dead_letter_event"."original_event_json" IS NOT NULL OR "dead_letter_event"."original_object_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "delivery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_event_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" "delivery_attempt_status" NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_status" integer,
	"response_summary" text,
	"error_class" varchar(128),
	"error_message" text,
	"duration_ms" integer NOT NULL,
	CONSTRAINT "delivery_attempt_values_ck" CHECK ("delivery_attempt"."attempt_no" > 0 AND "delivery_attempt"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_key" varchar(512) NOT NULL,
	"task_id" uuid NOT NULL,
	"endpoint_version_id" uuid NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"target" "delivery_target" NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"target_url_snapshot" text NOT NULL,
	"payload_json" jsonb,
	"payload_object_key" varchar(1024),
	"status" "delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(128),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "delivery_event_source_ck" CHECK ("delivery_event"."source_system" IN ('ERP', 'CRM')),
	CONSTRAINT "delivery_event_payload_ck" CHECK ("delivery_event"."payload_json" IS NOT NULL OR "delivery_event"."payload_object_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "fund_hold" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"original_amount" numeric(18, 6) NOT NULL,
	"remaining_amount" numeric(18, 6) NOT NULL,
	"status" "fund_hold_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "fund_hold_amount_ck" CHECK ("fund_hold"."original_amount" > 0 AND "fund_hold"."remaining_amount" >= 0 AND "fund_hold"."remaining_amount" <= "fund_hold"."original_amount")
);
--> statement-breakpoint
CREATE TABLE "integration_client_studio" (
	"integration_client_id" uuid NOT NULL,
	"studio_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_client_studio_integration_client_id_studio_id_pk" PRIMARY KEY("integration_client_id","studio_id")
);
--> statement-breakpoint
CREATE TABLE "integration_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar(128) NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"secret_ref" varchar(500) NOT NULL,
	"status" "integration_client_status" DEFAULT 'ACTIVE' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"created_by" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_client_source_ck" CHECK ("integration_client"."source_system" IN ('ERP', 'CRM')),
	CONSTRAINT "integration_client_rate_limit_ck" CHECK ("integration_client"."rate_limit_per_minute" > 0)
);
--> statement-breakpoint
CREATE TABLE "integration_endpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"version" integer NOT NULL,
	"result_url" text NOT NULL,
	"recording_url" text NOT NULL,
	"signing_secret_ref" varchar(500),
	"status" "integration_endpoint_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_by" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_endpoint_source_ck" CHECK ("integration_endpoint"."source_system" IN ('ERP', 'CRM')),
	CONSTRAINT "integration_endpoint_version_ck" CHECK ("integration_endpoint"."version" > 0),
	CONSTRAINT "integration_endpoint_active_secret_ck" CHECK ("integration_endpoint"."status" <> 'ACTIVE' OR "integration_endpoint"."signing_secret_ref" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "platform_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_no" varchar(64) NOT NULL,
	"external_request_id" varchar(128) NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"integration_client_id" uuid NOT NULL,
	"studio_id" uuid NOT NULL,
	"studio_name_snapshot" varchar(200) NOT NULL,
	"mc_code_snapshot" varchar(64) NOT NULL,
	"task_name" varchar(200) NOT NULL,
	"phone_count" integer NOT NULL,
	"category_snapshot_json" jsonb NOT NULL,
	"robot_def_id" varchar(128) NOT NULL,
	"robot_name" varchar(200) NOT NULL,
	"user_phone_id" varchar(128) NOT NULL,
	"line_name" varchar(200) NOT NULL,
	"mapping_version_id" uuid NOT NULL,
	"pricing_version_id" uuid NOT NULL,
	"endpoint_version_id" uuid NOT NULL,
	"endpoint_snapshot_json" jsonb NOT NULL,
	"customer_rate" numeric(18, 6) NOT NULL,
	"frozen_minutes" integer NOT NULL,
	"reserved_amount" numeric(18, 6) NOT NULL,
	"customer_charge" numeric(18, 6) DEFAULT '0' NOT NULL,
	"platform_rate" numeric(18, 6),
	"platform_cost" numeric(18, 6),
	"profit" numeric(18, 6),
	"baiying_company_id" varchar(64) NOT NULL,
	"baiying_call_job_id" varchar(64),
	"execution_status" "task_execution_status" DEFAULT 'ACCEPTED' NOT NULL,
	"provider_status" integer,
	"result_delivery_status" "result_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"recording_archive_status" "recording_archive_status" DEFAULT 'PENDING' NOT NULL,
	"recording_delivery_status" "recording_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"billing_status" "billing_status" DEFAULT 'RESERVED' NOT NULL,
	"import_requested_count" integer DEFAULT 0 NOT NULL,
	"import_succeeded_count" integer DEFAULT 0 NOT NULL,
	"import_failed_count" integer DEFAULT 0 NOT NULL,
	"import_repeated_count" integer DEFAULT 0 NOT NULL,
	"call_instance_count" integer DEFAULT 0 NOT NULL,
	"recording_discovered_count" integer DEFAULT 0 NOT NULL,
	"recording_archived_count" integer DEFAULT 0 NOT NULL,
	"recording_delivered_count" integer DEFAULT 0 NOT NULL,
	"total_duration_seconds" integer DEFAULT 0 NOT NULL,
	"billing_minutes" integer DEFAULT 0 NOT NULL,
	"failure_stage" varchar(64),
	"failure_code" varchar(128),
	"failure_message" text,
	"failure_retryable" boolean,
	"last_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"provider_completed_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "platform_task_source_ck" CHECK ("platform_task"."source_system" IN ('ERP', 'CRM')),
	CONSTRAINT "platform_task_phone_count_ck" CHECK ("platform_task"."phone_count" > 0 AND "platform_task"."phone_count" <= 10000),
	CONSTRAINT "platform_task_money_ck" CHECK ("platform_task"."customer_rate" >= 0 AND "platform_task"."reserved_amount" >= 0 AND "platform_task"."customer_charge" >= 0),
	CONSTRAINT "platform_task_frozen_minutes_ck" CHECK ("platform_task"."frozen_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "recording_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_instance_id" uuid NOT NULL,
	"kind" "recording_kind" NOT NULL,
	"provider_url_ciphertext" text NOT NULL,
	"oss_bucket" varchar(255),
	"oss_object_key" varchar(1024),
	"content_type" varchar(128),
	"size_bytes" bigint,
	"sha256" char(64),
	"archive_status" "recording_archive_status" DEFAULT 'PENDING' NOT NULL,
	"delivery_status" "recording_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"download_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "recording_asset_size_ck" CHECK ("recording_asset"."size_bytes" IS NULL OR "recording_asset"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "script_binding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robot_def_id" varchar(128) NOT NULL,
	"studio_id" uuid NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"user_phone_id" varchar(128) NOT NULL,
	"status" "script_binding_status" DEFAULT 'ACTIVE' NOT NULL,
	"version" integer NOT NULL,
	"created_by" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "script_binding_source_ck" CHECK ("script_binding"."source_system" IN ('ERP', 'CRM')),
	CONSTRAINT "script_binding_version_ck" CHECK ("script_binding"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "script_category_binding" (
	"script_binding_id" uuid NOT NULL,
	"studio_id" uuid NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"source_category_id" varchar(256) NOT NULL,
	"category_path" varchar(500) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_category_binding_script_binding_id_source_category_id_pk" PRIMARY KEY("script_binding_id","source_category_id")
);
--> statement-breakpoint
CREATE TABLE "studio_account" (
	"studio_id" uuid PRIMARY KEY NOT NULL,
	"currency" char(3) DEFAULT 'CNY' NOT NULL,
	"balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"active_hold_amount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"status" "studio_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_account_currency_ck" CHECK ("studio_account"."currency" = 'CNY'),
	CONSTRAINT "studio_account_hold_ck" CHECK ("studio_account"."active_hold_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "studio_pricing_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"voice_rate" numeric(18, 6) NOT NULL,
	"sms_rate" numeric(18, 6) NOT NULL,
	"frozen_minutes" integer NOT NULL,
	"source_mode" "pricing_source_mode" NOT NULL,
	"status" "pricing_status" NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"published_by" varchar(128) NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_pricing_voice_rate_ck" CHECK ("studio_pricing_version"."voice_rate" >= 0),
	CONSTRAINT "studio_pricing_sms_rate_ck" CHECK ("studio_pricing_version"."sms_rate" >= 0),
	CONSTRAINT "studio_pricing_frozen_minutes_ck" CHECK ("studio_pricing_version"."frozen_minutes" > 0),
	CONSTRAINT "studio_pricing_effective_range_ck" CHECK ("studio_pricing_version"."effective_to" IS NULL OR "studio_pricing_version"."effective_to" > "studio_pricing_version"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "studio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_code" varchar(64) NOT NULL,
	"mc_code" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"contact_name" varchar(128),
	"contact_phone_ciphertext" text,
	"contact_phone_masked" varchar(32),
	"status" "studio_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_by" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_pricing_tier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_code" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"min_monthly_minutes" bigint NOT NULL,
	"max_monthly_minutes" bigint,
	"voice_rate" numeric(18, 6) NOT NULL,
	"sms_rate" numeric(18, 6) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"published_by" varchar(128) NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_pricing_min_ck" CHECK ("supplier_pricing_tier"."min_monthly_minutes" >= 0),
	CONSTRAINT "supplier_pricing_max_ck" CHECK ("supplier_pricing_tier"."max_monthly_minutes" IS NULL OR "supplier_pricing_tier"."max_monthly_minutes" > "supplier_pricing_tier"."min_monthly_minutes"),
	CONSTRAINT "supplier_pricing_rate_ck" CHECK ("supplier_pricing_tier"."voice_rate" >= 0 AND "supplier_pricing_tier"."sms_rate" >= 0),
	CONSTRAINT "supplier_pricing_effective_range_ck" CHECK ("supplier_pricing_tier"."effective_to" IS NULL OR "supplier_pricing_tier"."effective_to" > "supplier_pricing_tier"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "task_call_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"external_customer_id" varchar(128) NOT NULL,
	"data_category_id" varchar(256) NOT NULL,
	"category_path" varchar(500) NOT NULL,
	"phone_ciphertext" text NOT NULL,
	"phone_hmac" char(64) NOT NULL,
	"phone_tail4" char(4) NOT NULL,
	"customer_name_ciphertext" text,
	"source_fields_ciphertext" text NOT NULL,
	"mapped_properties_ciphertext" text NOT NULL,
	"import_status" "task_import_status" DEFAULT 'PENDING' NOT NULL,
	"import_error" text,
	"call_status" "normalized_call_status" DEFAULT 'PENDING' NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"billing_minutes" integer DEFAULT 0 NOT NULL,
	"customer_charge" numeric(18, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_call_item_ordinal_ck" CHECK ("task_call_item"."ordinal" > 0),
	CONSTRAINT "task_call_item_duration_ck" CHECK ("task_call_item"."duration_seconds" >= 0 AND "task_call_item"."billing_minutes" >= 0 AND "task_call_item"."customer_charge" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"operation_type" "task_operation_type" NOT NULL,
	"attempt_no" integer NOT NULL,
	"request_payload_redacted_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_payload_redacted_json" jsonb,
	"provider_request_id" varchar(128),
	"status" "task_operation_status" DEFAULT 'PENDING' NOT NULL,
	"error_class" varchar(128),
	"error_code" varchar(128),
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "task_operation_attempt_ck" CHECK ("task_operation"."attempt_no" > 0)
);
--> statement-breakpoint
DROP INDEX "queue_outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "idempotency_record" DROP CONSTRAINT "idempotency_record_source_system_idempotency_key_pk";--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD COLUMN "client_id" varchar(128) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD COLUMN "request_body_sha256" char(64);--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD COLUMN "processing_status" "idempotency_processing_status" DEFAULT 'COMPLETED' NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_source_system_client_id_idempotency_key_pk" PRIMARY KEY("source_system","client_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "queue_outbox" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_outbox" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queue_outbox" ADD COLUMN "locked_by" varchar(128);--> statement-breakpoint
ALTER TABLE "queue_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "queue_outbox" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_call_instance_id_call_instance_id_fk" FOREIGN KEY ("call_instance_id") REFERENCES "public"."call_instance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_instance" ADD CONSTRAINT "call_instance_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_instance" ADD CONSTRAINT "call_instance_task_call_item_id_task_call_item_id_fk" FOREIGN KEY ("task_call_item_id") REFERENCES "public"."task_call_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_instance" ADD CONSTRAINT "call_instance_callback_inbox_id_callback_inbox_id_fk" FOREIGN KEY ("callback_inbox_id") REFERENCES "public"."callback_inbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_delivery_event_id_delivery_event_id_fk" FOREIGN KEY ("delivery_event_id") REFERENCES "public"."delivery_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_event" ADD CONSTRAINT "delivery_event_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_event" ADD CONSTRAINT "delivery_event_endpoint_version_id_integration_endpoint_id_fk" FOREIGN KEY ("endpoint_version_id") REFERENCES "public"."integration_endpoint"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_hold" ADD CONSTRAINT "fund_hold_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fund_hold" ADD CONSTRAINT "fund_hold_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_client_studio" ADD CONSTRAINT "integration_client_studio_integration_client_id_integration_client_id_fk" FOREIGN KEY ("integration_client_id") REFERENCES "public"."integration_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_client_studio" ADD CONSTRAINT "integration_client_studio_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_endpoint" ADD CONSTRAINT "integration_endpoint_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_integration_client_id_integration_client_id_fk" FOREIGN KEY ("integration_client_id") REFERENCES "public"."integration_client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_mapping_version_id_mapping_version_id_fk" FOREIGN KEY ("mapping_version_id") REFERENCES "public"."mapping_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_pricing_version_id_studio_pricing_version_id_fk" FOREIGN KEY ("pricing_version_id") REFERENCES "public"."studio_pricing_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_endpoint_version_id_integration_endpoint_id_fk" FOREIGN KEY ("endpoint_version_id") REFERENCES "public"."integration_endpoint"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_asset" ADD CONSTRAINT "recording_asset_call_instance_id_call_instance_id_fk" FOREIGN KEY ("call_instance_id") REFERENCES "public"."call_instance"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_binding" ADD CONSTRAINT "script_binding_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_binding" ADD CONSTRAINT "script_binding_user_phone_id_baiying_phone_line_user_phone_id_fk" FOREIGN KEY ("user_phone_id") REFERENCES "public"."baiying_phone_line"("user_phone_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_binding_identity_uq" ON "script_binding" USING btree ("id","studio_id","source_system");--> statement-breakpoint
ALTER TABLE "script_category_binding" ADD CONSTRAINT "script_category_binding_script_binding_id_script_binding_id_fk" FOREIGN KEY ("script_binding_id") REFERENCES "public"."script_binding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_category_binding" ADD CONSTRAINT "script_category_binding_identity_fk" FOREIGN KEY ("script_binding_id","studio_id","source_system") REFERENCES "public"."script_binding"("id","studio_id","source_system") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_category_binding" ADD CONSTRAINT "script_category_binding_source_category_fk" FOREIGN KEY ("source_system","source_category_id") REFERENCES "public"."source_data_category"("source_system","external_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_account" ADD CONSTRAINT "studio_account_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio_pricing_version" ADD CONSTRAINT "studio_pricing_version_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_call_item" ADD CONSTRAINT "task_call_item_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_operation" ADD CONSTRAINT "task_operation_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_ledger_business_key_uq" ON "account_ledger" USING btree ("business_key");--> statement-breakpoint
CREATE INDEX "account_ledger_studio_time_idx" ON "account_ledger" USING btree ("studio_id","occurred_at");--> statement-breakpoint
CREATE INDEX "account_ledger_task_idx" ON "account_ledger" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "call_instance_provider_uq" ON "call_instance" USING btree ("company_id","call_instance_id");--> statement-breakpoint
CREATE INDEX "call_instance_task_idx" ON "call_instance" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "callback_inbox_event_key_uq" ON "callback_inbox" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "callback_inbox_pending_idx" ON "callback_inbox" USING btree ("process_status","received_at");--> statement-breakpoint
CREATE INDEX "callback_inbox_body_sha_idx" ON "callback_inbox" USING btree ("raw_body_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "dead_letter_source_uq" ON "dead_letter_event" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "dead_letter_status_idx" ON "dead_letter_event" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempt_number_uq" ON "delivery_attempt" USING btree ("delivery_event_id","attempt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_event_event_id_uq" ON "delivery_event" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_event_event_key_uq" ON "delivery_event" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "delivery_event_pending_idx" ON "delivery_event" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fund_hold_task_uq" ON "fund_hold" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "fund_hold_studio_status_idx" ON "fund_hold" USING btree ("studio_id","status");--> statement-breakpoint
CREATE INDEX "integration_client_studio_studio_idx" ON "integration_client_studio" USING btree ("studio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_client_client_id_uq" ON "integration_client" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_endpoint_version_uq" ON "integration_endpoint" USING btree ("studio_id","source_system","version");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_endpoint_active_uq" ON "integration_endpoint" USING btree ("studio_id","source_system") WHERE "integration_endpoint"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "platform_task_task_no_uq" ON "platform_task" USING btree ("task_no");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_task_external_request_uq" ON "platform_task" USING btree ("integration_client_id","external_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_task_baiying_job_uq" ON "platform_task" USING btree ("baiying_company_id","baiying_call_job_id") WHERE "platform_task"."baiying_call_job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "platform_task_list_idx" ON "platform_task" USING btree ("studio_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_task_status_idx" ON "platform_task" USING btree ("execution_status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recording_asset_call_kind_uq" ON "recording_asset" USING btree ("call_instance_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "recording_asset_object_key_uq" ON "recording_asset" USING btree ("oss_bucket","oss_object_key") WHERE "recording_asset"."oss_object_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "recording_asset_archive_idx" ON "recording_asset" USING btree ("archive_status","discovered_at");--> statement-breakpoint
CREATE UNIQUE INDEX "script_binding_version_uq" ON "script_binding" USING btree ("robot_def_id","studio_id","source_system","version");--> statement-breakpoint
CREATE UNIQUE INDEX "script_binding_active_uq" ON "script_binding" USING btree ("robot_def_id","studio_id","source_system") WHERE "script_binding"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "script_category_binding_active_uq" ON "script_category_binding" USING btree ("studio_id","source_system","source_category_id") WHERE "script_category_binding"."active" = true;--> statement-breakpoint
CREATE INDEX "script_category_binding_script_idx" ON "script_category_binding" USING btree ("script_binding_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_pricing_version_uq" ON "studio_pricing_version" USING btree ("studio_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_pricing_active_uq" ON "studio_pricing_version" USING btree ("studio_id") WHERE "studio_pricing_version"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "studio_business_code_uq" ON "studio" USING btree ("business_code");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_mc_code_uq" ON "studio" USING btree ("mc_code");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_pricing_tier_code_uq" ON "supplier_pricing_tier" USING btree ("tier_code");--> statement-breakpoint
CREATE UNIQUE INDEX "task_call_item_ordinal_uq" ON "task_call_item" USING btree ("task_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "task_call_item_customer_uq" ON "task_call_item" USING btree ("task_id","external_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_call_item_phone_uq" ON "task_call_item" USING btree ("task_id","phone_hmac");--> statement-breakpoint
CREATE INDEX "task_call_item_status_idx" ON "task_call_item" USING btree ("task_id","call_status");--> statement-breakpoint
CREATE UNIQUE INDEX "task_operation_attempt_uq" ON "task_operation" USING btree ("task_id","operation_type","attempt_no");--> statement-breakpoint
CREATE INDEX "task_operation_status_idx" ON "task_operation" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "idempotency_task_idx" ON "idempotency_record" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "queue_outbox_lock_idx" ON "queue_outbox" USING btree ("locked_at","locked_by");--> statement-breakpoint
CREATE INDEX "queue_outbox_pending_idx" ON "queue_outbox" USING btree ("published_at","dead_lettered_at","available_at","created_at");
