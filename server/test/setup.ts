/**
 * Costra · Server · 测试全局 setup
 *
 * 卡号：COSTRA-101 · 事实源：dispatch §4 test/setup.ts
 *
 * 做三件事：
 *   1. 注入最小可用 env 供 config/env.ts / ttl.ts / subject.ts 读取（JWT_SECRET 硬编码 32+ 字节测试密钥）
 *   2. pg-mem 启动 → 执行 migrations 0001/0003（auth 流程仅依赖 users + user_sessions）→ 注入 pool
 *   3. ioredis-mock 注入
 *   4. wxFetch 替换为受控 mock，默认返回一个合法的 code2Session 响应；各用例再按需 override
 *
 * afterAll：关闭 pool / redis；__resetEnvForTests / __resetTTLForTests。
 */

import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newDb, DataType, type IMemoryDb } from 'pg-mem';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { setPoolForTests, closePool } from '../src/db/pool.js';
import { setRedisForTests, closeRedis } from '../src/db/redis.js';
import { setWxFetchForTests, __resetWxFetchForTests } from '../src/wx/code2Session.js';
import { __resetEnvForTests } from '../src/config/env.js';
import { __resetTTLForTests } from '../src/config/ttl.js';

// -----------------------------------------------------------------------------
// 1. env
// -----------------------------------------------------------------------------
function setupEnv(): void {
  // 测试密钥：32 字符刚好满足 env.ts 最低长度校验
  process.env.NODE_ENV = 'test';
  // inject 模式不真实监听端口；env schema 要求 PORT ∈ [1,65535]（Round-2 加固），
  // 故不注入该变量，交由 loadEnv 读默认值 '8080'（COSTRA-116 对齐 .env.example · 原 '3000' 为 COSTRA-101 R3 Verify 时选值）。
  delete process.env.PORT;
  process.env.LOG_LEVEL = 'fatal';
  process.env.DATABASE_URL = 'postgres://mock:mock@127.0.0.1:5432/costra_test';
  process.env.REDIS_URL = 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET = 'test-secret-aaaaaaaaaaaaaaaaaaaaaaaa'; // 36 chars
  process.env.JWT_ISSUER = 'costra-api-test';
  process.env.JWT_AUDIENCE = 'wx-test-appid';
  process.env.WX_APP_ID = 'wx-test-appid';
  process.env.WX_APP_SECRET = 'wx-test-appsecret';
  // 主体配置（subject.ts 启动期必读）
  process.env.SUBJECT_NAME = '测试主体';
  process.env.SUBJECT_TYPE = 'individual';
  process.env.SUBJECT_CONTACT_EMAIL = 'test@example.com';
  process.env.SUBJECT_PRIVACY_EFFECTIVE_DATE = '2026-01-01';
  // 虚拟支付（migration 0020 · tech-spec v1.2 §2.5）：默认 on 便于直测下单链路；
  // 测试 off/allowlist 场景时自行改写 process.env 后再次 __resetEnvForTests()。
  process.env.WX_PAY_MODE = 'on';
  process.env.WX_PAY_TEST_USER_IDS = '';
  process.env.WX_PAY_OFFER_ID = 'test-offer-id';
  process.env.WX_PAY_APP_KEY = 'test-app-key';
  process.env.WX_MSG_PUSH_TOKEN = '';

  __resetEnvForTests();
  __resetTTLForTests();
}

// -----------------------------------------------------------------------------
// 2. pg-mem
// -----------------------------------------------------------------------------
let memDb: IMemoryDb | null = null;

