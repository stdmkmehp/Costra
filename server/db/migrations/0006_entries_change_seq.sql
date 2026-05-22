-- =========================================================================
-- Costra · 0006 entries 表加 change_seq 列（同步引擎一致性水位）
-- =========================================================================
-- 卡号：BUG-COSTRA-154-WATERMARK-PRECISION · R1.x.2 选项 B 彻底修复
-- 事实源：
--   docs/api/sync-protocol.md §6.3 v1.2（升级 BIGINT change_seq）
--   qa/defects/2026-05-22-COSTRA-154-watermark-microsecond-precision.md §3.5 残余风险
--
-- 背景：
--   v1.1（2026-05-22 上午）用微秒精度 ISO 时间戳作为 watermark · 消除 99.9% 重传场景 ·
--   但仍残留 3 类风险：
--     ① 同微秒并发写漏拉（PG now() 在同 query 多次调用返回相同微秒值）
--     ② NTP 时钟回拨破坏单调性
--     ③ PG 主从切换时钟差导致 updated_at 倒退
--   本 migration 将同步水位从 updated_at（物理时间 · 有精度+单调性风险）
--   升级为 change_seq（PG SEQUENCE · 严格单调递增 · 不依赖时钟）。
--
-- 设计决策：
--   ① PG SEQUENCE 生成 seq · 不用雪花算法
--   ② 应用层显式 nextval（不用 plpgsql trigger · pg-mem 不支持 trigger）
--      事实源：实测 pg-mem 支持 SEQUENCE/nextval/setval 但不支持 plpgsql/trigger
--      应用层显式更易追踪 · 真 PG 与 pg-mem 行为完全一致
--   ③ updated_at 保留展示语义 · 不再进 sync 协议核心比较路径
--   ④ 协议 v1.1 → v1.2 不向后兼容 · client 自动 fallback 全量 pull 一次
--
-- 协议变更：详见 docs/api/sync-protocol.md §6.3 v1.2
-- =========================================================================

BEGIN;

-- ─── 1. 创建序列 ──────────────────────────────────────────────────────────
-- IF NOT EXISTS · 幂等防重跑
-- NO CYCLE · BIGINT 上限 9.22 × 10^18 · MVP 永远跑不到
-- CACHE 100 · 单进程预取 100 个 seq · 主从切换时可能丢失 < 100 · 但保证单调
CREATE SEQUENCE IF NOT EXISTS entries_change_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    CACHE 100
    NO CYCLE;

-- ─── 2. 加列 · 不带 DEFAULT（避免锁表 + 历史行回填顺序无法控制）──────────────
-- 阶段 A：先加 NULL 列
ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS change_seq BIGINT;

-- ─── 3. 历史数据回填（按 updated_at ASC, id ASC 顺序分配 change_seq）────────
-- 保证回填后的 change_seq 与时间序一致 · 已有 client 升级后能"看似"接续推进
-- 注意：dev/staging/prod 表小（家庭记账 · 数据量极低）· UPDATE 全表无性能问题
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY updated_at ASC, id ASC) AS rn FROM entries
)
UPDATE entries SET change_seq = ordered.rn FROM ordered WHERE entries.id = ordered.id;

-- ─── 4. 推进 sequence 到 max(change_seq) + 1 ────────────────────────────────
-- COALESCE 处理空表场景（max 返 NULL · 用 0 + 1 = 1 启动）
-- false 参数表示 "下次 nextval 返回此值"（不是 +1 后返回）
SELECT setval(
    'entries_change_seq',
    GREATEST(COALESCE((SELECT MAX(change_seq) FROM entries), 0), 1),
    true  -- true = next nextval() 返回 maxval+1（标准用法）
);

-- ─── 5. 加 NOT NULL 约束（回填完成后才能加）─────────────────────────────────
ALTER TABLE entries
    ALTER COLUMN change_seq SET NOT NULL;

-- ─── 6. 加 DEFAULT nextval · 后续 INSERT 自动赋值 ────────────────────────────
-- 注意：仅 INSERT 走 DEFAULT · UPDATE 必须应用层显式 SET change_seq = nextval(...)
-- 事实源：entryRepo.ts:updateEntryByVersion + softDeleteEntry · 已加显式刷 change_seq
ALTER TABLE entries
    ALTER COLUMN change_seq SET DEFAULT nextval('entries_change_seq');

-- ─── 7. UNIQUE 约束（防止应用层 bug 撞 seq · 同时也是覆盖索引基础）───────────
ALTER TABLE entries
    ADD CONSTRAINT entries_change_seq_unique UNIQUE (change_seq);

-- ─── 8. 复合索引 · 增量 pull 主路径 ─────────────────────────────────────────
-- WHERE l.family_id = $1 AND e.change_seq > $2 ORDER BY change_seq ASC LIMIT $3
-- 但 family_id 在 ledgers 表 · entries 表只有 ledger_id · 所以索引建在 ledger_id + change_seq
CREATE INDEX IF NOT EXISTS idx_entries_ledger_change_seq
    ON entries (ledger_id, change_seq);

COMMIT;

-- =========================================================================
-- 回滚（仅供故障应急 · 不在此文件执行）：
--   BEGIN;
--   DROP INDEX IF EXISTS idx_entries_ledger_change_seq;
--   ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_change_seq_unique;
--   ALTER TABLE entries DROP COLUMN IF EXISTS change_seq;
--   DROP SEQUENCE IF EXISTS entries_change_seq;
--   COMMIT;
-- =========================================================================
