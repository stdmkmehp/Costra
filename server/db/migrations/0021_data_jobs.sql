-- Costra · migration 0021 · 数据任务（导入/导出）基建
--
-- 卡号：数据导入导出方案落地（一期=导出 · 二期=导入）
-- 事实源：docs/design/data-import-export-client-analysis.md v1.0 §5.2/§7.3
--
-- 本迁移只做三件事（方案 §7.3 三部分一次建齐，避免二期再加列迁移）：
--   A) ledgers 增加导入 sync-hold 两列（方案 §5.2.4 E2b · 导入期间服务端钉住客户端 watermark）
--   B) import_detect_sessions（导入检测会话 · 二期代码落地前空置）
--   C) data_jobs（导出/导入统一任务表 · 一期即启用导出）
--
-- 与方案 §7.3 草案的偏差（实现期定稿，均有注释落点）：
--   - data_jobs 用 export_from/export_to（TIMESTAMPTZ 半开区间）替代 date_from/date_to（DATE），
--     与 entryExport.exportToShanghaiIsoSecond / computeExportRange 的真实实现一致；
--   - data_jobs 另含 worker 租约/退避全列（attempts/stage/stage_started_at/run_token/
--     lease_expires_at/retryable/error_code/error_message/next_attempt_at/expires_at），
--     与 dataJobRepo/dataJobScheduler 的真实认领语义一致（方案 §7.3 只列了部分列）；
--   - E2b 钳制是代码级方案：导入 worker 大事务前设置 sync_hold_* 两列、提交时
--     releaseHoldAndApplyDelta 同事务清除并应用资产 delta；syncPullService 拉取时按
--     MIN(sync_hold_seq)（hold_until 未过期者）钳制 entries 上界并钉住 has_more/nextSince。
--     方案 §5.2.4 提及的 PG trigger 双保险按 §7.3「（可选，v1.0 不建）」不建：
--     pg-mem 测试通道无 trigger 载体，且其覆盖的失败场景（钳制导回崩溃）后果为
--     benign-over-hold（hold_until 到期自愈 + 下一次导入修复），已接受该偏差。

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A) 导入 sync-hold 两列（方案 §5.2.4 E2b · 一期随本迁移建好，二期 worker 落地后启用）
--    sync_pull 时：cap = MIN(sync_hold_seq)（仅 sync_hold_until 未过期者），
--    entries 查询钳制 change_seq <= cap，has_more/nextSince 钉在 cap 上（≤120s 自愈）。
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS sync_hold_seq   BIGINT;
ALTER TABLE ledgers ADD COLUMN IF NOT EXISTS sync_hold_until TIMESTAMPTZ;

COMMENT ON COLUMN ledgers.sync_hold_seq   IS '导入 sync-hold：本账本"导入前最大 change_seq"，NULL=未持有';
COMMENT ON COLUMN ledgers.sync_hold_until IS '导入 sync-hold 到期时刻（导入时长上限 120s · 兜底自愈）';

-- ─────────────────────────────────────────────────────────────────────────────
-- B) 导入检测会话（方案 §4.2/§4.5/§7.3 · 二期落地导入功能）
--
-- 状态机仅四态：detecting → ready → consumed（终态）/ failed（终态）；
-- ready 过期由 expires_at 派生（同导出产物过期设计 · 方案 v0.6），不进状态枚举。
-- 僵尸 detecting（进程崩在解析中）由应用侧周期清理转 failed（>10min 阈值）：
-- 部分唯一索引谓词不能含 now()（PG 拒绝非 IMMUTABLE），僵尸只能由代码释放闸口。
-- member_mapping 在 commit 同事务写入（方案 §4.3 body），worker 在大事务内消费；
-- 方案 §7.3 未给映射持久化列，但 commit→执行之间必须落库，故存于会话行。
-- 产物（NDJSON 明细 + 报告 CSV）路径与 sha256 落库，文件本体在
-- /var/costra/import-staging/<yyyy-mm>/ 下（compose 挂载 /data/import-staging）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_detect_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id),
  family_id          UUID NOT NULL REFERENCES families(id),
  ledger_id          UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'detecting'
                     CHECK (status IN ('detecting', 'ready', 'consumed', 'failed')),
  file_name          TEXT,
  file_size          BIGINT,
  file_sha256        TEXT,
  is_costra_export   BOOLEAN NOT NULL DEFAULT false,
  formula_guard      TEXT CHECK (formula_guard IN ('apostrophe-v2')),
  member_mapping     JSONB,
  artifact_path      TEXT,
  artifact_sha256    TEXT,
  report_path        TEXT,
  total_rows         INTEGER,
  importable_rows    INTEGER,
  error_count        INTEGER,
  warning_count      INTEGER,
  report_preview     JSONB,
  job_id             UUID,
  expires_at         TIMESTAMPTZ,
  report_expires_at  TIMESTAMPTZ,
  consumed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  import_detect_sessions                   IS '导入检测会话（方案 §4.2/§7.3 · 二期启用）';
