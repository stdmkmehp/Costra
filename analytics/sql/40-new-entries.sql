-- 40-new-entries.sql · 窗口内新增记账明细（区分自动/手动）
-- 同时返回家庭成员数与每成员记账分布，供"分账本统计"使用。
-- 参数: :window_start, :window_end

WITH window_entries AS (
  SELECT
    e.id, e.created_at, e.occurred_at, e.type, e.shared_type,
    e.source_recurring_id, e.amount, e.currency, e.note,
    e.ledger_id, e.created_by, e.category_id
  FROM entries e
  WHERE e.deleted_at IS NULL
    AND e.created_at >= :'window_start'::timestamptz AND e.created_at < :'window_end'::timestamptz
),
-- 每个账本所属家庭的当前成员数（left_at IS NULL）
family_size AS (
  SELECT l.id AS ledger_id, count(fm.user_id) AS family_member_count
  FROM ledgers l
  JOIN family_members fm ON fm.family_id = l.family_id AND fm.left_at IS NULL
  GROUP BY l.id
),
-- 先按账本+记账人聚合，再 join users 拿昵称，最后 string_agg 拼成"昵称=N条, ..."
per_member AS (
  SELECT ledger_id, created_by, count(*) AS cnt
  FROM window_entries
  GROUP BY ledger_id, created_by
),
member_breakdown AS (
  SELECT
    pm.ledger_id,
    string_agg(
      u.nickname || '=' || pm.cnt,
      ', ' ORDER BY pm.cnt DESC, u.nickname
    ) AS member_breakdown
  FROM per_member pm
  JOIN users u ON u.id = pm.created_by
  GROUP BY pm.ledger_id
)
SELECT
  to_char(e.created_at  AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  to_char(e.created_at  AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS created_date_cst,
  EXTRACT(EPOCH FROM e.created_at)::bigint AS created_at_epoch,
  to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS occurred_at_cst,
  e.type,                                              -- 'income' | 'expense' | 'transfer'
  e.shared_type,                                       -- 'personal' | 'shared' | NULL
  CASE WHEN e.source_recurring_id IS NOT NULL THEN 'auto' ELSE 'manual' END AS source,
  e.amount,                                            -- cents (integer)
  e.currency,
  substring(coalesce(e.note, '') for 40) AS note_short,
  l.name          AS ledger_name,
  f.kind          AS family_kind,
  u.nickname      AS created_by_nickname,
  coalesce(parent.name, '') AS category_parent,
  coalesce(cat.name, '')    AS category_name,
  coalesce(fs.family_member_count, 0) AS family_member_count,
  coalesce(mb.member_breakdown, '')   AS member_breakdown
FROM window_entries e
JOIN ledgers    l      ON l.id = e.ledger_id
JOIN families   f      ON f.id = l.family_id
JOIN users      u      ON u.id = e.created_by
LEFT JOIN categories cat    ON cat.id = e.category_id
LEFT JOIN categories parent ON parent.id = cat.parent_id
LEFT JOIN family_size      fs ON fs.ledger_id = l.id
LEFT JOIN member_breakdown mb ON mb.ledger_id = l.id
ORDER BY e.created_at ASC;
