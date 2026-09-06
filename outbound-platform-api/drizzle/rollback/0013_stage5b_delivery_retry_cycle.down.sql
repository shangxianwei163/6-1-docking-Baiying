ALTER TABLE "delivery_event"
  DROP CONSTRAINT IF EXISTS "delivery_event_attempts_ck";

ALTER TABLE "delivery_event"
  DROP COLUMN IF EXISTS "retry_cycle_attempt_count";
