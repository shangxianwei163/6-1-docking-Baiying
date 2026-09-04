CREATE TABLE "baiying_phone_line" (
	"user_phone_id" varchar(128) PRIMARY KEY NOT NULL,
	"phone" varchar(200) NOT NULL,
	"phone_name" varchar(200) DEFAULT '' NOT NULL,
	"phone_type" integer NOT NULL,
	"scene_type" integer NOT NULL,
	"rate_type" integer NOT NULL,
	"local_selling_rate" double precision NOT NULL,
	"nonlocal_selling_rate" double precision NOT NULL,
	"line_amount" double precision NOT NULL,
	"bill_period" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
