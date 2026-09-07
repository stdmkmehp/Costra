/**
 * Costra · Server · tips（虚拟支付赞赏）路由单测
 *
 * 事实源：tech-spec v1.2 §4.1/§4.2/§4.5/§7.3/§10.1
 *
 * 覆盖：
 *   O1~O8   POST /tips/orders：鉴权（含 refresh token 拒绝 · B0）/ 模式闸门 / 身份闸门（不落单）/
 *           目录 / 响应签名形态 / out_trade_no 格式 / 日限 429
 *   P1~P2   GET /tips/products：purchasable 三态 · 目录结构（wx_product_id 不下发）
 *   S1~S6   GET /tips/summary：空态 / 交付后聚合 / created→refunded 不计入 / support_score 快照 /
 *           探测节流算术（5 次有效探测）/ 只 probe 最近一单 / 响应不等待上游
 *   B1~B2   PUT badge-visibility：开关语义 + badge_visible 与 supporter_badge 联动
 *   N1~N9   webhook POST：未知单不查询 / 发货→settle 幂等 / expired+notify / 退款 warn-only /
 *           iOS 退款查询 / 未知事件 / 畸形 XML 400 / DTD 400 / unpaid 回 retry
 *   H1~H2   webhook GET：echostr 回显约束 / 签名校验
 *   V1~V2   GET /users/me/overview 扩展字段（tip_entry_visible 三态 · 派生徽章）
 */

