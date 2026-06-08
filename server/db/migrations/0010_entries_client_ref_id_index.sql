-- Migration: 添加 entries.client_ref_id 独立索引
-- 用途: sync/push update/delete 通过 client_ref_id 查找 entry（不含 ledger_id 前缀）
-- 背景: findByClientRefId 新增后，WHERE client_ref_id = $1 不走 (ledger_id, client_ref_id) 复合唯一约束

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_entries_client_ref_id
  ON entries (client_ref_id)
  WHERE client_ref_id IS NOT NULL AND deleted_at IS NULL;
