DROP INDEX "callback_inbox_pending_idx";--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "process_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "locked_by" varchar(128);--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "callback_inbox_lock_idx" ON "callback_inbox" USING btree ("locked_at","locked_by");--> statement-breakpoint
CREATE INDEX "callback_inbox_pending_idx" ON "callback_inbox" USING btree ("process_status","dead_lettered_at","available_at","received_at");--> statement-breakpoint
ALTER TABLE "callback_inbox" ADD CONSTRAINT "callback_inbox_attempts_ck" CHECK ("callback_inbox"."process_attempts" >= 0);
