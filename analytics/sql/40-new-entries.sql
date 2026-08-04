-- 40-new-entries.sql · 窗口内新增记账明细（全量，渲染层按阈值截断）
-- 参数: :window_start, :window_end

SELECT
  to_char(e.created_at  AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  to_char(e.created_at  AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS created_date_cst,
  EXTRACT(EPOCH FROM e.created_at)::bigint AS created_at_epoch,
  to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS occurred_at_cst,
  e.type,                                     -- 'income' | 'expense' | 'transfer'
  e.shared_type,                              -- 'personal' | 'shared' | NULL
  e.amount,                                   -- cents (integer)
  e.currency,
  substring(coalesce(e.note, '') for 40)      AS note_short,
  l.name                                      AS ledger_name,
  f.kind                                      AS family_kind,
  u.nickname                                  AS created_by_nickname,
  coalesce(parent.name, '')                   AS category_parent,
  coalesce(cat.name, '')                      AS category_name
FROM entries e
JOIN ledgers    l      ON l.id = e.ledger_id
JOIN families   f      ON f.id = l.family_id
JOIN users      u      ON u.id = e.created_by
LEFT JOIN categories cat    ON cat.id = e.category_id
LEFT JOIN categories parent ON parent.id = cat.parent_id
WHERE e.deleted_at IS NULL
  AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
ORDER BY e.created_at ASC;
