-- =========================================================================
-- COSTRA-158 · users.has_completed_profile 列
-- Owner: Backend-Agent · 日期: 2026-05-19
-- 来源：COSTRA-157 hasProfile 严格判定争议 · Human 决策方案 D
-- =========================================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS has_completed_profile BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.has_completed_profile IS
'COSTRA-158: 用户是否完成资料补全（首登默认 FALSE · PATCH /users/me 成功后 TRUE）。'
'用于客户端 home 页"完善资料"入口的严格判定（替代 nickname 字符串比较代理判定）。'
'语义稳定字段：升级 default nickname 不影响判定 / 用户改名为占位串不误判 / 多端同账号一致。'
'单调约束（应用层保证）：一旦 TRUE 不降级回 FALSE · 避免用户清空资料后再次显示完善入口。';

-- 不做 backfill（MVP < 10 用户 · 让用户重新点"完善资料"自然修复 · 同时验证新链路）
-- 已知体验：之前 PATCH 过资料的用户首次重登会再次看到"完善资料 →" · 重新 PATCH 一次后消失（一次性困惑）

COMMIT;