function applyMigrations(db: IMemoryDb): void {
  // pg-mem 不支持 pgcrypto / citext / 分区表 / partial index with functions；
  // 只抽取 auth 链路必需的 DDL（users + user_sessions）重写一份兼容版本
  const ddl = `
    CREATE TABLE users (
      id                      UUID PRIMARY KEY,
      wx_openid               TEXT UNIQUE NOT NULL,
      wx_unionid              TEXT UNIQUE,
      nickname                TEXT NOT NULL,
      avatar_url              TEXT,
      timezone                TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      has_completed_profile   BOOLEAN NOT NULL DEFAULT FALSE,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at              TIMESTAMPTZ,
      version                 INTEGER NOT NULL DEFAULT 1,
      -- migration 0011_users_preferred_family.sql
      preferred_family_id     UUID,
      preferred_ledger_id     UUID,
      -- migration 0003_user_preference_revision.sql
      preferred_revision      BIGINT NOT NULL DEFAULT 0,
      preferred_updated_at    TIMESTAMPTZ,
      -- migration 0018_users_is_gm.sql
      is_gm                   BOOLEAN NOT NULL DEFAULT FALSE,
      -- migration 0020_tips.sql
      tip_badge_hidden        BOOLEAN NOT NULL DEFAULT FALSE
    );
    -- migration 0020_tips.sql · tip_orders（pg-mem 适配版）
    -- 跳过 idx_tip_orders_probe_due（WHERE status='created' 列等值谓词 ·
    --   与 uq_families_one_personal_per_owner 同属 pg-mem 已知污染场景）；
    -- uq_tip_orders_wx_order_id（WHERE wx_order_id IS NOT NULL）属同族 IS NULL 谓词，直接建。
    CREATE TABLE IF NOT EXISTS tip_orders (
      id                  UUID PRIMARY KEY,
      user_id             UUID NOT NULL REFERENCES users(id),
      openid              TEXT NOT NULL,
      product_type        TEXT NOT NULL,
      product_key         TEXT NOT NULL,
      product_title       TEXT NOT NULL,
      wx_product_id       TEXT NOT NULL,
      price_cents         BIGINT NOT NULL,
      support_delta       INTEGER NOT NULL,
      entitlement_keys    TEXT[] NOT NULL,
      upstream_order_type SMALLINT,
      out_trade_no        TEXT NOT NULL,
      wx_order_id         TEXT,
      channel_order_id    TEXT,
      wxpay_order_id      TEXT,
      upstream_status     SMALLINT,
      status              TEXT NOT NULL DEFAULT 'created',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      paid_at             TIMESTAMPTZ,
      delivered_at        TIMESTAMPTZ,
      refunded_at         TIMESTAMPTZ,
      last_probed_at      TIMESTAMPTZ,
      next_probe_at       TIMESTAMPTZ NOT NULL,
      probe_count         INTEGER NOT NULL DEFAULT 0,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tip_orders_out_trade_no ON tip_orders (out_trade_no);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_tip_orders_wx_order_id ON tip_orders (wx_order_id) WHERE wx_order_id IS NOT NULL;
    CREATE TABLE user_sessions (
      jti             UUID PRIMARY KEY,
      user_id         UUID NOT NULL,
      issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      revoked_at      TIMESTAMPTZ,
      client_fp       TEXT,
      last_refresh_at TIMESTAMPTZ
    );
    -- COSTRA-104: entries 测试需补充的表（简化版 · 兼容 pg-mem）
    CREATE TYPE family_kind AS ENUM ('personal', 'shared');
    CREATE TABLE families (
      id              UUID PRIMARY KEY,
      name            TEXT NOT NULL,
      owner_id        UUID NOT NULL,
      kind            family_kind NOT NULL DEFAULT 'shared',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at      TIMESTAMPTZ,
      version         INTEGER NOT NULL DEFAULT 1
    );
    -- COSTRA-164: partial unique index · 每用户最多 1 个 personal family
    CREATE UNIQUE INDEX uq_families_one_personal_per_owner
      ON families (owner_id) WHERE kind = 'personal' AND deleted_at IS NULL;
    CREATE TABLE ledgers (
      id              UUID PRIMARY KEY,
      family_id       UUID NOT NULL,
      name            TEXT NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'CNY',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at      TIMESTAMPTZ,
      version         INTEGER NOT NULL DEFAULT 1,
      -- COSTRA-4xx · migration 0012：资产字段
      balance_cents        BIGINT NOT NULL DEFAULT 0,
      balance_baseline_seq BIGINT NOT NULL DEFAULT 0,
      balance_version     INTEGER NOT NULL DEFAULT 1,
      -- L13 · migration 0019：批量写入版本戳（E1）
      sync_epoch          BIGINT NOT NULL DEFAULT 0,
      -- migration 0021：导入 sync-hold 两列（worker 大事务前设置 · 提交时同事务释放）
      sync_hold_seq       BIGINT,
      sync_hold_until     TIMESTAMPTZ
    );
    -- migration 0021_data_jobs.sql · 导入/导出（pg-mem 适配版）
    -- 差异（同 tip_orders 既有做法）：
    --   - type/status/stage 用 TEXT 而非 enum；刻意不带任何 CHECK
    --     （chk_data_jobs_type_fields 四分支 / chk_import_detect_sessions_* 只能静态断言生产 SQL）；
    --   - detect_id 不带列级 UNIQUE / ON DELETE CASCADE；
    --   - 跳过全部部分索引：uq_data_jobs_run_token / uq_data_jobs_active_export_per_user /
    --     uq_data_jobs_active_import_per_family / idx_data_jobs_due /
    --     uq_data_jobs_idempotency_key / uq_detect_sessions_active_per_user（生产 DDL 保留）；
    --   - "每用户单一活跃导出任务"/"每用户单一进行中检测"在 pg-mem 由 create 路径的先 SELECT
    --     判定覆盖，生产竞态由部分唯一索引 23505 兜底（路由两层都接）。
    --   - stage 列仍是 TEXT，但必须注册 data_job_stage 枚举类型名：
    --     claimQueuedJobs 的 CASE 写 stage 带显式 CAST(... AS data_job_stage)
    --     （生产 42804 修复 · 2026-09-08），pg-mem 对未注册类型名直接抛
    --     "type does not exist"（2026-09-09 实锤 · 任务永滞 queued）。
    CREATE TYPE data_job_stage AS ENUM ('validating', 'writing', 'querying', 'packaging');
    CREATE TABLE IF NOT EXISTS import_detect_sessions (
      id                 UUID PRIMARY KEY,
      user_id            UUID NOT NULL REFERENCES users(id),
      family_id          UUID NOT NULL REFERENCES families(id),
      ledger_id          UUID NOT NULL REFERENCES ledgers(id),
      status             TEXT NOT NULL DEFAULT 'detecting',
      file_name          TEXT,
      file_size          BIGINT,
      file_sha256        TEXT,
      is_costra_export   BOOLEAN NOT NULL DEFAULT FALSE,
      formula_guard      TEXT,
      member_mapping     JSONB,
      artifact_path      TEXT,
      artifact_sha256    TEXT,
      report_path        TEXT,
      total_rows         INTEGER,
      importable_rows    INTEGER,
      error_count        INTEGER,
      warning_count      INTEGER,
      report_preview     JSONB,
      job_id             UUID,
      expires_at         TIMESTAMPTZ,
      report_expires_at  TIMESTAMPTZ,
      consumed_at        TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS data_jobs (
      id                 UUID PRIMARY KEY,
      type               TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'queued',
      user_id            UUID NOT NULL REFERENCES users(id),
      family_id          UUID NOT NULL REFERENCES families(id),
      ledger_id          UUID NOT NULL REFERENCES ledgers(id),
      detect_id          UUID,
      source_hash        TEXT,
      ruleset_version    INTEGER,
      export_from        TIMESTAMPTZ,
      export_to          TIMESTAMPTZ,
      attempts           INTEGER NOT NULL DEFAULT 0,
      stage              TEXT,
      stage_started_at   TIMESTAMPTZ,
      run_token          UUID,
      lease_expires_at   TIMESTAMPTZ,
      retryable          BOOLEAN NOT NULL DEFAULT false,
      error_code         TEXT,
      error_message      TEXT,
      next_attempt_at    TIMESTAMPTZ,
      expires_at         TIMESTAMPTZ,
      result_summary     JSONB,
      files              JSONB,
      file_expires_at    TIMESTAMPTZ,
      idempotency_key    TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at         TIMESTAMPTZ,
      finished_at        TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_data_jobs_owner_created ON data_jobs (user_id, created_at DESC);
    -- 非部分索引可直接建（同文件重复上传秒出的去重查找锚 · 与生产 DDL 对齐）
    CREATE INDEX IF NOT EXISTS idx_detect_sessions_dedup ON import_detect_sessions (user_id, ledger_id, file_sha256);
    CREATE TYPE family_role AS ENUM ('owner', 'member', 'viewer');
    CREATE TABLE family_members (
      family_id       UUID NOT NULL,
      user_id         UUID NOT NULL,
      role            family_role NOT NULL,
      joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      left_at         TIMESTAMPTZ,
      -- migration 0017: seat_order（原 color_slot 改名）= 座位号，唯一、单调递增、用于稳定排序
      -- pg-mem 不支持 CHECK 含 BETWEEN OR NULL 复合表达式 · 改为应用层校验（familyMemberRepo selectAvailableSlot）
      seat_order      SMALLINT,
      -- migration 0017: color_choice = 用户自选偏好色 0~7，允许撞色；left 成员为 NULL
      color_choice    SMALLINT,
      PRIMARY KEY (family_id, user_id)
    );
    -- migration 0017: 同 family active 成员 seat_order 唯一 · left 成员 seat_order 为 NULL 不参与
    CREATE UNIQUE INDEX uq_family_members_seat_active
      ON family_members (family_id, seat_order) WHERE left_at IS NULL;
    CREATE TABLE entries (
      id              UUID PRIMARY KEY,
      ledger_id       UUID NOT NULL,
      amount          BIGINT NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'CNY',
      type            TEXT NOT NULL,
      category_id     UUID,
      account_id      UUID,
      to_account_id   UUID,
      note            TEXT,
      occurred_at     TIMESTAMPTZ NOT NULL,
      created_by      UUID NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at      TIMESTAMPTZ,
      version         INTEGER NOT NULL DEFAULT 1,
      client_ref_id   TEXT
    );
    -- BUG-COSTRA-154 v1.2 升级（2026-05-22）· migration 0006_entries_change_seq.sql
    -- pg-mem 支持 CREATE SEQUENCE / nextval / ALTER TABLE ... DEFAULT nextval
    -- 不支持 trigger · 应用层 entryRepo 显式 SET change_seq = nextval(...) for UPDATE
    CREATE SEQUENCE IF NOT EXISTS entries_change_seq AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;
    ALTER TABLE entries ADD COLUMN change_seq BIGINT NOT NULL DEFAULT nextval('entries_change_seq');
    -- COSTRA-217 B2: entries.shared_type 公共/个人支出标记
    ALTER TABLE entries ADD COLUMN shared_type TEXT;
    -- pg-mem 不支持 CHECK 约束含列引用 · 改为应用层校验（entryService validateCreatePayload）
    -- COSTRA-217 B1: categories 二级分类体系
    CREATE TABLE categories (
      id              UUID PRIMARY KEY,
      family_id       UUID,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL,
      icon            TEXT NOT NULL,
      color           TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      is_system       BOOLEAN NOT NULL DEFAULT false,
      parent_id       UUID,
      is_direct_default BOOLEAN NOT NULL DEFAULT false,
      -- is_parent_default：精确标记"点父一级时自动选中的默认子分类"
      -- display_order：全局二级展示区的展示顺序，NULL=不展示
      is_parent_default BOOLEAN NOT NULL DEFAULT false,
      display_order   SMALLINT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at      TIMESTAMPTZ,
      version         INTEGER NOT NULL DEFAULT 1
    );
    -- pg-mem 实测：partial unique index 在 WHERE bool_col = true 谓词下会污染所有针对索引列的等值查询
    -- 改为应用层 + 真实 PG 约束兜底，pg-mem 跳过该 index
    -- 统计页接口性能索引
    -- pg-mem 对 partial index WHERE col IS NULL 谓词支持正常
    CREATE INDEX idx_entries_category_id ON entries (category_id) WHERE deleted_at IS NULL;
    CREATE INDEX idx_categories_parent_id ON categories (parent_id) WHERE deleted_at IS NULL;
    -- migration 0004_categories_restructure.sql · category_redirects 重定向表
    -- 硬删后服务端"category_id 不存在 → 找重定向 new_id"的唯一事实源
    CREATE TABLE category_redirects (
      old_id     UUID PRIMARY KEY,
      new_id     UUID NOT NULL REFERENCES categories(id),
      reason     TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_category_redirects_new_id ON category_redirects (new_id);
    CREATE TABLE idempotency_keys (
      key             TEXT NOT NULL,
      endpoint        TEXT NOT NULL,
      actor_user_id   UUID,
      request_hash    TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_body   JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (key, endpoint)
    );
    -- COSTRA-221: family_invites 表（测试需补充）
    CREATE TABLE family_invites (
      id              UUID PRIMARY KEY,
      family_id       UUID NOT NULL,
      inviter_id      UUID NOT NULL,
      invite_token    TEXT NOT NULL UNIQUE,
      role            family_role NOT NULL DEFAULT 'member',
      expires_at      TIMESTAMPTZ NOT NULL,
      used_at         TIMESTAMPTZ,
      used_by         UUID,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- 公告系统（migration 0002）
    CREATE TABLE announcements (
      id              UUID PRIMARY KEY,
      title           TEXT NOT NULL,
      content         TEXT NOT NULL,
      published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at      TIMESTAMPTZ
    );
    CREATE TABLE announcement_reads (
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, announcement_id)
    );
    CREATE INDEX idx_announcement_reads_user ON announcement_reads(user_id);

    -- ═══════════════════════════════════════════════════════════════
    -- migration 0011_recurring_entries.sql · 简化 pg-mem 兼容版
    -- （含 workday_calendars · 原 0012/0013 在上线前合并进来）
    -- 依据 docs/spike/pgmem-array-check.md 的适配策略：
    --   * ENUM → TEXT + CHECK IN (...)
    --   * 数组元素范围 / 长度 CHECK → 省略（service 层 validateCreate 兜底）
    --   * 复合 chk_recurring_period_fields → 省略（service 层校验）
    --   * chk_holidays_workdays_disjoint（数组重叠 && 运算符）→ pg-mem 不支持 · 省略
    --   * pg-mem 已验证支持 SMALLINT[] / INTEGER[] 列基础 INSERT/SELECT
    -- ═══════════════════════════════════════════════════════════════
    CREATE TABLE recurring_rules (
      id              UUID PRIMARY KEY,
      ledger_id       UUID NOT NULL,
      created_by      UUID NOT NULL,

      type            TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
      amount          BIGINT NOT NULL CHECK (amount > 0),
      currency        TEXT NOT NULL DEFAULT 'CNY',
      category_id     UUID,
      account_id      UUID,
      to_account_id   UUID,
      note            TEXT,
      shared_type     TEXT,

      period          TEXT NOT NULL CHECK (period IN
        ('weekly','monthly','yearly','workday','daily')),
      period_interval SMALLINT NOT NULL DEFAULT 1,
      days_of_week    SMALLINT[],
      days_of_month   SMALLINT[],
      year_month_days INTEGER[],

      execute_bucket  TEXT NOT NULL CHECK (execute_bucket IN
        ('dawn','morning','afternoon','night')),
      execute_hour    SMALLINT NOT NULL CHECK (execute_hour BETWEEN 0 AND 23),
      execute_minute  SMALLINT NOT NULL CHECK (execute_minute BETWEEN 0 AND 59),
      timezone        TEXT NOT NULL,

      start_date      DATE NOT NULL,
      end_date        DATE,
      status          TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','ended','auto_paused')),

      next_run_at     TIMESTAMPTZ NOT NULL,
      last_run_at     TIMESTAMPTZ,
      last_run_status TEXT,
      consecutive_failures SMALLINT NOT NULL DEFAULT 0,

      -- 复用 entries_change_seq（0006 已 CREATE SEQUENCE）
      change_seq      BIGINT NOT NULL DEFAULT nextval('entries_change_seq'),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at      TIMESTAMPTZ,
      version         INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX idx_recurring_rules_next_run ON recurring_rules (next_run_at)
      WHERE status = 'active' AND deleted_at IS NULL;
    CREATE INDEX idx_recurring_rules_created_by ON recurring_rules (created_by)
      WHERE deleted_at IS NULL;

    -- ═══════════════════════════════════════════════════════════════════════
    -- workday_calendars 表（同属 migration 0011 · 原 0012 合并进来）
    --   * chk_holidays_workdays_disjoint（数组重叠 && 运算符）→ pg-mem 不支持 · 省略
    --     约束由真实 PG migration 兜底
    -- ═══════════════════════════════════════════════════════════════════════
    CREATE TABLE workday_calendars (
      year        SMALLINT PRIMARY KEY,
      holidays    TEXT[] NOT NULL,
      workdays    TEXT[] NOT NULL,
      source      TEXT,
      source_url  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- entries 表新增 source_recurring_id 列（migration 0011 ALTER）
    ALTER TABLE entries ADD COLUMN source_recurring_id UUID REFERENCES recurring_rules(id) ON DELETE SET NULL;
    CREATE INDEX idx_entries_source_recurring ON entries (source_recurring_id)
      WHERE source_recurring_id IS NOT NULL AND deleted_at IS NULL;

    -- ═══════════════════════════════════════════════════════════════════════
    -- COSTRA-4xx · migration 0013：budgets v2 表（月度总预算 · 仅 ledger_id+month 维度）
    -- v1 旧表从未启用，直接重建
    -- ═══════════════════════════════════════════════════════════════════════
    DROP TABLE IF EXISTS budgets;
    CREATE TABLE budgets (
      id             UUID PRIMARY KEY,
      ledger_id      UUID NOT NULL,
      month          CHAR(7) NOT NULL,
      amount_cents   BIGINT NOT NULL CHECK (amount_cents >= 0),
      currency       TEXT NOT NULL DEFAULT 'CNY',
      updated_by     UUID NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at     TIMESTAMPTZ,
      version        INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX uq_budgets_ledger_month
      ON budgets (ledger_id, month) WHERE deleted_at IS NULL;
    CREATE INDEX idx_budgets_ledger_month ON budgets (ledger_id, month);
    CREATE INDEX idx_budgets_updated_at ON budgets (updated_at);
  `;
  db.public.none(ddl);

  // 读取原始 migration 文件仅供文档证据；实际 DDL 以上面简化版为准
  try {
    const path = join(process.cwd(), 'db', 'migrations', '0001_init.sql');
    void readFileSync(path, 'utf-8'); // read for coverage
  } catch {
    /* ignore */
  }
}

