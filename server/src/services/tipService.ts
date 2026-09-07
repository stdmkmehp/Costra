/**
 * Costra · Server · 赞赏业务编排层
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §4.1/§4.4/§4.5/§4.6
 *
 * 职责：
 *   createTipOrder    下单（模式闸门 → 身份闸门 → 目录 → 落单 → 签名）
 *   settleOrder       唯一允许创建 delivered 行的函数（§4.4 四步 · 单行条件迁移 T1）
 *   probeAndApply     query_order → validate → reconcile → 执行决策（webhook/scheduler/summary 共用）
 *   listTipProducts   商品目录 + purchasable
 *   buildTipSummary   派生权益聚合 + fire-and-forget 加速探测（绝不 await 上游）
 *   setBadgeHidden    徽章可见性开关
 *
 * 铁律：
 *   - code2Session.openid === users.wx_openid 是唯一支付身份闸门（不落单的 mismatch 直接拒绝）；
 *   - 微信网络调用全部在 DB 事务外；
 *   - session_key 不落库、不进日志（用完即弃）；
 *   - 资金写入只有 settleOrder / markRefunded / markExpired 三条路径（对账矩阵驱动）。
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { appEnv } from '../config/env.js';
import { ttl } from '../config/ttl.js';
import { findTipProduct, TIP_PRODUCTS } from '../config/tipProducts.js';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as tipOrderRepo from '../repositories/tipOrderRepo.js';
import type { TipOrderEntity } from '../repositories/tipOrderRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import { code2Session } from '../wx/code2Session.js';
import { queryOrder } from '../wx/virtualPayClient.js';
import { calcPaySig, calcSignature } from '../wx/virtualPaySign.js';
import {
  decisionSnapshot,
  reconcileQueryOutcome,
  validateQueryOrderOutcome,
  TIP_ATTACH,
  type ReconcileDecision,
  type ReconcileTrigger,
  type ValidatedPaidOrder,
} from './tipReconcile.js';

/** 用户日限（soft · tech-spec §4.1.2 步骤 1） */
const DAILY_ORDER_LIMIT = 20;
/** 首探测延迟（tech-spec §4.1.2 步骤 4：next_probe_at = created_at + 120s） */
const FIRST_PROBE_DELAY_MS = 120_000;
/** summary 历史条数上限 */
const HISTORY_LIMIT = 20;
/** summary 加速探测候选窗口：10 分钟内的 created 单（tech-spec §4.6） */
const SUMMARY_PROBE_CANDIDATE_MS = 10 * 60 * 1000;

export interface TipLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

// ─── 下单 ────────────────────────────────────────────────────────────────────

export interface CreateTipOrderResult {
  outTradeNo: string;
  payData: {
    /** 官方 8 字段 JSON 字符串（一次 stringify · 客户端原样回传） */
    signData: string;
    paySig: string;
    signature: string;
    mode: 'short_series_goods';
  };
}

export async function createTipOrder(input: {
  userId: string;
  productKey: string;
  code: string;
  log: TipLog;
}): Promise<CreateTipOrderResult> {
  const env = appEnv();
  const { userId } = input;

  // 步骤 1：模式闸门 + 日限
  if (env.wxPayMode === 'off') {
    throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
      message: 'virtual payment disabled',
      details: { reason: 'payment_disabled' },
    });
  }
  if (env.wxPayMode === 'allowlist' && !env.wxPayTestUserIds.includes(userId)) {
    throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
      message: 'virtual payment disabled',
      details: { reason: 'payment_disabled' },
    });
  }
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const todayCount = await tipOrderRepo.countOrdersSince(userId, dayAgo);
  if (todayCount >= DAILY_ORDER_LIMIT) {
    throw new AppError(ErrorCode.RATE_LIMITED, {
      message: 'daily tip order limit reached',
      details: { limit: DAILY_ORDER_LIMIT },
      retryAfterSec: 3600,
    });
  }

  // 步骤 2：支付身份闸门（唯一 · code2Session.openid === users.wx_openid · 不落单）
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'user not found' });
  }
  const session = await code2Session(input.code);
  if (session.openid !== user.wxOpenid) {
    input.log.warn({ userId }, 'tip order rejected: openid mismatch (payment identity gate)');
    throw new AppError(ErrorCode.PERMISSION_DENIED, {
      message: 'payment identity mismatch',
      details: { reason: 'payment_identity_mismatch' },
    });
  }

  // 步骤 3：商品目录
  const product = findTipProduct(input.productKey);
  if (!product) {
    throw new AppError(ErrorCode.PAYMENT_PRODUCT_INVALID, {
      message: 'unknown product_key',
      details: { product_key: input.productKey },
    });
  }

  // 步骤 4：落单（快照一次写齐 · out_trade_no = 'T' + 30 位 hex · 首探测 T+120s）
  const outTradeNo = 'T' + randomBytes(15).toString('hex');
  await tipOrderRepo.insertOrder({
    id: randomUUID(),
    userId,
    openid: session.openid,
    product,
    outTradeNo,
    nextProbeAt: new Date(Date.now() + FIRST_PROBE_DELAY_MS),
  });

  // 步骤 5：签名（官方 8 字段闭合 · 一次 stringify · session_key 用完即弃不落库）
  const signData = JSON.stringify({
    offerId: env.wxPayOfferId,
    buyQuantity: 1,
    env: 0,
    currencyType: 'CNY',
    productId: product.wxProductId,
    goodsPrice: product.priceCents,
    outTradeNo,
    attach: TIP_ATTACH,
  });
  const signature = calcSignature(signData, session.session_key);
  const paySig = calcPaySig('requestVirtualPayment', signData, env.wxPayAppKey as string);

  return {
    outTradeNo,
    payData: { signData, paySig, signature, mode: 'short_series_goods' },
  };
}

