--============================================================================
-- Costra · Migration 0012 · 账本资产字段
--============================================================================
-- 卡号占位：COSTRA-4xx
-- 事实源：
--   docs/design/asset-and-budget-spec.md v2 §3.1 / §4
--
-- 主要变更：
--   1. ledgers 新增 balance_cents / balance_baseline_seq / balance_version
--   2. balance_version 独立于 ledgers.version，避免与账本名修改互相 conflict
--
-- ★硬约定：本 SQL 必须与 server/test/setup.ts 的简化 pg-mem DDL 同步
--
-- 停服数据回填：
--   生产停服窗口在部署后单独执行 infra/scripts/migrate-ledger-asset.sh
--   开发环境清库重建由 0001_init.sql 自动 DEFAULT 0 即可
--============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- ledgers 新增 3 个字段
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ledgers
  ADD COLUMN IF NOT EXISTS balance_cents        BIGINT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_baseline_seq  BIGINT   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_version       INTEGER  NOT NULL DEFAULT 1;

COMMENT ON COLUMN ledgers.balance_cents IS
'账本资产净值（分）· 用户可修改；服务端在 entries 变化时自动累加/回退';
COMMENT ON COLUMN ledgers.balance_baseline_seq IS
'资产累加基线（entries.change_seq）。用户重锚资产后置为当时的 MAX(entries.change_seq)。
 只有 change_seq > baseline_seq 的流水才被计入 balance_cents。
 全库共用一个 entries_change_seq SEQUENCE，不同账本 seq 交错，但单账本内部严格单调。';
COMMENT ON COLUMN ledgers.balance_version IS
'balance_cents / balance_baseline_seq 的乐观锁版本（独立于 ledgers.version，
 避免"改资产"与"改账本名"互相 conflict）。';

COMMIT;
