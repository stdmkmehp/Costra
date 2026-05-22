/**
 * Costra · Server · entries 路由单测
 *
 * 卡号：COSTRA-104 / COSTRA-152 / COSTRA-153
 * 事实源：dispatch §2.3 验证锚点 T7-T12 + T-CROSS-FAMILY
 *
 * 覆盖：
 *   T7   POST /entries ok（直接创建 entry）
 *   T8   GET  /entries 游标分页（25 条 → next_cursor）
 *   T11  GET  /entries/{id} 鉴权失败（无 JWT → 401）
 *   T12  POST /entries invalid body（400 INVALID_ARGUMENT）
 *   T-CROSS-FAMILY  GET /entries/{id} 跨 family 越权 → 404（守门补丁验证）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

async function login(app: FastifyInstance): Promise<string> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid: 'openid-entries-test', session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: 'test-entries' },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string; user: { id: string } };
  if (res.statusCode !== 200) {
    console.error('[DEBUG entries login fail]', res.statusCode, body);
  }
  return body.access_token;
}

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  token = await login(app);

  // COSTRA-104 R1.2: entries + ledgers + family_members + idempotency_keys 表在 setup.ts 补全
  // T7/T8/T11 需 ledger '00000000-0000-0000-0000-000000000001'
  // 该 ledger 属于 family '00000000-0000-0000-0000-0000000000f1'
  // wx-login 签发的 JWT payload.sub 即为当前 user id（不用再调用 wx-login）
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { sub: string };
  const userId = payload.sub;

  const familyId = '00000000-0000-0000-0000-0000000000f1';
  const ledgerId = '00000000-0000-0000-0000-000000000001';
  const pool = (await import('../src/db/pool.js')).getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id) VALUES ($1, 'TestFamily', $2) ON CONFLICT DO NOTHING`,
    [familyId, userId],
  );
  await pool.query(
    `INSERT INTO ledgers (id, family_id, name) VALUES ($1, $2, 'Main') ON CONFLICT DO NOTHING`,
    [ledgerId, familyId],
  );
  await pool.query(
    `INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
    [familyId, userId],
  );
});

function authHeader() {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

describe('POST /entries', () => {
  it('T7 happy 直接创建 entry → 201 + 完整 Entry 字段', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/entries',
      headers: authHeader(),
      payload: {
        ledger_id: '00000000-0000-0000-0000-000000000001',
        amount: 5000,
        type: 'income',
        occurred_at: '2026-05-11T08:00:00.000Z',
        note: '工资',
        client_ref_id: 'local-T7-salary',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.id).toMatch(/^[0-9a-f]{8}-/);
    expect(body.amount).toBe(5000);
    expect(body.currency).toBe('CNY');
    expect(body.type).toBe('income');
    expect(body.version).toBe(1);
    expect(body.client_ref_id).toBe('local-T7-salary'); // R1.x.3 防回归：request → response 字段保真
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('T12 invalid body 缺 required 字段 → 400 INVALID_ARGUMENT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/entries',
      headers: authHeader(),
      payload: { amount: 100 }, // 缺 ledger_id / type / occurred_at
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string };
    expect(body.code).toBe('INVALID_ARGUMENT');
  });
});

describe('GET /entries', () => {
  it('T8 游标分页 25 条 → 返回 next_cursor', async () => {
    // 先建 25 条 entry
for (let i = 0; i < 25; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/entries',
        headers: authHeader(),
        payload: {
          ledger_id: '00000000-0000-0000-0000-000000000001',
          amount: 100 + i,
          type: 'expense',
          occurred_at: '2026-05-11T10:00:00.000Z',
        },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: '/v1/entries?limit=20',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: unknown[]; next_cursor: string | null };
    expect(body.entries.length).toBe(20);
    expect(body.next_cursor).toBeTruthy();
  });

  it('T11 无 JWT → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/entries',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('CROSS-FAMILY guard', () => {
  it('T-CROSS-FAMILY user A 查 user B family 的 entry → 404', async () => {
    // 1. 用 user A（当前登录用户）创建 entry
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/entries',
      headers: authHeader(),
      payload: {
        ledger_id: '00000000-0000-0000-0000-000000000001',
        amount: 3000,
        type: 'expense',
        occurred_at: '2026-05-11T12:00:00.000Z',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const entryId = (createRes.json() as Record<string, unknown>).id as string;

    // 2. 登录 user B（不同 openid → 不同 user）
    setWxFetchForTests(
      (async () =>
        new Response(
          JSON.stringify({ openid: 'openid-user-b-cross-family', session_key: 'sk-b' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );
    const loginB = await app.inject({
      method: 'POST',
      url: '/v1/auth/wx-login',
      payload: { code: 'user-b' },
      headers: { 'content-type': 'application/json' },
    });
    const tokenB = (loginB.json() as { access_token: string }).access_token;

    // 3. user B 尝试 GET user A 的 entry → 应 404（跨 family 守门生效）
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/entries/${entryId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getRes.statusCode).toBe(404);
    const body = getRes.json() as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /entries/{entry_id} stub', () => {
  it('T10 stub 返回 501 + deferred_card=COSTRA-153', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/entries/00000000-0000-0000-0000-0000000000ee',
      headers: { authorization: authHeader().authorization }, // Bug3 fix: 不带 content-type 避免 Fastify 空 body 400
    });
    expect(res.statusCode).toBe(501);
    const body = res.json() as { error: { code: string; details?: { deferred_card?: string; followup_id?: string } } };
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
    expect(body.error.details?.deferred_card).toBe('COSTRA-153');
    expect(body.error.details?.followup_id).toBe('FU-104-ENTRIES-DELETE');
  });
});
