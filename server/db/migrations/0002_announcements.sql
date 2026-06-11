-- Costra DB Schema · 公告系统
-- 依赖：0001_init.sql (users 表)
-- 幂等：所有 DDL 使用 IF NOT EXISTS

BEGIN;

-- ═══ 公告表 ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

COMMENT ON TABLE announcements IS '公告：面向全量用户的系统通知';
COMMENT ON COLUMN announcements.title IS '公告标题';
COMMENT ON COLUMN announcements.content IS '公告正文（纯文本）';
COMMENT ON COLUMN announcements.published_at IS '上线时间，早于此时间不展示';
COMMENT ON COLUMN announcements.expires_at IS '过期时间，NULL 表示永不过期';

-- ═══ 公告阅读记录表 ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS announcement_reads (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id);

-- ═══ 种子数据：第一份公告（删档公测说明） ═════════════════════════════════════
-- 使用固定 UUID + ON CONFLICT DO NOTHING，确保幂等可重跑。
-- 此公告已被 0005_bulletin_update.sql 标记过期（expires_at = now()），
-- 后续部署仅保留插入记录的无害占位。

INSERT INTO announcements (id, title, content, published_at, expires_at)
VALUES (
  'b1e2c3d4-0002-4a7d-b8e1-1a2b3c4d5e6f',
  '删档公测说明',
  'Costra 目前处于删档公测阶段，时间为 2026 年 6 月 7 日至 6 月 30 日。公测期间您的所有记账数据将在测试结束后被清除。感谢您的参与和反馈，帮助我们打造更好的产品。',
  '2026-06-07T00:00:00+08:00',
  '2026-07-01T00:00:00+08:00'
) ON CONFLICT (id) DO NOTHING;

COMMIT;