function setupPgMem(): void {
  memDb = newDb({ autoCreateForeignKeyIndices: true });
  registerPgMemFunctions(memDb);
  applyMigrations(memDb);
  const { Pool } = memDb.adapters.createPg();
  const pool = new Pool();
  setPoolForTests(pool);
}

/**
 * 注入 pg-mem 默认不支持的 PostgreSQL 函数（mock 实现）
 *
 * 历史修订：
 *   - R1.x.2（2026-05-22 BUG-154 v1.1）：注册 timezone() / to_char() 输出微秒精度 ISO
 *   - R1.x.2（2026-05-22 BUG-154 v1.2）：移除 to_char/timezone（不再用 ISO 微秒）·
 *     新增 setval() mock（pg-mem 不原生支持 · 但 nextval/CREATE SEQUENCE 都原生支持）
 *
 * 当前协议（v1.2）：watermark 用 BIGINT change_seq · 不再用 ISO 时间戳
 *   pg-mem 实测能力：
 *     ✅ CREATE SEQUENCE / nextval（原生）
 *     ✅ ALTER TABLE ADD COLUMN ... DEFAULT nextval（原生）
 *     ❌ setval（需 mock · 仅 return val 不真改 sequence 状态 · 测试场景够用）
 *     ❌ CREATE TRIGGER / plpgsql（不支持 · 应用层显式 nextval 替代）
 */
