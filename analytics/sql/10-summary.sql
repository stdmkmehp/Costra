-- 10-summary.sql · 窗口内各维度汇总（含手动/自动区分）
-- 参数: :window_start, :window_end

WITH
  u AS (
    SELECT count(*) c
    FROM users
    WHERE deleted_at IS NULL
      AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  ),
  l AS (
    SELECT
      count(*) c,
      count(*) FILTER (WHERE f.kind = 'personal') personal_c,
      count(*) FILTER (WHERE f.kind = 'shared') shared_c
    FROM ledgers
    JOIN families f ON f.id = ledgers.family_id
    WHERE ledgers.deleted_at IS NULL
      AND ledgers.created_at >= :'window_start'::timestamptz AND ledgers.created_at < :'window_end'::timestamptz
  ),
  e AS (
    SELECT
      count(*) c,
    coalesce(sum(amount), 0) sum_amount,
      count(*) FILTER (WHERE source_recurring_id IS NULL) manual_count,
      count(*) FILTER (WHERE source_recurring_id IS NOT NULL) auto_count,
      coalesce(sum(amount) FILTER (WHERE source_recurring_id IS NULL), 0) manual_amount,
      coalesce(sum(amount) FILTER (WHERE source_recurring_id IS NOT NULL), 0) auto_amount
    FROM entries
    WHERE deleted_at IS NULL
      AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  ),
  i AS (
    SELECT
      count(*) c,
      count(*) FILTER (WHERE used_at IS NOT NULL) used_c
    FROM family_invites
    WHERE created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  ),
  a AS (
 SELECT count(DISTINCT created_by) c
    FROM entries
    WHERE deleted_at IS NULL
      AND created_at >= :'window_start'::timestamptz AND created_at < :'window_end'::timestamptz
  )
SELECT
  u.c  AS new_users,
  l.c    AS new_ledgers,
  l.personal_c     AS personal_ledgers,
l.shared_c       AS shared_ledgers,
  e.c        AS new_entries,
  e.sum_amount     AS new_entries_amount_cents,
  e.manual_count   AS manual_entries,
  e.auto_count AS auto_entries,
  e.manual_amount  AS manual_amount_cents,
  e.auto_amount    AS auto_amount_cents,
  i.c         AS new_invites,
  i.used_c         AS new_invites_used,
  a.c        AS active_users
FROM u, l, e, i, a;
