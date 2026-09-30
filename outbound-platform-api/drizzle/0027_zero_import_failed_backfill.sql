-- Correct v2 tasks whose every customer was filtered before Baiying import.
-- Existing customer result events and delivery state are retained.
UPDATE "platform_task" AS task
SET "execution_status" = 'IMPORT_FAILED',
    "failure_stage" = 'BAIYING_IMPORT',
    "failure_code" = 'NO_IMPORTABLE_CUSTOMERS',
    "failure_message" = '该任务的号码全部因参数或映射异常被过滤，成功导入 0 个号码，任务执行失败；每个号码的失败结果将正常回传',
    "failure_retryable" = false,
    "provider_completed_at" = NULL,
    "reconciled_at" = NULL,
    "updated_at" = now(),
    "lock_version" = "lock_version" + 1
WHERE task."contract_version" = '2.0'
  AND task."execution_status" = 'COMPLETED'
  AND task."phone_count" > 0
  AND task."import_requested_count" = 0
  AND task."import_succeeded_count" = 0
  AND task."import_failed_count" = task."phone_count"
  AND task."call_instance_count" = 0
  AND task."baiying_call_job_id" IS NULL
  AND task."billing_status" = 'SETTLED'
  AND EXISTS (
    SELECT 1 FROM "task_call_item" AS item
    WHERE item."task_id" = task."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "task_call_item" AS item
    WHERE item."task_id" = task."id"
      AND (
        item."import_status" <> 'FAILED'
        OR item."call_status" <> 'FAILED'
        OR item."result_event_id" IS NULL
      )
  );
--> statement-breakpoint
UPDATE "intake_batch" AS batch
SET "execution_status" = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM "platform_task" AS task
        WHERE task."batch_id" = batch."id"
          AND task."execution_status" NOT IN ('CREATE_FAILED', 'IMPORT_FAILED', 'START_FAILED')
      ) THEN 'FAILED'::"intake_batch_status"
      ELSE 'PARTIAL_FAILED'::"intake_batch_status"
    END,
    "failure_code" = COALESCE(batch."failure_code", 'NO_IMPORTABLE_CUSTOMERS'),
    "failure_message" = COALESCE(
      batch."failure_message",
      '至少一个子任务成功导入 0 个号码，已标记执行失败；号码结果按原事件回传'
    ),
    "updated_at" = now()
WHERE batch."execution_status" IN ('COMPLETED', 'PARTIAL_FAILED', 'FAILED')
  AND EXISTS (
    SELECT 1 FROM "platform_task" AS task
    WHERE task."batch_id" = batch."id"
      AND task."failure_code" = 'NO_IMPORTABLE_CUSTOMERS'
      AND task."execution_status" = 'IMPORT_FAILED'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "platform_task" AS task
    WHERE task."batch_id" = batch."id"
      AND task."execution_status" NOT IN (
        'COMPLETED', 'CREATE_FAILED', 'IMPORT_FAILED', 'START_FAILED',
        'CANCELLED', 'TERMINATED'
      )
  );
