/**
 * Costra · Server · 赞赏对账判定层单测（tipReconcile · 纯函数）
 *
 * 事实源：tech-spec v1.2 §4.3（validate 唯一校验入口）/ §4.3.1（reconcile 全格决策矩阵）
 *
 * 覆盖：
 *   V1~V8   validate：硬校验三格（order_id / order_fee / wx_order_id 漂移）+ 通过路径 + 非 paid 透传
 *           + 弱校验三件套 + order_type 已知集合（7/8 Apple 不告警 · 集合外才告警）
 *   R1~R9   reconcile created × 9 类 outcome × 窗口内外（T3：窗口外除 paid 外一律 mark_expired）
 *   G1~G4   reconcile 终态守卫（delivered / expired / refunded 各行）
 */

import { describe, it, expect } from 'vitest';
import {
  reconcileQueryOutcome,
  validateQueryOrderOutcome,
  type ValidatedQueryOrderOutcome,
} from '../src/services/tipReconcile.js';
import type { TipOrderEntity } from '../src/repositories/tipOrderRepo.js';
import type { RawQueryOrderOutcome, WxPaidOrderFacts } from '../src/wx/virtualPayClient.js';

const noopLog = { warn: () => undefined };

function makeOrder(overrides: Partial<TipOrderEntity> = {}): TipOrderEntity {
  return {
    id: 'order-1',
    userId: 'user-1',
    openid: 'openid-1',
    productType: 'tip',
    productKey: 'coffee',
    productTitle: '请开发者喝一杯咖啡',
    wxProductId: 'coffee',
    priceCents: 990,
    supportDelta: 99,
    entitlementKeys: ['supporter_badge'],
    upstreamOrderType: null,
    outTradeNo: 'T' + 'a'.repeat(30),
    wxOrderId: null,
    channelOrderId: null,
    wxpayOrderId: null,
    upstreamStatus: null,
    status: 'created',
    createdAt: new Date('2026-09-04T00:00:00Z'),
    paidAt: null,
    deliveredAt: null,
    refundedAt: null,
    lastProbedAt: null,
    nextProbeAt: new Date('2026-09-04T00:02:00Z'),
    probeCount: 0,
    updatedAt: new Date('2026-09-04T00:00:00Z'),
    ...overrides,
  };
}

function makePaidFacts(overrides: Partial<WxPaidOrderFacts> = {}): WxPaidOrderFacts {
  return {
    status: 4,
    orderId: 'T' + 'a'.repeat(30),
    orderFee: 990,
    wxOrderId: 'wx-pay-1',
    channelOrderId: null,
    wxpayOrderId: 'tx-1',
    orderType: 0,
    paidTime: 1_800_000_000,
    paidFee: 990,
    envType: 1,
    bizMeta: 'costra-tip-v1',
    ...overrides,
  };
}

// ─── validate ────────────────────────────────────────────────────────────────

