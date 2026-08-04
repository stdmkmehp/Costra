-- 20-new-users.sql ·窗口内新增用户明细（丰富版）
-- 参数: :window_start, :window_end

SELECT
  u.nickname,
  to_char(u.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  u.has_completed_profile,
  --窗口内手动记账条数
  (
    SELECT count(*)
    FROM entries e
    WHERE e.created_by = u.id
      AND e.deleted_at IS NULL
      AND e.source_recurring_id IS NULL
      AND e.created_at >=:'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
  ) AS manual_entries_in_window,
  -- 窗口内自动记账条数
  (
    SELECT count(*)
    FROM entries e
    WHERE e.created_by = u.id
      AND e.deleted_at IS NULL
      AND e.source_recurring_id IS NOT NULL
      AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
  ) AS auto_entries_in_window,
  -- 加入家庭数
  (
    SELECT count(*)
    FROM family_members fm
    WHERE fm.user_id = u.id AND fm.left_at IS NULL
  ) AS family_count,
  -- 是否通过邀请注册（在用户注册前后5 分钟内有 invite.used_by = user.id）
  CASE WHEN EXISTS (
    SELECT 1 FROM family_invites fi
    WHERE fi.used_by = u.id
      AND fi.used_at BETWEEN u.created_at - interval '5 minutes' AND u.created_at + interval '5 minutes'
  ) THEN 'true' ELSE 'false' END AS invited_registration,
  -- 首笔记账耗时（秒），NULL 表示尚未记账
  (
    SELECT EXTRACT(EPOCH FROM (min(e.created_at) - u.created_at))::bigint
    FROM entries e
    WHERE e.created_by = u.id AND e.deleted_at IS NULL
  ) AS first_entry_seconds,
  -- 是否设置偏好
  CASE WHEN u.preferred_family_id IS NOT NULL THEN 'true' ELSE 'false' END AS has_preference
FROM users u
WHERE u.deleted_at IS NULL
  AND u.created_at >= :'window_start'::timestamptz AND u.created_at < :'window_end'::timestamptz
ORDER BY u.created_at ASC;