COMMENT ON COLUMN import_detect_sessions.status            IS 'detecting/ready/consumed/failed · ready 过期由 expires_at 派生（不进状态机）';
COMMENT ON COLUMN import_detect_sessions.file_sha256       IS '源文件内容 SHA-256 hex（同文件重复上传秒出去重锚 · §4.4）';
COMMENT ON COLUMN import_detect_sessions.is_costra_export  IS '表头指纹九列精确匹配 ⇒ true（公式守卫解码锚 · §2.1）';
COMMENT ON COLUMN import_detect_sessions.formula_guard     IS '公式守卫方案标识：apostrophe-v2（自产文件备注剥引号依据 · §9.3）';
COMMENT ON COLUMN import_detect_sessions.member_mapping    IS 'commit 写入的 昵称→user_id 映射（worker 大事务内消费 · §4.3）';
COMMENT ON COLUMN import_detect_sessions.artifact_path     IS '规范化明细产物（NDJSON gzip）绝对路径';
COMMENT ON COLUMN import_detect_sessions.artifact_sha256   IS '规范化明细产物 SHA-256 hex（审计）';
COMMENT ON COLUMN import_detect_sessions.report_path       IS '错误报告 CSV 绝对路径（无错误/警告时为 NULL）';
COMMENT ON COLUMN import_detect_sessions.report_preview    IS '{errors≤100, warnings≤100, unmatched_members[]} · DetectReport 响应直接物化（§4.2 · PREVIEW_LIMIT=100）';
COMMENT ON COLUMN import_detect_sessions.job_id            IS 'commit 成功后回填的导入任务 id（普通列不建 FK · 溯源链）';
COMMENT ON COLUMN import_detect_sessions.expires_at        IS 'ready 态 15 分钟有效期（§4.5 d · 到期 commit 410 DETECT_SESSION_EXPIRED）';
COMMENT ON COLUMN import_detect_sessions.report_expires_at IS '检测报告 24h 有效期（§4.5 f）';

-- 同文件重复上传秒出（§4.4）：按（用户, 账本, 文件哈希）找回活着的 ready 会话
CREATE INDEX IF NOT EXISTS idx_detect_sessions_dedup
  ON import_detect_sessions (user_id, ledger_id, file_sha256);
-- 每用户单一进行中检测闸口（§4.4）：代码侧先查，本索引做并发兜底（23505 ⇒ DETECT_IN_PROGRESS）
CREATE UNIQUE INDEX IF NOT EXISTS uq_detect_sessions_active_per_user
  ON import_detect_sessions (user_id) WHERE status = 'detecting';