import { createHmac, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { __resetEnvForTests } from '../src/config/env.js';
import { findTipProduct } from '../src/config/tipProducts.js';
import { getPool } from '../src/db/pool.js';
import { setWxFetchForTests } from '../src/wx/code2Session.js';
import { setVirtualPayFetchForTests } from '../src/wx/virtualPayClient.js';
import { setAccessTokenFetchForTests } from '../src/wx/accessToken.js';
import { XPAY_NOTIFY_ACK_XML } from '../src/wx/xpayNotifyDecoder.js';

let app: FastifyInstance;

const SESSION_KEY = 'sk-test-session';

beforeEach(async () => {
  app = await buildApp({ disableLogger: true });
  await app.ready();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockCode2Session(openid: string): void {
  setWxFetchForTests(
    (async (): Promise<Response> => {
      return new Response(JSON.stringify({ openid, session_key: SESSION_KEY }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
}

async function login(openid: string): Promise<{ token: string; refreshToken: string; userId: string }> {
  mockCode2Session(openid);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/wx-login',
    payload: { code: `code-${openid}` },
  });
  const body = res.json() as { access_token: string; refresh_token: string; user: { id: string } };
  return { token: body.access_token, refreshToken: body.refresh_token, userId: body.user.id };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function mockStableToken(): void {
  setAccessTokenFetchForTests(
    (async (): Promise<Response> => {
      return new Response(JSON.stringify({ access_token: 'tk-test', expires_in: 7200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  );
}

interface QueryCall {
  body: Record<string, unknown>;
}

/** mock query_order：按请求体 order_id 回显，status/fee 可配 */
function mockQueryOrder(opts: { status: number; orderFee?: number; wxOrderId?: string }): { calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  setVirtualPayFetchForTests(
    (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ body });
      return new Response(
        JSON.stringify({
          errcode: 0,
          env_type: 1,
          biz_meta: 'costra-tip-v1',
          order: {
            status: opts.status,
            order_type: 0,
            order_id: body['order_id'],
            order_fee: opts.orderFee ?? 990,
            wx_order_id: opts.wxOrderId ?? 'wx-mch-1',
            wxpay_order_id: 'tx-1',
            paid_time: 1_800_000_000,
            paid_fee: opts.orderFee ?? 990,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch,
  );
  return { calls };
}

async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function createOrderViaApi(token: string, productKey = 'coffee'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/tips/orders',
    headers: auth(token),
    payload: { product_key: productKey, code: 'order-code' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { out_trade_no: string }).out_trade_no;
}

async function getOrderRow(outTradeNo: string): Promise<Record<string, unknown>> {
  const r = await getPool().query(`SELECT * FROM tip_orders WHERE out_trade_no = $1`, [outTradeNo]);
  return r.rows[0] as Record<string, unknown>;
}

async function insertOrderRaw(overrides: Record<string, unknown> = {}): Promise<string> {
  const outTradeNo = (overrides['out_trade_no'] as string) ?? ('T' + randomUUID().replace(/-/g, '').slice(0, 30));
  await getPool().query(
    `INSERT INTO tip_orders (
       id, user_id, openid, product_type, product_key, product_title, wx_product_id,
       price_cents, support_delta, entitlement_keys, out_trade_no, status, next_probe_at,
       wx_order_id, created_at, delivered_at, paid_at, refunded_at, probe_count, last_probed_at
     ) VALUES ($1,$2,$3,'tip',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      overrides['id'] ?? randomUUID(),
      overrides['user_id'],
      overrides['openid'] ?? 'openid-x',
      overrides['product_key'] ?? 'coffee',
      overrides['product_title'] ?? '请开发者喝一杯咖啡',
      overrides['wx_product_id'] ?? 'coffee',
      overrides['price_cents'] ?? 990,
      overrides['support_delta'] ?? 99,
      overrides['entitlement_keys'] ?? ['supporter_badge'],
      outTradeNo,
      overrides['status'] ?? 'created',
      overrides['next_probe_at'] ?? new Date(Date.now() + 120_000),
      overrides['wx_order_id'] ?? null,
      overrides['created_at'] ?? new Date(),
      overrides['delivered_at'] ?? null,
      overrides['paid_at'] ?? null,
      overrides['refunded_at'] ?? null,
      overrides['probe_count'] ?? 0,
      overrides['last_probed_at'] ?? null,
    ],
  );
  return outTradeNo;
}

function goodsDeliveryXml(outTradeNo: string, opts: { productId?: string; quantity?: number } = {}): string {
  return `<xml>
  <ToUserName><![CDATA[gh_test]]></ToUserName>
  <FromUserName><![CDATA[openid-x]]></FromUserName>
  <CreateTime>1700000000</CreateTime>
  <MsgType><![CDATA[event]]></MsgType>
  <Event><![CDATA[xpay_goods_deliver_notify]]></Event>
  <OutTradeNo><![CDATA[${outTradeNo}]]></OutTradeNo>
  <Env>0</Env>
  <WeChatPayInfo>
    <MchOrderNo><![CDATA[wx-mch-1]]></MchOrderNo>
    <TransactionId><![CDATA[tx-1]]></TransactionId>
    <PaidTime>1800000000</PaidTime>
  </WeChatPayInfo>
  <GoodsInfo>
    <ProductId><![CDATA[${opts.productId ?? 'coffee'}]]></ProductId>
    <Quantity>${opts.quantity ?? 1}</Quantity>
    <OrigPrice>990</OrigPrice>
    <ActualPrice>990</ActualPrice>
  </GoodsInfo>
  <Sign><![CDATA[sign-x]]></Sign>
</xml>`;
}

// ─── POST /tips/orders ───────────────────────────────────────────────────────

describe('POST /v1/tips/orders', () => {
  it('O1 · 未登录 401；refresh token 401（B0 · token_type 判定）', async () => {
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      payload: { product_key: 'coffee', code: 'x' },
    });
    expect(res1.statusCode).toBe(401);

    const { refreshToken } = await login('openid-o1');
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(refreshToken),
      payload: { product_key: 'coffee', code: 'x' },
    });
    expect(res2.statusCode).toBe(401);
  });

  it('O2 · WX_PAY_MODE=off ⇒ 422 BUSINESS_RULE_VIOLATION payment_disabled（不落单）', async () => {
    process.env.WX_PAY_MODE = 'off';
    __resetEnvForTests();
    const { token } = await login('openid-o2');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(token),
      payload: { product_key: 'coffee', code: 'x' },
    });
    // 项目契约：BUSINESS_RULE_VIOLATION → HTTP 422（ErrorCode.ts 三表为唯一事实源）
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', details: { reason: 'payment_disabled' } });
    const c = await getPool().query(`SELECT count(*) AS c FROM tip_orders`);
    expect(Number(c.rows[0].c)).toBe(0);
  });

  it('O3 · allowlist：非白名单 422 · 白名单成员 200', async () => {
    process.env.WX_PAY_MODE = 'allowlist';
    __resetEnvForTests();
    const { token, userId } = await login('openid-o3');
    const denied = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(token),
      payload: { product_key: 'coffee', code: 'x' },
    });
    expect(denied.statusCode).toBe(422);
    expect(denied.json()).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', details: { reason: 'payment_disabled' } });

    process.env.WX_PAY_TEST_USER_IDS = userId;
    __resetEnvForTests();
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(token),
      payload: { product_key: 'coffee', code: 'x' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('O4 · 身份闸门：code2Session.openid ≠ users.wx_openid ⇒ 403 payment_identity_mismatch 且不落单', async () => {
    const { token } = await login('openid-real');
    mockCode2Session('openid-OTHER'); // 下单时换成另一个 openid
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(token),
      payload: { product_key: 'coffee', code: 'order-code' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'payment_identity_mismatch' } });
    const c = await getPool().query(`SELECT count(*) AS c FROM tip_orders`);
    expect(Number(c.rows[0].c)).toBe(0);
  });

  it('O5 · 未知 product_key ⇒ 400 PAYMENT_PRODUCT_INVALID', async () => {
    const { token } = await login('openid-o5');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(token),
      payload: { product_key: 'not-exist', code: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'PAYMENT_PRODUCT_INVALID', details: { product_key: 'not-exist' } });
  });

  it('O6 · 成功下单：out_trade_no 格式 + 签名三要素可验证 + 落单快照', async () => {
    const { token, userId } = await login('openid-o6');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(token),
      payload: { product_key: 'coffee', code: 'order-code' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      out_trade_no: string;
      pay_data: { signData: string; paySig: string; signature: string; mode: string };
    };
    expect(body.out_trade_no).toMatch(/^T[0-9a-f]{30}$/);
    expect(body.pay_data.mode).toBe('short_series_goods');

    // signData 严格官方 8 字段
    const signData = JSON.parse(body.pay_data.signData) as Record<string, unknown>;
    expect(Object.keys(signData)).toEqual([
      'offerId', 'buyQuantity', 'env', 'currencyType', 'productId', 'goodsPrice', 'outTradeNo', 'attach',
    ]);
    expect(signData).toMatchObject({
      offerId: 'test-offer-id',
      buyQuantity: 1,
      env: 0,
      currencyType: 'CNY',
      // 断言"取自目录"而非某个字面量：B2 回填真实道具 ID 后本用例无需改动
      productId: findTipProduct('coffee')!.wxProductId,
      goodsPrice: 990,
      outTradeNo: body.out_trade_no,
      attach: 'costra-tip-v1',
    });

    // signature = HMAC(signData, session_key) · paySig = HMAC('requestVirtualPayment'&signData, AppKey)
    const expectSignature = createHmac('sha256', SESSION_KEY).update(body.pay_data.signData, 'utf8').digest('hex');
    expect(body.pay_data.signature).toBe(expectSignature);
    const expectPaySig = createHmac('sha256', 'test-app-key')
      .update(`requestVirtualPayment&${body.pay_data.signData}`, 'utf8')
      .digest('hex');
    expect(body.pay_data.paySig).toBe(expectPaySig);

    // 落单快照
    const row = await getOrderRow(body.out_trade_no);
    expect(row).toMatchObject({
      user_id: userId,
      openid: 'openid-o6',
      product_key: 'coffee',
      wx_product_id: findTipProduct('coffee')!.wxProductId,
      support_delta: 99,
      status: 'created',
      probe_count: 0,
    });
    expect(Number(row['price_cents'])).toBe(990);
    // next_probe_at = created_at + 120s（created_at 走 DB now() 与 JS 时钟存在毫秒级偏差 · 容差 5s）
    const createdAt = new Date(row['created_at'] as string).getTime();
    const nextProbeAt = new Date(row['next_probe_at'] as string).getTime();
    expect(Math.abs(nextProbeAt - createdAt - 120_000)).toBeLessThan(5_000);
  });

  it('O7 · 日限 20 单 ⇒ 429 RATE_LIMITED', async () => {
    const { token, userId } = await login('openid-o7');
    for (let i = 0; i < 20; i++) {
      await insertOrderRaw({ user_id: userId });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tips/orders',
      headers: auth(token),
      payload: { product_key: 'coffee', code: 'x' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('O8 · body 夹带 channel / device_platform ⇒ 400（additionalProperties:false · 防渠道维度回退）', async () => {
    const { token } = await login('openid-o8');
    for (const extra of [{ channel: 'ios' }, { device_platform: 'ios' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/tips/orders',
        headers: auth(token),
        payload: { product_key: 'coffee', code: 'x', ...extra },
      });
      expect(res.statusCode).toBe(400);
      const c = await getPool().query(`SELECT count(*) AS c FROM tip_orders`);
      expect(Number(c.rows[0].c)).toBe(0);
    }
  });
});

// ─── GET /tips/products ──────────────────────────────────────────────────────

describe('GET /v1/tips/products', () => {
  it('P1 · 目录结构完整且 wx_product_id 不下发（price 单位：分）', async () => {
    const { token } = await login('openid-p1');
    const res = await app.inject({ method: 'GET', url: '/v1/tips/products', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { purchasable: boolean; products: Array<Record<string, unknown>> };
    expect(body.purchasable).toBe(true); // 默认 WX_PAY_MODE=on
    expect(body.products).toHaveLength(3);
    expect(body.products.map((p) => p['product_key'])).toEqual(['encourage', 'coffee', 'server']);
    expect(body.products[0]).toMatchObject({
      type: 'tip',
      title: '一次暖心的鼓励',
      price_cents: 100,
      support_delta: 10,
      entitlement_keys: ['supporter_badge'],
    });
    for (const p of body.products) {
      expect(p).not.toHaveProperty('wx_product_id');
      expect(typeof p['sub_desc']).toBe('string');
    }
  });

  it('P0 · 携带任何 query 参数 ⇒ 400（目录无渠道维度 · tech-spec §10 防回退）', async () => {
    const { token } = await login('openid-p0');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tips/products?channel=ios',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it('P2 · purchasable 三态：off ⇒ false · allowlist 非成员 false / 成员 true', async () => {
    const { token, userId } = await login('openid-p2');

    process.env.WX_PAY_MODE = 'off';
    __resetEnvForTests();
    let res = await app.inject({ method: 'GET', url: '/v1/tips/products', headers: auth(token) });
    expect((res.json() as { purchasable: boolean }).purchasable).toBe(false);

    process.env.WX_PAY_MODE = 'allowlist';
    process.env.WX_PAY_TEST_USER_IDS = '';
    __resetEnvForTests();
    res = await app.inject({ method: 'GET', url: '/v1/tips/products', headers: auth(token) });
    expect((res.json() as { purchasable: boolean }).purchasable).toBe(false);

    process.env.WX_PAY_TEST_USER_IDS = userId;
    __resetEnvForTests();
    res = await app.inject({ method: 'GET', url: '/v1/tips/products', headers: auth(token) });
    expect((res.json() as { purchasable: boolean }).purchasable).toBe(true);
  });
});

// ─── GET /tips/summary ───────────────────────────────────────────────────────

describe('GET /v1/tips/summary', () => {
  it('S1 · 空态：全零 + 空权益 + 空历史', async () => {
    const { token } = await login('openid-s1');
    const res = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      entitlements: [],
      supporter_badge: false,
      tip_count: 0,
      support_score: 0,
      badge_hidden: false,
      has_pending_orders: false,
      history: [],
    });
  });

  it('S2 · 交付后聚合：tip_count/support_score/entitlements/granted_at/history', async () => {
    const { token, userId } = await login('openid-s2');
    await insertOrderRaw({
      user_id: userId,
      status: 'delivered',
      delivered_at: new Date('2026-09-01T00:00:00Z'),
      paid_at: new Date('2026-09-01T00:00:00Z'),
    });
    await insertOrderRaw({
      user_id: userId,
      status: 'delivered',
      delivered_at: new Date('2026-09-02T00:00:00Z'),
      paid_at: new Date('2026-09-02T00:00:00Z'),
      product_key: 'encourage',
      support_delta: 10,
    });
    const res = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    const body = res.json() as {
      supporter_badge: boolean;
      tip_count: number;
      support_score: number;
      entitlements: Array<{ key: string; granted_at: string }>;
      history: Array<{
        out_trade_no: string;
        title: string;
        status: string;
        support_delta: number;
        time: string;
      }>;
    };
    expect(body.supporter_badge).toBe(true);
    expect(body.tip_count).toBe(2);
    expect(body.support_score).toBe(109); // 快照 support_delta 求和（99+10）
    expect(body.entitlements).toHaveLength(1);
    expect(body.entitlements[0]!.key).toBe('supporter_badge');
    expect(body.entitlements[0]!.granted_at).toBe('2026-09-01T00:00:00.000Z'); // MIN(delivered_at)
    expect(body.history).toHaveLength(2);
    expect(body.history[0]!.time > body.history[1]!.time).toBe(true); // delivered_at DESC
    // 每条历史都带本人业务单号：客户端 settling 判定「本单已发货」的唯一精确依据
    for (const h of body.history) expect(h.out_trade_no).toMatch(/^T[0-9a-f]{30}$/);
    // 仍不下发金额 / openid / 任何平台 ID
    for (const h of body.history) {
      expect(h).not.toHaveProperty('price_cents');
      expect(h).not.toHaveProperty('openid');
      expect(h).not.toHaveProperty('wx_order_id');
    }
  });

  it('S3 · created→refunded 未发货单不计入（delivered_at IS NOT NULL 铁律）', async () => {
    const { token, userId } = await login('openid-s3');
    // 未交付直接退款：delivered_at 为 NULL
    await insertOrderRaw({
      user_id: userId,
      status: 'refunded',
      paid_at: new Date(),
      refunded_at: new Date(),
    });
    // 过期单
    await insertOrderRaw({ user_id: userId, status: 'expired' });
    const res = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    expect(res.json()).toMatchObject({ supporter_badge: false, tip_count: 0, support_score: 0, history: [] });
  });

  it('S4 · support_score 由订单快照聚合（与当前目录值无关）', async () => {
    const { token, userId } = await login('openid-s4');
    // 历史单快照 support_delta=12345（目录改价前的值）⇒ 聚合按快照而非目录现值
    await insertOrderRaw({
      user_id: userId,
      status: 'delivered',
      delivered_at: new Date(),
      paid_at: new Date(),
      support_delta: 12345,
    });
    const res = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    expect((res.json() as { support_score: number }).support_score).toBe(12345);
  });

  it('S5 · 探测节流算术：退避序列 t=0/2/4/8/16/31 中 5 次有效探测（仅 t=2 被 3s 租约挡掉）', async () => {
    const { token } = await login('openid-s5');
    mockStableToken();
    const { calls } = mockQueryOrder({ status: 1 });
    await createOrderViaApi(token);

    const summary = () => app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    const warpLastProbe = async (msAgo: number) => {
      await getPool().query(`UPDATE tip_orders SET last_probed_at = $1`, [new Date(Date.now() - msAgo)]);
    };

    // t=0：从未探测 ⇒ 触发
    await summary();
    await waitFor(() => calls.length === 1);
    // t=2：last_probed_at 刚刚写入（距现在 < 3s）⇒ 租约挡掉
    await summary();
    await new Promise((r) => setTimeout(r, 100));
    expect(calls.length).toBe(1);
    // t=4（距上次 4s > 3s）⇒ 触发
    await warpLastProbe(4_000);
    await summary();
    await waitFor(() => calls.length === 2);
    // t=8（4s）⇒ 触发
    await warpLastProbe(4_000);
    await summary();
    await waitFor(() => calls.length === 3);
    // t=16（8s）⇒ 触发
    await warpLastProbe(8_000);
    await summary();
    await waitFor(() => calls.length === 4);
    // t=31（15s）⇒ 触发
    await warpLastProbe(15_000);
    await summary();
    await waitFor(() => calls.length === 5);
    // 再次立即调用 ⇒ 不触发（合计仍是 5 次）
    await summary();
    await new Promise((r) => setTimeout(r, 100));
    expect(calls.length).toBe(5);
  });

  it('S6 · 每次只 probe 最近一张 created 单', async () => {
    const { token } = await login('openid-s6');
    mockStableToken();
    const { calls } = mockQueryOrder({ status: 1 });
    const first = await createOrderViaApi(token);
    await new Promise((r) => setTimeout(r, 20));
    const second = await createOrderViaApi(token);

    await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    await waitFor(() => calls.length === 1);
    expect(calls[0]!.body['order_id']).toBe(second);
    expect(calls[0]!.body['order_id']).not.toBe(first);
  });

  it('S7 · 响应不等待上游（query_order 挂起时 summary 照常返回）', async () => {
    const { token } = await login('openid-s7');
    mockStableToken();
    let releaseQuery: ((r: Response) => void) | undefined;
    setVirtualPayFetchForTests(
      (async (): Promise<Response> => {
        return await new Promise<Response>((resolve) => {
          releaseQuery = resolve;
        });
      }) as unknown as typeof fetch,
    );
    await createOrderViaApi(token);
    const res = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    // query_order 仍在挂起，但响应已返回
    expect(res.statusCode).toBe(200);
    expect((res.json() as { has_pending_orders: boolean }).has_pending_orders).toBe(true);
    // 释放挂起的 fetch，避免泄漏
    releaseQuery?.(new Response(JSON.stringify({ errcode: 0, order: { status: 1, order_type: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  });

  it('S8 · 窗口内连续 10 次加速探测后订单仍为 created（P0-1 回归：加速探测不吃节奏预算）', async () => {
    const { token } = await login('openid-s8');
    mockStableToken();
    const { calls } = mockQueryOrder({ status: 1 });
    const outTradeNo = await createOrderViaApi(token);

    for (let i = 0; i < 10; i++) {
      await getPool().query(`UPDATE tip_orders SET last_probed_at = $1 WHERE out_trade_no = $2`, [
        new Date(Date.now() - 4_000),
        outTradeNo,
      ]);
      await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
      await waitFor(() => calls.length === i + 1);
    }
    expect(calls.length).toBe(10);
    const row = await getOrderRow(outTradeNo);
    expect(row['status']).toBe('created');
    expect(Number(row['probe_count'])).toBe(0); // 加速探测不推进节奏游标
  });

  it('S9 · 重复购买：连续两单均成功创建并各自结算；tip_count=2 徽章派生唯一', async () => {
    const { token } = await login('openid-s9');
    const first = await createOrderViaApi(token);
    const second = await createOrderViaApi(token);
    expect(second).not.toBe(first);

    // 各自结算（直接调 settleOrder 模拟两条独立 delivered 路径）
    const { settleOrder } = await import('../src/services/tipService.js');
    const paidFacts = (outTradeNo: string) => ({
      status: 4 as const,
      orderId: outTradeNo,
      orderFee: 990,
      wxOrderId: `wx-${outTradeNo.slice(-6)}`,
      channelOrderId: null,
      wxpayOrderId: `tx-${outTradeNo.slice(-6)}`,
      orderType: 0,
      paidTime: 1_800_000_000,
      paidFee: 990,
      envType: 1,
      bizMeta: 'costra-tip-v1',
    });
    expect(await settleOrder(first, paidFacts(first))).toBe('delivered');
    expect(await settleOrder(second, paidFacts(second))).toBe('delivered');

    const res = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    const body = res.json() as { supporter_badge: boolean; tip_count: number; entitlements: unknown[] };
    expect(body.tip_count).toBe(2);
    expect(body.supporter_badge).toBe(true);
    expect(body.entitlements).toHaveLength(1); // 徽章派生去重（EXISTS 语义）
  });

  it('S10 · settleOrder 幂等：重复调用只计一次（already_delivered · tip_count 不变）', async () => {
    const { token } = await login('openid-s10');
    const outTradeNo = await createOrderViaApi(token);
    const { settleOrder } = await import('../src/services/tipService.js');
    const facts = {
      status: 4 as const,
      orderId: outTradeNo,
      orderFee: 990,
      wxOrderId: 'wx-idem-1',
      channelOrderId: null,
      wxpayOrderId: 'tx-idem-1',
      orderType: 0,
      paidTime: 1_800_000_000,
      paidFee: 990,
      envType: 1,
      bizMeta: 'costra-tip-v1',
    };
    expect(await settleOrder(outTradeNo, facts)).toBe('delivered');
    expect(await settleOrder(outTradeNo, facts)).toBe('already_delivered');
    expect(await settleOrder(outTradeNo, facts)).toBe('already_delivered');

    const res = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    expect((res.json() as { tip_count: number }).tip_count).toBe(1);
  });

  it('S11 · wx_order_id 跨单占用 ⇒ order-conflict 不发放（CI3）', async () => {
    const { token } = await login('openid-s11');
    const first = await createOrderViaApi(token);
    const second = await createOrderViaApi(token);
    const { settleOrder } = await import('../src/services/tipService.js');
    const facts = (otn: string) => ({
      status: 4 as const,
      orderId: otn,
      orderFee: 990,
      wxOrderId: 'wx-SHARED',
      channelOrderId: null,
      wxpayOrderId: null,
      orderType: 0,
      paidTime: 1_800_000_000,
      paidFee: 990,
      envType: 1,
      bizMeta: 'costra-tip-v1',
    });
    expect(await settleOrder(first, facts(first))).toBe('delivered');
    // 同一 wx_order_id 映射到第二单 ⇒ 撞单 ⇒ 不发放
    expect(await settleOrder(second, facts(second))).toBe('order-conflict');
    expect((await getOrderRow(second))['status']).toBe('created');
  });

  it('S12 · order_type 未知取值原值落 upstream_order_type（不改写为 NULL）', async () => {
    const { token } = await login('openid-s12');
    const outTradeNo = await createOrderViaApi(token);
    mockStableToken();
    mockQueryOrder({ status: 4, orderFee: 990 });
    // 覆盖 order_type 为未知值 9
    setVirtualPayFetchForTests(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            errcode: 0,
            env_type: 1,
            biz_meta: 'costra-tip-v1',
            order: {
              status: 4,
              order_type: 9, // 未知枚举 ⇒ 原值落库
              order_id: body['order_id'],
              order_fee: 990,
              wx_order_id: 'wx-ot9',
              paid_time: 1_800_000_000,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tips/notify',
      headers: { 'content-type': 'text/xml' },
      payload: goodsDeliveryXml(outTradeNo),
    });
    expect(res.statusCode).toBe(200);
    const row = await getOrderRow(outTradeNo);
    expect(row['status']).toBe('delivered');
    expect(Number(row['upstream_order_type'])).toBe(9);
  });

  it('S13 · 非 settle 路径同样落 order_type 原值（schedule_probe 留痕 · 不写 NULL）', async () => {
    const { token } = await login('openid-s13');
    const outTradeNo = await createOrderViaApi(token);
    mockStableToken();
    // 窗口内未支付（status=1）+ order_type=7（Apple）⇒ schedule_probe：不改资金状态，但必须留原值
    setVirtualPayFetchForTests(
      (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            errcode: 0,
            env_type: 1,
            biz_meta: 'costra-tip-v1',
            order: { status: 1, order_type: 7, order_id: body['order_id'], order_fee: 990 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/tips/notify',
      headers: { 'content-type': 'text/xml' },
      payload: goodsDeliveryXml(outTradeNo),
    });
    expect(res.statusCode).toBe(500); // schedule_probe ⇒ 让平台重推
    const row = await getOrderRow(outTradeNo);
    expect(row['status']).toBe('created');
    expect(Number(row['upstream_status'])).toBe(1);
    // R1（Apple 价格档映射）的渠道归因依赖该列 ⇒ settle 之外的路径同样不得丢原值
    expect(Number(row['upstream_order_type'])).toBe(7);
  });

  it('S14 · 同一单 wx_order_id 漂移 ⇒ order-id-drift 且不覆盖任何已记字段', async () => {
    const { token } = await login('openid-s14');
    const outTradeNo = await createOrderViaApi(token);
    const { settleOrder } = await import('../src/services/tipService.js');
    const facts = (wxOrderId: string) => ({
      status: 4 as const,
      orderId: outTradeNo,
      orderFee: 990,
      wxOrderId,
      channelOrderId: null,
      wxpayOrderId: 'tx-drift',
      orderType: 0,
      paidTime: 1_800_000_000,
      paidFee: 990,
      envType: 1,
      bizMeta: 'costra-tip-v1',
    });
    expect(await settleOrder(outTradeNo, facts('wx-A'))).toBe('delivered');
    // 上游改口报另一个平台单号：既不得静默保留 A（COALESCE 假成功），也不得改成 B
    expect(await settleOrder(outTradeNo, facts('wx-B'))).toBe('order-id-drift');
    const row = await getOrderRow(outTradeNo);
    expect(row).toMatchObject({ status: 'delivered', wx_order_id: 'wx-A' });
  });
});

// ─── PUT /tips/summary/badge-visibility ──────────────────────────────────────

describe('PUT /v1/tips/summary/badge-visibility', () => {
  it('B1 · 开关写入 + badge_visible 与 supporter_badge 联动（tech-spec §4.5.3）', async () => {
    const { token, userId } = await login('openid-b1');

    // 无徽章用户：badge_hidden=true ⇒ badge_hidden=true · badge_visible=false（无徽章可显示）
    let res = await app.inject({
      method: 'PUT',
      url: '/v1/tips/summary/badge-visibility',
      headers: auth(token),
      payload: { badge_hidden: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ badge_hidden: true, badge_visible: false });

    // 交付一单后：badge_hidden=true ⇒ badge_visible=false；badge_hidden=false ⇒ badge_visible=true
    await insertOrderRaw({ user_id: userId, status: 'delivered', delivered_at: new Date(), paid_at: new Date() });
    res = await app.inject({
      method: 'PUT',
      url: '/v1/tips/summary/badge-visibility',
      headers: auth(token),
      payload: { badge_hidden: true },
    });
    expect(res.json()).toMatchObject({ badge_hidden: true, badge_visible: false });
    res = await app.inject({
      method: 'PUT',
      url: '/v1/tips/summary/badge-visibility',
      headers: auth(token),
      payload: { badge_hidden: false },
    });
    expect(res.json()).toMatchObject({ badge_hidden: false, badge_visible: true });

    // summary 读回 badge_hidden=false
    const summary = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    expect((summary.json() as { badge_hidden: boolean }).badge_hidden).toBe(false);
  });

  it('B2 · body 缺 badge_hidden ⇒ 400（schema 校验）', async () => {
    const { token } = await login('openid-b2');
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/tips/summary/badge-visibility',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('B3 · badge_hidden 非布尔（"true" / 1）⇒ 400（tips validator 不做类型强转）', async () => {
    const { token } = await login('openid-b3');
    for (const bad of ['true', 1, 'false', 0]) {
      const res = await app.inject({
        method: 'PUT',
        url: '/v1/tips/summary/badge-visibility',
        headers: auth(token),
        payload: { badge_hidden: bad },
      });
      expect(res.statusCode).toBe(400);
    }
    // 库中保持默认值：非法请求不得产生任何写入
    const summary = await app.inject({ method: 'GET', url: '/v1/tips/summary', headers: auth(token) });
    expect((summary.json() as { badge_hidden: boolean }).badge_hidden).toBe(false);
  });
});

// ─── POST /tips/notify（webhook） ────────────────────────────────────────────

describe('POST /v1/tips/notify（webhook）', () => {
  function postNotify(body: string | Buffer) {
    return app.inject({
      method: 'POST',
      url: '/v1/tips/notify',
      headers: { 'content-type': 'text/xml' },
      payload: body,
    });
  }

  it('N1 · 未知订单 ⇒ 成功回包且不发起 query_order', async () => {
    mockStableToken();
    const { calls } = mockQueryOrder({ status: 4 });
    const res = await postNotify(goodsDeliveryXml('T' + 'f'.repeat(30)));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(XPAY_NOTIFY_ACK_XML);
    expect(res.headers['content-type']).toContain('text/xml');
    expect(calls.length).toBe(0);
  });

  it('N2 · 发货推送 ⇒ query_order 复核 paid ⇒ settle 交付（幂等：重推送不再查询）', async () => {
    const { token } = await login('openid-n2');
    const outTradeNo = await createOrderViaApi(token);
    mockStableToken();
    const { calls } = mockQueryOrder({ status: 4 });

    const res = await postNotify(goodsDeliveryXml(outTradeNo));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(XPAY_NOTIFY_ACK_XML);
    expect(calls.length).toBe(1);

    const row = await getOrderRow(outTradeNo);
    expect(row).toMatchObject({
      status: 'delivered',
      wx_order_id: 'wx-mch-1',
      wxpay_order_id: 'tx-1',
      upstream_status: 4,
      upstream_order_type: 0,
    });
    expect(row['delivered_at']).not.toBeNull();
    expect(row['paid_at']).not.toBeNull();

    // 重推送：已 delivered ⇒ warn + ACK，不再发起 query_order
    const res2 = await postNotify(goodsDeliveryXml(outTradeNo));
    expect(res2.statusCode).toBe(200);
    expect(calls.length).toBe(1);
  });

  it('N3 · 推送字段弱校验不阻断（Quantity=2 仍按 query_order 复核交付）', async () => {
    const { token } = await login('openid-n3');
    const outTradeNo = await createOrderViaApi(token);
    mockStableToken();
    mockQueryOrder({ status: 4 });
    const res = await postNotify(goodsDeliveryXml(outTradeNo, { quantity: 2, productId: 'other' }));
    expect(res.statusCode).toBe(200);
    expect((await getOrderRow(outTradeNo))['status']).toBe('delivered');
  });

  it('N4 · created 单 query 未支付 ⇒ 回 retry（平台重推 · 非成功回包）', async () => {
    const { token } = await login('openid-n4');
    const outTradeNo = await createOrderViaApi(token);
    mockStableToken();
    mockQueryOrder({ status: 1 });
    const res = await postNotify(goodsDeliveryXml(outTradeNo));
    expect(res.statusCode).toBe(500);
    expect((await getOrderRow(outTradeNo))['status']).toBe('created');
  });

  it('N5 · expired 单收到发货推送 ⇒ 成功回包且状态不变（manual_conflict 留痕 · 不改账）', async () => {
    const { userId } = await login('openid-n5');
    const outTradeNo = await insertOrderRaw({ user_id: userId, status: 'expired' });
    mockStableToken();
    const { calls } = mockQueryOrder({ status: 4 });
    const res = await postNotify(goodsDeliveryXml(outTradeNo));
    expect(res.statusCode).toBe(200);
    expect(calls.length).toBe(0); // expired 不发起查询（对账矩阵已由调度器收口）
    expect((await getOrderRow(outTradeNo))['status']).toBe('expired');
  });

  it('N6 · 退款推送 ⇒ warn-only + 成功回包（不做自动资金变更）', async () => {
    const { userId } = await login('openid-n6');
    const outTradeNo = await insertOrderRaw({
      user_id: userId,
      status: 'delivered',
      delivered_at: new Date(),
      paid_at: new Date(),
    });
    const xml = `<xml>
      <MsgType><![CDATA[event]]></MsgType>
      <Event><![CDATA[xpay_refund_notify]]></Event>
      <WxOrderId><![CDATA[wx-1]]></WxOrderId>
      <MchOrderNo><![CDATA[mch-1]]></MchOrderNo>
      <RefundFee><![CDATA[990]]></RefundFee>
      <RetCode><![CDATA[0]]></RetCode>
      <Sign><![CDATA[s]]></Sign>
    </xml>`;
    const res = await postNotify(xml);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(XPAY_NOTIFY_ACK_XML);
    // 不改账：订单仍 delivered（退款事实由 query_order 路径的对账矩阵处理）
    expect((await getOrderRow(outTradeNo))['status']).toBe('delivered');
  });

  it('N7 · iOS 退款查询推送 ⇒ 成功回包', async () => {
    const xml = `<xml>
      <MsgType><![CDATA[event]]></MsgType>
      <Event><![CDATA[xpay_subscribe_ios_refund_query_notify]]></Event>
      <Sign><![CDATA[s]]></Sign>
    </xml>`;
    const res = await postNotify(xml);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(XPAY_NOTIFY_ACK_XML);
  });

  it('N8 · 未知 Event ⇒ 成功回包；畸形 XML ⇒ 400；DTD/实体 ⇒ 400', async () => {
    const unknown = await postNotify(`<xml><Event><![CDATA[some_other_event]]></Event></xml>`);
    expect(unknown.statusCode).toBe(200);

    // 截断在标签中间（fast-xml-parser 必抛错）
    const malformed = await postNotify(`<xml><Event`);
    expect(malformed.statusCode).toBe(400);

    const dtd = await postNotify(
      `<?xml version="1.0"?><!DOCTYPE xml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><xml><Event>&xxe;</Event></xml>`,
    );
    expect(dtd.statusCode).toBe(400);
  });

  it('N9 · 租约竞争：3 秒内重复推送 ⇒ 第二次回 retry（不重复查询）', async () => {
    const { token } = await login('openid-n9');
    const outTradeNo = await createOrderViaApi(token);
    mockStableToken();
    const { calls } = mockQueryOrder({ status: 1 });
    const first = await postNotify(goodsDeliveryXml(outTradeNo));
    expect(first.statusCode).toBe(500); // 未支付 ⇒ retry
    expect(calls.length).toBe(1);
    // 立即重推：租约（3s）未过期 ⇒ 回 retry 且不查询
    const second = await postNotify(goodsDeliveryXml(outTradeNo));
    expect(second.statusCode).toBe(500);
    expect(calls.length).toBe(1);
  });
});

// ─── GET /tips/notify（握手） ────────────────────────────────────────────────

describe('GET /v1/tips/notify（握手）', () => {
  it('H1 · 合法 echostr 回显（text/plain + nosniff）；非法 echostr 回 success', async () => {
    const ok = await app.inject({ method: 'GET', url: '/v1/tips/notify?echostr=abc-123_XYZ' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('abc-123_XYZ');
    expect(ok.headers['content-type']).toContain('text/plain');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');

    const badCharset = await app.inject({ method: 'GET', url: '/v1/tips/notify?echostr=<script>alert(1)</script>' });
    expect(badCharset.body).toBe('success');

    const tooLong = await app.inject({ method: 'GET', url: `/v1/tips/notify?echostr=${'a'.repeat(129)}` });
    expect(tooLong.body).toBe('success');

    const missing = await app.inject({ method: 'GET', url: '/v1/tips/notify' });
    expect(missing.body).toBe('success');
  });

  it('H2 · 配置 WX_MSG_PUSH_TOKEN 后：签名错误 401 · 签名正确回显', async () => {
    process.env.WX_MSG_PUSH_TOKEN = 'push-token-1';
    __resetEnvForTests();
    const { createHash } = await import('node:crypto');
    const timestamp = '1700000000';
    const nonce = 'nonce-1';
    const goodSig = createHash('sha1').update(['push-token-1', timestamp, nonce].sort().join('')).digest('hex');

    const bad = await app.inject({
      method: 'GET',
      url: `/v1/tips/notify?signature=bad&timestamp=${timestamp}&nonce=${nonce}&echostr=abc`,
    });
    expect(bad.statusCode).toBe(401);

    const good = await app.inject({
      method: 'GET',
      url: `/v1/tips/notify?signature=${goodSig}&timestamp=${timestamp}&nonce=${nonce}&echostr=abc`,
    });
    expect(good.statusCode).toBe(200);
    expect(good.body).toBe('abc');
  });
});

// ─── GET /users/me/overview 扩展字段 ─────────────────────────────────────────

describe('GET /v1/users/me/overview（tips 扩展）', () => {
  it('V1 · 全量模式：新用户 tip_entry_visible=true · 无徽章', async () => {
    const { token } = await login('openid-v1');
    const res = await app.inject({ method: 'GET', url: '/v1/users/me/overview', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tip_entry_visible: true,
      supporter_badge: false,
      badge_hidden: false,
      tip_count: 0,
      support_score: 0,
    });
  });

  it('V2 · off 模式：无赞赏记录 tip_entry_visible=false · 有交付记录仍可见（历史权益保留）', async () => {
    process.env.WX_PAY_MODE = 'off';
    __resetEnvForTests();
    const { token, userId } = await login('openid-v2');
    let res = await app.inject({ method: 'GET', url: '/v1/users/me/overview', headers: auth(token) });
    expect((res.json() as { tip_entry_visible: boolean }).tip_entry_visible).toBe(false);

    await insertOrderRaw({ user_id: userId, status: 'delivered', delivered_at: new Date(), paid_at: new Date() });
    res = await app.inject({ method: 'GET', url: '/v1/users/me/overview', headers: auth(token) });
    expect(res.json()).toMatchObject({ tip_entry_visible: true, supporter_badge: true, tip_count: 1, support_score: 99 });
  });
});
