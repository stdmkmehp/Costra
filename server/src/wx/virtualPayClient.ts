/**
 * Costra · Server · 虚拟支付 query_order 客户端
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §4.2.3
 *
 * 请求：POST /xpay/query_order?access_token=..&pay_sig=..，超时 5s；
 *       body = {"openid","env":0,"order_id":<out_trade_no>}（传 order_id = 我方单号，不传 wx_order_id）。
 *
 * 分类（RawQueryOrderOutcome · 业务决策收口在 tipReconcile.reconcileQueryOutcome）：
 *   order.status：0/1 ⇒ unpaid · 2/3/4 ⇒ paid · 5/8 ⇒ refunded · 6 ⇒ closed ·
 *                 7 ⇒ refund_failed · 9/10 ⇒ unrelated · 其他 ⇒ unknown
 *   errcode：268490003（签名错误）⇒ unknown（配置告警）；268490015（频率限制）⇒ transient rate_limited；
 *            40001/42001 ⇒ getAccessToken(true) 强刷后**只重试一次**，仍失败 ⇒ transient token_failed；
 *            其他非 0 ⇒ unknown
 *   传输：HTTP 5xx ⇒ upstream_5xx；abort ⇒ timeout；其余网络异常 ⇒ network
 *
 * 安全：access_token / pay_sig 出现在 URL query —— 所有异常路径经 redactUrlSecret 脱敏（E2）。
 */

import { appEnv } from '../config/env.js';
import { redactUrlSecret } from './code2Session.js';
import { getAccessToken } from './accessToken.js';
import { calcPaySig } from './virtualPaySign.js';
import { WX_XPAY_QUERY_ORDER_URL } from './endpoints.js';

const QUERY_ORDER_URI = '/xpay/query_order';
const TIMEOUT_MS = 5_000;

/** 最近一次 query_order 的原始枚举快照（不改写为内部字符串 · 原值入库） */
export interface WxOrderSnapshot {
  status: number;
  orderType: number | null;
}

/** query_order 返回的资金事实（status ∈ 2/3/4 已支付族） */
export interface WxPaidOrderFacts {
  status: 2 | 3 | 4;
  /** 我方单号（按 order_id 查询 ⇒ 必须回显 out_trade_no，硬校验） */
  orderId: string | null;
  /** 实付金额（分 · 硬校验基准） */
  orderFee: number | null;
  wxOrderId: string | null;
  channelOrderId: string | null;
  wxpayOrderId: string | null;
  orderType: number | null;
  /** 支付时间（unix 秒） */
  paidTime: number | null;
  paidFee: number | null;
  envType: number | null;
  bizMeta: string | null;
}

export type QueryTransientReason = 'timeout' | 'network' | 'rate_limited' | 'token_failed' | 'upstream_5xx';

export type RawQueryOrderOutcome =
  | { kind: 'paid'; order: WxPaidOrderFacts }
  | { kind: 'unpaid'; snapshot: WxOrderSnapshot }
  | { kind: 'closed'; snapshot: WxOrderSnapshot }
  | { kind: 'refunded'; snapshot: WxOrderSnapshot }
  | { kind: 'refund_failed'; snapshot: WxOrderSnapshot }
  | { kind: 'unrelated'; snapshot: WxOrderSnapshot }
  | { kind: 'unknown'; detail: string; snapshot: WxOrderSnapshot | null }
  | { kind: 'transient_error'; reason: QueryTransientReason; detail: string };

interface RawOrderPayload {
  status?: number;
  order_type?: number;
  order_id?: string;
  order_fee?: number;
  wx_order_id?: string;
  channel_order_id?: string;
  wxpay_order_id?: string;
  paid_time?: number;
  paid_fee?: number;
}

interface RawQueryOrderResponse {
  errcode?: number;
  errmsg?: string;
  env_type?: number;
  biz_meta?: string;
  order?: RawOrderPayload;
}

type FetchLike = typeof fetch;

let _fetch: FetchLike = globalThis.fetch;

/** 仅用于测试：替换 fetch 实现。 */
export function setVirtualPayFetchForTests(f: FetchLike): void {
  _fetch = f;
}

/** 测试 afterEach：恢复默认 fetch。 */
export function __resetVirtualPayFetchForTests(): void {
  _fetch = globalThis.fetch;
}