describe('validateQueryOrderOutcome · 唯一校验入口', () => {
  it('V1 · 全部校验通过 ⇒ paid（原样搬运下游字段）', () => {
    const raw: RawQueryOrderOutcome = { kind: 'paid', order: makePaidFacts() };
    const v = validateQueryOrderOutcome(makeOrder(), raw, noopLog);
    expect(v.kind).toBe('paid');
    if (v.kind === 'paid') {
      expect(v.order.orderId).toBe('T' + 'a'.repeat(30));
      expect(v.order.orderFee).toBe(990);
      expect(v.order.wxOrderId).toBe('wx-pay-1');
    }
  });

  it('V2 · order_id 不回显 out_trade_no ⇒ conflict[order_id]', () => {
    const raw: RawQueryOrderOutcome = { kind: 'paid', order: makePaidFacts({ orderId: 'OTHER' }) };
    const v = validateQueryOrderOutcome(makeOrder(), raw, noopLog);
    expect(v).toMatchObject({ kind: 'conflict', reasons: ['order_id'] });
  });

  it('V3 · order_fee ≠ price_cents ⇒ conflict[order_fee]；null 同样冲突', () => {
    const raw1: RawQueryOrderOutcome = { kind: 'paid', order: makePaidFacts({ orderFee: 100 }) };
    expect(validateQueryOrderOutcome(makeOrder(), raw1, noopLog)).toMatchObject({
      kind: 'conflict',
      reasons: ['order_fee'],
    });
    const raw2: RawQueryOrderOutcome = { kind: 'paid', order: makePaidFacts({ orderFee: null }) };
    expect(validateQueryOrderOutcome(makeOrder(), raw2, noopLog)).toMatchObject({
      kind: 'conflict',
      reasons: ['order_fee'],
    });
  });

  it('V4 · wx_order_id 漂移（本地已有值且不同）⇒ conflict[wx_order_id]', () => {
    const local = makeOrder({ wxOrderId: 'wx-pay-LOCAL' });
    const raw: RawQueryOrderOutcome = { kind: 'paid', order: makePaidFacts({ wxOrderId: 'wx-pay-OTHER' }) };
    const v = validateQueryOrderOutcome(local, raw, noopLog);
    expect(v).toMatchObject({ kind: 'conflict', reasons: ['wx_order_id'] });
  });

  it('V5 · 本地 wx_order_id 为 NULL ⇒ 下游任意值不构成漂移（回填路径放行）', () => {
    const raw: RawQueryOrderOutcome = { kind: 'paid', order: makePaidFacts({ wxOrderId: 'wx-pay-NEW' }) };
    const v = validateQueryOrderOutcome(makeOrder({ wxOrderId: null }), raw, noopLog);
    expect(v.kind).toBe('paid');
  });

  it('V6 · 非 paid outcome 原样透传（不在本层校验）', () => {
    const raw: RawQueryOrderOutcome = { kind: 'unpaid', snapshot: { status: 1, orderType: 0 } };
    const v = validateQueryOrderOutcome(makeOrder(), raw, noopLog);
    expect(v).toEqual(raw);
  });

  it('V7 · 弱校验只告警不阻断（env_type / biz_meta / order_type 异常仍 paid）', () => {
    const warnings: string[] = [];
    const log = { warn: (_obj: object, msg: string) => warnings.push(msg) };
    const raw: RawQueryOrderOutcome = {
      kind: 'paid',
      order: makePaidFacts({ envType: 0, bizMeta: 'other', orderType: 5 }),
    };
    const v = validateQueryOrderOutcome(makeOrder(), raw, log);
    expect(v.kind).toBe('paid');
    expect(warnings.length).toBe(3);
  });

  it('V8 · order_type 已知集合（0/1 微信 · 7/8 Apple）不告警；仅集合外取值告警（§4.3.1 弱证据表）', () => {
    for (const orderType of [0, 1, 7, 8]) {
      const warnings: string[] = [];
      const log = { warn: (_obj: object, msg: string) => warnings.push(msg) };
      const raw: RawQueryOrderOutcome = { kind: 'paid', order: makePaidFacts({ orderType }) };
      const v = validateQueryOrderOutcome(makeOrder(), raw, log);
      expect(v.kind).toBe('paid');
      expect(warnings.length).toBe(0);
    }
  });
});

// ─── reconcile · created × 9 × 窗口内外 ──────────────────────────────────────

function reconcile(
  outcome: ValidatedQueryOrderOutcome,
  probeWindowExpired: boolean,
  localStatus: TipOrderEntity['status'] = 'created',
) {
  return reconcileQueryOutcome({ localStatus, outcome, trigger: 'scheduler', probeWindowExpired });
}

const unpaid: ValidatedQueryOrderOutcome = { kind: 'unpaid', snapshot: { status: 1, orderType: 0 } };
const closed: ValidatedQueryOrderOutcome = { kind: 'closed', snapshot: { status: 6, orderType: 0 } };
const refunded: ValidatedQueryOrderOutcome = { kind: 'refunded', snapshot: { status: 5, orderType: 0 } };
const refundFailed: ValidatedQueryOrderOutcome = { kind: 'refund_failed', snapshot: { status: 7, orderType: 0 } };
const unrelated: ValidatedQueryOrderOutcome = { kind: 'unrelated', snapshot: { status: 9, orderType: 0 } };
const unknown: ValidatedQueryOrderOutcome = { kind: 'unknown', detail: 'x', snapshot: null };
const transient: ValidatedQueryOrderOutcome = { kind: 'transient_error', reason: 'timeout', detail: 't' };
const conflict: ValidatedQueryOrderOutcome = {
  kind: 'conflict',
  reasons: ['order_fee'],
  snapshot: { status: 4, orderType: 0 },
};
const paid: ValidatedQueryOrderOutcome = {
  kind: 'paid',
  order: {
    status: 4,
    orderId: 'T' + 'a'.repeat(30),
    orderFee: 990,
    wxOrderId: 'wx-pay-1',
    channelOrderId: null,
    wxpayOrderId: 'tx-1',
    orderType: 0,
    paidTime: 1_800_000_000,
    paidFee: 990,
    envType: 1,
    bizMeta: 'costra-tip-v1',
  },
};

