/**
 * Costra · Server · 赞赏对账判定层（纯函数 · 无 DB / 无网络）
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §4.3 / §4.3.1
 *
 * 组成：
 *   validateQueryOrderOutcome —— query_order 原始结果的唯一校验入口：
 *     · 硬校验（阻断）：order_id 必须回显 out_trade_no；order_fee 必须等于 price_cents；
 *       wx_order_id 不漂移（撞单检测需 DB ⇒ 在 settleOrder 事务内做，不在本层）。
 *     · 弱校验（只告警不阻断）：env_type=1（现网）/ biz_meta='costra-tip-v1' / order_type ∈ {0,1,7,8}
 *       （0/1⇔微信支付 · 7/8⇔Apple 支付，§4.3.1 弱证据表；仅集合外取值告警，避免对每笔 iOS 单误报）。
 *       设计原则：误标 hard-block 会把已支付用户拦在交付外；弱校验只写日志，人工巡检发现真实问题。
 *   reconcileQueryOutcome —— 全格决策矩阵（第一步终态守卫 + 第二步 created × 9 类 outcome），
 *     不得在本函数之外派生任何资金语义。
 *
 * T3（优先于 outcome 的前置判定）：窗口外（now >= created_at + tipProbeWindowSec）除 paid 2/3/4
 *   外一律 mark_expired —— 由第二步各行在 probeWindowExpired=true 时收口（调用方计算该标记）。
 */

import type { TipOrderEntity, TipOrderStatus } from '../repositories/tipOrderRepo.js';
import type {
  QueryTransientReason,
  RawQueryOrderOutcome,
  WxOrderSnapshot,
} from '../wx/virtualPayClient.js';

// ─── 校验层 ──────────────────────────────────────────────────────────────────

export interface ValidatedPaidOrder {
  status: 2 | 3 | 4;
  /** 已校验 === 本地 out_trade_no */
  orderId: string;
  /** 已校验 === 本地 price_cents */
  orderFee: number;
  wxOrderId: string | null;
  channelOrderId: string | null;
  wxpayOrderId: string | null;
  orderType: number | null;
  paidTime: number | null;
  paidFee: number | null;
  envType: number | null;
  bizMeta: string | null;
}

export type HardConflictReason = 'order_id' | 'order_fee' | 'wx_order_id';

export type ValidatedQueryOrderOutcome =
  | { kind: 'paid'; order: ValidatedPaidOrder }
  | { kind: 'unpaid'; snapshot: WxOrderSnapshot }
  | { kind: 'closed'; snapshot: WxOrderSnapshot }
  | { kind: 'refunded'; snapshot: WxOrderSnapshot }
  | { kind: 'refund_failed'; snapshot: WxOrderSnapshot }
  | { kind: 'unrelated'; snapshot: WxOrderSnapshot }
  | { kind: 'unknown'; detail: string; snapshot: WxOrderSnapshot | null }
  | { kind: 'transient_error'; reason: QueryTransientReason; detail: string }
  | { kind: 'conflict'; reasons: HardConflictReason[]; snapshot: WxOrderSnapshot };

export interface WarnLogger {
  warn: (obj: object, msg: string) => void;
}

/** attach 协议标识（tech-spec §2.4.2 · 同时是 biz_meta 期望值） */
export const TIP_ATTACH = 'costra-tip-v1';

/** query_order order_type 合法取值集合（§4.3.1 弱证据表：0/1⇔微信支付 · 7/8⇔Apple 支付） */
const KNOWN_ORDER_TYPES: ReadonlySet<number> = new Set([0, 1, 7, 8]);

/**
 * query_order 结果唯一校验入口（tech-spec §4.3）。
 * wx_order_id「撞单」检测（同一下游支付单映射两单）必须读库 ⇒ 不在本纯函数层，
 * 由 settleOrder 事务内 existsWxOrderIdOnOtherOrder 完成（§4.4）。
 */
