-- 60-active-users.sql · 活跃/低活跃用户（基于最近 7 天记账天数）
-- 活跃：7天内 ≥5 天有记账（手动或自动）
-- 低活跃：7天内 2~4 天有记账
-- 参数: :window_end（基于 anchor 往前推7 天）

WITH seven_days AS (
  SELECT :'window_end'::timestamptz - interval '7 days' AS start_ts,
         :'window_end'::timestamptz AS end_ts
),
user_daily AS (
  SELECT
    e.created_by AS user_id,
    (e.created_at AT TIME ZONE 'Asia/Shanghai')::date AS entry_date,
    count(*) FILTER (WHERE e.source_recurring_id IS NULL) AS manual_count,
    count(*) FILTER (WHERE e.source_recurring_id IS NOT NULL) AS auto_count,
    count(*) AS total_count
  FROM entries e, seven_days s
  WHERE e.deleted_at IS NULL
    AND e.created_at >= s.start_ts AND e.created_at < s.end_ts
  GROUP BY e.created_by, (e.created_at AT TIME ZONE 'Asia/Shanghai')::date
),
user_stats AS (
  SELECT
    ud.user_id,
    count(DISTINCT ud.entry_date) AS active_days,
    sum(ud.manual_count) AS manual_total,
    sum(ud.auto_count) AS auto_total,
    sum(ud.total_count) AS entries_total
  FROM user_daily ud
  GROUP BY ud.user_id
)
SELECT
  u.nickname,
  us.active_days,
  us.manual_total,
  us.auto_total,
  us.entries_total,
  CASE
    WHEN us.active_days >= 5 THEN 'active'
    WHEN us.active_days >= 2 THEN 'low_active'
    ELSE 'inactive'
  END AS activity_level,
  to_char(
    (SELECT max(e2.created_at) FROM entries e2 WHERE e2.created_by = u.id AND e2.deleted_at IS NULL)
    AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI'
  ) AS last_entry_at_cst
FROM user_stats us
JOIN users u ON u.id = us.user_id
WHERE u.deleted_at IS NULL
ORDER BY us.active_days DESC, us.entries_total DESC;
