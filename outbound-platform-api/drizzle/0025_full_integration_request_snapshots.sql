ALTER TABLE "idempotency_record" ADD COLUMN "request_body_ciphertext" text;
--> statement-breakpoint
ALTER TABLE "task_operation" ADD COLUMN "request_payload_ciphertext" text;
