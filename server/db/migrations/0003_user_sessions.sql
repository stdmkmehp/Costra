-- =========================================================================
-- Costra DB Schema · 0003 · user_sessions (refresh_token 登记)（幂等 · 可安全重跑）
-- Owner: Backend-Agent · 卡号: COSTRA-101 · 日期: 2026-04-23
-- 约束来源: ADR-0004 §3 Token · docs/api/ttl-policy.md §4.2 JWT 签发
-- 补齐 0001_init.sql 未创建的 refresh_token 持久化层
-- =========================================================================
--
-- 设计点：
--   1. 双写策略：DB（事实源 · 登出/审计）+ Redis（热路径校验加速）
--      Redis miss 时回退 DB 查询，保证冷启动安全
--   2. jti 作主键：refresh_token payload 含 jti，校验路径 WHERE jti = $1
--   3. 登出 = UPDATE SET revoked_at = now() WHERE jti = $1 (+ DEL Redis key)
--   4. 刷新 = 查有效 → 签新 access_token；refresh_token 沿用旧值（MVP 不换发）
--   5. 表不进 touch_updated_at trigger（唯一可变字段是 revoked_at/last_refresh_at，
--      语义不同不合并为 updated_at）
-- =========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_sessions (
    jti             UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    client_fp       TEXT,
    last_refresh_at TIMESTAMPTZ
);

-- 热路径：按 user_id 查所有未吊销 session（登出全部用 / 管理端查看在线）
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
    ON user_sessions (user_id) WHERE revoked_at IS NULL;

-- 运维清理：按 expires_at 批量清理过期 session
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at) WHERE revoked_at IS NULL;

COMMIT;

-- 运营风险审查（user_sessions 容量估算 / 缺清理 job / idx 设计反讽 / 注销级联）
-- 见 docs/db/ops-risk-audit-todo.md §4 · FU-DB-OPS-AUDIT
