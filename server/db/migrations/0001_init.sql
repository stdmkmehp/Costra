-- =========================================================================
-- Costra DB Schema · 统一初始化迁移
-- Postgres >= 15 · 幂等 · 可安全重跑
-- 合并自原 0001~0014 migration（开发阶段不考虑历史兼容，清库重建）
-- 最后更新：2026-06-06
-- =========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";       -- 大小写不敏感邮箱/昵称

-- ═══════════════════════════════════════════════════════════════════════════════
-- ENUM 类型
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE family_role AS ENUM ('owner', 'member', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE family_kind AS ENUM ('personal', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE category_type AS ENUM ('income', 'expense');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE entry_type AS ENUM ('income', 'expense', 'transfer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE entry_shared_type AS ENUM ('personal', 'shared');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE budget_period AS ENUM ('monthly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEQUENCE
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS entries_change_seq
  AS BIGINT START WITH 1 INCREMENT BY 1 CACHE 100 NO CYCLE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- users
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wx_openid              TEXT UNIQUE NOT NULL,
    wx_unionid             TEXT UNIQUE,
    nickname               TEXT NOT NULL,
    avatar_url             TEXT,
    timezone               TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    has_completed_profile  BOOLEAN NOT NULL DEFAULT FALSE,
    preferred_family_id    UUID,   -- FK 延迟到 families 建表后添加
    preferred_ledger_id    UUID,   -- FK 延迟到 ledgers 建表后添加
    preferred_revision     BIGINT NOT NULL DEFAULT 0,
    preferred_updated_at   TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at             TIMESTAMPTZ,
    version                INTEGER NOT NULL DEFAULT 1
);
-- CREATE TABLE IF NOT EXISTS 不会补齐已有 users 表的新增列；幂等重跑时显式 ADD COLUMN。
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_family_id UUID,
  ADD COLUMN IF NOT EXISTS preferred_ledger_id UUID,
  ADD COLUMN IF NOT EXISTS preferred_revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preferred_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users (updated_at);

COMMENT ON COLUMN users.has_completed_profile IS
'用户是否完成资料补全（首登默认 FALSE · PATCH /users/me 成功后 TRUE）。';

-- ═══════════════════════════════════════════════════════════════════════════════
-- families
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS families (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    kind            family_kind NOT NULL DEFAULT 'shared',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_families_owner ON families (owner_id);
CREATE INDEX IF NOT EXISTS idx_families_updated_at ON families (updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_families_one_personal_per_owner
  ON families (owner_id)
  WHERE kind = 'personal' AND deleted_at IS NULL;

-- users.preferred_family_id FK（延迟添加）
DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT fk_users_preferred_family
    FOREIGN KEY (preferred_family_id) REFERENCES families(id) ON DELETE SET NULL
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- family_members
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS family_members (
    family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            family_role NOT NULL,
    color_slot      SMALLINT CHECK (color_slot IS NULL OR (color_slot BETWEEN 0 AND 7)),
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at         TIMESTAMPTZ,
    PRIMARY KEY (family_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members (user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_color_slot_active
  ON family_members (family_id, color_slot)
  WHERE left_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- family_invites
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS family_invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    inviter_id      UUID NOT NULL REFERENCES users(id),
    invite_token    TEXT NOT NULL UNIQUE,
    role            family_role NOT NULL DEFAULT 'member',
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    used_by         UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_family_invites_family ON family_invites (family_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ledgers
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ledgers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
    currency        TEXT NOT NULL DEFAULT 'CNY',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ledgers_family ON ledgers (family_id);
CREATE INDEX IF NOT EXISTS idx_ledgers_updated_at ON ledgers (updated_at);

-- users.preferred_ledger_id FK（延迟添加）
DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT fk_users_preferred_ledger
    FOREIGN KEY (preferred_ledger_id) REFERENCES ledgers(id) ON DELETE SET NULL
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- categories（含二级分类体系 + display_order）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS categories (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id         UUID REFERENCES families(id) ON DELETE CASCADE,  -- NULL = 系统预设
    name              TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
    type              category_type NOT NULL,
    icon              TEXT NOT NULL,
    color             TEXT,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_system         BOOLEAN NOT NULL DEFAULT false,
    parent_id         UUID REFERENCES categories(id) ON DELETE RESTRICT,
    is_direct_default BOOLEAN NOT NULL DEFAULT false,
    is_parent_default BOOLEAN NOT NULL DEFAULT false,
    display_order     SMALLINT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,
    version           INTEGER NOT NULL DEFAULT 1
);

-- 唯一索引：同一 scope 下分类名唯一（含 parent_id 维度）
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_family_name_type_parent
  ON categories (COALESCE(family_id, '00000000-0000-0000-0000-000000000000'), name, type, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_categories_family ON categories (family_id);
CREATE INDEX IF NOT EXISTS idx_categories_updated_at ON categories (updated_at);
CREATE INDEX IF NOT EXISTS idx_categories_type_parent_sort
  ON categories (type, parent_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_categories_parent_id
  ON categories (parent_id)
  WHERE deleted_at IS NULL;

-- 同名二级分类只有一个 is_direct_default=true
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_direct_default
  ON categories (name, type)
  WHERE family_id IS NULL AND parent_id IS NOT NULL AND is_direct_default = true AND deleted_at IS NULL;

-- 每父级最多 1 个 is_parent_default=true
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_parent_default
  ON categories (parent_id)
  WHERE is_parent_default = true AND deleted_at IS NULL;

-- 层级约束函数 + 触发器（最多两层 + 禁止自引用）
CREATE OR REPLACE FUNCTION chk_categories_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  parent_parent_id UUID;
BEGIN
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'category cannot reference itself as parent';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.parent_id INTO parent_parent_id
      FROM categories c WHERE c.id = NEW.parent_id;
    IF parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'category hierarchy exceeds 2 levels (parent is already a child)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE CONSTRAINT TRIGGER chk_categories_max_two_levels
    AFTER INSERT OR UPDATE OF parent_id ON categories
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION chk_categories_hierarchy();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- entries
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_id       UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
    amount          BIGINT NOT NULL CHECK (amount > 0),              -- 单位: 分
    currency        TEXT NOT NULL DEFAULT 'CNY',
    type            entry_type NOT NULL,
    category_id     UUID REFERENCES categories(id),
    note            TEXT CHECK (char_length(COALESCE(note,'')) <= 200),
    occurred_at     TIMESTAMPTZ NOT NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    account_id      UUID,
    to_account_id   UUID,
    shared_type     entry_shared_type,
    change_seq      BIGINT NOT NULL DEFAULT nextval('entries_change_seq'),
    client_ref_id   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_entries_ledger_client_ref UNIQUE (ledger_id, client_ref_id),
    CONSTRAINT entries_change_seq_unique UNIQUE (change_seq),
    CONSTRAINT chk_entries_shared_type_scope CHECK (
      shared_type IS NULL OR type = 'expense'
    )
);

CREATE INDEX IF NOT EXISTS idx_entries_ledger_occurred ON entries (ledger_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entries_updated_at ON entries (updated_at);
CREATE INDEX IF NOT EXISTS idx_entries_category ON entries (category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entries_created_by ON entries (created_by);
CREATE INDEX IF NOT EXISTS idx_entries_account ON entries (account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entries_ledger_change_seq ON entries (ledger_id, change_seq);
CREATE INDEX IF NOT EXISTS idx_entries_client_ref_id ON entries (client_ref_id) WHERE client_ref_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entries_shared_type ON entries (ledger_id, shared_type) WHERE shared_type IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_entries_category_id ON entries (category_id) WHERE deleted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- budgets
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS budgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_id       UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES categories(id),
    period          budget_period NOT NULL DEFAULT 'monthly',
    month           CHAR(7) NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    currency        TEXT NOT NULL DEFAULT 'CNY',
    alert_threshold INTEGER NOT NULL DEFAULT 80 CHECK (alert_threshold BETWEEN 50 AND 100),
    alerted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_ledger_scope_month
    ON budgets (ledger_id, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'), month)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_budgets_ledger_month ON budgets (ledger_id, month);
CREATE INDEX IF NOT EXISTS idx_budgets_updated_at ON budgets (updated_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- user_sessions
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_sessions (
    jti             UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    client_fp       TEXT,
    last_refresh_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
    ON user_sessions (user_id) WHERE revoked_at IS NULL;
-- 无谓词全索引：清理任务（maintenance.sh purge-sessions）执行 DELETE ... WHERE expires_at < now()，
-- 需删除所有已过期行（含"已吊销且已过期"的行）。带 WHERE revoked_at IS NULL 谓词会把已吊销行
-- 排除在索引外，使这部分行无法被该索引覆盖，导致清理走全表扫（见 0009）。
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions (expires_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- idempotency_keys
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             TEXT NOT NULL,
    endpoint        TEXT NOT NULL,
    actor_user_id   UUID REFERENCES users(id),
    request_hash    TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (key, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- audit_logs（分区表）
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id   UUID NOT NULL,
    family_id       UUID,
    entity          TEXT NOT NULL,
    entity_id       UUID,
    action          TEXT NOT NULL,
    before_version  INTEGER,
    after_version   INTEGER,
    diff            JSONB,
    client          JSONB,
    trace_id        TEXT,
    idempotency_key TEXT,
    PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

DO $$ BEGIN
  CREATE TABLE audit_logs_y2026m04 PARTITION OF audit_logs
      FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TABLE audit_logs_y2026m05 PARTITION OF audit_logs
      FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TABLE audit_logs_y2026m06 PARTITION OF audit_logs
      FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_family_time ON audit_logs (family_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs (actor_user_id, occurred_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- subscription_messages
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscription_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id     TEXT NOT NULL,
    scene           TEXT NOT NULL,
    authorized_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at         TIMESTAMPTZ,
    UNIQUE (user_id, template_id, scene, authorized_at)
);
CREATE INDEX IF NOT EXISTS idx_subs_user_scene ON subscription_messages (user_id, scene);

-- ═══════════════════════════════════════════════════════════════════════════════
-- updated_at 自动维护触发器
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'users','families','ledgers','categories','entries','budgets'
    ])
    LOOP
        EXECUTE format(
          'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s;',
          t, t
        );
        EXECUTE format(
          'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION touch_updated_at();',
          t, t
        );
    END LOOP;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 系统分类 SEED（独立事务 · 幂等：UPSERT 按 (family_id,name,type,parent_id) 唯一键）
-- 数据源：design/categories.yaml
-- 11 一级 + 80 二级 = 91 条（本基线为 expense+income；transfer 类目由 0004 引入）
--
-- ⚠️ 重要：本 seed 必须保证 ID 稳定（不再 DELETE+随机 UUID 重插）
-- 原因：entries.category_id / budgets.category_id 直接 FK 引用本表 ID。
-- 一旦有线上数据，DELETE 会被 FK 阻断；即便能删，重新 gen_random_uuid()
-- 会让所有历史 entries 变"未分类"。
--
-- 幂等机制：
--   - INSERT ... ON CONFLICT (family_id_normalized, name, type, parent_id_normalized)
--     WHERE deleted_at IS NULL · 命中冲突时仅 UPDATE 业务属性，不动 id
--   - 冲突目标对齐 partial unique index `uq_categories_family_name_type_parent`
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 一级分类（11 条：8 支出 + 3 收入）
-- 冲突时更新 icon/color/sort_order；不动 id/family_id/parent_id/type/is_system
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  -- 支出一级
  (NULL, '餐饮',     'expense', '餐', 'color.category.food',      1,  true, NULL, false, false, NULL),
  (NULL, '交通',     'expense', '行', 'color.category.transport', 2,  true, NULL, false, false, NULL),
  (NULL, '购物',     'expense', '购', 'color.category.shopping',  3,  true, NULL, false, false, NULL),
  (NULL, '生活',     'expense', '活', 'color.category.lifestyle', 4,  true, NULL, false, false, NULL),
  (NULL, '旅行',     'expense', '旅', 'color.category.travel',    5,  true, NULL, false, false, NULL),
  (NULL, '文娱',     'expense', '娱', 'color.category.culture',   6,  true, NULL, false, false, NULL),
  (NULL, '转账',     'expense', '转', 'color.category.transfer',  7,  true, NULL, false, false, NULL),
  (NULL, '其他',     'expense', '他', 'color.category.other',     99, true, NULL, false, false, NULL),
  -- 收入一级
  (NULL, '职业收入', 'income',  '薪', 'color.category.salary',    1,  true, NULL, false, false, NULL),
  (NULL, '投资与资产','income', '投', 'color.category.invest',    2,  true, NULL, false, false, NULL),
  (NULL, '意外收入', 'income',  '运', 'color.category.windfall',  3,  true, NULL, false, false, NULL)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ---------------------------------------------------------------------------
-- 二级分类（78 条：64 支出 + 14 收入）
-- 字段：family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order
-- is_parent_default=true：每个一级下 sort_order=1 的二级
-- display_order：全局展示区顺序（NULL=不展示，如一级默认子/同名副本）
-- ---------------------------------------------------------------------------

-- ----------- 餐饮 下二级（10 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '餐饮',     'expense', '餐', 'color.category.food', 1,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '外卖',     'expense', '餐', 'color.category.food', 3,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 1),
  (NULL, '买菜',     'expense', '餐', 'color.category.food', 4,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 2),
  (NULL, '水果',     'expense', '餐', 'color.category.food', 5,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 5),
  (NULL, '零食',     'expense', '餐', 'color.category.food', 6,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 6),
  (NULL, '饮料',     'expense', '餐', 'color.category.food', 7,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 7),
  (NULL, '酒水',     'expense', '餐', 'color.category.food', 8,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, 47),
  (NULL, '柴米油盐', 'expense', '餐', 'color.category.food', 9,  true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 13),
  (NULL, '聚餐',     'expense', '餐', 'color.category.food', 10, true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 12),
  (NULL, '宴请',     'expense', '餐', 'color.category.food', 11, true, (SELECT id FROM categories WHERE name='餐饮' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 22)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 交通 下二级（10 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '交通',     'expense', '行', 'color.category.transport', 1,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '打车',     'expense', '行', 'color.category.transport', 2,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 3),
  (NULL, '公交地铁', 'expense', '行', 'color.category.transport', 3,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 8),
  (NULL, '加油',     'expense', '行', 'color.category.transport', 4,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 15),
  (NULL, '停车',     'expense', '行', 'color.category.transport', 5,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 16),
  (NULL, '火车高铁', 'expense', '行', 'color.category.transport', 6,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 23),
  (NULL, '机票',     'expense', '行', 'color.category.transport', 7,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 24),
  (NULL, '汽车保养', 'expense', '行', 'color.category.transport', 8,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 34),
  (NULL, '保险',     'expense', '行', 'color.category.transport', 9,  true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 35),
  (NULL, '过路费',   'expense', '行', 'color.category.transport', 10, true, (SELECT id FROM categories WHERE name='交通' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 36)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 购物 下二级（8 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '购物',     'expense', '购', 'color.category.shopping', 1, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '日用',     'expense', '购', 'color.category.shopping', 2, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 4),
  (NULL, '服饰',     'expense', '购', 'color.category.shopping', 3, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 9),
  (NULL, '数码',     'expense', '购', 'color.category.shopping', 4, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 27),
  (NULL, '零食',     'expense', '购', 'color.category.shopping', 5, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '纸巾',     'expense', '购', 'color.category.shopping', 6, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 39),
  (NULL, '饮料',     'expense', '购', 'color.category.shopping', 7, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '护肤美妆', 'expense', '购', 'color.category.shopping', 8, true, (SELECT id FROM categories WHERE name='购物' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 26)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 生活 下二级（11 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '生活',     'expense', '活', 'color.category.lifestyle', 1,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '日用',     'expense', '活', 'color.category.lifestyle', 2,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '买菜',     'expense', '活', 'color.category.lifestyle', 3,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '柴米油盐', 'expense', '活', 'color.category.lifestyle', 4,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '宠物',     'expense', '活', 'color.category.lifestyle', 5,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 29),
  (NULL, '美容美发', 'expense', '活', 'color.category.lifestyle', 6,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 20),
  (NULL, '话费网费', 'expense', '活', 'color.category.lifestyle', 8,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 11),
  (NULL, '物业维修', 'expense', '活', 'color.category.lifestyle', 9,  true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 37),
  (NULL, '医疗',     'expense', '活', 'color.category.lifestyle', 10, true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 17),
  (NULL, '母婴',     'expense', '活', 'color.category.lifestyle', 11, true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 33),
  (NULL, '租房',     'expense', '活', 'color.category.lifestyle', 12, true, (SELECT id FROM categories WHERE name='生活' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 38)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 旅行 下二级（6 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '旅行',     'expense', '旅', 'color.category.travel', 1, true, (SELECT id FROM categories WHERE name='旅行' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '机票',     'expense', '旅', 'color.category.travel', 2, true, (SELECT id FROM categories WHERE name='旅行' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '酒店',     'expense', '旅', 'color.category.travel', 3, true, (SELECT id FROM categories WHERE name='旅行' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 21),
  (NULL, '交通',     'expense', '旅', 'color.category.travel', 4, true, (SELECT id FROM categories WHERE name='旅行' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '火车高铁', 'expense', '旅', 'color.category.travel', 5, true, (SELECT id FROM categories WHERE name='旅行' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL),
  (NULL, '餐饮',     'expense', '旅', 'color.category.travel', 6, true, (SELECT id FROM categories WHERE name='旅行' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), false, false, NULL)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 文娱 下二级（8 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '文娱',     'expense', '娱', 'color.category.culture', 1, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '订阅会员', 'expense', '娱', 'color.category.culture', 2, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 14),
  (NULL, '演出',     'expense', '娱', 'color.category.culture', 3, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 31),
  (NULL, '游戏',     'expense', '娱', 'color.category.culture', 4, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 28),
  (NULL, '运动',     'expense', '娱', 'color.category.culture', 5, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 19),
  (NULL, '电影',     'expense', '娱', 'color.category.culture', 6, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 18),
  (NULL, '门票',     'expense', '娱', 'color.category.culture', 7, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 30),
  (NULL, '教育',     'expense', '娱', 'color.category.culture', 8, true, (SELECT id FROM categories WHERE name='文娱' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 32)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 转账 下二级（3 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '转账', 'expense', '转', 'color.category.transfer', 1, true, (SELECT id FROM categories WHERE name='转账' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '还贷', 'expense', '转', 'color.category.transfer', 2, true, (SELECT id FROM categories WHERE name='转账' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 25),
  (NULL, '垫付', 'expense', '转', 'color.category.transfer', 3, true, (SELECT id FROM categories WHERE name='转账' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 45)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 其他 下二级（8 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '其他', 'expense', '他', 'color.category.other', 1, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  true,  NULL),
  (NULL, '红包', 'expense', '他', 'color.category.other', 2, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 40),
  (NULL, '礼金', 'expense', '他', 'color.category.other', 3, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 41),
  (NULL, '赡养', 'expense', '他', 'color.category.other', 4, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 43),
  (NULL, '捐赠', 'expense', '他', 'color.category.other', 5, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 44),
  (NULL, '丢失', 'expense', '他', 'color.category.other', 6, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 46),
  (NULL, '礼物', 'expense', '他', 'color.category.other', 7, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 42),
  (NULL, '罚款', 'expense', '他', 'color.category.other', 8, true, (SELECT id FROM categories WHERE name='其他' AND type='expense' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true,  false, 49)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 职业收入 下二级（4 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '工资', 'income', '薪', 'color.category.salary', 1, true, (SELECT id FROM categories WHERE name='职业收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, true,  NULL),
  (NULL, '奖金', 'income', '薪', 'color.category.salary', 2, true, (SELECT id FROM categories WHERE name='职业收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 1),
  (NULL, '兼职', 'income', '薪', 'color.category.salary', 3, true, (SELECT id FROM categories WHERE name='职业收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 2),
  (NULL, '报销', 'income', '薪', 'color.category.salary', 4, true, (SELECT id FROM categories WHERE name='职业收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 3)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 投资与资产 下二级（3 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '理财', 'income', '投', 'color.category.invest', 1, true, (SELECT id FROM categories WHERE name='投资与资产' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, true,  NULL),
  (NULL, '收租', 'income', '投', 'color.category.invest', 2, true, (SELECT id FROM categories WHERE name='投资与资产' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 4),
  (NULL, '利息', 'income', '投', 'color.category.invest', 3, true, (SELECT id FROM categories WHERE name='投资与资产' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 5)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

-- ----------- 意外收入 下二级（7 条）-----------
INSERT INTO categories (family_id, name, type, icon, color, sort_order, is_system, parent_id, is_direct_default, is_parent_default, display_order)
VALUES
  (NULL, '其他',     'income', '运', 'color.category.windfall', 1, true, (SELECT id FROM categories WHERE name='意外收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, true,  NULL),
  (NULL, '转账',     'income', '运', 'color.category.windfall', 2, true, (SELECT id FROM categories WHERE name='意外收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 8),
  (NULL, '红包',     'income', '运', 'color.category.windfall', 3, true, (SELECT id FROM categories WHERE name='意外收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 6),
  (NULL, '退款',     'income', '运', 'color.category.windfall', 4, true, (SELECT id FROM categories WHERE name='意外收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 7),
  (NULL, '中奖',     'income', '运', 'color.category.windfall', 5, true, (SELECT id FROM categories WHERE name='意外收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 10),
  (NULL, '闲置出售', 'income', '运', 'color.category.windfall', 6, true, (SELECT id FROM categories WHERE name='意外收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 11),
  (NULL, '礼金',     'income', '运', 'color.category.windfall', 7, true, (SELECT id FROM categories WHERE name='意外收入' AND type='income' AND parent_id IS NULL AND family_id IS NULL LIMIT 1), true, false, 9)
ON CONFLICT (
  COALESCE(family_id, '00000000-0000-0000-0000-000000000000'),
  name, type,
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')
) WHERE deleted_at IS NULL
DO UPDATE SET
  icon              = EXCLUDED.icon,
  color             = EXCLUDED.color,
  sort_order        = EXCLUDED.sort_order,
  is_direct_default = EXCLUDED.is_direct_default,
  is_parent_default = EXCLUDED.is_parent_default,
  display_order     = EXCLUDED.display_order;

COMMIT;
