-- Development/test rollback only. Do not run after a real supplier settlement.
DROP TABLE IF EXISTS "supplier_settlement_task_item";
ALTER TABLE "platform_task" DROP COLUMN IF EXISTS "supplier_settlement_id";
DROP TABLE IF EXISTS "supplier_monthly_settlement";
