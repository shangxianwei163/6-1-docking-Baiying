ALTER TABLE "task_operation" DROP COLUMN IF EXISTS "request_payload_ciphertext";
ALTER TABLE "idempotency_record" DROP COLUMN IF EXISTS "request_body_ciphertext";
