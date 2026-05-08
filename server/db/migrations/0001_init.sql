-- =========================================================================
-- Costra DB Schema v1 · 初始化迁移
-- Owner: Backend-Agent · 卡号: COSTRA-021 · 日期: 2026-04-21
-- 约束来源: ADR-0004 (金额分/UTC时间/软删/乐观锁/审计)
-- Postgres >= 15
-- =========================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";       -- 大小写不敏感邮箱/昵称

-- ---------------- users ----------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wx_openid       TEXT UNIQUE NOT NULL,
    wx_unionid      TEXT UNIQUE,
    nickname        TEXT NOT NULL,
    avatar_url      TEXT,
    timezone        TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_users_updated_at ON users (updated_at);

-- ---------------- families ----------------
CREATE TABLE families (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_families_owner ON families (owner_id);
CREATE INDEX idx_families_updated_at ON families (updated_at);

-- ---------------- family_members ----------------
CREATE TYPE family_role AS ENUM ('owner', 'member', 'viewer');

CREATE TABLE family_members (
    family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            family_role NOT NULL,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at         TIMESTAMPTZ,
    PRIMARY KEY (family_id, user_id)
);
CREATE INDEX idx_family_members_user ON family_members (user_id) WHERE left_at IS NULL;

-- ---------------- family_invites ----------------
CREATE TABLE family_invites (
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
CREATE INDEX idx_family_invites_family ON family_invites (family_id);

-- ---------------- ledgers ----------------
CREATE TABLE ledgers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id       UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
    currency        TEXT NOT NULL DEFAULT 'CNY',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_ledgers_family ON ledgers (family_id);
CREATE INDEX idx_ledgers_updated_at ON ledgers (updated_at);

-- ---------------- categories ----------------
CREATE TYPE category_type AS ENUM ('income', 'expense');

CREATE TABLE categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id       UUID REFERENCES families(id) ON DELETE CASCADE,  -- NULL = 系统预设
    name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 16),
    type            category_type NOT NULL,
    icon            TEXT NOT NULL,
    color           TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_system       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX uq_categories_family_name_type
    ON categories (COALESCE(family_id, '00000000-0000-0000-0000-000000000000'), name, type)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_categories_family ON categories (family_id);
CREATE INDEX idx_categories_updated_at ON categories (updated_at);

-- ---------------- entries ----------------
CREATE TYPE entry_type AS ENUM ('income', 'expense', 'transfer');

CREATE TABLE entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_id       UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
    amount          BIGINT NOT NULL CHECK (amount > 0),              -- 单位: 分
    currency        TEXT NOT NULL DEFAULT 'CNY',
    type            entry_type NOT NULL,
    category_id     UUID REFERENCES categories(id),
    note            TEXT CHECK (char_length(COALESCE(note,'')) <= 200),
    occurred_at     TIMESTAMPTZ NOT NULL,                             -- 用户选择的发生时间（UTC 存储）
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1,
    client_ref_id   TEXT,                                             -- 客户端离线本地 id，去重用
    CONSTRAINT uq_entries_ledger_client_ref UNIQUE (ledger_id, client_ref_id)
);
CREATE INDEX idx_entries_ledger_occurred ON entries (ledger_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_updated_at ON entries (updated_at);
CREATE INDEX idx_entries_category ON entries (category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_entries_created_by ON entries (created_by);

-- ---------------- budgets ----------------
CREATE TYPE budget_period AS ENUM ('monthly');

CREATE TABLE budgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_id       UUID NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES categories(id),                   -- NULL = 总预算
    period          budget_period NOT NULL DEFAULT 'monthly',
    month           CHAR(7) NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
    amount          BIGINT NOT NULL CHECK (amount > 0),
    currency        TEXT NOT NULL DEFAULT 'CNY',
    alert_threshold INTEGER NOT NULL DEFAULT 80 CHECK (alert_threshold BETWEEN 50 AND 100),
    alerted_at      TIMESTAMPTZ,                                       -- 触发过预警的时间
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX uq_budgets_ledger_scope_month
    ON budgets (ledger_id, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'), month)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_budgets_ledger_month ON budgets (ledger_id, month);
CREATE INDEX idx_budgets_updated_at ON budgets (updated_at);

-- ---------------- idempotency_keys ----------------
CREATE TABLE idempotency_keys (
    key             TEXT NOT NULL,
    endpoint        TEXT NOT NULL,
    actor_user_id   UUID REFERENCES users(id),
    request_hash    TEXT NOT NULL,                                     -- body sha256
    response_status INTEGER NOT NULL,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (key, endpoint)
);
CREATE INDEX idx_idempotency_expires ON idempotency_keys (expires_at);

-- ---------------- audit_logs ----------------
CREATE TABLE audit_logs (
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

-- 初始分区（2026-04 / 2026-05 / 2026-06），实际运维按月滚动创建
CREATE TABLE audit_logs_y2026m04 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_logs_y2026m05 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_logs_y2026m06 PARTITION OF audit_logs
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX idx_audit_family_time ON audit_logs (family_id, occurred_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs (entity, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs (actor_user_id, occurred_at DESC);

-- ---------------- subscription_messages ----------------
CREATE TABLE subscription_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id     TEXT NOT NULL,
    scene           TEXT NOT NULL,
    authorized_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    used_at         TIMESTAMPTZ,
    UNIQUE (user_id, template_id, scene, authorized_at)
);
CREATE INDEX idx_subs_user_scene ON subscription_messages (user_id, scene);

-- ---------------- updated_at 自动维护 ----------------
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
          'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION touch_updated_at();',
          t, t
        );
    END LOOP;
END $$;

COMMIT;

-- 运营风险审查（容量 / 清理 / 索引 / 软删-硬删策略）见 docs/db/ops-risk-audit-todo.md
-- FU-DB-OPS-AUDIT · P3 · 触发阈值 DAU > 100 / Sprint-2+ DBA 体检窗口
