/**
 * Costra · Server · DELETE /entries/{entry_id} 单测
 *
 * 卡号：COSTRA-153 · 事实源：dispatch v2.0 §2.1 C
 *
 * 覆盖：
 *   T1 未登录 401
 *   T2 缺 version query 400
 *   T3 删除成功 204 + DB deleted_at != null + version+1 + change_seq 推进
 *   T4 base_version 不匹配 409 + details.server_version
 *   T5 entry 不存在 404
 *   T6 跨 family 越权 → 404（守门补丁后返 null 等同不存在）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';

async function login(app: FastifyInstance, openid = 'openid-delete-test'): Promise<string> {
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
    payload: { code: 'test-delete' },
    headers: { 'content-type': 'application/json' },
  });
  return (res.json() as { access_token: string }).access_token;
}

let app: FastifyInstance;
let token: string;
let userId: string;
let entryId: string;
let entryChangeSeq: number;

const familyId = '00000000-0000-0000-0000-0000000000f2';
const ledgerId = '00000000-0000-0000-0000-000000000002';

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  token = await login(app);

  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as { sub: string };
  userId = payload.sub;

  const pool = (await import('../src/db/pool.js')).getPool();
  await pool.query(
    `INSERT INTO families (id, name, owner_id) VALUES ($1, 'DeleteFamily', $2) ON CONFLICT DO NOTHING`,
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

  // 创建一条 entry 供 DELETE 测试
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/entries',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      ledger_id: ledgerId,
      amount: 500,
      type: 'expense',
      occurred_at: '2026-05-20T14:00:00.000Z',
      note: 'to be deleted',
    },
  });
  expect(createRes.statusCode).toBe(201);
  const createBody = createRes.json() as Record<string, unknown>;
  entryId = createBody.id as string;
  // change_seq 不在 POST 响应中 · 通过 DB 查询获取原始 change_seq
  const pool0 = (await import('../src/db/pool.js')).getPool();
  const dbRes0 = await pool0.query('SELECT change_seq FROM entries WHERE id = $1', [entryId]);
  entryChangeSeq = Number(dbRes0.rows[0].change_seq);
});

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

describe('DELETE /entries/{entry_id}', () => {
  it('T1 未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/entries/${entryId}?version=1`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('T2 缺 version query → 400', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/entries/${entryId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('T3 删除成功 204 + DB deleted_at != null + version+1 + change_seq 推进', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/entries/${entryId}?version=1`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(204);

    // 验证 DB：deleted_at IS NOT NULL + version = 2 + change_seq > 原 change_seq
    const pool = (await import('../src/db/pool.js')).getPool();
    const dbRes = await pool.query(
      'SELECT deleted_at, version, change_seq FROM entries WHERE id = $1',
      [entryId],
    );
    expect(dbRes.rows.length).toBe(1);
    expect(dbRes.rows[0].deleted_at).not.toBeNull();
    expect(dbRes.rows[0].version).toBe(2);
    expect(Number(dbRes.rows[0].change_seq)).toBeGreaterThan(entryChangeSeq);
  });

  it('T4 base_version 不匹配 → 409 + details.server_version', async () => {
    // 先 PATCH 让 version 变成 2
    await app.inject({
      method: 'PATCH',
      url: `/v1/entries/${entryId}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { version: 1, amount: 600 },
    });

    // 用 version=1 DELETE → 应 409
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/entries/${entryId}?version=1`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { code: string; details?: { server_version?: number } };
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(body.details?.server_version).toBe(2);
  });

  it('T5 entry 不存在 → 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/entries/00000000-0000-0000-0000-000000009999?version=1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('T6 跨 family 越权 → 404', async () => {
    // 登录 user B（不同 openid）
    const tokenB = await login(app, 'openid-delete-user-b');

    // user B 尝试 DELETE user A 的 entry → 404
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/entries/${entryId}?version=1`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
