CREATE TYPE "public"."account_adjustment_kind" AS ENUM('REFUND', 'ADJUSTMENT_CREDIT', 'ADJUSTMENT_DEBIT');--> statement-breakpoint
CREATE TYPE "public"."account_adjustment_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "account_adjustment_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_no" varchar(64) NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"studio_id" uuid NOT NULL,
	"kind" "account_adjustment_kind" NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"balance_snapshot" numeric(18, 6) NOT NULL,
	"available_balance_snapshot" numeric(18, 6) NOT NULL,
	"reason" text NOT NULL,
	"supporting_reference" varchar(256),
	"status" "account_adjustment_status" DEFAULT 'PENDING' NOT NULL,
	"requested_by" varchar(128) NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" varchar(128),
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"ledger_id" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "account_adjustment_amount_ck" CHECK ("account_adjustment_request"."amount" > 0),
	CONSTRAINT "account_adjustment_separation_ck" CHECK ("account_adjustment_request"."reviewed_by" IS NULL OR "account_adjustment_request"."reviewed_by" <> "account_adjustment_request"."requested_by"),
	CONSTRAINT "account_adjustment_state_ck" CHECK ((
        ("account_adjustment_request"."status" = 'PENDING' AND "account_adjustment_request"."reviewed_by" IS NULL AND "account_adjustment_request"."review_note" IS NULL AND "account_adjustment_request"."reviewed_at" IS NULL AND "account_adjustment_request"."ledger_id" IS NULL)
        OR
        ("account_adjustment_request"."status" = 'APPROVED' AND "account_adjustment_request"."reviewed_by" IS NOT NULL AND "account_adjustment_request"."review_note" IS NOT NULL AND "account_adjustment_request"."reviewed_at" IS NOT NULL AND "account_adjustment_request"."ledger_id" IS NOT NULL)
        OR
        ("account_adjustment_request"."status" = 'REJECTED' AND "account_adjustment_request"."reviewed_by" IS NOT NULL AND "account_adjustment_request"."review_note" IS NOT NULL AND "account_adjustment_request"."reviewed_at" IS NOT NULL AND "account_adjustment_request"."ledger_id" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "account_adjustment_request" ADD CONSTRAINT "account_adjustment_request_studio_id_studio_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_adjustment_request" ADD CONSTRAINT "account_adjustment_request_ledger_id_account_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."account_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_adjustment_request_no_uq" ON "account_adjustment_request" USING btree ("request_no");--> statement-breakpoint
CREATE UNIQUE INDEX "account_adjustment_idempotency_uq" ON "account_adjustment_request" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "account_adjustment_ledger_uq" ON "account_adjustment_request" USING btree ("ledger_id");--> statement-breakpoint
CREATE INDEX "account_adjustment_status_time_idx" ON "account_adjustment_request" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "account_adjustment_studio_time_idx" ON "account_adjustment_request" USING btree ("studio_id","requested_at");