function registerPgMemFunctions(db: IMemoryDb): void {
  // setval('seq_name', val) → BIGINT
  // setval('seq_name', val, called_bool) → BIGINT
  // pg-mem 不原生支持 · mock 仅 return val（不改 sequence 内部状态 · 但测试场景够用）
  db.public.registerFunction({
    name: 'setval',
    args: [DataType.text, DataType.bigint],
    returns: DataType.bigint,
    implementation: (_seq: string, val: number): number => val,
  });
  db.public.registerFunction({
    name: 'setval',
    args: [DataType.text, DataType.bigint, DataType.bool],
    returns: DataType.bigint,
    implementation: (_seq: string, val: number, _called: boolean): number => val,
  });
}

function resetPgMem(): void {
  if (memDb) {
    memDb.public.none(
      'DELETE FROM data_jobs; DELETE FROM import_detect_sessions; DELETE FROM recurring_rules; DELETE FROM workday_calendars; DELETE FROM entries; DELETE FROM budgets; DELETE FROM category_redirects; DELETE FROM categories; DELETE FROM family_invites; DELETE FROM family_members; DELETE FROM ledgers; DELETE FROM families; DELETE FROM user_sessions; DELETE FROM tip_orders; DELETE FROM users; DELETE FROM idempotency_keys; DELETE FROM announcement_reads; DELETE FROM announcements;',
    );
  }
}

