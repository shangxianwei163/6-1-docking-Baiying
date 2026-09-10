INSERT INTO "integration_client" (
	"client_id",
	"source_system",
	"display_name",
	"access_token",
	"secret_ref",
	"status",
	"rate_limit_per_minute",
	"created_by",
	"created_at",
	"updated_at"
)
SELECT
	'erp-auto-' || left(gen_random_uuid()::text, 8),
	'ERP',
	'ERP 接口客户端',
	'erp_' || replace(gen_random_uuid()::text, '-', ''),
	'fixed-token://erp',
	'ACTIVE',
	60,
	'MIGRATION_0023',
	now(),
	now()
WHERE NOT EXISTS (
	SELECT 1
	FROM "integration_client"
	WHERE "source_system" = 'ERP' AND "status" = 'ACTIVE'
);--> statement-breakpoint
INSERT INTO "integration_client" (
	"client_id",
	"source_system",
	"display_name",
	"access_token",
	"secret_ref",
	"status",
	"rate_limit_per_minute",
	"created_by",
	"created_at",
	"updated_at"
)
SELECT
	'crm-auto-' || left(gen_random_uuid()::text, 8),
	'CRM',
	'CRM 接口客户端',
	'crm_' || replace(gen_random_uuid()::text, '-', ''),
	'fixed-token://crm',
	'ACTIVE',
	60,
	'MIGRATION_0023',
	now(),
	now()
WHERE NOT EXISTS (
	SELECT 1
	FROM "integration_client"
	WHERE "source_system" = 'CRM' AND "status" = 'ACTIVE'
);--> statement-breakpoint
INSERT INTO "integration_client_studio" (
	"integration_client_id",
	"studio_id",
	"created_at"
)
SELECT "integration_client"."id", "studio"."id", now()
FROM "integration_client"
CROSS JOIN "studio"
WHERE "integration_client"."status" = 'ACTIVE'
ON CONFLICT DO NOTHING;
