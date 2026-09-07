/**
 * Costra · Server · 微信 stable_token 管理单测（accessToken）
 *
 * 事实源：tech-spec v1.2 §2.6
 *
 * 覆盖：
 *   T1  body 含 force_refresh 字段且与入参一致（false / true 各一格）
 *   T2  Redis 缓存命中 ⇒ 不再发起 fetch（cache:v1:wx:access-token · TTL=expires_in-300s）
 *   T3  并发单飞：N 个并行调用共享同一次取票数（fetch 只发生 1 次）
 *   T4  forceRefresh=true 绕过缓存取新票
 *   T5  上游 errcode ≠ 0 ⇒ 抛错（不缓存）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAccessToken,
  setAccessTokenFetchForTests,
  __resetAccessTokenForTests,
} from '../src/wx/accessToken.js';
import { getRedis } from '../src/db/redis.js';

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function mockStableToken(token: string, expiresIn = 7200): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  setAccessTokenFetchForTests(
    (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
  return { calls };
}

beforeEach(() => {
  __resetAccessTokenForTests();
});

afterEach(() => {
  __resetAccessTokenForTests();
});

describe('accessToken · stable_token', () => {
  it('T1 · body 含 force_refresh 字段且与入参一致', async () => {
    const { calls } = mockStableToken('tk-1');
    await getAccessToken(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({
      grant_type: 'client_credential',
      appid: 'wx-test-appid',
      secret: 'wx-test-appsecret',
      force_refresh: false,
    });
    expect(calls[0]!.url).toBe('https://api.weixin.qq.com/cgi-bin/stable_token');

    __resetAccessTokenForTests();
    const second = mockStableToken('tk-2');
    await getAccessToken(true);
    expect(second.calls[0]!.body['force_refresh']).toBe(true);
  });

  it('T2 · 缓存命中（Redis）⇒ 第二次调用不再 fetch', async () => {
    const { calls } = mockStableToken('tk-cache');
    const t1 = await getAccessToken(false);
    const t2 = await getAccessToken(false);
    expect(t1).toBe('tk-cache');
    expect(t2).toBe('tk-cache');
    expect(calls).toHaveLength(1);
    // Redis key 符合 tech-spec §2.6
    expect(await getRedis().get('cache:v1:wx:access-token')).toBe('tk-cache');
  });

  it('T3 · 并发单飞：5 个并行调用共享同一次取票数', async () => {
    const { calls } = mockStableToken('tk-flight');
    const results = await Promise.all([
      getAccessToken(false),
      getAccessToken(false),
      getAccessToken(true),
      getAccessToken(false),
      getAccessToken(true),
    ]);
    expect(results).toEqual(['tk-flight', 'tk-flight', 'tk-flight', 'tk-flight', 'tk-flight']);
    expect(calls).toHaveLength(1);
  });

  it('T4 · forceRefresh=true 绕过缓存取新票', async () => {
    const first = mockStableToken('tk-old');
    await getAccessToken(false);
    expect(first.calls).toHaveLength(1);

    const second = mockStableToken('tk-new');
    const token = await getAccessToken(true);
    expect(token).toBe('tk-new');
    expect(second.calls).toHaveLength(1);
    // 新票覆盖缓存
    expect(await getRedis().get('cache:v1:wx:access-token')).toBe('tk-new');
  });

  it('T5 · 上游 errcode ≠ 0 ⇒ 抛错且不缓存', async () => {
    setAccessTokenFetchForTests(
      (async (): Promise<Response> => {
        return new Response(JSON.stringify({ errcode: 40125, errmsg: 'invalid appsecret' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    );
    await expect(getAccessToken(false)).rejects.toThrow(/40125/);
    expect(await getRedis().get('cache:v1:wx:access-token')).toBeNull();
  });
});
