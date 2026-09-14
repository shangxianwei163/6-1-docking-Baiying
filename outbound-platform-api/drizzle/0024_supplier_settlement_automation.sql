CREATE TABLE "supplier_settlement_close_cycle" (
	"settlement_month" date PRIMARY KEY NOT NULL,
	"status" varchar(32) NOT NULL,
	"preclose_source_hash" char(64),
	"preclosed_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"finalized_settlement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_close_cycle_status_ck" CHECK ("supplier_settlement_close_cycle"."status" IN ('PRE_CLOSING', 'RECONCILING', 'BLOCKED', 'FINALIZED')),
	CONSTRAINT "supplier_close_cycle_month_ck" CHECK (extract(day from "supplier_settlement_close_cycle"."settlement_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "supplier_settlement_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"source_hash" char(64) NOT NULL,
	"status" varchar(32) DEFAULT 'OPEN' NOT NULL,
	"task_count_delta" integer NOT NULL,
	"billing_minutes_delta" bigint NOT NULL,
	"customer_charge_delta" numeric(18, 6) NOT NULL,
	"platform_cost_delta" numeric(18, 6) NOT NULL,
	"profit_delta" numeric(18, 6) NOT NULL,
	"detail_json" jsonb NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_settlement_adjustment_status_ck" CHECK ("supplier_settlement_adjustment"."status" IN ('OPEN', 'ACKNOWLEDGED'))
);
--> statement-breakpoint
ALTER TABLE "supplier_settlement_close_cycle" ADD CONSTRAINT "supplier_settlement_close_cycle_finalized_settlement_id_supplier_monthly_settlement_id_fk" FOREIGN KEY ("finalized_settlement_id") REFERENCES "public"."supplier_monthly_settlement"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "supplier_settlement_adjustment" ADD CONSTRAINT "supplier_settlement_adjustment_settlement_id_supplier_monthly_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."supplier_monthly_settlement"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_close_cycle_settlement_uq" ON "supplier_settlement_close_cycle" USING btree ("finalized_settlement_id") WHERE "supplier_settlement_close_cycle"."finalized_settlement_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_settlement_adjustment_source_uq" ON "supplier_settlement_adjustment" USING btree ("settlement_id", "source_hash");
--> statement-breakpoint
CREATE INDEX "supplier_settlement_adjustment_status_idx" ON "supplier_settlement_adjustment" USING btree ("status", "detected_at");
