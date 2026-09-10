ALTER TABLE "integration_client" ADD COLUMN "access_token" varchar(128);--> statement-breakpoint
UPDATE "integration_client"
SET "access_token" = lower("source_system") || '_' || md5("id"::text || clock_timestamp()::text || random()::text)
WHERE "access_token" IS NULL;--> statement-breakpoint
ALTER TABLE "integration_client" ALTER COLUMN "access_token" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_client_access_token_uq" ON "integration_client" USING btree ("access_token");--> statement-breakpoint
INSERT INTO "integration_client_studio" ("integration_client_id", "studio_id", "created_at")
SELECT "integration_client"."id", "studio"."id", now()
FROM "integration_client"
CROSS JOIN "studio"
WHERE "integration_client"."status" = 'ACTIVE'
ON CONFLICT DO NOTHING;
