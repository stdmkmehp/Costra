-- 20-new-users.sql · 窗口内新增用户明细
-- 参数: :window_start, :window_end

SELECT
  u.nickname,
  to_char(u.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  u.has_completed_profile,
  (
    SELECT count(*)
    FROM entries e
    WHERE e.created_by = u.id
      AND e.deleted_at IS NULL
      AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
  ) AS entries_in_window
FROM users u
WHERE u.deleted_at IS NULL
  AND u.created_at >= :'window_start'::timestamptz AND u.created_at < :'window_end'::timestamptz
ORDER BY u.created_at ASC;
