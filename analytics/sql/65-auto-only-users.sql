-- 65-auto-only-users.sql · 仅自动记账预警
-- 找出连续一段时间（7/14/30天）只有自动记账、没有手动记账的用户
-- 参数: :window_end

WITH periods AS (
  SELECT
    :'window_end'::timestamptz - interval '7 days'AS start_7d,
    :'window_end'::timestamptz - interval '14 days' AS start_14d,
    :'window_end'::timestamptz - interval '30 days' AS start_30d,
    :'window_end'::timestamptz AS end_ts
),
-- 有自动记账的用户（各周期）
auto_users_7d AS (
  SELECT DISTINCT e.created_by AS user_id
  FROM entries e, periods p
  WHERE e.deleted_at IS NULL
    AND e.source_recurring_id IS NOT NULL
    AND e.created_at >= p.start_7d AND e.created_at < p.end_ts
),
auto_users_14d AS (
  SELECT DISTINCT e.created_by AS user_id
  FROM entries e, periods p
  WHERE e.deleted_at IS NULL
    AND e.source_recurring_id IS NOT NULL
    AND e.created_at >= p.start_14d AND e.created_at < p.end_ts
),
auto_users_30d AS (
  SELECT DISTINCT e.created_by AS user_id
  FROM entries e, periods p
  WHERE e.deleted_at IS NULL
    AND e.source_recurring_id IS NOT NULL
    AND e.created_at >= p.start_30d AND e.created_at < p.end_ts
),
-- 有手动记账的用户（各周期）
manual_users_7d AS (
  SELECT DISTINCT e.created_by AS user_id
  FROM entries e, periods p
  WHERE e.deleted_at IS NULL
    AND e.source_recurring_id IS NULL
    AND e.created_at >= p.start_7d AND e.created_at < p.end_ts
),
manual_users_14d AS (
  SELECT DISTINCT e.created_by AS user_id
  FROM entries e, periods p
  WHERE e.deleted_at IS NULL
    AND e.source_recurring_id IS NULL
    AND e.created_at >= p.start_14d AND e.created_at < p.end_ts
),
manual_users_30d AS (
  SELECT DISTINCT e.created_by AS user_id
  FROM entries e, periods p
  WHERE e.deleted_at IS NULL
    AND e.source_recurring_id IS NULL
    AND e.created_at >= p.start_30d AND e.created_at < p.end_ts
)
-- 7天仅自动
SELECT
  u.nickname,
  '7d' AS period,
  (SELECT count(*) FROM entries e, periods p
   WHERE e.created_by = u.id AND e.deleted_at IS NULL
     AND e.source_recurring_id IS NOT NULL
     AND e.created_at >= p.start_7d AND e.created_at < p.end_ts
  ) AS auto_entries
FROM auto_users_7d a
JOIN users u ON u.id = a.user_id
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM manual_users_7d m WHERE m.user_id = a.user_id)

UNION ALL

-- 14天仅自动（但7天内有手动的不算，已在7d报出）
SELECT
  u.nickname,
  '14d' AS period,
  (SELECT count(*) FROM entries e, periods p
   WHERE e.created_by = u.id AND e.deleted_at IS NULL
     AND e.source_recurring_id IS NOT NULL
     AND e.created_at >= p.start_14d AND e.created_at < p.end_ts
  ) AS auto_entries
FROM auto_users_14d a
JOIN users u ON u.id = a.user_id
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM manual_users_14d m WHERE m.user_id = a.user_id)
  AND EXISTS (SELECT 1 FROM manual_users_7d m WHERE m.user_id = a.user_id)  -- 7天内有手动，不重复

UNION ALL

-- 30天仅自动（排除已在7d/14d报过的）
SELECT
  u.nickname,
  '30d' AS period,
  (SELECT count(*) FROM entries e, periods p
   WHERE e.created_by = u.id AND e.deleted_at IS NULL
     AND e.source_recurring_id IS NOT NULL
     AND e.created_at >= p.start_30d AND e.created_at < p.end_ts
  ) AS auto_entries
FROM auto_users_30d a
JOIN users u ON u.id = a.user_id
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM manual_users_30d m WHERE m.user_id = a.user_id)
  AND EXISTS (SELECT 1 FROM manual_users_14d m WHERE m.user_id = a.user_id)  -- 14天内有手动

ORDER BY period, auto_entries DESC;
