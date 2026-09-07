WITH duplicate_future AS (
  SELECT
    future.id AS future_id,
    current.id AS current_id,
    future.effective_to AS next_effective_to
  FROM supplier_pricing_tier AS future
  INNER JOIN supplier_pricing_tier AS current
    ON current.tier_code = future.tier_code
   AND current.effective_to = future.effective_from
  WHERE future.effective_from > now()
    AND current.name = future.name
    AND current.min_monthly_minutes = future.min_monthly_minutes
    AND current.max_monthly_minutes IS NOT DISTINCT FROM future.max_monthly_minutes
    AND current.voice_rate = future.voice_rate
    AND current.sms_rate = future.sms_rate
), reopened AS (
  UPDATE supplier_pricing_tier AS current
  SET effective_to = duplicate_future.next_effective_to
  FROM duplicate_future
  WHERE current.id = duplicate_future.current_id
  RETURNING duplicate_future.future_id
)
DELETE FROM supplier_pricing_tier
WHERE id IN (SELECT future_id FROM reopened);
