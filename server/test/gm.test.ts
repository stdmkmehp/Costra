/**
 * Costra · Server · GM 路由单测（/gm/users · /gm/impersonate）
 *
 * 事实源：docs/ops/gm-impersonate-design.md §5 测试清单
 *
 * 覆盖：
 *   T1  未登录：两端点 → 401 UNAUTHENTICATED
 *   T2  非 GM：两端点 → 403 PERMISSION_DENIED
 *   T3  GM list 双榜：active 按 entry_count_7d DESC / recent 按 created_at DESC /
 *       无 openid 字段 / 排除软删 / 无流水用户不进 active
 *   T4  impersonate user_id：200 且 user.id = 目标（is_gm=false）
 *   T5  impersonate 目标不存在 → 404 NOT_FOUND
 *   T6  impersonate create_fake → 200 服务端自动分配伪造账号（gm_fake_ 前缀 · 每次调用新建独立账号）
 *   T7  手动指定 fake_openid 已被契约移除 → 400 INVALID_ARGUMENT（additionalProperties:false）
 *   T8  user_id 与 create_fake 同给 / 同缺 → 400 INVALID_ARGUMENT
 *   T9  list 缓存：二次请求命中 Redis（新写入流水不影响已缓存榜单）
 *   T10 Redis 异常 → 降级直查 SQL 返回 200
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { getPool } from '../src/db/pool.js';
import { getRedis, setRedisForTests } from '../src/db/redis.js';

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

interface GmActiveItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
  entry_count_7d: number;
  last_active_at: string;
}

interface GmRecentItem {
  id: string;
  id_short: string;
  nickname: string;
  avatar_url: string | null;
  created_at: string;
}

interface GmListsBody {
  active: GmActiveItem[];
  recent: GmRecentItem[];
}

/** 直接 SQL 插入 entries（pg-mem DDL 无 FK · ledger_id 用固定占位 uuid） */
async function addEntries(userId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await getPool().query(
      `INSERT INTO entries (id, ledger_id, amount, type, occurred_at, created_by)
       VALUES ($1, $2, 100, 'expense', now(), $3)`,
      [randomUUID(), '00000000-0000-0000-0000-000000000001', userId],
    );
  }
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

  it('T3 GM 双榜：active 按活跃度 / recent 按注册时间 / 排除软删 / 字段封闭', async () => {
    const gm = await login('openid-gm-list-gm');
    const u1 = await login('openid-gm-list-u1');
    const u2 = await login('openid-gm-list-u2');
    const u3 = await login('openid-gm-list-u3'); // 无流水 · 不进 active
    const u4 = await login('openid-gm-list-u4'); // 软删 · 两榜均不出现
    await addEntries(u1.userId, 3);
    await addEntries(u2.userId, 1);
    await addEntries(u4.userId, 5);
    await getPool().query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [u4.userId]);
    await grantGm(gm.userId);

    const res = await app.inject({ method: 'GET', url: '/v1/gm/users', headers: authHeader(gm.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as GmListsBody;

    // active：u1(3) 在 u2(1) 前；无流水的 u3/gm 与软删的 u4 均不出现
    expect(body.active.map((i) => i.id)).toEqual([u1.userId, u2.userId]);
    expect(body.active.map((i) => i.entry_count_7d)).toEqual([3, 1]);
    expect(body.active[0].last_active_at).toBeTruthy();
    // active 字段集合封闭（无 openid）
    expect(Object.keys(body.active[0]).sort()).toEqual(
      ['avatar_url', 'created_at', 'entry_count_7d', 'id', 'id_short', 'last_active_at', 'nickname'].sort(),
    );

    // recent：创建倒序（u3 最新 · gm 最早）；软删 u4 不出现
    expect(body.recent.map((i) => i.id)).toEqual([u3.userId, u2.userId, u1.userId, gm.userId]);
    expect(Object.keys(body.recent[0]).sort()).toEqual(
      ['avatar_url', 'created_at', 'id', 'id_short', 'nickname'].sort(),
    );
    expect(body.recent[0].id_short).toBe(body.recent[0].id.slice(0, 8));
  });

  it('T9 二次请求命中缓存：新写入流水不影响已缓存榜单', async () => {
    const gm = await login('openid-gm-cache-gm');
    const u1 = await login('openid-gm-cache-u1');
    const u2 = await login('openid-gm-cache-u2');
    await addEntries(u1.userId, 3);
    await addEntries(u2.userId, 1);
    await grantGm(gm.userId);

    const first = (await app.inject({ method: 'GET', url: '/v1/gm/users', headers: authHeader(gm.token) }))
      .json() as GmListsBody;
    expect(first.active.map((i) => i.id)).toEqual([u1.userId, u2.userId]);

    // 缓存期内的数据变化不应反映：u2 追加 5 笔（实际 6 > u1 的 3）
    await addEntries(u2.userId, 5);
    const second = (await app.inject({ method: 'GET', url: '/v1/gm/users', headers: authHeader(gm.token) }))
      .json() as GmListsBody;
    expect(second.active.map((i) => [i.id, i.entry_count_7d])).toEqual([
      [u1.userId, 3],
      [u2.userId, 1],
    ]);
  });

  it('T10 Redis 异常 → 降级直查 SQL 返回 200', async () => {
    const gm = await login('openid-gm-degrade-gm');
    const u1 = await login('openid-gm-degrade-u1');
    await addEntries(u1.userId, 2);
    await grantGm(gm.userId);

    const original = getRedis();
    const broken = {
      get: async () => { throw new Error('redis down'); },
      set: async () => { throw new Error('redis down'); },
    } as unknown as Redis;
    setRedisForTests(broken);
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/gm/users', headers: authHeader(gm.token) });
      expect(res.statusCode).toBe(200);
      const body = res.json() as GmListsBody;
      expect(body.active.map((i) => i.id)).toEqual([u1.userId]);
      expect(body.recent.map((i) => i.id)).toEqual([u1.userId, gm.userId]);
    } finally {
      setRedisForTests(original);
    }
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
