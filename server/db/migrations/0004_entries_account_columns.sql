-- =========================================================================
-- Costra · 0004 entries 表加 account_id / to_account_id 列
-- =========================================================================
-- 卡号：COSTRA-104 R1.x.2 · 修 schema gap
-- 事实源：server/api/openapi.yaml Entry schema:1045-1058 (COSTRA-020 Round-2 P0-1)
--
-- 背景：协议 OpenAPI 已含 account_id / to_account_id 字段（Entry + EntryCreate）·
-- 但 0001_init.sql 漏建 entries 表的对应列 · entryRepo.ts:107 INSERT 写了这俩列 ·
-- 真实 PG 跑触发 42703 column does not exist · 测因 test/setup.ts pg-mem 自定义
-- 重建 schema 时多加了这两列而掩盖 bug · Human curl 实测 (2026-05-12 13:18) 暴露。
--
-- accounts 表当前未建 · FK 约束留待 accounts 表建立后的后续 migration 补 ALTER。
-- =========================================================================

BEGIN;

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS account_id    UUID,
    ADD COLUMN IF NOT EXISTS to_account_id UUID;

-- 索引：account_id 后续会高频查询账户对应流水
CREATE INDEX IF NOT EXISTS idx_entries_account
    ON entries (account_id) WHERE deleted_at IS NULL;

COMMIT;