/**
 * Costra · Server · GM 路由单测（/gm/users · /gm/impersonate）
 *
 * 事实源：docs/ops/gm-impersonate-design.md §5 测试清单
 *
 * 覆盖：
 *   T1  未登录：两端点 → 401 UNAUTHENTICATED
 *   T2  非 GM：两端点 → 403 PERMISSION_DENIED
 *   T3  GM list：分页 / has_more / created_at DESC / 无 openid 字段 / 不含软删用户
 *   T4  impersonate user_id：200 且 user.id = 目标（is_gm=false）
 *   T5  impersonate 目标不存在 → 404 NOT_FOUND
 *   T6  impersonate create_fake → 200 服务端自动分配伪造账号（gm_fake_ 前缀 · 每次调用新建独立账号）
 *   T7  手动指定 fake_openid 已被契约移除 → 400 INVALID_ARGUMENT（additionalProperties:false）
 *   T8  user_id 与 create_fake 同给 / 同缺 → 400 INVALID_ARGUMENT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { getPool } from '../src/db/pool.js';

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

async function login(openid: string): Promise<{ token: string; userId: string }> {
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
    payload: { code: `code-${openid}` },
    headers: { 'content-type': 'application/json' },
  });
  const body = res.json() as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

async function grantGm(userId: string): Promise<void> {
  await getPool().query(`UPDATE users SET is_gm = TRUE WHERE id = $1`, [userId]);
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

interface GmUserItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
}

interface GmUsersBody {
  items: GmUserItem[];
  page: number;
  page_size: number;
  has_more: boolean;
}

describe('GET /v1/gm/users', () => {
  it('T1 未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/gm/users' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('T2 非 GM → 403 PERMISSION_DENIED', async () => {
    const user = await login('openid-gm-list-nongm');
    const res = await app.inject({ method: 'GET', url: '/v1/gm/users', headers: authHeader(user.token) });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('PERMISSION_DENIED');
  });

  it('T3 GM：created_at DESC / 无 openid / 排除软删 / 分页 has_more', async () => {
    const gm = await login('openid-gm-list-gm');
    const u1 = await login('openid-gm-list-u1');
    const u2 = await login('openid-gm-list-u2');
    await getPool().query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [u2.userId]);
    await grantGm(gm.userId);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/gm/users?page_size=50',
      headers: authHeader(gm.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GmUsersBody;
    // 软删 u2 不出现；最新创建的 u1 排最前（created_at 并列时 id DESC · uuidv7 时序保证）
    expect(body.items.map((i) => i.id)).toEqual([u1.userId, gm.userId]);
    expect(body.has_more).toBe(false);
    // 不返回 openid · 字段集合封闭
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ['avatar_url', 'created_at', 'id', 'id_short', 'nickname'].sort(),
    );
    expect(body.items[0].id_short).toBe(body.items[0].id.slice(0, 8));

    // 分页：page_size=1 → has_more；第二页 → 无更多
    const page1 = (await app.inject({
      method: 'GET',
      url: '/v1/gm/users?page=1&page_size=1',
      headers: authHeader(gm.token),
    })).json() as GmUsersBody;
    expect(page1.items).toHaveLength(1);
    expect(page1.has_more).toBe(true);
    const page2 = (await app.inject({
      method: 'GET',
      url: '/v1/gm/users?page=2&page_size=1',
      headers: authHeader(gm.token),
    })).json() as GmUsersBody;
    expect(page2.items).toHaveLength(1);
    expect(page2.has_more).toBe(false);
  });
});

describe('POST /v1/gm/impersonate', () => {
  it('T1 未登录 → 401 UNAUTHENTICATED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { create_fake: true },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('T2 非 GM → 403 PERMISSION_DENIED', async () => {
    const user = await login('openid-gm-imp-nongm');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { create_fake: true },
      headers: authHeader(user.token),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('PERMISSION_DENIED');
  });

  it('T4 user_id 路径：200 且 user.id = 目标用户', async () => {
    const target = await login('openid-gm-imp-target');
    const gm = await login('openid-gm-imp-gm');
    await grantGm(gm.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { user_id: target.userId },
      headers: authHeader(gm.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      access_token: string;
      refresh_token: string;
      default_family_id: string;
      default_ledger_id: string;
      user: { id: string; is_gm: boolean };
    };
    expect(body.user.id).toBe(target.userId);
    expect(body.user.is_gm).toBe(false);
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.default_family_id).toBeTruthy();
    expect(body.default_ledger_id).toBeTruthy();
  });

  it('T5 目标不存在 → 404 NOT_FOUND', async () => {
    const gm = await login('openid-gm-imp-404');
    await grantGm(gm.userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { user_id: '00000000-0000-0000-0000-000000000000' },
      headers: authHeader(gm.token),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('NOT_FOUND');
  });

  it('T6 create_fake：服务端自动分配伪造账号 + bootstrap；每次调用新建独立账号', async () => {
    const gm = await login('openid-gm-imp-fake');
    await grantGm(gm.userId);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { create_fake: true },
      headers: authHeader(gm.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      default_family_id: string;
      user: { id: string; is_gm: boolean };
    };
    expect(body.user.is_gm).toBe(false);
    expect(body.default_family_id).toBeTruthy();

    const rows = await getPool().query(`SELECT wx_openid FROM users WHERE id = $1`, [body.user.id]);
    expect(rows.rows[0].wx_openid).toMatch(/^gm_fake_[0-9a-f]{32}$/);

    // 再次 create_fake：服务端生成新 openid → 新建独立账号（复登旧伪造账号走 user_id 路径）
    const again = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { create_fake: true },
      headers: authHeader(gm.token),
    });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { user: { id: string } }).user.id).not.toBe(body.user.id);
  });

  it('T7 手动指定 fake_openid 已被契约移除 → 400 INVALID_ARGUMENT（additionalProperties:false）', async () => {
    const gm = await login('openid-gm-imp-badprefix');
    await grantGm(gm.userId);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { fake_openid: 'gm_fake_test_001' },
      headers: authHeader(gm.token),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
  });

  it('T8 user_id 与 create_fake 同给 / 同缺 → 400 INVALID_ARGUMENT', async () => {
    const gm = await login('openid-gm-imp-both');
    await grantGm(gm.userId);

    const neither = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: {},
      headers: authHeader(gm.token),
    });
    expect(neither.statusCode).toBe(400);
    expect((neither.json() as { code: string }).code).toBe('INVALID_ARGUMENT');

    const both = await app.inject({
      method: 'POST',
      url: '/v1/gm/impersonate',
      payload: { user_id: gm.userId, create_fake: true },
      headers: authHeader(gm.token),
    });
    expect(both.statusCode).toBe(400);
    expect((both.json() as { code: string }).code).toBe('INVALID_ARGUMENT');
  });
});
