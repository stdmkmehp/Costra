-- 90-anomaly.sql · 轻量异常信号（高频用户/账本）
-- 阈值：单用户 >50 条 / 单账本 >100 条（后续根据实际数据调整）
-- 参数: :window_start, :window_end

WITH per_user AS (
  SELECT created_by, count(*) c
  FROM entries
  WHERE deleted_at IS NULL
    AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  GROUP BY created_by
),
per_ledger AS (
  SELECT ledger_id, count(*) c
  FROM entries
  WHERE deleted_at IS NULL
    AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  GROUP BY ledger_id
)
SELECT
  'high_entry_user'   AS kind,
  u.nickname          AS ref,
  pu.c                AS metric
FROM per_user pu
JOIN users u ON u.id = pu.created_by
WHERE pu.c > 50

UNION ALL

SELECT
  'high_entry_ledger' AS kind,
  l.name              AS ref,
  pl.c                AS metric
FROM per_ledger pl
JOIN ledgers l ON l.id = pl.ledger_id
WHERE pl.c > 100

ORDER BY metric DESC;
