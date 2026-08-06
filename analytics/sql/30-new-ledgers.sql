-- 30-new-ledgers.sql · 窗口内新增账本明细
-- 含已软删账本（deleted_at IS NOT NULL，标记 [已删除]），并带家庭成员数与成员昵称列表。
-- 排序：家庭(shared) 在前、个人(personal) 在后；同类型内按 created_at ASC。
-- 参数: :window_start, :window_end

WITH window_ledgers AS (
  SELECT l.id, l.name, l.family_id, l.created_at, l.deleted_at
  FROM ledgers l
  WHERE l.created_at >= :'window_start'::timestamptz AND l.created_at < :'window_end'::timestamptz
),
-- 账本 → 家庭当前活跃成员（left_at IS NULL），数量 + 昵称列表
family_member_stats AS (
  SELECT
    fm.family_id,
    count(*) AS member_count,
    string_agg(u.nickname, ', ' ORDER BY u.nickname) AS member_names
  FROM family_members fm
  JOIN users u ON u.id = fm.user_id AND u.deleted_at IS NULL
  WHERE fm.left_at IS NULL
  GROUP BY fm.family_id
)
SELECT
  wl.name                                                    AS ledger_name,
  f.name                                                     AS family_name,
  f.kind                                                     AS family_kind,        -- 'personal' | 'shared'
  owner.nickname                                             AS owner_nickname,
  to_char(wl.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  (wl.deleted_at IS NOT NULL)                                AS is_deleted,
  to_char(wl.deleted_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS deleted_at_cst,
  coalesce(fms.member_count, 0)                              AS member_count,
  coalesce(fms.member_names, '')                             AS member_names
FROM window_ledgers wl
JOIN families f     ON f.id = wl.family_id
JOIN users owner    ON owner.id = f.owner_id
LEFT JOIN family_member_stats fms ON fms.family_id = wl.family_id
ORDER BY
  -- family_kind: 'shared' < 'personal'（家庭账本在前）
  CASE WHEN f.kind = 'shared' THEN 0 ELSE 1 END,
  wl.created_at ASC;
