-- Phase 1 pre-production rollback only.
-- Do not run after accepting real tasks or posting ledger entries. Production
-- rollback switches feature flags/read paths and preserves all Phase 1 data.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM idempotency_record
    GROUP BY source_system, idempotency_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot restore the legacy idempotency primary key: duplicate source/key pairs exist';
  END IF;
END
$$;

DROP TABLE account_ledger;
DROP TABLE recording_asset;
DROP TABLE delivery_attempt;
DROP TABLE delivery_event;
DROP TABLE call_instance;
DROP TABLE fund_hold;
DROP TABLE task_operation;
DROP TABLE task_call_item;
DROP TABLE platform_task;
DROP TABLE script_category_binding;
DROP TABLE script_binding;
DROP TABLE integration_client_studio;
DROP TABLE studio_account;
DROP TABLE studio_pricing_version;
DROP TABLE integration_endpoint;
DROP TABLE integration_client;
DROP TABLE callback_inbox;
DROP TABLE dead_letter_event;
DROP TABLE supplier_pricing_tier;
DROP TABLE studio;

DROP INDEX idempotency_task_idx;
ALTER TABLE idempotency_record
  DROP CONSTRAINT idempotency_record_source_system_client_id_idempotency_key_pk;
ALTER TABLE idempotency_record
  DROP COLUMN client_id,
  DROP COLUMN request_body_sha256,
  DROP COLUMN task_id,
  DROP COLUMN processing_status,
  DROP COLUMN updated_at;
ALTER TABLE idempotency_record
  ADD CONSTRAINT idempotency_record_source_system_idempotency_key_pk
  PRIMARY KEY (source_system, idempotency_key);

DROP INDEX queue_outbox_lock_idx;
DROP INDEX queue_outbox_pending_idx;
ALTER TABLE queue_outbox
  DROP COLUMN available_at,
  DROP COLUMN locked_at,
  DROP COLUMN locked_by,
  DROP COLUMN last_error,
  DROP COLUMN dead_lettered_at;
CREATE INDEX queue_outbox_pending_idx
  ON queue_outbox USING btree (published_at, created_at);

DROP TYPE account_ledger_entry_type;
DROP TYPE billing_status;
DROP TYPE callback_parse_status;
DROP TYPE callback_process_status;
DROP TYPE dead_letter_source_type;
DROP TYPE dead_letter_status;
DROP TYPE delivery_attempt_status;
DROP TYPE delivery_status;
DROP TYPE delivery_target;
DROP TYPE fund_hold_status;
DROP TYPE idempotency_processing_status;
DROP TYPE integration_client_status;
DROP TYPE integration_endpoint_status;
DROP TYPE normalized_call_status;
DROP TYPE pricing_source_mode;
DROP TYPE pricing_status;
DROP TYPE recording_archive_status;
DROP TYPE recording_delivery_status;
DROP TYPE recording_kind;
DROP TYPE result_delivery_status;
DROP TYPE script_binding_status;
DROP TYPE studio_account_status;
DROP TYPE studio_status;
DROP TYPE task_execution_status;
DROP TYPE task_import_status;
DROP TYPE task_operation_status;
DROP TYPE task_operation_type;

DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = 1788629412323;

COMMIT;