function redactError(err: unknown): unknown {
  if (err instanceof Error) {
    const e = new Error(redactUrlSecret(err.message));
    e.name = err.name;
    return e;
  }
  return err;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function snapshotOf(o: RawOrderPayload): WxOrderSnapshot {
  return { status: o.status ?? -1, orderType: num(o.order_type) };
}

function classifyStatus(raw: RawQueryOrderResponse): RawQueryOrderOutcome {
  const o = raw.order ?? {};
  const status = num(o.status);
  if (status == null) {
    return { kind: 'unknown', detail: 'missing order.status', snapshot: null };
  }
  if (status === 2 || status === 3 || status === 4) {
    const order: WxPaidOrderFacts = {
      status,
      orderId: str(o.order_id),
      orderFee: num(o.order_fee),
      wxOrderId: str(o.wx_order_id),
      channelOrderId: str(o.channel_order_id),
      wxpayOrderId: str(o.wxpay_order_id),
      orderType: num(o.order_type),
      paidTime: num(o.paid_time),
      paidFee: num(o.paid_fee),
      envType: num(raw.env_type),
      bizMeta: str(raw.biz_meta),
    };
    return { kind: 'paid', order };
  }
  const snap = snapshotOf(o);
  if (status === 0 || status === 1) return { kind: 'unpaid', snapshot: snap };
  if (status === 5 || status === 8) return { kind: 'refunded', snapshot: snap };
  if (status === 6) return { kind: 'closed', snapshot: snap };
  if (status === 7) return { kind: 'refund_failed', snapshot: snap };
  if (status === 9 || status === 10) return { kind: 'unrelated', snapshot: snap };
  return { kind: 'unknown', detail: `unexpected order.status=${status}`, snapshot: snap };
}

async function postQueryOrder(accessToken: string, bodyJson: string, appKey: string): Promise<RawQueryOrderResponse> {
  const paySig = calcPaySig(QUERY_ORDER_URI, bodyJson, appKey);
  const url =
    `${WX_XPAY_QUERY_ORDER_URL}` +
    `?access_token=${encodeURIComponent(accessToken)}` +
    `&pay_sig=${encodeURIComponent(paySig)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyJson,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const err = new Error(`wx query_order http ${resp.status}`);
      (err as { httpStatus?: number }).httpStatus = resp.status;
      throw err;
    }
    return (await resp.json()) as RawQueryOrderResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 查询用户订单（query_order · tech-spec §4.2.3）。
 * 不抛业务异常：所有失败都归类进 RawQueryOrderOutcome，由 reconcile 决策矩阵统一处理。
 */
export async function queryOrder(outTradeNo: string, openid: string): Promise<RawQueryOrderOutcome> {
  const env = appEnv();
  if (!env.wxPayAppKey) {
    return { kind: 'unknown', detail: 'WX_PAY_APP_KEY not configured', snapshot: null };
  }
  const bodyJson = JSON.stringify({ openid, env: 0, order_id: outTradeNo });

  let raw: RawQueryOrderResponse;
  try {
    let accessToken = await getAccessToken(false);
    raw = await postQueryOrder(accessToken, bodyJson, env.wxPayAppKey);

    // 40001/42001：access_token 失效 ⇒ 强刷（并行去重）后只重试一次
    if (raw.errcode === 40001 || raw.errcode === 42001) {
      accessToken = await getAccessToken(true);
      raw = await postQueryOrder(accessToken, bodyJson, env.wxPayAppKey);
      if (raw.errcode === 40001 || raw.errcode === 42001) {
        return { kind: 'transient_error', reason: 'token_failed', detail: `errcode=${raw.errcode} after force refresh` };
      }
    }
  } catch (err) {
    const e = err as { name?: string; httpStatus?: number; message?: string };
    if (e?.name === 'AbortError') {
      return { kind: 'transient_error', reason: 'timeout', detail: 'query_order 5s timeout' };
    }
    if (typeof e?.httpStatus === 'number') {
      if (e.httpStatus >= 500) {
        return { kind: 'transient_error', reason: 'upstream_5xx', detail: `http ${e.httpStatus}` };
      }
      return { kind: 'unknown', detail: `http ${e.httpStatus}`, snapshot: null };
    }
    // getAccessToken 失败（stable_token 不可用）也按 token_failed 归类
    const msg = redactError(err) instanceof Error ? (redactError(err) as Error).message : 'unknown error';
    if (msg.includes('[accessToken]')) {
      return { kind: 'transient_error', reason: 'token_failed', detail: msg };
    }
    return { kind: 'transient_error', reason: 'network', detail: msg };
  }

  const errcode = raw.errcode ?? 0;
  if (errcode === 0) return classifyStatus(raw);
  if (errcode === 268490015) return { kind: 'transient_error', reason: 'rate_limited', detail: 'errcode=268490015' };
  if (errcode === 268490003) return { kind: 'unknown', detail: 'errcode=268490003 (pay_sig rejected · config alarm)', snapshot: null };
  return { kind: 'unknown', detail: `errcode=${errcode} errmsg=${raw.errmsg ?? ''}`, snapshot: null };
}
