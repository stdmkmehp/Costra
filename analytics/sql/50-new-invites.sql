-- 50-new-invites.sql · 窗口内新增邀请明细
-- 参数: :window_start, :window_end

SELECT
  to_char(i.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  to_char(i.used_at    AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS used_at_cst,
  inviter.nickname                            AS inviter_nickname,
  coalesce(used_user.nickname, '')            AS used_by_nickname,
  f.name                                      AS family_name,
  f.kind                                      AS family_kind,
  CASE
    WHEN i.used_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (i.used_at - i.created_at))::bigint
    ELSE NULL
  END                                         AS accepted_in_seconds
FROM family_invites i
JOIN users inviter       ON inviter.id = i.inviter_id
JOIN families f          ON f.id = i.family_id
LEFT JOIN users used_user ON used_user.id = i.used_by
WHERE i.created_at >= :'window_start'::timestamptz AND i.created_at < :'window_end'::timestamptz
ORDER BY i.created_at ASC;