// ─── 结算（tech-spec §4.4 · 唯一允许创建 delivered 行的函数） ──────────────────

export type SettlementResult =
  | 'delivered'
  | 'already_delivered'
  | 'order-not-found'
  /** CI3：本次 wx_order_id 已被**另一张**本地单占用 */
  | 'order-conflict'
  /** 同一张单上的 wx_order_id 与上游漂移（本地已记 A、上游报 B）⇒ 不改任何字段，转人工 */
  | 'order-id-drift'
  | 'terminal-noop';

export async function settleOrder(
  outTradeNo: string,
  verified: ValidatedPaidOrder,
): Promise<SettlementResult> {
  const pool = getPool();
  const client = await pool.connect();
  const runner = client as unknown as tipOrderRepo.Runner;
  try {
    await client.query('BEGIN');

    const order = await tipOrderRepo.lockByOutTradeNo(outTradeNo, runner);
    if (!order) {
      await client.query('ROLLBACK');
      return 'order-not-found';
    }

    // 锁内复核（§4.4 步骤 2 · 只能此刻查库）：
    //   ① CI3 撞单——本次 wx_order_id 已挂在另一张本地单上；
    //   ② 同单漂移——本地已记 A、上游报 B。②必须显式阻断：backfillPlatformIds 用
    //      COALESCE 保留旧值，若放行则既不改 ID 也不告警，等于把一次账实错乱静默吞掉。
    //   （order_fee 无需锁内复外：price_cents 建表后不可变，外层 validate 已逐笔比对）
    if (verified.wxOrderId) {
      if (order.wxOrderId != null && order.wxOrderId !== verified.wxOrderId) {
        await client.query('ROLLBACK');
        return 'order-id-drift';
      }
      const occupied = await tipOrderRepo.existsWxOrderIdOnOtherOrder(verified.wxOrderId, outTradeNo, runner);
      if (occupied) {
        await client.query('ROLLBACK');
        return 'order-conflict';
      }
    }

    if (order.status === 'delivered') {
      // 幂等成功：只补齐平台 ID（不改动资金字段）
      await tipOrderRepo.backfillPlatformIds(
        {
          outTradeNo,
          wxOrderId: verified.wxOrderId,
          channelOrderId: verified.channelOrderId,
          wxpayOrderId: verified.wxpayOrderId,
          upstreamStatus: verified.status,
          upstreamOrderType: verified.orderType,
        },
        runner,
      );
      await client.query('COMMIT');
      return 'already_delivered';
    }

    if (order.status !== 'created') {
      // refunded / expired：不改账（告警分级由 reconcile 决策层负责）
      await client.query('ROLLBACK');
      return 'terminal-noop';
    }

    const paidAt = verified.paidTime ? new Date(verified.paidTime * 1000) : new Date();
    const updated = await tipOrderRepo.conditionalDeliver(
      {
        outTradeNo,
        wxOrderId: verified.wxOrderId,
        channelOrderId: verified.channelOrderId,
        wxpayOrderId: verified.wxpayOrderId,
        upstreamStatus: verified.status,
        upstreamOrderType: verified.orderType,
        paidAt,
      },
      runner,
    );
    if (updated !== 1) {
      // 并发下已被其他路径迁移（T1 断言）
      await client.query('ROLLBACK');
      return 'terminal-noop';
    }

    await client.query('COMMIT');
    return 'delivered';
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 忽略 rollback 异常，保留原异常
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─── 探测执行（webhook / scheduler / summary 三方共用） ───────────────────────

/**
 * query_order → validate → reconcile → 执行决策。
 * 前置：调用方已持有探测租约（claimProbe / 调度器 claim）；本函数不再做节流判定。
 * @returns 执行的决策（webhook 据此决定 ACK 或回 retry）
 */
export async function probeAndApply(
  order: TipOrderEntity,
  trigger: ReconcileTrigger,
  log: TipLog,
): Promise<ReconcileDecision> {
  const raw = await queryOrder(order.outTradeNo, order.openid);
  const validated = validateQueryOrderOutcome(order, raw, log);
  const probeWindowExpired =
    Date.now() >= order.createdAt.getTime() + ttl().tipProbeWindowSec * 1000;
  const decision = reconcileQueryOutcome({
    localStatus: order.status,
    outcome: validated,
    trigger,
    probeWindowExpired,
  });
  await applyDecision(order, decision, log);
  return decision;
}

async function applyDecision(
  order: TipOrderEntity,
  decision: ReconcileDecision,
  log: TipLog,
): Promise<void> {
  // 上游快照（status + order_type 原值）：所有留痕/终态迁移路径统一取用，
  // 保证 §4.3.1「order_type 原值不丢」不只在 settle 一条路径上成立。
  const snapshot = decisionSnapshot(decision);
  switch (decision.type) {
    case 'settle': {
      const result = await settleOrder(order.outTradeNo, decision.order);
      if (result === 'order-conflict' || result === 'order-id-drift') {
        log.error(
          {
            outTradeNo: order.outTradeNo,
            wxOrderId: decision.order.wxOrderId,
            localWxOrderId: order.wxOrderId,
            result,
          },
          result === 'order-conflict'
            ? 'tip settle blocked: wx_order_id occupied by another order (CI3)'
            : 'tip settle blocked: wx_order_id drifted on the same order · manual reconcile required',
        );
        await tipOrderRepo.updateUpstreamSnapshot({
          outTradeNo: order.outTradeNo,
          upstreamStatus: decision.order.status,
          upstreamOrderType: decision.order.orderType,
        });
      }
      return;
    }
    case 'mark_refunded':
      await tipOrderRepo.markRefunded({
        outTradeNo: order.outTradeNo,
        upstreamStatus: decision.snapshot.status,
        upstreamOrderType: decision.snapshot.orderType,
        paidAt: null,
      });
      return;
    case 'mark_expired':
      // T3 收口；告警级别由决策层给出（spec §4.3.1：conflict/unknown=error · transient=warn · unrelated=info）
      if (decision.level) {
        const payload = { outTradeNo: order.outTradeNo, upstreamStatus: snapshot?.status ?? null };
        log[decision.level](payload, 'tip reconcile mark_expired with alert');
      }
      await tipOrderRepo.markExpired({
        outTradeNo: order.outTradeNo,
        upstreamStatus: snapshot?.status ?? null,
        upstreamOrderType: snapshot?.orderType ?? null,
      });
      return;
    case 'keep_delivered': {
      const payload = { outTradeNo: order.outTradeNo, reason: decision.reason };
      if (decision.level === 'warn') log.warn(payload, 'tip reconcile keep_delivered');
      return;
    }
    case 'manual_conflict': {
      const payload = { outTradeNo: order.outTradeNo, reason: decision.reason };
      if (decision.level === 'error') {
        log.error(payload, 'tip reconcile manual_conflict');
      } else {
        log.warn(payload, 'tip reconcile manual_conflict');
      }
      // created 单保留待人工：镜像上游快照留痕
      if (order.status === 'created') {
        await tipOrderRepo.updateUpstreamSnapshot({
          outTradeNo: order.outTradeNo,
          upstreamStatus: snapshot?.status ?? null,
          upstreamOrderType: snapshot?.orderType ?? null,
        });
      }
      return;
    }
    case 'keep_current':
    case 'schedule_probe':
    case 'retry':
      // 不改资金状态；created 单镜像上游快照留痕（schedule_probe 的下一拍由调度器节奏表驱动）
      if (order.status === 'created') {
        await tipOrderRepo.updateUpstreamSnapshot({
          outTradeNo: order.outTradeNo,
          upstreamStatus: snapshot?.status ?? null,
          upstreamOrderType: snapshot?.orderType ?? null,
        });
      }
      return;
  }
}

// ─── 商品目录（tech-spec §4.5.1） ─────────────────────────────────────────────

export function listTipProducts(userId: string): {
  purchasable: boolean;
  products: Array<{
    type: string;
    product_key: string;
    title: string;
    price_cents: number;
    support_delta: number;
    entitlement_keys: string[];
    sub_desc: string;
  }>;
} {
  const env = appEnv();
  const purchasable =
    env.wxPayMode === 'on' ||
    (env.wxPayMode === 'allowlist' && env.wxPayTestUserIds.includes(userId));
  return {
    purchasable,
    products: TIP_PRODUCTS.filter((p) => p.enabled).map((p) => ({
      type: p.type,
      product_key: p.productKey,
      title: p.title,
      price_cents: p.priceCents,
      support_delta: p.supportDelta,
      entitlement_keys: [...p.entitlementKeys],
      sub_desc: p.subDesc,
    })),
  };
}

// ─── 权益 summary（tech-spec §4.5.2 / §4.6） ──────────────────────────────────

export interface TipSummaryResponse {
  entitlements: Array<{ key: string; granted_at: string | null }>;
  supporter_badge: boolean;
  tip_count: number;
  support_score: number;
  badge_hidden: boolean;
  has_pending_orders: boolean;
  /**
   * 历史（`out_trade_no` 为本人业务单号）。
   * 客户端 settling 用「本单是否出现在 history」判定发货，替代「次数是否变大」——
   * 后者需要一个下单前的基线，而基线在 summary 首拉失败时不可得（会误判已发货）。
   * 仍不返回金额、openid 与任何平台 ID（§4.6）。
   */
  history: Array<{
    out_trade_no: string;
    time: string;
    title: string;
    status: string;
    support_delta: number;
  }>;
}

export async function buildTipSummary(userId: string, log: TipLog): Promise<TipSummaryResponse> {
  const [agg, entitlements, badgeHidden, hasPending, history] = await Promise.all([
    tipOrderRepo.aggregateTipSummary(userId),
    tipOrderRepo.deriveEntitlements(userId),
    tipOrderRepo.getBadgeHidden(userId),
    tipOrderRepo.hasPendingOrder(userId),
    tipOrderRepo.listSettledHistory(userId, HISTORY_LIMIT),
  ]);

  // entitlements 用通用派生而非 tipCount 特化（tech-spec §7.3：summary 要输出 entitlements[]
  // 明细、且未来皮肤会引入第二个 key；overview 高频端点才获准用 tipCount>0 特化）
  const supporterBadge = entitlements.some((e) => e.key === 'supporter_badge');
  const response: TipSummaryResponse = {
    entitlements: entitlements.map((e) => ({
      key: e.key,
      granted_at: e.grantedAt ? e.grantedAt.toISOString() : null,
    })),
    supporter_badge: supporterBadge,
    tip_count: agg.tipCount,
    support_score: agg.supportScore,
    badge_hidden: badgeHidden,
    has_pending_orders: hasPending,
    history: history.map((h) => ({
      out_trade_no: h.outTradeNo,
      time: h.time.toISOString(),
      title: h.title,
      status: h.status,
      support_delta: h.supportDelta,
    })),
  };

  // fire-and-forget 加速探测（tech-spec §4.6）：响应路径绝不 await 上游；
  // 每次请求最多 probe 一单（最近一张 10 分钟内的 created 单）；受探测租约保护。
  const candidate = await tipOrderRepo.findLatestCreatedWithin(
    userId,
    new Date(Date.now() - SUMMARY_PROBE_CANDIDATE_MS),
  );
  if (candidate) {
    void (async () => {
      const claimed = await tipOrderRepo.claimProbe(candidate.outTradeNo, ttl().tipProbeMinIntervalSec);
      if (!claimed) return;
      await probeAndApply(candidate, 'summary', log);
    })().catch((err: unknown) => {
      log.warn(
        { err, outTradeNo: candidate.outTradeNo },
        'tip summary fire-and-forget probe failed (swallowed)',
      );
    });
  }

  return response;
}