describe('reconcileQueryOutcome · created × 9 类 outcome（tech-spec §4.3.1 第二步）', () => {
  it('R1 · paid ⇒ settle（窗口内外一致）', () => {
    expect(reconcile(paid, false).type).toBe('settle');
    expect(reconcile(paid, true).type).toBe('settle');
  });

  it('R2 · unpaid：窗口内 schedule_probe · 窗口外 mark_expired（T3）', () => {
    expect(reconcile(unpaid, false).type).toBe('schedule_probe');
    expect(reconcile(unpaid, true).type).toBe('mark_expired');
  });

  it('R3 · closed ⇒ mark_expired（窗口内外一致 · 微信已关单）', () => {
    expect(reconcile(closed, false).type).toBe('mark_expired');
    expect(reconcile(closed, true).type).toBe('mark_expired');
  });

  it('R4 · refunded ⇒ mark_refunded（从未交付 ⇒ 只记资金回退事实）', () => {
    expect(reconcile(refunded, false).type).toBe('mark_refunded');
    expect(reconcile(refunded, true).type).toBe('mark_refunded');
  });

  it('R5 · refund_failed：窗口内 manual_conflict + error（created+退款失败=账实错乱）· 窗口外 mark_expired + error', () => {
    expect(reconcile(refundFailed, false)).toMatchObject({ type: 'manual_conflict', level: 'error' });
    expect(reconcile(refundFailed, true)).toMatchObject({ type: 'mark_expired', level: 'error' });
  });

  it('R6 · unrelated：窗口内 keep_current（与本业务无关 · 不动账）· 窗口外 mark_expired + info（T3 收口）', () => {
    expect(reconcile(unrelated, false).type).toBe('keep_current');
    expect(reconcile(unrelated, true)).toMatchObject({ type: 'mark_expired', level: 'info' });
  });

  it('R7 · unknown：窗口内 retry · 窗口外 mark_expired + error 告警（T3 · spec §4.3.1）', () => {
    expect(reconcile(unknown, false).type).toBe('retry');
    expect(reconcile(unknown, true)).toMatchObject({ type: 'mark_expired', level: 'error' });
  });

  it('R8 · transient_error：窗口内 retry · 窗口外 mark_expired + warn 告警（T3 · spec §4.3.1）', () => {
    expect(reconcile(transient, false).type).toBe('retry');
    expect(reconcile(transient, true)).toMatchObject({ type: 'mark_expired', level: 'warn' });
  });

  it('R9 · conflict：窗口内 manual_conflict + error 不改账 · 窗口外 mark_expired + error（T3 收口 · P0-A 回归）', () => {
    expect(reconcile(conflict, false)).toMatchObject({ type: 'manual_conflict', level: 'error' });
    expect(reconcile(conflict, true)).toMatchObject({ type: 'mark_expired', level: 'error' });
  });
});

describe('reconcileQueryOutcome · 终态守卫（tech-spec §4.3.1 第一步）', () => {
  it('G1 · delivered + paid ⇒ settle（幂等成功 · 只补齐平台 ID）', () => {
    expect(reconcile(paid, false, 'delivered').type).toBe('settle');
  });

  it('G2 · delivered + refunded ⇒ mark_refunded；+ refund_failed ⇒ keep_delivered warn', () => {
    expect(reconcile(refunded, false, 'delivered').type).toBe('mark_refunded');
    expect(reconcile(refundFailed, false, 'delivered')).toMatchObject({
      type: 'keep_delivered',
      level: 'warn',
    });
  });

  it('G3 · delivered + unpaid/closed ⇒ manual_conflict（不得把已交付订单改 expired）', () => {
    expect(reconcile(unpaid, false, 'delivered')).toMatchObject({ type: 'manual_conflict', level: 'warn' });
    expect(reconcile(closed, false, 'delivered')).toMatchObject({ type: 'manual_conflict', level: 'warn' });
    // 不确定结果不改账
    expect(reconcile(unknown, false, 'delivered').type).toBe('keep_delivered');
    expect(reconcile(transient, false, 'delivered').type).toBe('keep_delivered');
    expect(reconcile(unrelated, false, 'delivered').type).toBe('keep_delivered');
    expect(reconcile(conflict, false, 'delivered')).toMatchObject({ type: 'manual_conflict', level: 'error' });
  });

  it('G4 · expired + paid ⇒ manual_conflict error；expired + 其余任一（含 conflict）⇒ keep_current', () => {
    expect(reconcile(paid, false, 'expired')).toMatchObject({ type: 'manual_conflict', level: 'error' });
    expect(reconcile(unpaid, false, 'expired').type).toBe('keep_current');
    expect(reconcile(conflict, false, 'expired').type).toBe('keep_current');
  });

  it('G5 · refunded + 其余任一（含 paid / conflict）⇒ keep_current（终态不再迁移）', () => {
    expect(reconcile(paid, false, 'refunded').type).toBe('keep_current');
    expect(reconcile(refunded, false, 'refunded').type).toBe('keep_current');
    expect(reconcile(conflict, false, 'refunded').type).toBe('keep_current');
  });
});
