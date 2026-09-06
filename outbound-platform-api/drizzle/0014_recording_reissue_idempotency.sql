CREATE TABLE "recording_url_issue" (
	"integration_client_id" uuid NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"idempotency_key_hash" char(64) NOT NULL,
	"request_fingerprint" char(64) NOT NULL,
	"recording_id" uuid NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"response_status" integer NOT NULL,
	"response_body_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recording_url_issue_integration_client_id_idempotency_key_hash_pk" PRIMARY KEY("integration_client_id","idempotency_key_hash"),
	CONSTRAINT "recording_url_issue_source_ck" CHECK ("recording_url_issue"."source_system" IN ('ERP', 'CRM')),
	CONSTRAINT "recording_url_issue_status_ck" CHECK ("recording_url_issue"."response_status" = 200),
	CONSTRAINT "recording_url_issue_expiry_ck" CHECK ("recording_url_issue"."expires_at" > "recording_url_issue"."created_at")
);
--> statement-breakpoint
ALTER TABLE "recording_url_issue" ADD CONSTRAINT "recording_url_issue_integration_client_id_integration_client_id_fk" FOREIGN KEY ("integration_client_id") REFERENCES "public"."integration_client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_url_issue" ADD CONSTRAINT "recording_url_issue_recording_id_recording_asset_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recording_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recording_url_issue_expiry_idx" ON "recording_url_issue" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "recording_url_issue_recording_idx" ON "recording_url_issue" USING btree ("recording_id");
