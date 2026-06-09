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
      preferred_updated_at    TIMESTAMPTZ
    );
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
      version         INTEGER NOT NULL DEFAULT 1
    );
    CREATE TYPE family_role AS ENUM ('owner', 'member', 'viewer');
    CREATE TABLE family_members (
      family_id       UUID NOT NULL,
      user_id         UUID NOT NULL,
      role            family_role NOT NULL,
      joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      left_at         TIMESTAMPTZ,
      -- migration 0012_family_members_color_slot.sql
      -- pg-mem 不支持 CHECK 含 BETWEEN OR NULL 复合表达式 · 改为应用层校验（familyMemberRepo selectAvailableSlot）
      color_slot      SMALLINT,
      PRIMARY KEY (family_id, user_id)
    );
    -- migration 0012: 同 family active 成员 slot 唯一 · left 成员 slot 为 NULL 不参与
    CREATE UNIQUE INDEX uq_family_members_color_slot_active
      ON family_members (family_id, color_slot) WHERE left_at IS NULL;
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
      'DELETE FROM entries; DELETE FROM categories; DELETE FROM family_invites; DELETE FROM family_members; DELETE FROM ledgers; DELETE FROM families; DELETE FROM user_sessions; DELETE FROM users; DELETE FROM idempotency_keys; DELETE FROM announcement_reads; DELETE FROM announcements;',
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

beforeEach(() => {
  resetPgMem();
  void resetRedisMock();
  setupDefaultWxFetch();
});

afterEach(() => {
  __resetWxFetchForTests();
});

afterAll(async () => {
  await closePool();
  await closeRedis();
});
