/**
 * Costra · Server · /announcements 路由单测
 *
 * 覆盖：
 *   T1  GET  /v1/announcements 未登录 → 401
 *   T2  GET  /v1/announcements 登录后 → 200 + 公告列表 + is_read=false
 *   T3  POST /v1/announcements/:id/read 未登录 → 401
 *   T4  POST /v1/announcements/:id/read 登录后 → 204
 *   T5  标记已读后再 GET → is_read=true
 *   T6  POST 不存在的 UUID → 204（幂等）
 *   T7  POST 非法 id → 400 INVALID_ARGUMENT
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { getPool } from '../src/db/pool.js';

let app: FastifyInstance;
let token: string;
let testAnnouncementId: string;

async function login(app: FastifyInstance): Promise<string> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid: 'openid-announcements-test', session_key: 'sk' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  );
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: 'test-announcements' },
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

  // 插入测试公告
  const id = 'a0000000-0000-0000-0000-000000000001';
  await getPool().query(
    `INSERT INTO announcements (id, title, content, published_at)
     VALUES ($1, $2, $3, now())`,
    [id, '测试公告', '这是一条测试公告内容。'],
  );
  testAnnouncementId = id;
});

describe('GET /v1/announcements', () => {
  it('T1 未登录 → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/announcements',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('T2 登录后 → 200 + 公告列表 + is_read=false', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/announcements',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ id: string; title: string; is_read: boolean }>;
    expect(list.length).toBeGreaterThanOrEqual(1);
    const item = list.find(a => a.id === testAnnouncementId);
    expect(item).toBeDefined();
    expect(item!.is_read).toBe(false);
  });
});

describe('POST /v1/announcements/:id/read', () => {
  it('T3 未登录 → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/announcements/${testAnnouncementId}/read`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('T4 标记已读 → 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/announcements/${testAnnouncementId}/read`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('T5 标记已读后再 GET → is_read=true', async () => {
    // 标记已读
    await app.inject({
      method: 'POST',
      url: `/v1/announcements/${testAnnouncementId}/read`,
      headers: { authorization: `Bearer ${token}` },
    });

    // 再次获取
    const afterRes = await app.inject({
      method: 'GET',
      url: '/v1/announcements',
      headers: authHeader(),
    });
    const afterList = afterRes.json() as Array<{ id: string; is_read: boolean }>;
    const read = afterList.find(a => a.id === testAnnouncementId);
    expect(read!.is_read).toBe(true);
  });

  it('T6 不存在的 UUID → 204（幂等）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/announcements/00000000-0000-0000-0000-000000000000/read',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('T7 非法 id → 400 INVALID_ARGUMENT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/announcements/not-a-uuid/read',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { code: string };
    expect(body.code).toBe('INVALID_ARGUMENT');
  });
});
