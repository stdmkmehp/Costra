--============================================================================
-- Costra · Migration 0019 · ledgers.sync_epoch（批量写入版本戳 · L13 E1）
--============================================================================
-- 卡号：L13（sync/pull 分页收敛）
-- 事实源：docs/design/sync-pull-pagination-design.md §4.2 / §5
--
-- 背景（R1 洞）：
--   entries.change_seq 走 nextval('entries_change_seq')，INSERT 时取号、COMMIT 时才可见。
--   批量写入（导入 / 运维脚本 / 数据修复）的长事务在 COMMIT 前，同 family 的并发单笔写入
--   可能先提交并把客户端 watermark 推过批量事务的号段区间 → 批量数据永久拉不到（§3.1）。
--
-- E1 机制：
--   ledgers 加 sync_epoch。任何"绕过 entryService 且未经 sync-hold 保护的批量写入路径"
--   在同一事务内执行
--     UPDATE ledgers SET sync_epoch = sync_epoch + 1 WHERE id = $1;
--   epoch 随每次 /sync/pull 的 ledgers[] 透传。客户端本地按 family 记录 { [ledgerId]: epoch }，
--   比对不一致 = "上次同步后发生过批量写入" → watermark 清零 → 全量重拉（幂等对账）。
--
-- 正确性：epoch+1 与批量 INSERT 同一事务，COMMIT 原子可见，不存在"数据到了标记没到"的窗口。
--   epoch 是持久列（非事件），客户端离线 / 漏看响应 / 多次导入跳变都不会错过。
--
-- 例外（data-import-export v1.0 §5.2）：导入 worker 的大事务受 sync-hold 保护
--   （ledgers.sync_hold_seq/sync_hold_until · migration 0021），号段洞由闸门钳制消除，
--   不再同事务 +1（否则每次导入都引发全量重拉，比 hold 的 ≤120s 收敛贵得多）。
--
-- ★硬约定：本 SQL 必须与 server/test/setup.ts 的简化 pg-mem DDL 同步。
--============================================================================

BEGIN;

ALTER TABLE ledgers
  ADD COLUMN IF NOT EXISTS sync_epoch BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN ledgers.sync_epoch IS
'批量写入版本戳（L13 E1）。仅在绕过 entryService 且未经 sync-hold 保护的批量写入路径
 （运维脚本 / 数据修复）中同事务 +1；日常单笔记账不加（每笔都加会退化成 change_seq →
 客户端无限重拉）。导入 worker 大事务由 sync-hold 保护（migration 0021 · §5.2），不再 +1。
 客户端比对不一致时清零 watermark 全量重拉，规避 change_seq"已取号未提交"洞。';

COMMIT;
