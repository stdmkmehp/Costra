-- 30-new-ledgers.sql · 窗口内新增账本明细
-- 参数: :window_start, :window_end

SELECT
  l.name                AS ledger_name,
  f.name                AS family_name,
  f.kind                AS family_kind,        -- 'personal' | 'shared'
  owner.nickname        AS owner_nickname,
  to_char(l.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst
FROM ledgers l
JOIN families f     ON f.id = l.family_id
JOIN users owner    ON owner.id = f.owner_id
WHERE l.deleted_at IS NULL
  AND l.created_at >= :'window_start'::timestamptz AND l.created_at < :'window_end'::timestamptz
ORDER BY l.created_at ASC;
