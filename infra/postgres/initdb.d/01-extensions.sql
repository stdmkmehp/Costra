-- =============================================================================
-- Costra · PG initdb 自动跑（v1.5 · 2026-05-25）
-- =============================================================================
-- 触发时机：postgres:15-alpine 容器首次启动 · POSTGRES_DB 创建后自动执行
--          (数据目录 /var/lib/postgresql/data 非空时跳过)
-- 作用：装 pgcrypto + citext 扩展（0001_init.sql 必需）
-- 不在此处跑 migration：migration 走独立步骤 · 手册 §6
-- =============================================================================

-- 装扩展（必须在 costra DB 内 · POSTGRES_DB=costra 已切到此 DB）
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- 验证（log 里能看到）
\dx
