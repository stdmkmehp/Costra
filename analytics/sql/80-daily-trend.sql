-- 80-daily-trend.sql · 过去 7 天每日趋势数据（活跃用户数 + 新注册数 + 记账条数）
-- 参数: :window_end
-- generate_series 含两端点；要拿到 [end-7d, end) 这 7 个日期，end::date 必须包含。

WITH bounds AS (
  SELECT
    :'window_end'::timestamptz - interval '7 days' AS start_ts,
    :'window_end'::timestamptz AS end_ts
),
days AS (
  SELECT generate_series(
    (SELECT start_ts::date FROM bounds),
    (SELECT end_ts::date FROM bounds),
    '1 day'::interval
  )::date AS day
),
-- 每日活跃用户数（有记账行为）
daily_active AS (
  SELECT
    (e.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
    count(DISTINCT e.created_by) AS active_users
  FROM entries e, bounds b
  WHERE e.deleted_at IS NULL
    AND e.created_at >= b.start_ts AND e.created_at < b.end_ts
  GROUP BY (e.created_at AT TIME ZONE 'Asia/Shanghai')::date
),
-- 每日新注册用户数
daily_reg AS (
  SELECT
    (u.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
    count(*) AS new_users
  FROM users u, bounds b
  WHERE u.deleted_at IS NULL
    AND u.created_at >= b.start_ts AND u.created_at < b.end_ts
  GROUP BY (u.created_at AT TIME ZONE 'Asia/Shanghai')::date
),
-- 每日记账条数（手动 + 自动）
daily_entries AS (
  SELECT
    (e.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
    count(*) FILTER (WHERE e.source_recurring_id IS NULL) AS manual_entries,
    count(*) FILTER (WHERE e.source_recurring_id IS NOT NULL) AS auto_entries,
    count(*) AS total_entries
  FROM entries e, bounds b
  WHERE e.deleted_at IS NULL
    AND e.created_at >= b.start_ts AND e.created_at < b.end_ts
  GROUP BY (e.created_at AT TIME ZONE 'Asia/Shanghai')::date
)
SELECT
  to_char(d.day, 'MM-DD') AS date_label,
  to_char(d.day, 'Dy') AS weekday,
  coalesce(da.active_users, 0) AS active_users,
  coalesce(dr.new_users, 0) AS new_users,
  coalesce(de.manual_entries, 0) AS manual_entries,
  coalesce(de.auto_entries, 0) AS auto_entries,
  coalesce(de.total_entries, 0) AS total_entries
FROM days d
LEFT JOIN daily_active da ON da.day = d.day
LEFT JOIN daily_reg dr ON dr.day = d.day
LEFT JOIN daily_entries de ON de.day = d.day
ORDER BY d.day ASC;
