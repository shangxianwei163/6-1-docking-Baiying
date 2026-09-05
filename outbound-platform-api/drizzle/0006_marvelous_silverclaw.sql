ALTER TABLE "source_data_category" ADD COLUMN "name" varchar(500) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_data_category" ADD COLUMN "level" integer;--> statement-breakpoint
ALTER TABLE "source_data_category" ADD COLUMN "parent_id" varchar(256);--> statement-breakpoint
ALTER TABLE "source_data_category" ADD COLUMN "fields_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "source_data_category"
SET "name" = "category_path",
    "level" = array_length(string_to_array("category_path", '-'), 1);
