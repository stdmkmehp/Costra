/**
 * Costra · Server · PATCH /entries/{entry_id} 单测
 *
 * 卡号：COSTRA-152 · 事实源：dispatch v2.0 §2.1 D
 *
 * 覆盖：
 *   T1 未登录 401
 *   T2 entry_id 非 UUID 400
 *   T3 缺 version 400
 *   T4 update 成功 200 + version 递增
 *   T5 base_version 不匹配 409 + details.server_version
 *   T6 entry 不存在 404
 *   T7 跨 family 越权 → 404（守门补丁后返 null 等同不存在）
 *   T8 method-override（POST + X-HTTP-Method-Override: PATCH）等价于 PATCH 行为
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

async function login(app: FastifyInstance, openid = 'openid-patch-test'): Promise<string> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid, session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: 'test-patch' },
    headers: { 'content-type': 'application/json' },
  });
  return (res.json() as { access_token: string }).access_token;
}

let app: FastifyInstance;
let token: string;
let userId: string;
let entryId: string;

const familyId = '00000000-0000-0000-0000-0000000000f1';
const ledgerId = '00000000-0000-0000-0000-000000000001';

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  token = await login(app);

  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { sub: string };
  userId = payload.sub;

  const pool = (await import('../src/db/pool.js')).getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id, kind) VALUES ($1, 'PatchFamily', $2, 'shared')`,
    [familyId, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Main')`,
    [ledgerId, familyId],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [familyId, userId],
  );

  // 创建一条 entry 供 PATCH 测试
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/entries',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      ledger_id: ledgerId,
      amount: 1000,
      type: 'expense',
      occurred_at: '2026-05-20T10:00:00.000Z',
      note: 'original note',
    },
  });
  expect(createRes.statusCode).toBe(201);
  entryId = (createRes.json() as Record<string, unknown>).id as string;
});

function authHeader() {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('PATCH /entries/{entry_id}', () => {
  it('T1 未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${entryId}`,
      payload: { version: 1, amount: 2000 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('T2 entry_id 非 UUID → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/entries/not-a-uuid',
      headers: authHeader(),
      payload: { version: 1, amount: 2000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T3 缺 version → 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${entryId}`,
      headers: authHeader(),
      payload: { amount: 2000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('T4 update 成功 200 + version 递增', async () => {
    const res = await app.inject({
      method:'PATCH',
      url: `/v1/entries/${entryId}`,
      headers: authHeader(),
      payload: { version: 1, amount: 2000, note: 'updated note' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.version).toBe(2);
    expect(body.amount).toBe(2000);
    expect(body.note).toBe('updated note');
    expect(body.id).toBe(entryId);
    expect(body.ledger_id).toBe(ledgerId);
  });

  it('T5 base_version 不匹配 → 409 + details.server_version', async () => {
    // 先 PATCH 一次让 version 变成 2
    await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${entryId}`,
      headers: authHeader(),
      payload: { version: 1, amount: 2000 },
    });

    // 再用 version=1 PATCH → 应 409
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${entryId}`,
      headers: authHeader(),
      payload: { version: 1, amount: 3000 },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { code: string; details?: { server_version?: number } };
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.details?.server_version).toBe(2);
  });

  it('T6 entry 不存在 → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/entries/00000000-0000-0000-0000-000000009999',
      headers: authHeader(),
      payload: { version: 1, amount: 2000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('T7 跨 family 越权 → 404', async () => {
    // 登录 user B（不同 openid）
    const tokenB = await login(app, 'openid-patch-user-b');

    // user B 尝试 PATCH user A 的 entry → 404
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${entryId}`,
      headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
      payload: { version: 1, amount: 9999 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('T8 method-override 等价于 PATCH 行为', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/entries/${entryId}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-http-method-override': 'PATCH',
      },
      payload: { version: 1, amount: 3000, note: 'via method-override' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.version).toBe(2);
    expect(body.amount).toBe(3000);
    expect(body.note).toBe('via method-override');
  });
});

describe('POST /entries/{entry_id} without method-override', () => {
  it('should return 405 when no X-HTTP-Method-Override header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/entries/${entryId}`,
      headers: authHeader(),
      payload: { version: 1, amount: 100 },
    });
    expect(res.statusCode).toBe(405);
  });
});