export function validateQueryOrderOutcome(
  localOrder: TipOrderEntity,
  raw: RawQueryOrderOutcome,
  log: WarnLogger,
): ValidatedQueryOrderOutcome {
  if (raw.kind !== 'paid') return raw;

  const o = raw.order;
  const reasons: HardConflictReason[] = [];

  // 硬校验 1：order_id 必须回显我方单号（按 order_id 查询 ⇒ 不回显 = 账本错乱）
  if (o.orderId == null || o.orderId !== localOrder.outTradeNo) reasons.push('order_id');
  // 硬校验 2：order_fee 必须等于下单快照 price_cents
  if (o.orderFee == null || o.orderFee !== localOrder.priceCents) reasons.push('order_fee');
  // 硬校验 3：wx_order_id 不漂移（本地已有值而下游给出不同值）
  if (localOrder.wxOrderId && o.wxOrderId && localOrder.wxOrderId !== o.wxOrderId) {
    reasons.push('wx_order_id');
  }

  if (reasons.length > 0) {
    return { kind: 'conflict', reasons, snapshot: { status: o.status, orderType: o.orderType } };
  }

  // 弱校验（只 warn · 不阻断发放）
  if (o.envType != null && o.envType !== 1) {
    log.warn(
      { outTradeNo: localOrder.outTradeNo, envType: o.envType },
      'query_order env_type mismatch (expect 1 · prod)',
    );
  }
  if (o.bizMeta != null && o.bizMeta !== TIP_ATTACH) {
    log.warn(
      { outTradeNo: localOrder.outTradeNo, bizMeta: o.bizMeta },
      'query_order biz_meta mismatch (expect costra-tip-v1)',
    );
  }
  // order_type 原值记账、仅作弱证据（§4.3.1）：0/1⇔微信支付 · 7/8⇔Apple 支付均为合法现网取值，
  // 只对集合外取值告警（否则每笔 iOS Apple 单都会误报 warn，造成告警疲劳）。
  if (o.orderType != null && !KNOWN_ORDER_TYPES.has(o.orderType)) {
    log.warn(
      { outTradeNo: localOrder.outTradeNo, orderType: o.orderType },
      'query_order order_type unknown (expect 0/1 wechat · 7/8 apple)',
    );
  }

  return {
    kind: 'paid',
    order: {
      status: o.status,
      orderId: o.orderId as string,
      orderFee: o.orderFee as number,
      wxOrderId: o.wxOrderId,
      channelOrderId: o.channelOrderId,
      wxpayOrderId: o.wxpayOrderId,
      orderType: o.orderType,
      paidTime: o.paidTime,
      paidFee: o.paidFee,
      envType: o.envType,
      bizMeta: o.bizMeta,
    },
  };
}

// ─── 决策层 ──────────────────────────────────────────────────────────────────

export type ReconcileTrigger = 'notify' | 'scheduler' | 'summary';

export type ReconcileDecision =
  | { type: 'settle'; order: ValidatedPaidOrder }
  | { type: 'keep_delivered'; level: 'info' | 'warn'; reason: string }
  | { type: 'mark_refunded'; snapshot: WxOrderSnapshot }
  | { type: 'manual_conflict'; level: 'warn' | 'error'; reason: string; snapshot: WxOrderSnapshot | null }
  | { type: 'keep_current'; snapshot: WxOrderSnapshot | null }
  | { type: 'mark_expired'; snapshot: WxOrderSnapshot | null; level?: 'info' | 'warn' | 'error' }
  | { type: 'schedule_probe'; snapshot: WxOrderSnapshot | null }
  | { type: 'retry'; snapshot: WxOrderSnapshot | null };

function snapshotOf(outcome: ValidatedQueryOrderOutcome): WxOrderSnapshot | null {
  switch (outcome.kind) {
    case 'paid':
      return { status: outcome.order.status, orderType: outcome.order.orderType };
    case 'unpaid':
    case 'closed':
    case 'refunded':
    case 'refund_failed':
    case 'unrelated':
    case 'conflict':
      return outcome.snapshot;
    default:
      return null;
  }
}

/**
 * 决策携带的上游快照（`status` + `order_type` **原值**）。
 * 执行层（`applyDecision`）用它统一留痕，保证 §4.3.1「order_type 原值不丢」在
 * settle 之外的每条路径上同样成立——`upstream_order_type` 是 R1（Apple 价格档映射）
 * 的唯一渠道归因依据，任一路径写 NULL 都会削弱取证面。
 */
export function decisionSnapshot(decision: ReconcileDecision): WxOrderSnapshot | null {
  switch (decision.type) {
    case 'settle':
      return { status: decision.order.status, orderType: decision.order.orderType };
    case 'keep_delivered':
      // delivered 单不改账也不留痕（updateUpstreamSnapshot 只写 created 行）
      return null;
    default:
      return decision.snapshot;
  }
}

/**
 * 全格决策矩阵（tech-spec §4.3.1）。
 * @param probeWindowExpired now >= created_at + tipProbeWindowSec（T3 · 调用方计算）
 */
