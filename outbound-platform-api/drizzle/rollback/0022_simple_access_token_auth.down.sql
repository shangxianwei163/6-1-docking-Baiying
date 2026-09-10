DROP INDEX IF EXISTS "integration_client_access_token_uq";
ALTER TABLE "integration_client" DROP COLUMN IF EXISTS "access_token";
