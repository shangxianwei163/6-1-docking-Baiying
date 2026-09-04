CREATE TABLE "baiying_robot_binding" (
	"robot_def_id" varchar(128) PRIMARY KEY NOT NULL,
	"source_system" varchar(32) NOT NULL,
	"source_category_id" varchar(256) NOT NULL,
	"category_path" varchar(500) NOT NULL,
	"studio_id" varchar(128) NOT NULL,
	"studio_name" varchar(200) NOT NULL,
	"line_id" varchar(128) NOT NULL,
	"line_name" varchar(200) NOT NULL,
	"updated_by" varchar(128) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
