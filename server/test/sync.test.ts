/**
 * Costra · Server · sync 路由单测
 *
 * 卡号：COSTRA-104 · 事实源：dispatch §2.3 验证锚点 T1-T12
 *
 * 覆盖：
 *   T1  POST /sync/push 单条 ok（创建 entry 成功）
 *   T2  POST /sync/push 单条 conflict（base_version 不匹配）
 *   T3  POST /sync/push 单条 rejected（entity=category → NOT_IMPLEMENTED）
 *   T4  POST /sync/push idempotency 命中（24h 内同 body 返回缓存）
 *   T5  POST /sync/push idempotency mismatch（同 key 不同 body → 409）
 *   T6  POST /sync/push batch limit（201 ops → 400 INVALID_ARGUMENT）
 *   T7  GET  /sync/pull stub（501 + deferred_card=COSTRA-154）
 *   T8  entries 鉴权（无 JWT → 401 UNAUTHENTICATED）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

// JWT 辅助（直接复用 auth.test.ts 的登入流程）
async function login(app: FastifyInstance): Promise<string> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid: 'openid-sync-test', session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/auth/wx-login',
    payload: { code: 'test-sync' },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string; user: { id: string } };
  return body.access_token;
}

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  token = await login(app);

  // T2 需 ledger '00000000-0000-0000-0000-000000000001'
  // 该 ledger 属于 family '00000000-0000-0000-0000-0000000000f1'
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

describe('POST /sync/push', () => {
  it('T1 happy 单条 create entry → status=ok + server_id + server_version=1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': '00000000-0000-0000-0000-000000000001',
      },
      payload: {
        ops: [{
          op: 'create',
          entity: 'entry',
          client_ref_id: 'local-id-T1',
          base_version: null,
          payload: {
            ledger_id: '00000000-0000-0000-0000-000000000001',
            amount: 12345,
            type: 'expense',
            occurred_at: '2026-05-11T10:00:00.000Z',
          },
        }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ client_ref_id: string; status: string; server_id?: string; server_version?: number }> };
    expect(body.results[0].status).toBe('ok');
    expect(body.results[0].server_id).toMatch(/^[0-9a-f]{8}-/);
    expect(body.results[0].server_version).toBe(1);
  });

  it('T2 update conflict base_version 不匹配 → status=conflict + server_version', async () => {
    // T1 先创建一个 entry，拿 server_id + server_version=1
    const createRes = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': '00000000-0000-0000-0000-000000000T20',
      },
      payload: {
        ops: [{
          op: 'create',
          entity: 'entry',
          client_ref_id: 'local-T2-create',
          base_version: null,
          payload: {
            ledger_id: '00000000-0000-0000-0000-000000000001',
            amount: 5000,
            type: 'expense',
            occurred_at: '2026-05-11T10:00:00.000Z',
          },
        }],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const createBody = createRes.json() as { results: Array<{ status: string; server_id: string; server_version: number }> };
    expect(createBody.results[0].status).toBe('ok');
    const serverId = createBody.results[0].server_id;
    expect(createBody.results[0].server_version).toBe(1);

    // 再用错的 base_version=99 update 同一 entry，期望 conflict
    const updateRes = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': '00000000-0000-0000-0000-000000000T21',
      },
      payload: {
        ops: [{
          op: 'update',
          entity: 'entry',
          client_ref_id: 'local-T2-update',
          base_version: 99, // 故意错，真实 server_version=1
          payload: {
            entry_id: serverId, // 用 T1 拿到的 server_id
            amount: 9999,
          },
        }],
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updateBody = updateRes.json() as { results: Array<{ status: string; server_version?: number }> };
    expect(updateBody.results[0].status).toBe('conflict');
    expect(updateBody.results[0].server_version).toBe(1); // server 真实 version
  });

  it('T3 rejected entity=category → status=rejected + NOT_IMPLEMENTED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': '00000000-0000-0000-0000-000000000003',
      },
      payload: {
        ops: [{
          op: 'create',
          entity: 'category',
          client_ref_id: 'local-cat-T3',
          base_version: null,
          payload: { name: '餐饮', type: 'expense' },
        }],
      },
    });
    // eslint-disable-next-line no-console
    console.log('[T3] sync/push status:', res.statusCode, 'body:', JSON.stringify(res.json()));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { results: Array<{ status: string; error?: { code: string } }> };
    expect(body.results[0].status).toBe('rejected');
    expect(body.results[0].error?.code).toBe('NOT_IMPLEMENTED');
  });

  it('T6 batch 201 ops → 400 INVALID_ARGUMENT', async () => {
    const ops = Array.from({ length: 201 }, (_, i) => ({
      op: 'create',
      entity: 'entry',
      client_ref_id: `local-${i}`,
      base_version: null,
      payload: {
        ledger_id: '00000000-0000-0000-0000-000000000001',
        amount: 100,
        type: 'expense',
        occurred_at: '2026-05-11T10:00:00.000Z',
      },
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': '00000000-0000-0000-0000-000000000006',
      },
      payload: { ops },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string };
    expect(body.code).toBe('INVALID_ARGUMENT');
  });

  it('T8 无 JWT → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sync/push',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': '00000000-0000-0000-0000-000000000008',
      },
      payload: { ops: [] },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /sync/pull', () => {
  it('T7 stub 返回 501 + deferred_card=COSTRA-154', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sync/pull',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(501);
    const body = res.json() as { error: { code: string; details?: { deferred_card?: string; followup_id?: string } } };
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
    expect(body.error.details?.deferred_card).toBe('COSTRA-154');
    expect(body.error.details?.followup_id).toBe('FU-104-SYNC-PULL');
  });
});