// 3. ioredis-mock
// -----------------------------------------------------------------------------
let redisMock: Redis | null = null;

function setupRedisMock(): void {
  redisMock = new (RedisMock as unknown as new () => Redis)();
  setRedisForTests(redisMock);
}

async function resetRedisMock(): Promise<void> {
  if (redisMock) {
    await (redisMock as unknown as { flushall: () => Promise<'OK'> }).flushall();
  }
}

// -----------------------------------------------------------------------------
// 4. wxFetch mock
// -----------------------------------------------------------------------------
function setupDefaultWxFetch(): void {
  const mockFetch = async (_input: RequestInfo | URL): Promise<Response> => {
    // 默认：返回一个合法的 code2Session 成功响应
    return new Response(
      JSON.stringify({
        openid: 'mock-openid-default',
        session_key: 'mock-session-key',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  setWxFetchForTests(mockFetch as unknown as typeof fetch);
}

// -----------------------------------------------------------------------------
// Vitest lifecycle
// -----------------------------------------------------------------------------
beforeAll(() => {
  setupEnv();
  setupPgMem();
  setupRedisMock();
});

beforeEach(async () => {
  // env 单例每用例重置（测试改写 process.env.WX_PAY_* 等后不得跨用例残留）
  setupEnv();
  resetPgMem();
  await resetRedisMock();
  setupDefaultWxFetch();
});

afterEach(() => {
  __resetWxFetchForTests();
});

afterAll(async () => {
  await closePool();
  await closeRedis();
});