-- ─────────────────────────────────────────────────────────────────────────────
-- C) 数据任务表（导出/导入统一 · 方案 §7.2/§7.3 + 状态机冻结于 §14.2）
--    type 分列语义（chk_data_jobs_type_fields 强制）：
--      export：export_from/export_to 必填（半开区间 [from, to) · 全量导出允许双 NULL），
--              detect_id 必须为空；
--      import：detect_id 必填（溯源链 · detect 会话删除则级联删除任务），
--              export_from/export_to 必须为空。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE data_job_type   AS ENUM ('export', 'import');
CREATE TYPE data_job_status AS ENUM ('queued', 'processing', 'succeeded', 'failed');
-- 阶段（与 chk_data_jobs_stage_scope 一致）：export = querying → packaging；
--       import = validating（单大事务内写入对轮询连接不可见）；queued 用 stage IS NULL 表达。
--       ENUM 保留 'writing' 供未来扩展（方案 §7.2 阶段集已将其从 import/export 移除）。
CREATE TYPE data_job_stage  AS ENUM ('validating', 'writing', 'querying', 'packaging');

CREATE TABLE IF NOT EXISTS data_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            data_job_type   NOT NULL,
  status          data_job_status NOT NULL DEFAULT 'queued',
  user_id         UUID NOT NULL REFERENCES users(id),
  family_id       UUID NOT NULL REFERENCES families(id),
  ledger_id       UUID NOT NULL REFERENCES ledgers(id),
  -- 导入溯源链：检测会话删除则任务级联删除（方案 §7.3）
  detect_id       UUID UNIQUE REFERENCES import_detect_sessions(id) ON DELETE CASCADE,
  -- 导入源文件内容哈希（= 会话 file_sha256 · 审计/去重链）
  source_hash     TEXT,
  -- 导入解析规则集版本（二期 commit 时写入 · 格式演进审计锚）
  ruleset_version INTEGER,
  -- 导出范围（半开区间 Asia/Shanghai 日界 → UTC · 全量导出双 NULL = 不过滤）
  export_from     TIMESTAMPTZ,
  export_to       TIMESTAMPTZ,
  -- worker 租约/退避（与 dataJobRepo/dataJobScheduler 认领语义一致）
  attempts        INTEGER NOT NULL DEFAULT 0,
  stage           data_job_stage,
  stage_started_at TIMESTAMPTZ,
  run_token       UUID,
  lease_expires_at TIMESTAMPTZ,
  retryable       BOOLEAN NOT NULL DEFAULT false,
  error_code      TEXT,
  error_message   TEXT,
  next_attempt_at TIMESTAMPTZ,
  -- 队列租约：queued 任务 10min 未被认领则回收重排（与 processing 租约 90s 分列 · 语义不同源）
  expires_at      TIMESTAMPTZ,
  -- 结果摘要：导出 {entry_count, part_count, storage_month, source_date_from/to}；
  --          导入 {imported, skipped, error_count, warning_count}（方案 §7.6 result_summary）
  result_summary  JSONB,
  -- 产物清单 [{part, filename, size_bytes, sha256, download_path}]（方案 §7.6 files[] · 仅导出）
  files           JSONB,
  -- 产物整体过期时刻（= now()+24h · 由 DB now() 起算 · 仅导出）
  file_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ
);

COMMENT ON TABLE  data_jobs                IS '数据导入/导出任务（方案 §7.2/§7.3）';
COMMENT ON COLUMN data_jobs.detect_id      IS '导入检测会话（import 必填 · ON DELETE CASCADE 溯源链）';
COMMENT ON COLUMN data_jobs.source_hash    IS '导入源文件内容 SHA-256（= 会话 file_sha256）';
COMMENT ON COLUMN data_jobs.ruleset_version IS '导入解析规则集版本（当前恒 1）';
COMMENT ON COLUMN data_jobs.export_from    IS '导出起始（含 · UTC · NULL=不限制 · 与 export_to 同有或同无）';
COMMENT ON COLUMN data_jobs.export_to      IS '导出结束（不含 · UTC · NULL=不限制 · 与 export_from 同有或同无）';
COMMENT ON COLUMN data_jobs.attempts       IS '已执行次数（首次认领后=1 · 上限 3）';
COMMENT ON COLUMN data_jobs.run_token      IS 'processing 租约令牌（续租/终态落库全链路灯芯 · §14.2）';
COMMENT ON COLUMN data_jobs.lease_expires_at IS 'processing 租约到期时刻（90s）';
COMMENT ON COLUMN data_jobs.retryable      IS '该失败是否可重试：执行期终态失败=false；排队租约到期（QUEUE_LEASE_EXPIRED）=true（§9.5）';
COMMENT ON COLUMN data_jobs.next_attempt_at IS '下次可执行时刻（指数退避 5/15/45s）';
COMMENT ON COLUMN data_jobs.expires_at     IS '队列租约到期时刻（queued 专用 · 10min 未被认领则回收重排）';
COMMENT ON COLUMN data_jobs.result_summary IS '结果摘要（导出含 entry_count/part_count/storage_month/source_date_* · 导入含 imported/skipped/error_count/warning_count）';
COMMENT ON COLUMN data_jobs.files          IS '产物清单 JSON（含 part/filename/size_bytes/sha256/download_path · 仅导出）';
COMMENT ON COLUMN data_jobs.file_expires_at IS '产物过期时刻（DB now()+24h · 仅导出）';

