-- Stage 2A pre-production rollback only.
-- Removing this table disables nonce replay protection for the external API.

BEGIN;

DROP TABLE api_request_nonce;

COMMIT;
