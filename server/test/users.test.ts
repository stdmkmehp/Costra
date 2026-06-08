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

let app: FastifyInstance;
let token: string;

async function login(app: FastifyInstance): Promise<string> {
  setWxFetchForTests(
    (async () =>
      new Response(
        JSON.stringify({ openid: 'openid-users-test', session_key: 'sk' }),
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
      created_at: string;
      updated_at: string;
    };
    expect(body.id).toMatch(/^[0-9a-f]{8}-/);
    expect(body.nickname).toBe('微信用户');
    expect(body.has_completed_profile).toBe(false);
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