-- 形状约束：按 type 强制分列语义
--   export：export_from/export_to 要么同时有（自定义范围）要么同时空（全量导出）·
--           双 NULL 与全量导出语义一致（worker 不附加日期谓词）。
ALTER TABLE data_jobs ADD CONSTRAINT chk_data_jobs_type_fields CHECK (
  (type = 'export' AND detect_id IS NULL AND source_hash IS NULL
     AND ((export_from IS NULL AND export_to IS NULL) OR (export_from IS NOT NULL AND export_to IS NOT NULL)))
  OR
  (type = 'import' AND detect_id IS NOT NULL AND source_hash IS NOT NULL
     AND export_from IS NULL AND export_to IS NULL)
);

-- stage 必须属于该 type 的合法阶段集（方案 §7.2 v1.0）：
--   import 唯一可观测阶段是 validating（单大事务内写入对轮询连接不可见，'writing' 已移除）；
--   export = querying → packaging；queued 用 stage IS NULL 表达。
ALTER TABLE data_jobs ADD CONSTRAINT chk_data_jobs_stage_scope CHECK (
  stage IS NULL
  OR (type = 'import' AND stage IN ('validating'))
  OR (type = 'export' AND stage IN ('querying', 'packaging'))
);

-- 导出区间防倒挂（方案 §7.3 chk_data_jobs_date_range · 实现期改名 export_from/to 后补回）
ALTER TABLE data_jobs ADD CONSTRAINT chk_data_jobs_date_range CHECK (
  export_from IS NULL OR export_to IS NULL OR export_from <= export_to
);

-- 幂等键唯一（与导出路由 Idempotency-Key 头联动）
ALTER TABLE data_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_idempotency_key
  ON data_jobs (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- run_token 唯一（灯芯防串号）
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_run_token
  ON data_jobs (run_token) WHERE run_token IS NOT NULL;

-- 每用户单一活跃导出任务闸口（方案 §4.4）
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_active_export_per_user
  ON data_jobs (user_id) WHERE type = 'export' AND status IN ('queued', 'processing');
-- 同账本同时只允许一个导入任务（方案 §4.4 · 当前 family:ledger=1:1，按 family 收口）
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_jobs_active_import_per_family
  ON data_jobs (family_id) WHERE type = 'import' AND status IN ('queued', 'processing');
-- 注：detect 会话最多产生一个任务，已由列定义 detect_id UUID UNIQUE 全局保证
--（强于「仅 queued/processing 内唯一」），故不再建 uq_data_jobs_detect 部分索引 —— 它恒被
--  列级唯一约束覆盖，永不生效，只带来写放大。

CREATE INDEX IF NOT EXISTS idx_data_jobs_owner_created ON data_jobs (user_id, created_at DESC);
-- worker 轮询：待认领 queued（next_attempt_at IS NULL 或已到点）
CREATE INDEX IF NOT EXISTS idx_data_jobs_due ON data_jobs (status, next_attempt_at)
  WHERE status = 'queued';

COMMIT;
