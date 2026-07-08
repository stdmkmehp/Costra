-- =========================================================================
-- Costra DB Migration 0009 · 修正 user_sessions 过期索引谓词
-- Postgres >= 15 · 幂等 · 可安全重跑
-- 最后更新：2026-07-08
-- =========================================================================
-- 背景：原 idx_user_sessions_expires 带 `WHERE revoked_at IS NULL` 部分谓词，
--   使"已吊销"行落在索引外。而清理任务（infra/scripts/maintenance.sh purge-sessions）
--   执行 `DELETE FROM user_sessions WHERE expires_at < now()`，需删除**所有**已过期行，
--   其中包含"已吊销且已过期"的行——这些行恰好不在带谓词索引里，
--   导致优化器无法只用该索引完成删除 → 退化为全表扫描（Seq Scan）。
--
--   业务侧 findActive 走主键 jti（WHERE jti=$1 · O(log n)），不依赖本索引，
--   故去掉谓词无损任何现有查询，仅让清理任务在表变大后能走索引 range scan。
--
-- 说明：0001_init.sql 的索引定义已同步改为无谓词（事实源对齐）。
--   本迁移用于已部署环境把旧的带谓词索引 DROP 后重建为无谓词。
--   顺序执行与清库重建两种场景均幂等：
--     - 新环境：0001 建无谓词 → 0009 DROP + 重建无谓词（幂等）
--     - 已部署：0001 IF NOT EXISTS 跳过（旧带谓词索引仍在）→ 0009 DROP 旧 + 建无谓词
-- =========================================================================

BEGIN;

-- 运维执行幂等：项目 migration runner（06-migrate.sh）每次部署都顺序重跑全部 SQL。
-- 因此这里不能无条件 DROP/CREATE（否则每次部署都会重建索引 · 大表下带来锁等待/写阻塞）。
-- 仅当现存索引仍是"带谓词的 partial index"（indpred 非空）时才 DROP，然后建无谓词索引。
--   - 已部署旧环境：检测到 partial index → DROP + 建无谓词
--   - 清库新建：0001 已建无谓词（indpred 为空）→ 不 DROP · CREATE IF NOT EXISTS 跳过
--   - 后续重复跑：索引已无谓词 → 不 DROP · 不重建
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE c.relname = 'idx_user_sessions_expires'
       AND i.indpred IS NOT NULL
  ) THEN
    DROP INDEX idx_user_sessions_expires;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

COMMIT;
