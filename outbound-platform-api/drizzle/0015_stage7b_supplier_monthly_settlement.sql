CREATE TABLE "supplier_monthly_settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_month" date NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"supplier_pricing_tier_id" uuid NOT NULL,
	"tier_code_snapshot" varchar(64) NOT NULL,
	"tier_name_snapshot" varchar(200) NOT NULL,
	"min_monthly_minutes_snapshot" bigint NOT NULL,
	"max_monthly_minutes_snapshot" bigint,
	"voice_rate" numeric(18, 6) NOT NULL,
	"task_count" integer NOT NULL,
	"total_billing_minutes" bigint NOT NULL,
	"total_customer_charge" numeric(18, 6) NOT NULL,
	"total_platform_cost" numeric(18, 6) NOT NULL,
	"total_profit" numeric(18, 6) NOT NULL,
	"source_hash" char(64) NOT NULL,
	"finalization_idempotency_key" uuid NOT NULL,
	"finalization_reason" text NOT NULL,
	"finalized_by" varchar(128) NOT NULL,
	"finalized_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_monthly_settlement_month_ck" CHECK (extract(day from "supplier_monthly_settlement"."settlement_month") = 1),
	CONSTRAINT "supplier_monthly_settlement_timezone_ck" CHECK ("supplier_monthly_settlement"."timezone" = 'Asia/Shanghai'),
	CONSTRAINT "supplier_monthly_settlement_counts_ck" CHECK ("supplier_monthly_settlement"."task_count" >= 0 AND "supplier_monthly_settlement"."total_billing_minutes" >= 0),
	CONSTRAINT "supplier_monthly_settlement_money_ck" CHECK ("supplier_monthly_settlement"."voice_rate" >= 0 AND "supplier_monthly_settlement"."total_customer_charge" >= 0 AND "supplier_monthly_settlement"."total_platform_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_settlement_task_item" (
	"settlement_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_no" varchar(64) NOT NULL,
	"billing_minutes" integer NOT NULL,
	"customer_charge" numeric(18, 6) NOT NULL,
	"platform_rate" numeric(18, 6) NOT NULL,
	"platform_cost" numeric(18, 6) NOT NULL,
	"profit" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_settlement_task_item_settlement_id_task_id_pk" PRIMARY KEY("settlement_id","task_id"),
	CONSTRAINT "supplier_settlement_task_item_values_ck" CHECK ("supplier_settlement_task_item"."billing_minutes" >= 0 AND "supplier_settlement_task_item"."customer_charge" >= 0 AND "supplier_settlement_task_item"."platform_rate" >= 0 AND "supplier_settlement_task_item"."platform_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "platform_task" ADD COLUMN "supplier_settlement_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_monthly_settlement" ADD CONSTRAINT "supplier_monthly_settlement_supplier_pricing_tier_id_supplier_pricing_tier_id_fk" FOREIGN KEY ("supplier_pricing_tier_id") REFERENCES "public"."supplier_pricing_tier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_settlement_task_item" ADD CONSTRAINT "supplier_settlement_task_item_settlement_id_supplier_monthly_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."supplier_monthly_settlement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_settlement_task_item" ADD CONSTRAINT "supplier_settlement_task_item_task_id_platform_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."platform_task"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_monthly_settlement_month_uq" ON "supplier_monthly_settlement" USING btree ("settlement_month");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_monthly_settlement_idempotency_uq" ON "supplier_monthly_settlement" USING btree ("finalization_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_settlement_task_item_task_uq" ON "supplier_settlement_task_item" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "supplier_settlement_task_item_task_no_idx" ON "supplier_settlement_task_item" USING btree ("task_no");--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_supplier_settlement_id_supplier_monthly_settlement_id_fk" FOREIGN KEY ("supplier_settlement_id") REFERENCES "public"."supplier_monthly_settlement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_task" ADD CONSTRAINT "platform_task_supplier_cost_ck" CHECK (("platform_task"."platform_rate" IS NULL AND "platform_task"."platform_cost" IS NULL AND "platform_task"."profit" IS NULL AND "platform_task"."supplier_settlement_id" IS NULL) OR ("platform_task"."platform_rate" IS NOT NULL AND "platform_task"."platform_cost" IS NOT NULL AND "platform_task"."profit" IS NOT NULL AND "platform_task"."platform_rate" >= 0 AND "platform_task"."platform_cost" >= 0));