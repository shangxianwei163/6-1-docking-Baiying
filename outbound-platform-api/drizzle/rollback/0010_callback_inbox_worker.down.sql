DROP INDEX IF EXISTS "callback_inbox_lock_idx";
DROP INDEX IF EXISTS "callback_inbox_pending_idx";

ALTER TABLE "callback_inbox"
  DROP CONSTRAINT IF EXISTS "callback_inbox_attempts_ck",
  DROP COLUMN IF EXISTS "dead_lettered_at",
  DROP COLUMN IF EXISTS "locked_by",
  DROP COLUMN IF EXISTS "locked_at",
  DROP COLUMN IF EXISTS "available_at",
  DROP COLUMN IF EXISTS "process_attempts";

CREATE INDEX "callback_inbox_pending_idx"
  ON "callback_inbox" USING btree ("process_status", "received_at");
