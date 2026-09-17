-- 55-import-jobs.sql · 窗口内账本导入任务明细
-- 数据源：data_jobs（type='import'）+ import_detect_sessions（文件名/检测行数）
-- 结果列 imported/skipped/error_count/warning_count 来自 worker 落库的 result_summary
-- （仅终态任务有值，其余为 0）；失败原因以 error_code 为准。
-- 参数: :window_start, :window_end

SELECT
  to_char(j.created_at AT TIME ZONE 'Asia/Shanghai', 'MM-DD HH24:MI') AS created_at_cst,
  u.nickname                                          AS user_nickname,
  l.name                                              AS ledger_name,
  f.kind                                              AS family_kind,        -- 'personal' | 'shared'
  ds.file_name                                        AS file_name,
  j.status                                            AS status,             -- queued/processing/succeeded/failed
  j.error_code                                        AS error_code,
  coalesce((j.result_summary->>'imported')::int, 0)      AS imported_rows,
  coalesce((j.result_summary->>'skipped')::int, 0)       AS skipped_rows,
  coalesce((j.result_summary->>'error_count')::int, 0)   AS error_count,
  coalesce((j.result_summary->>'warning_count')::int, 0) AS warning_count,
  j.attempts                                          AS attempts,
  CASE
    WHEN j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.finished_at - j.started_at))::bigint
    ELSE NULL
  END                                                 AS duration_seconds
FROM data_jobs j
JOIN users u                   ON u.id = j.user_id
JOIN ledgers l                 ON l.id = j.ledger_id
JOIN families f                ON f.id = j.family_id
LEFT JOIN import_detect_sessions ds ON ds.id = j.detect_id
WHERE j.type = 'import'
  AND j.created_at >= :'window_start'::timestamptz AND j.created_at < :'window_end'::timestamptz
ORDER BY j.created_at ASC;
