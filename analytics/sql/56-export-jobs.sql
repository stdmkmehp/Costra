-- 56-export-jobs.sql · 窗口内账本导出任务明细
-- 数据源：data_jobs（type='export'）
-- export_from/export_to 为半开区间 [from, to)，双 NULL = 全量导出；
-- 展示时 to 回退 1 天还原用户选择的「截止日期」（服务端存的是截止日 +1 天的日界）。
-- entry_count/part_count 来自 worker 落库的 result_summary（仅终态任务有值）。
-- 参数: :window_start, :window_end

SELECT
  to_char(j.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  u.nickname                                          AS user_nickname,
  l.name                                              AS ledger_name,
  f.kind                                              AS family_kind,        -- 'personal' | 'shared'
  CASE
    WHEN j.export_from IS NULL THEN '全部流水'
    ELSE to_char(j.export_from AT TIME ZONE 'Asia/Shanghai', 'MM-DD')
      || ' → ' ||
         to_char((j.export_to - interval '1 day') AT TIME ZONE 'Asia/Shanghai', 'MM-DD')
  END                                                 AS export_range,
  j.status                                            AS status,             -- queued/processing/succeeded/failed
  j.error_code                                        AS error_code,
  coalesce((j.result_summary->>'entry_count')::int, 0) AS entry_count,
  coalesce((j.result_summary->>'part_count')::int, 0)  AS part_count,
  j.attempts                                          AS attempts,
  CASE
    WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.finished_at - j.started_at))::bigint
    ELSE NULL
  END                                                 AS duration_seconds
FROM data_jobs j
JOIN users u    ON u.id = j.user_id
JOIN ledgers l  ON l.id = j.ledger_id
JOIN families f ON f.id = j.family_id
WHERE j.type = 'export'
  AND j.created_at >= :'window_start'::timestamptz AND j.created_at < :'window_end'::timestamptz
ORDER BY j.created_at ASC;
