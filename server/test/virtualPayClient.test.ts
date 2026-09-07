/**
 * Costra · Server · 虚拟支付 query_order 客户端单测（virtualPayClient）
 *
 * 事实源：tech-spec v1.2 §4.2.3
 *
 * 覆盖：
 *   Q1  请求形态：body={"openid","env":0,"order_id":<outTradeNo>} · URL 含 access_token+pay_sig
 *   Q2  order.status 全枚举映射（0/1 unpaid · 2/3/4 paid · 5/8 refunded · 6 closed · 7 refund_failed · 9/10 unrelated · 其他 unknown）
 *   Q3  errcode 映射：268490015 ⇒ rate_limited · 268490003 ⇒ unknown · 其他非 0 ⇒ unknown
 *   Q4  40001 ⇒ stable_token force_refresh 一次后重试；仍 40001 ⇒ token_failed
 *   Q5  传输分类：HTTP 5xx ⇒ upstream_5xx · HTTP 4xx ⇒ unknown · AbortError ⇒ timeout
 *   Q6  fetch 异常消息中的 access_token/pay_sig 被脱敏（E2）
 *   Q7  paid 事实搬运（wx_order_id / channel_order_id / wxpay_order_id / paid_time 等）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  queryOrder,
  setVirtualPayFetchForTests,
  __resetVirtualPayFetchForTests,
} from '../src/wx/virtualPayClient.js';
import {
  setAccessTokenFetchForTests,
  __resetAccessTokenForTests,
} from '../src/wx/accessToken.js';

const OUT_TRADE_NO = 'T' + 'b'.repeat(30);

/** mock stable_token（query_order 前置取票数） */
function mockToken(): void {
  setAccessTokenFetchForTests(
    (async (): Promise<Response> => {
      return new Response(JSON.stringify({ access_token: 'tk-test', expires_in: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
}

function mockQuery(impl: (url: string, body: Record<string, unknown>) => unknown): { calls: Array<{ url: string; body: Record<string, unknown> }> } {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  setVirtualPayFetchForTests(
    (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      const payload = impl(url, body);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
  return { calls };
}

beforeEach(() => {
  __resetVirtualPayFetchForTests();
  __resetAccessTokenForTests();
  mockToken();
});

afterEach(() => {
  __resetVirtualPayFetchForTests();
  __resetAccessTokenForTests();
});

describe('virtualPayClient · query_order', () => {
  it('Q1 · 请求形态：body={"openid","env":0,"order_id"} · URL 带 access_token+pay_sig', async () => {
    const { calls } = mockQuery(() => ({ errcode: 0, order: { status: 1, order_type: 0 } }));
    const outcome = await queryOrder(OUT_TRADE_NO, 'openid-1');
    expect(outcome.kind).toBe('unpaid');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ openid: 'openid-1', env: 0, order_id: OUT_TRADE_NO });
    expect(calls[0]!.url).toContain('https://api.weixin.qq.com/xpay/query_order?');
    expect(calls[0]!.url).toContain('access_token=tk-test');
    expect(calls[0]!.url).toContain('pay_sig=');
  });

  it('Q2 · order.status 全枚举映射', async () => {
    const cases: Array<[number, string]> = [
      [0, 'unpaid'], [1, 'unpaid'],
      [2, 'paid'], [3, 'paid'], [4, 'paid'],
      [5, 'refunded'], [8, 'refunded'],
      [6, 'closed'],
      [7, 'refund_failed'],
      [9, 'unrelated'], [10, 'unrelated'],
      [99, 'unknown'],
    ];
    for (const [status, expectKind] of cases) {
      __resetVirtualPayFetchForTests();
      mockQuery(() => ({ errcode: 0, order: { status, order_type: 0, order_id: OUT_TRADE_NO, order_fee: 990 } }));
      const outcome = await queryOrder(OUT_TRADE_NO, 'openid-1');
      expect(outcome.kind, `status=${status}`).toBe(expectKind);
    }
  });

  it('Q3 · errcode 映射：268490015 ⇒ rate_limited · 268490003 ⇒ unknown · 其他 ⇒ unknown', async () => {
    mockQuery(() => ({ errcode: 268490015, errmsg: 'rate limited' }));
    expect((await queryOrder(OUT_TRADE_NO, 'o'))).toMatchObject({ kind: 'transient_error', reason: 'rate_limited' });

    mockQuery(() => ({ errcode: 268490003, errmsg: 'bad sign' }));
    expect((await queryOrder(OUT_TRADE_NO, 'o')).kind).toBe('unknown');

    mockQuery(() => ({ errcode: -1, errmsg: 'system busy' }));
    expect((await queryOrder(OUT_TRADE_NO, 'o')).kind).toBe('unknown');
  });

  it('Q4 · 40001 ⇒ force_refresh 强刷一次后重试；仍 40001 ⇒ token_failed', async () => {
    // 第一次 40001，第二次成功
    let queryCalls = 0;
    mockQuery(() => {
      queryCalls += 1;
      if (queryCalls === 1) return { errcode: 40001, errmsg: 'access_token expired' };
      return { errcode: 0, order: { status: 1, order_type: 0 } };
    });
    const forceRefreshFlags: boolean[] = [];
    setAccessTokenFetchForTests(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        forceRefreshFlags.push(Boolean(JSON.parse(String(init?.body))['force_refresh']));
        return new Response(JSON.stringify({ access_token: `tk-${forceRefreshFlags.length}`, expires_in: 7200 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    );
    const outcome = await queryOrder(OUT_TRADE_NO, 'openid-1');
    expect(outcome.kind).toBe('unpaid');
    expect(queryCalls).toBe(2);
    expect(forceRefreshFlags).toEqual([false, true]);

    // 始终 40001 ⇒ token_failed，且只重试一次（共 2 次 query）
    __resetVirtualPayFetchForTests();
    __resetAccessTokenForTests();
    let queryCalls2 = 0;
    mockQuery(() => {
      queryCalls2 += 1;
      return { errcode: 40001 };
    });
    mockToken();
    const outcome2 = await queryOrder(OUT_TRADE_NO, 'openid-1');
    expect(outcome2).toMatchObject({ kind: 'transient_error', reason: 'token_failed' });
    expect(queryCalls2).toBe(2);
  });

  it('Q5 · 传输分类：HTTP 5xx ⇒ upstream_5xx · HTTP 4xx ⇒ unknown · AbortError ⇒ timeout', async () => {
    setVirtualPayFetchForTests(
      (async (): Promise<Response> => new Response('err', { status: 502 })) as unknown as typeof fetch,
    );
    expect((await queryOrder(OUT_TRADE_NO, 'o'))).toMatchObject({ kind: 'transient_error', reason: 'upstream_5xx' });

    setVirtualPayFetchForTests(
      (async (): Promise<Response> => new Response('err', { status: 404 })) as unknown as typeof fetch,
    );
    expect((await queryOrder(OUT_TRADE_NO, 'o')).kind).toBe('unknown');

    setVirtualPayFetchForTests(
      (async (): Promise<Response> => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }) as unknown as typeof fetch,
    );
    expect((await queryOrder(OUT_TRADE_NO, 'o'))).toMatchObject({ kind: 'transient_error', reason: 'timeout' });
  });

  it('Q6 · fetch 异常消息中的 access_token/pay_sig 被脱敏（E2）', async () => {
    setVirtualPayFetchForTests(
      (async (): Promise<Response> => {
        throw new TypeError(
          'fetch failed: https://api.weixin.qq.com/xpay/query_order?access_token=SECRET_TOKEN&pay_sig=SECRET_SIG',
        );
      }) as unknown as typeof fetch,
    );
    const outcome = await queryOrder(OUT_TRADE_NO, 'o');
    expect(outcome.kind).toBe('transient_error');
    if (outcome.kind === 'transient_error') {
      expect(outcome.detail).not.toContain('SECRET_TOKEN');
      expect(outcome.detail).not.toContain('SECRET_SIG');
      expect(outcome.detail).toContain('***REDACTED***');
    }
  });

  it('Q7 · paid 事实搬运（平台单号 / paid_time / env_type / biz_meta）', async () => {
    mockQuery(() => ({
      errcode: 0,
      env_type: 1,
      biz_meta: 'costra-tip-v1',
      order: {
        status: 4,
        order_type: 0,
        order_id: OUT_TRADE_NO,
        order_fee: 990,
        wx_order_id: 'wx-1',
        channel_order_id: 'apple-1',
        wxpay_order_id: 'tx-1',
        paid_time: 1_800_000_000,
        paid_fee: 990,
      },
    }));
    const outcome = await queryOrder(OUT_TRADE_NO, 'openid-1');
    expect(outcome.kind).toBe('paid');
    if (outcome.kind === 'paid') {
      expect(outcome.order).toMatchObject({
        status: 4,
        orderId: OUT_TRADE_NO,
        orderFee: 990,
        wxOrderId: 'wx-1',
        channelOrderId: 'apple-1',
        wxpayOrderId: 'tx-1',
        paidTime: 1_800_000_000,
        paidFee: 990,
        envType: 1,
        bizMeta: 'costra-tip-v1',
      });
    }
  });
});
