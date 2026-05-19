/**
 * Costra · Server · sync/pull 路由单测
 *
 * 卡号：COSTRA-154 · 事实源：dispatch §2.1 F 项 T1-T14
 *
 * 覆盖：
 *   T1  GET /v1/sync/pull 未登录 → 401
 *   T2  GET /v1/sync/pull 缺 family_id → 400
 *   T3  GET /v1/sync/pull 缺 since → 400
 *   T4  GET /v1/sync/pull family_id 非 UUID → 400
 *   T5  GET /v1/sync/pull since 非 ISO → 400
 *   T6  GET /v1/sync/pull family_id 越权 → 403
 *   T7  GET /v1/sync/pull since=epoch 无数据 → 200 watermark=since
 *   T8  GET /v1/sync/pull 写 3 entry 拉取 → ORDER BY updated_at ASC
 *   T9  GET /v1/sync/pull limit=2 → has_more=true
 *   T10 GET /v1/sync/pull 二次拉用上次 watermark → 跟进数据
 *   T11 GET /v1/sync/pull 含软删行 → entries 含 deleted_at !== null
 *   T12 GET /v1/sync/pull 响应 100% snake_case → 0 驼峰命中
 *   T13 GET /v1/sync/pull server_version 字段映射（非 DB version）
 *   T14 GET /v1/sync/pull limit=501 边界 → 400
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

// JWT 辅助
async function login(app: FastifyInstance): Promise<{ token: string; userId: string }> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid: 'openid-sync-pull-test', session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: 'test-sync-pull' },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

let app: FastifyInstance;
let token: string;
let userId: string;

const FAMILY_ID = '00000000-0000-0000-0000-0000000000f1';
const LEDGER_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_FAMILY_ID = '00000000-0000-0000-0000-0000000000f2';
const OTHER_LEDGER_ID = '00000000-0000-0000-0000-000000000002';
const EPOCH = '1970-01-01T00:00:00.000Z';

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  const loginResult = await login(app);
  token = loginResult.token;
  userId = loginResult.userId;

  // 插入测试基础数据
  const pool = (await import('../src/db/pool.js')).getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id) VALUES ($1, 'TestFamily', $2) ON CONFLICT DO NOTHING`,
    [FAMILY_ID, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Main') ON CONFLICT DO NOTHING`,
    [LEDGER_ID, FAMILY_ID],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
    [FAMILY_ID, userId],
  );

  // 插入另一个 family（越权测试用）
  await pool.query(
    `INSERT INTO families (id, name, owner_id) VALUES ($1, 'OtherFamily', $2) ON CONFLICT DO NOTHING`,
    [OTHER_FAMILY_ID, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Other') ON CONFLICT DO NOTHING`,
    [OTHER_LEDGER_ID, OTHER_FAMILY_ID],
  );
  // 注意：不把 user 加入 OTHER_FAMILY 的 family_members（越权测试用）
});

/** 通过 sync/push 创建 entry 的辅助函数 */
async function createEntryViaPush(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ server_id: string; server_version: number }> {
  const idempotencyKey = `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/sync/push',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': idempotencyKey,
    },
    payload: {
      ops: [{
        op: 'create',
        entity: 'entry',
        client_ref_id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        base_version: null,
        payload: {
          ledger_id: LEDGER_ID,
          amount: 10000,
          type: 'expense',
          occurred_at: '2026-05-19T10:00:00.000Z',
          ...overrides,
        },
      }],
    },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { results: Array<{ status: string; server_id?: string; server_version?: number }> };
  expect(body.results[0].status).toBe('ok');
  return { server_id: body.results[0].server_id!, server_version: body.results[0].server_version! };
}

describe('GET /sync/pull', () => {
  it('T1 未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('T2 缺 family_id → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T3 缺 since → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T4 family_id 非 UUID → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=not-a-uuid&since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T5 since 非 ISO → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=not-a-date`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T6 family_id 越权 → 403 PERMISSION_DENIED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${OTHER_FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { code: string };
    expect(body.code).toBe('PERMISSION_DENIED');
  });

  it('T7 since=epoch 无数据 → 200 + watermark=since + has_more=false + entries=[]', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { watermark: string; has_more: boolean; changes: { entries: unknown[] } };
    expect(body.watermark).toBe(EPOCH);
    expect(body.has_more).toBe(false);
    expect(body.changes.entries).toEqual([]);
  });

  it('T8 写 3 entry 拉取 → ORDER BY updated_at ASC', async () => {
    // 创建 3 个 entry
    await createEntryViaPush(app, token, { amount: 1000 });
    await createEntryViaPush(app, token, { amount: 2000 });
    await createEntryViaPush(app, token, { amount: 3000 });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { watermark: string; has_more: boolean; changes: { entries: Array<{ amount: number; updated_at: string }> } };
    expect(body.changes.entries.length).toBe(3);
    expect(body.has_more).toBe(false);
    // 验证 updated_at ASC 顺序
    const times = body.changes.entries.map(e => new Date(e.updated_at).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it('T9 limit=2 · 写 5 entry → has_more=true + entries.length=2', async () => {
    for (let i = 0; i < 5; i++) {
      await createEntryViaPush(app, token, { amount: (i + 1) * 1000 });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}&limit=2`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { watermark: string; has_more: boolean; changes: { entries: unknown[] } };
    expect(body.changes.entries.length).toBe(2);
    expect(body.has_more).toBe(true);
  });

  it('T10 二次拉用上次 watermark → 跟进数据', async () => {
    // 第一批：2 个 entry
    await createEntryViaPush(app, token, { amount: 1000 });
    await createEntryViaPush(app, token, { amount: 2000 });

    const firstRes = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}&limit=2`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(firstRes.statusCode).toBe(200);
    const firstBody = firstRes.json() as { watermark: string; has_more: boolean; changes: { entries: unknown[] } };
    const watermark1 = firstBody.watermark;

    // 再创建 3 个 entry
    await createEntryViaPush(app, token, { amount: 3000 });
    await createEntryViaPush(app, token, { amount: 4000 });
    await createEntryViaPush(app, token, { amount: 5000 });

    // 二次拉用上次 watermark
    const secondRes = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(watermark1)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondRes.statusCode).toBe(200);
    const secondBody = secondRes.json() as { watermark: string; has_more: boolean; changes: { entries: unknown[] } };
    expect(secondBody.changes.entries.length).toBe(3);
    expect(secondBody.has_more).toBe(false);
    // watermark 单调推进
    expect(new Date(secondBody.watermark).getTime()).toBeGreaterThanOrEqual(new Date(watermark1).getTime());
  });

  it('T11 含软删行 → entries 含 deleted_at !== null（协议 §3.5）', async () => {
    // 先创建 entry
    const { server_id, server_version } = await createEntryViaPush(app, token, { amount: 5000 });

    // 软删该 entry（sync/push delete 用 client_ref_id 作为 entry id）
    const delRes = await app.inject({
      method: 'POST',
      url: '/v1/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': `idemp-del-${Date.now()}`,
      },
      payload: {
        ops: [{
          op: 'delete',
          entity: 'entry',
          client_ref_id: server_id,
          base_version: server_version,
          payload: {},
        }],
      },
    });
    expect(delRes.statusCode).toBe(200);
    const delBody = delRes.json() as { results: Array<{ status: string }> };
    expect(delBody.results[0].status).toBe('ok');

    // 拉取应含软删行
    const pullRes = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pullRes.statusCode).toBe(200);
    const pullBody = pullRes.json() as { changes: { entries: Array<{ deleted_at: string | null }> } };
    const deletedEntry = pullBody.changes.entries.find(e => e.deleted_at !== null);
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry!.deleted_at).not.toBeNull();
  });

  it('T12 响应 100% snake_case → 0 驼峰命中', async () => {
    await createEntryViaPush(app, token, { amount: 1234 });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { changes: { entries: Array<Record<string, unknown>> } };
    expect(body.changes.entries.length).toBeGreaterThan(0);

    const entry = body.changes.entries[0];
    const keys = Object.keys(entry);
    // 驼峰模式：含大写字母的 key
    const camelCaseKeys = keys.filter(k => /[a-z][A-Z]/.test(k));
    expect(camelCaseKeys).toEqual([]);
  });

  it('T13 server_version 字段映射（非 DB 列名 version）', async () => {
    await createEntryViaPush(app, token, { amount: 5678 });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { changes: { entries: Array<Record<string, unknown>> } };
    const entry = body.changes.entries[0];
    // 应有 server_version 字段，不应有 version 字段
    expect(entry).toHaveProperty('server_version');
    expect(entry).not.toHaveProperty('version');
    expect(typeof entry.server_version).toBe('number');
  });

  it('T14 limit=501 边界 → 400（schema 上限 500）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sync/pull?family_id=${FAMILY_ID}&since=${encodeURIComponent(EPOCH)}&limit=501`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
