-- ═══════════════════════════════════════════════════════════════════════════════
-- migration 0018: users.is_gm —— GM 权限标记
--
-- 背景：
--   GM 权限与指定账号登录（impersonate）方案（docs/ops/gm-impersonate-design.md）：
--   users 表承载 GM 标记，服务端 requireGm 实时查库校验，
--   GM 用户可登录任意账号或以 gm_fake_ 前缀伪造账号。
--
-- 语义：
--   · 默认 FALSE；全库无任何 API 写该列（PATCH /users/me 白名单天然排除）
--   · 唯一写入路径 = 运维 SQL（docs/ops/gm-access.md）
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_gm BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.is_gm IS
'GM 权限标记（默认 FALSE · 唯一写入路径 = 运维 SQL · requireGm 实时查库校验）。';
