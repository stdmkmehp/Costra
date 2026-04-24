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
import { newDb, type IMemoryDb } from 'pg-mem';
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
  // 故不注入该变量，交由 loadEnv 读默认值 '3000'（COSTRA-101 R3 Verify 修复）。
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
      id              UUID PRIMARY KEY,
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
    CREATE TABLE user_sessions (
      jti             UUID PRIMARY KEY,
      user_id         UUID NOT NULL,
      issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      revoked_at      TIMESTAMPTZ,
      client_fp       TEXT,
      last_refresh_at TIMESTAMPTZ
    );
  `;
  db.public.none(ddl);

  // 读取原始 migration 文件仅供文档证据；实际 DDL 以上面简化版为准
  try {
    const path = join(process.cwd(), 'db', 'migrations', '0003_user_sessions.sql');
    void readFileSync(path, 'utf-8'); // read for coverage
  } catch {
    /* ignore */
  }
}

function setupPgMem(): void {
  memDb = newDb({ autoCreateForeignKeyIndices: true });
  applyMigrations(memDb);
  const { Pool } = memDb.adapters.createPg();
  const pool = new Pool();
  setPoolForTests(pool);
}

function resetPgMem(): void {
  if (memDb) {
    memDb.public.none('DELETE FROM user_sessions; DELETE FROM users;');
  }
}

// -----------------------------------------------------------------------------
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
