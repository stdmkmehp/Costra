/**
 * Costra · Server · /users/me 路由单测
 *
 * 卡号：COSTRA-158 · 事实源：dispatch §2.1 G 测表
 *
 * 覆盖：
 *   T1   GET  /v1/users/me 未登录 → 401 UNAUTHENTICATED
 *   T2   GET  /v1/users/me 登录后 → 200 + User schema 完整字段 + has_completed_profile=false
 *   T3   PATCH /v1/users/me 未登录 → 401
 *   T4   PATCH /v1/users/me body 全空 → 400 INVALID_ARGUMENT
 *   T5   PATCH /v1/users/me nickname='张三' → 200 + nickname='张三' + has_completed_profile=true
 *   T6   PATCH 第二次 nickname='李四' → 200 + has_completed_profile 保持 true
 *   T7   PATCH avatar_url=null 显式清空 → 200 + avatar_url=null + has_completed_profile=true
 *   T8   PATCH nickname 超长 33 字符 → 400 INVALID_ARGUMENT
 *   T9   K3 兼容：POST /v1/users/me + X-HTTP-Method-Override: PATCH + body → 200
 *   T10  K3 不兼容反例：POST /v1/users/me 不带 override header → 405
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { getPool } from '../src/db/pool.js';

let app: FastifyInstance;
let token: string;

async function login(app: FastifyInstance, openid = 'openid-users-test'): Promise<string> {
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
    payload: { code: 'test-users' },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string };
  return body.access_token;
}

function authHeader(overrides?: Record<string, string>) {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    ...overrides,
  };
}

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
  token = await login(app);
});

describe('GET /v1/users/me', () => {
  it('T1 未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('T2 登录后 → 200 + User schema 完整字段 + has_completed_profile=false', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      nickname: string;
      avatar_url: string | null;
      timezone: string;
      has_completed_profile: boolean;
      is_gm: boolean;
      created_at: string;
      updated_at: string;
    };
    expect(body.id).toMatch(/^[0-9a-f]{8}-/);
    expect(body.nickname).toBe('微信用户');
    expect(body.has_completed_profile).toBe(false);
    expect(body.is_gm).toBe(false); // migration 0018: 默认非 GM
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('PATCH /v1/users/me', () => {
  it('T3 未登录 → 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { nickname: 'test' },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('T4 body 全空 → 400 INVALID_ARGUMENT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: {},
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string };
    expect(body.code).toBe('INVALID_ARGUMENT');
  });

  it('T5 nickname=张三 → 200 + nickname=张三 + has_completed_profile=true', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { nickname: '张三' },
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nickname: string; has_completed_profile: boolean };
    expect(body.nickname).toBe('张三');
    expect(body.has_completed_profile).toBe(true);
  });

  it('T6 第二次 PATCH nickname=李四 → has_completed_profile 保持 true', async () => {
    // 第一次 PATCH
    await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { nickname: '张三' },
      headers: authHeader(),
    });
    // 第二次 PATCH
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { nickname: '李四' },
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nickname: string; has_completed_profile: boolean };
    expect(body.nickname).toBe('李四');
    expect(body.has_completed_profile).toBe(true);
  });

  it('T7 avatar_url=null 显式清空 → 200 + avatar_url=null + has_completed_profile=true', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { avatar_url: null },
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { avatar_url: string | null; has_completed_profile: boolean };
    expect(body.avatar_url).toBeNull();
    expect(body.has_completed_profile).toBe(true);
  });

  it('T8 nickname 超长 33 字符 → 400 INVALID_ARGUMENT', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { nickname: 'A'.repeat(33) },
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string };
    expect(body.code).toBe('INVALID_ARGUMENT');
  });

  // migration 0018: RETURNING 补 is_gm 后，GM 用户 PATCH 后响应仍携带 is_gm=true
  // 回归防线：docs/ops/gm-impersonate-design.md §2.1 明确要求所有 SELECT/RETURNING 补 is_gm
  it('T8b GM 用户 PATCH 后响应 is_gm 保持 true（RETURNING 覆盖回归）', async () => {
    // 先读当前 user.id 并授予 GM
    const me = await app.inject({ method: 'GET', url: '/v1/users/me', headers: authHeader() });
    const userId = (me.json() as { id: string }).id;
    await getPool().query(`UPDATE users SET is_gm = TRUE WHERE id = $1`, [userId]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      payload: { nickname: 'GM张三' },
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nickname: string; is_gm: boolean };
    expect(body.nickname).toBe('GM张三');
    expect(body.is_gm).toBe(true);
  });
});

describe('POST /v1/users/me (K3 method-override)', () => {
  it('T9 K3 兼容：POST + X-HTTP-Method-Override: PATCH → 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users/me',
      payload: { nickname: '张三' },
      headers: authHeader({ 'x-http-method-override': 'PATCH' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { nickname: string; has_completed_profile: boolean };
    expect(body.nickname).toBe('张三');
    expect(body.has_completed_profile).toBe(true);
  });

  it('T10 K3 反例：POST 不带 X-HTTP-Method-Override → 405', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users/me',
      payload: { nickname: '张三' },
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(405);
  });
});

// ─── GET/PUT /v1/users/me/preference · active 账本恢复偏好 ─────────────────────
describe('GET/PUT /v1/users/me/preference', () => {
  async function listFamilies(t = token): Promise<Array<{ id: string; kind: 'personal' | 'shared'; ledger_id: string; ledger_name: string; name: string }>> {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/families',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as Array<{ id: string; kind: 'personal' | 'shared'; ledger_id: string; ledger_name: string; name: string }>;
  }

  it('T11 新用户 preference 为空但返回 revision 字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/preference',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { preferred_family_id: string | null; preferred_ledger_id: string | null; preferred_revision: number };
    expect(body.preferred_family_id).toBeNull();
    expect(body.preferred_ledger_id).toBeNull();
    expect(body.preferred_revision).toBe(0);
  });

  it('T12 PUT preference 校验通过后 GET 返回完整 context', async () => {
    const families = await listFamilies();
    const personal = families.find((f) => f.kind === 'personal')!;

    const put = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/preference',
      payload: {
        preferred_family_id: personal.id,
        preferred_ledger_id: personal.ledger_id,
        client_revision: 100,
      },
      headers: authHeader(),
    });
    expect(put.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET',
      url: '/v1/users/me/preference',
      headers: authHeader(),
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { preferred_family_id: string; preferred_ledger_id: string; preferred_family_kind: string; preferred_ledger_name: string; preferred_revision: number };
    expect(body.preferred_family_id).toBe(personal.id);
    expect(body.preferred_ledger_id).toBe(personal.ledger_id);
    expect(body.preferred_family_kind).toBe('personal');
    expect(body.preferred_ledger_name).toBe(personal.ledger_name || personal.name);
    expect(body.preferred_revision).toBe(100);
  });

  it('T13 旧 client_revision 不覆盖新 preference', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/families',
      payload: { name: '家庭账本' },
      headers: authHeader(),
    });
    expect(created.statusCode).toBe(201);
    const shared = created.json() as { id: string; ledger_id: string };

    const families = await listFamilies();
    const personal = families.find((f) => f.kind === 'personal')!;

    const stale = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/preference',
      payload: {
        preferred_family_id: personal.id,
        preferred_ledger_id: personal.ledger_id,
        client_revision: 0,
      },
      headers: authHeader(),
    });
    expect(stale.statusCode).toBe(204);

    const get = await app.inject({
      method: 'GET',
      url: '/v1/users/me/preference',
      headers: authHeader(),
    });
    const body = get.json() as { preferred_family_id: string; preferred_ledger_id: string };
    expect(body.preferred_family_id).toBe(shared.id);
    expect(body.preferred_ledger_id).toBe(shared.ledger_id);
  });

  it('T14 非成员不能把 preference 写到他人 family', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/families',
      payload: { name: 'A 的家庭' },
      headers: authHeader(),
    });
    expect(created.statusCode).toBe(201);
    const familyA = created.json() as { id: string; ledger_id: string };

    const tokenB = await login(app, 'openid-users-test-B');

    const res = await app.inject({
      method: 'PUT',
      url: '/v1/users/me/preference',
      payload: {
        preferred_family_id: familyA.id,
        preferred_ledger_id: familyA.ledger_id,
        client_revision: 1,
      },
      headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json() as { code: string };
    expect(body.code).toBe('FAMILY_NOT_MEMBER');
  });
});

// ─── GET /v1/users/me/overview · mine 页宏观聚合 ──────────────────────────────
describe('GET /v1/users/me/overview', () => {
  // 复用模块级 app/token，并通过额外登录拿到 default_ledger_id + user.id
  // 用直接 SQL 插 entries 来构造场景（绕过 sync/idempotency · 仅测聚合 SQL 正确）

  async function loginAndGetContext(): Promise<{ token: string; userId: string; ledgerId: string }> {
    setWxFetchForTests(
      (async () =>
        new Response(
          JSON.stringify({ openid: 'openid-overview-test', session_key: 'sk' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/wx-login',
      payload: { code: 'overview-code' },
      headers: { 'content-type': 'application/json' },
    });
    const body = res.json() as {
      access_token: string;
      user: { id: string };
      default_ledger_id: string;
    };
    return { token: body.access_token, userId: body.user.id, ledgerId: body.default_ledger_id };
  }

  async function insertEntry(params: {
    ledgerId: string;
    createdBy: string;
    occurredAt: string;
    type?: 'expense' | 'income' | 'transfer';
    amount?: number;
    deletedAt?: string | null;
  }): Promise<void> {
    const { getPool } = await import('../src/db/pool.js');
    const id = crypto.randomUUID();
    await getPool().query(
      `INSERT INTO entries (id, ledger_id, amount, currency, type, occurred_at, created_by, deleted_at)
       VALUES ($1, $2, $3, 'CNY', $4, $5, $6, $7)`,
      [
        id,
        params.ledgerId,
        params.amount ?? 100,
        params.type ?? 'expense',
        params.occurredAt,
        params.createdBy,
        params.deletedAt ?? null,
      ],
    );
  }

  it('T11 未登录 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/overview',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('T12 新登录用户无任何 entry → entry_count=0, ledger_days=0', async () => {
    const { token: t } = await loginAndGetContext();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/overview',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entry_count: number; ledger_days: number };
    expect(body.entry_count).toBe(0);
    expect(body.ledger_days).toBe(0);
  });

  it('T13 多 entry 跨日 → entry_count 总和、ledger_days 按 Asia/Shanghai DISTINCT date', async () => {
    const { token: t, userId, ledgerId } = await loginAndGetContext();

    // 同一 Shanghai 日（2026-06-08）→ 两个 UTC 时间，但都在 Shanghai 同日
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-07T20:00:00.000Z' }); // Shanghai 06-08 04:00
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-08T05:00:00.000Z' }); // Shanghai 06-08 13:00

    // 不同 Shanghai 日
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-10T05:00:00.000Z' }); // Shanghai 06-10
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-07-01T05:00:00.000Z' }); // Shanghai 07-01

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/overview',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entry_count: number; ledger_days: number };
    expect(body.entry_count).toBe(4);
    expect(body.ledger_days).toBe(3); // 06-08, 06-10, 07-01
  });

  it('T14 deleted_at 不计入', async () => {
    const { token: t, userId, ledgerId } = await loginAndGetContext();
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-08T05:00:00.000Z' });
    await insertEntry({
      ledgerId,
      createdBy: userId,
      occurredAt: '2026-06-09T05:00:00.000Z',
      deletedAt: '2026-06-09T06:00:00.000Z',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/overview',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entry_count: number; ledger_days: number };
    expect(body.entry_count).toBe(1);
    expect(body.ledger_days).toBe(1);
  });

  it('T15 income / transfer / expense 都计入 entry_count', async () => {
    const { token: t, userId, ledgerId } = await loginAndGetContext();
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-08T05:00:00.000Z', type: 'expense' });
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-08T06:00:00.000Z', type: 'income' });
    await insertEntry({ ledgerId, createdBy: userId, occurredAt: '2026-06-08T07:00:00.000Z', type: 'transfer' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/overview',
      headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entry_count: number; ledger_days: number };
    expect(body.entry_count).toBe(3);
    expect(body.ledger_days).toBe(1);
  });

  it('T16 仅按 created_by 聚合（其他用户的 entry 不计入）', async () => {
    const { token: tA, userId: userIdA, ledgerId: ledgerIdA } = await loginAndGetContext();

    // 第二个用户登录拿独立 ledger
    setWxFetchForTests(
      (async () =>
        new Response(
          JSON.stringify({ openid: 'openid-overview-other', session_key: 'sk' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );
    const otherRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/wx-login',
      payload: { code: 'other-code' },
      headers: { 'content-type': 'application/json' },
    });
    const otherBody = otherRes.json() as { user: { id: string } };
    const userIdOther = otherBody.user.id;

    await insertEntry({ ledgerId: ledgerIdA, createdBy: userIdA, occurredAt: '2026-06-08T05:00:00.000Z' });
    // 在同一个 ledger 写"别人"创建的 entry → 仍按 created_by 过滤
    await insertEntry({ ledgerId: ledgerIdA, createdBy: userIdOther, occurredAt: '2026-06-09T05:00:00.000Z' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me/overview',
      headers: { authorization: `Bearer ${tA}`, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entry_count: number; ledger_days: number };
    expect(body.entry_count).toBe(1);
    expect(body.ledger_days).toBe(1);
  });
});

