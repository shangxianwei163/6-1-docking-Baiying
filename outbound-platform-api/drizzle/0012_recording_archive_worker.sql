DROP INDEX "recording_asset_archive_idx";--> statement-breakpoint
ALTER TABLE "recording_asset" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "recording_asset" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_asset" ADD COLUMN "locked_by" varchar(128);--> statement-breakpoint
ALTER TABLE "recording_asset" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_asset" ADD COLUMN "retention_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "recording_asset_lock_idx" ON "recording_asset" USING btree ("locked_at","locked_by");--> statement-breakpoint
CREATE INDEX "recording_asset_archive_idx" ON "recording_asset" USING btree ("archive_status","dead_lettered_at","available_at","discovered_at");