export function reconcileQueryOutcome(input: {
  localStatus: TipOrderStatus;
  outcome: ValidatedQueryOrderOutcome;
  trigger: ReconcileTrigger;
  probeWindowExpired: boolean;
}): ReconcileDecision {
  const { localStatus, outcome, probeWindowExpired } = input;

  // ── 第一步：终态守卫（delivered / refunded / expired 绝不被对账改为 expired/refunded） ──
  if (localStatus === 'delivered') {
    switch (outcome.kind) {
      case 'paid':
        // 幂等成功：只补齐平台 ID（不改动资金字段）
        return { type: 'settle', order: outcome.order };
      case 'refund_failed':
        return { type: 'keep_delivered', level: 'warn', reason: 'upstream refund_failed after delivered' };
      case 'refunded':
        return { type: 'mark_refunded', snapshot: outcome.snapshot };
      case 'unpaid':
      case 'closed':
        return {
          type: 'manual_conflict',
          level: 'warn',
          reason: `delivered order reported ${outcome.kind} upstream · never downgrade delivered`,
          snapshot: outcome.snapshot,
        };
      case 'conflict':
        return {
          type: 'manual_conflict',
          level: 'error',
          reason: `delivered order hard conflict: ${outcome.reasons.join('+')}`,
          snapshot: outcome.snapshot,
        };
      default:
        // unknown / transient_error / unrelated：已交付订单不因不确定结果改账
        return { type: 'keep_delivered', level: 'info', reason: `delivered + ${outcome.kind}` };
    }
  }

  if (localStatus === 'expired') {
    if (outcome.kind === 'paid') {
      return {
        type: 'manual_conflict',
        level: 'error',
        reason: 'paid order arrived after local expired · requires manual reconcile',
        snapshot: snapshotOf(outcome),
      };
    }
    // 终态 + 其余任一 outcome（含 conflict）⇒ keep_current（spec §4.3.1 第一步全格语义）
    return { type: 'keep_current', snapshot: snapshotOf(outcome) };
  }

  if (localStatus === 'refunded') {
    return { type: 'keep_current', snapshot: snapshotOf(outcome) };
  }

  // ── 第二步：created × 9 类 outcome（T3：窗口外除 paid 外一律 mark_expired） ──
  switch (outcome.kind) {
    case 'paid':
      return { type: 'settle', order: outcome.order };
    case 'unpaid':
      return probeWindowExpired
        ? { type: 'mark_expired', snapshot: outcome.snapshot }
        : { type: 'schedule_probe', snapshot: outcome.snapshot };
    case 'closed':
      return { type: 'mark_expired', snapshot: outcome.snapshot };
    case 'refunded':
      return { type: 'mark_refunded', snapshot: outcome.snapshot };
    case 'refund_failed':
      // created + 退款失败 = 账实错乱（上游收过钱且退款失败，本地从未交付）：
      // 窗口内转人工 + error；窗口外仍按 T3 收口 expired，但保留 error 告警
      return probeWindowExpired
        ? { type: 'mark_expired', snapshot: outcome.snapshot, level: 'error' }
        : {
            type: 'manual_conflict',
            level: 'error',
            reason: 'created order reported refund_failed upstream · ledger-fact mismatch',
            snapshot: outcome.snapshot,
          };
    case 'unrelated':
      // 窗口内不动账；窗口外必须收口 expired（T3：除 paid 外一律终态，
      // 否则订单永久驻留 idx_tip_orders_probe_due 且每 tick 重复 query_order）
      return probeWindowExpired
        ? { type: 'mark_expired', snapshot: outcome.snapshot, level: 'info' }
        : { type: 'keep_current', snapshot: outcome.snapshot };
    case 'unknown':
      // 窗口外收口需 error 告警（spec §4.3.1：未知结果置 expired 属保守兜底，须可观测）
      return probeWindowExpired
        ? { type: 'mark_expired', snapshot: outcome.snapshot, level: 'error' }
        : { type: 'retry', snapshot: outcome.snapshot };
    case 'transient_error':
      // 窗口外收口 warn 告警（spec §4.3.1：瞬时故障耗尽窗口属预期内但需留趋势）
      return probeWindowExpired
        ? { type: 'mark_expired', snapshot: null, level: 'warn' }
        : { type: 'retry', snapshot: null };
    case 'conflict':
      // 确定性冲突重复探测无法修复：窗口内转人工（不改账）+ error；
      // 窗口外按 T3 收口 expired + error（同 P0-A：sweep 侧必须有终止出口）
      return probeWindowExpired
        ? { type: 'mark_expired', snapshot: outcome.snapshot, level: 'error' }
        : {
            type: 'manual_conflict',
            level: 'error',
            reason: `created order hard conflict: ${outcome.reasons.join('+')} · keep created for manual review`,
            snapshot: outcome.snapshot,
          };
  }
}
