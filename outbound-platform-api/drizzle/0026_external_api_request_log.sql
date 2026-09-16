CREATE TABLE "external_api_request_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"source_system" varchar(32) DEFAULT 'UNKNOWN' NOT NULL,
	"operation_code" varchar(256) NOT NULL,
	"endpoint_label" varchar(300) NOT NULL,
	"method" varchar(16) NOT NULL,
	"path" varchar(1000) NOT NULL,
	"query_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"client_id" varchar(128),
	"idempotency_key" varchar(128),
	"request_headers_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_body_sha256" char(64),
	"request_body_ciphertext" text,
	"response_status" integer,
	"response_body_ciphertext" text,
	"response_summary_json" jsonb,
	"task_no" varchar(32),
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"error_code" varchar(256),
	"error_message" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "external_api_request_source_ck" CHECK ("external_api_request_log"."source_system" IN ('ERP', 'CRM', 'BAIYING', 'UNKNOWN')),
	CONSTRAINT "external_api_request_status_ck" CHECK ("external_api_request_log"."status" IN ('PENDING', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
	CONSTRAINT "external_api_request_response_status_ck" CHECK ("external_api_request_log"."response_status" IS NULL OR "external_api_request_log"."response_status" BETWEEN 100 AND 599),
	CONSTRAINT "external_api_request_duration_ck" CHECK ("external_api_request_log"."duration_ms" IS NULL OR "external_api_request_log"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX "external_api_request_started_idx" ON "external_api_request_log" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "external_api_request_status_idx" ON "external_api_request_log" USING btree ("status", "started_at");
--> statement-breakpoint
CREATE INDEX "external_api_request_request_id_idx" ON "external_api_request_log" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "external_api_request_idempotency_idx" ON "external_api_request_log" USING btree ("source_system", "client_id", "idempotency_key");
