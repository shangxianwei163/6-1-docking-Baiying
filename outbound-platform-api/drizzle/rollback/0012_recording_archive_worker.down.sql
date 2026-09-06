DROP INDEX IF EXISTS recording_asset_lock_idx;
DROP INDEX IF EXISTS recording_asset_archive_idx;
ALTER TABLE recording_asset
  DROP COLUMN IF EXISTS retention_until,
  DROP COLUMN IF EXISTS dead_lettered_at,
  DROP COLUMN IF EXISTS locked_by,
  DROP COLUMN IF EXISTS locked_at,
  DROP COLUMN IF EXISTS available_at;
CREATE INDEX recording_asset_archive_idx
  ON recording_asset (archive_status, discovered_at);
