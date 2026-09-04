CREATE TABLE "planned_task_category_binding" (
	"workflow_id" varchar(128) PRIMARY KEY NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"source_category_id" varchar(256) NOT NULL,
	"category_path" varchar(500) NOT NULL,
	"updated_by" varchar(128) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_data_category" (
	"source_system" varchar(32) NOT NULL,
	"external_id" varchar(256) NOT NULL,
	"category_path" varchar(500) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_data_category_source_system_external_id_pk" PRIMARY KEY("source_system","external_id")
);
--> statement-breakpoint
CREATE INDEX "source_category_active_idx" ON "source_data_category" USING btree ("source_system","active","category_path");