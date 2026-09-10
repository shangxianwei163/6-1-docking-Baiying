DROP INDEX IF EXISTS "task_call_item_result_event_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "task_call_item_batch_phone_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "task_call_item_batch_customer_uq";--> statement-breakpoint
ALTER TABLE "task_call_item" DROP CONSTRAINT IF EXISTS "task_call_item_batch_id_intake_batch_id_fk";--> statement-breakpoint
ALTER TABLE "task_call_item" DROP COLUMN IF EXISTS "result_event_id";--> statement-breakpoint
ALTER TABLE "task_call_item" DROP COLUMN IF EXISTS "category_snapshot_json";--> statement-breakpoint
ALTER TABLE "task_call_item" DROP COLUMN IF EXISTS "batch_id";--> statement-breakpoint
DROP INDEX IF EXISTS "platform_task_batch_route_uq";--> statement-breakpoint
ALTER TABLE "platform_task" DROP CONSTRAINT IF EXISTS "platform_task_batch_id_intake_batch_id_fk";--> statement-breakpoint
ALTER TABLE "platform_task" DROP COLUMN IF EXISTS "contract_version";--> statement-breakpoint
ALTER TABLE "platform_task" DROP COLUMN IF EXISTS "route_key";--> statement-breakpoint
ALTER TABLE "platform_task" DROP COLUMN IF EXISTS "batch_id";--> statement-breakpoint
ALTER TABLE "call_instance" DROP COLUMN IF EXISTS "match_method";--> statement-breakpoint
ALTER TABLE "call_instance" DROP COLUMN IF EXISTS "result_complete";--> statement-breakpoint
ALTER TABLE "call_instance" DROP COLUMN IF EXISTS "task_results_json";--> statement-breakpoint
DROP TABLE IF EXISTS "intake_batch";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."callback_match_method";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."intake_batch_status";

-- PostgreSQL enum values cannot be removed safely while dependent columns are in use.
-- The additive OMIT value is intentionally retained; old application versions ignore it.
