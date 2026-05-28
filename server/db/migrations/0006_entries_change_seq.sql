-- =========================================================================
-- Costra · 0006 entries 表加 change_seq 列（同步引擎一致性水位）（幂等 · 可安全重跑）
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
-- 幂等策略：
--   所有 DDL 使用 IF NOT EXISTS / IF EXISTS 守卫
--   回填 + setval 仅在 change_seq 列存在且有 NULL 行时执行
--   ALTER COLUMN SET NOT NULL / SET DEFAULT 天然幂等（重跑不报错）
--   ADD CONSTRAINT 用 DO $$ 块 + EXCEPTION 守卫
--
-- 协议变更：详见 docs/api/sync-protocol.md §6.3 v1.2
-- =========================================================================

BEGIN;

-- ─── 1. 创建序列 ──────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS entries_change_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    CACHE 100
    NO CYCLE;

-- ─── 2. 加列（IF NOT EXISTS 幂等）──────────────────────────────────────────
ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS change_seq BIGINT;

-- ─── 3. 历史数据回填（仅对 change_seq IS NULL 的行执行 · 幂等）──────────────
-- 已回填过的行 change_seq 不为 NULL · 不会被重复 UPDATE
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY updated_at ASC, id ASC) AS rn
  FROM entries
  WHERE change_seq IS NULL
)
UPDATE entries SET change_seq = ordered.rn FROM ordered WHERE entries.id = ordered.id;

-- ─── 4. 推进 sequence 到 max(change_seq) + 1 ────────────────────────────────
-- 幂等：setval 天然幂等 · 重跑只是重新设置到相同值
SELECT setval(
    'entries_change_seq',
    GREATEST(COALESCE((SELECT MAX(change_seq) FROM entries), 0), 1),
    true
);

-- ─── 5. 加 NOT NULL 约束 ─────────────────────────────────────────────────────
-- ALTER COLUMN SET NOT NULL 天然幂等 · 已经是 NOT NULL 时重跑不报错
ALTER TABLE entries
    ALTER COLUMN change_seq SET NOT NULL;

-- ─── 6. 加 DEFAULT nextval ────────────────────────────────────────────────────
-- ALTER COLUMN SET DEFAULT 天然幂等 · 重跑只是重新设置相同 DEFAULT
ALTER TABLE entries
    ALTER COLUMN change_seq SET DEFAULT nextval('entries_change_seq');

-- ─── 7. UNIQUE 约束（用 DO 块 + EXCEPTION 守卫幂等）──────────────────────────
DO $$ BEGIN
  ALTER TABLE entries
      ADD CONSTRAINT entries_change_seq_unique UNIQUE (change_seq);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 8. 复合索引 ─────────────────────────────────────────────────────────────
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
