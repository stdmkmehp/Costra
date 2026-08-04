-- 60-active-users.sql · 窗口内活跃用户（有 entry 的用户）
-- 活跃定义：窗口内有 entry created（见 spec §6.6）
-- 参数: :window_start, :window_end

SELECT
  u.nickname,
  count(*)              AS entries_count,
  sum(e.amount)         AS entries_amount_cents,
  to_char(max(e.created_at) AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS last_entry_at_cst
FROM entries e
JOIN users u ON u.id = e.created_by
WHERE e.deleted_at IS NULL
  AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
GROUP BY u.id, u.nickname
ORDER BY entries_count DESC;
