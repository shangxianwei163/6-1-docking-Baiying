CREATE TABLE "operational_metric_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_code" varchar(128) NOT NULL,
	"source_system" varchar(32),
	"request_id" varchar(128),
	"object_ref" varchar(512),
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "operational_metric_code_time_idx" ON "operational_metric_event" USING btree ("metric_code","occurred_at");
