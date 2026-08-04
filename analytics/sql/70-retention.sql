-- 70-retention.sql · 留存率统计
-- 7日留存：7~14天前注册的用户，在最近7天是否仍有记账
-- 30日留存：30~37天前注册的用户，在最近7天是否仍有记账
-- 参数: :window_end

WITH bounds AS (
  SELECT
    :'window_end'::timestamptz AS end_ts,
    :'window_end'::timestamptz - interval '7 days' AS recent_start
),
-- 7日留存群组：7~14天前注册的用户
cohort_7d AS (
  SELECT u.id, u.nickname
  FROM users u, bounds b
  WHERE u.deleted_at IS NULL
    AND u.created_at >= b.end_ts - interval '14 days'
    AND u.created_at < b.end_ts - interval '7 days'
),
-- 30日留存群组：30~37天前注册的用户
cohort_30d AS (
  SELECT u.id, u.nickname
  FROM users u, bounds b
  WHERE u.deleted_at IS NULL
    AND u.created_at >= b.end_ts - interval '37 days'
    AND u.created_at < b.end_ts - interval '30 days'
),
-- 最近7天有记账行为的用户
recent_active AS (
  SELECT DISTINCT e.created_by AS user_id
  FROM entries e, bounds b
  WHERE e.deleted_at IS NULL
    AND e.created_at >= b.recent_start AND e.created_at < b.end_ts
),
stats_7d AS (
  SELECT
    count(*) AS cohort_size,
    count(*) FILTER (WHERE ra.user_id IS NOT NULL) AS retained_count
  FROM cohort_7d c
  LEFT JOIN recent_active ra ON ra.user_id = c.id
),
stats_30d AS (
  SELECT
    count(*) AS cohort_size,
    count(*) FILTER (WHERE ra.user_id IS NOT NULL) AS retained_count
  FROM cohort_30d c
  LEFT JOIN recent_active ra ON ra.user_id = c.id
)
SELECT
  '7d' AS cohort,
  s.cohort_size,
  s.retained_count,
  CASE WHEN s.cohort_size > 0
    THEN round(s.retained_count::numeric / s.cohort_size * 100, 1)
    ELSE 0
  END AS retention_pct
FROM stats_7d s

UNION ALL

SELECT
  '30d' AS cohort,
  s.cohort_size,
  s.retained_count,
  CASE WHEN s.cohort_size > 0
    THEN round(s.retained_count::numeric / s.cohort_size * 100, 1)
    ELSE 0
  END AS retention_pct
FROM stats_30d s;
