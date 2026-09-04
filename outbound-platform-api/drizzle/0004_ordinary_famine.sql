CREATE TABLE "baiying_line_studio_binding" (
	"user_phone_id" varchar(128) NOT NULL,
	"studio_id" varchar(128) NOT NULL,
	"studio_name" varchar(200) NOT NULL,
	"updated_by" varchar(128) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baiying_line_studio_binding_user_phone_id_studio_id_pk" PRIMARY KEY("user_phone_id","studio_id")
);
--> statement-breakpoint
CREATE INDEX "line_studio_binding_line_idx" ON "baiying_line_studio_binding" USING btree ("user_phone_id");