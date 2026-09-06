-- Development/test rollback only. Do not run after real financial approvals exist.
DROP TABLE IF EXISTS account_adjustment_request;
DROP TYPE IF EXISTS account_adjustment_status;
DROP TYPE IF EXISTS account_adjustment_kind;
