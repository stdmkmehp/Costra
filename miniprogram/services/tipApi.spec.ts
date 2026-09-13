// services/tipApi.spec.ts · 赞赏 API adapter 与缓存单测
// 事实源：tech-spec v1.2 §7.2/§7.5 + §10（客户端测试行）
//
// 覆盖：
//   - adaptCatalog：snake→camel、type 枚举校验（非 tip 丢弃）、非法价格/支持度丢弃
//   - adaptSummary：history status 枚举校验（expired 等丢弃）、granted_at 映射
//   - adaptCreateOrderResult：malformed 抛错（客户端不得重组残缺 payData）
//   - formatYuan：整元不带小数、去尾随零（100→'1' · 990→'9.9' · 18740→'187.4'）
//   - 目录缓存：不按 channel 分键（单一缓存键）、clearTipCatalogCache 清内存镜像

import { describe, it, expect } from 'vitest';
import {
  adaptCatalog,
  adaptSummary,
  adaptCreateOrderResult,
  formatYuan,
  getCachedCatalog,
  clearTipCatalogCache,
  type TipCatalogWire,
  type TipSummaryWire,
  type CreateTipOrderWire,
} from './tipApi';

function catalogWire(products: Partial<TipCatalogWire['products'][number]>[]): TipCatalogWire {
  return {
    purchasable: true,
    products: products.map((p) => ({
      type: 'tip',
      product_key: 'coffee',
      title: '请开发者喝一杯咖啡',
      price_cents: 990,
      support_delta: 99,
      entitlement_keys: ['supporter_badge'],
      sub_desc: 'sub',
      ...p,
    })),
  };
}

describe('adaptCatalog', () => {
  it('snake→camel + 预计算 priceText', () => {
    const c = adaptCatalog(catalogWire([{ product_key: 'encourage', price_cents: 100, support_delta: 10 }]));
    expect(c.purchasable).toBe(true);
    expect(c.products).toHaveLength(1);
    expect(c.products[0]).toMatchObject({
      type: 'tip',
      productKey: 'encourage',
      priceCents: 100,
      priceText: '1',
      supportDelta: 10,
      entitlementKeys: ['supporter_badge'],
    });
  });

  it('type 非 tip 的条目被丢弃（运行时枚举校验）', () => {
    const c = adaptCatalog(catalogWire([{ type: 'skin' }, { product_key: 'ok' }]));
    expect(c.products.map((p) => p.productKey)).toEqual(['ok']);
  });

  it('非法 price_cents / support_delta / 空 product_key 的条目被丢弃', () => {
    const c = adaptCatalog(
      catalogWire([
        { product_key: 'bad-price', price_cents: 0 },
        { product_key: 'bad-delta', support_delta: -1 },
        { product_key: '' },
        { product_key: 'ok' },
      ]),
    );
    expect(c.products.map((p) => p.productKey)).toEqual(['ok']);
  });

  it('purchasable 严格布尔化（非 true 一律不可购买 · 保守降级）；products 缺失时为空数组', () => {
    expect(adaptCatalog({ purchasable: 1 as unknown as boolean, products: [] }).purchasable).toBe(false);
    const c = adaptCatalog({ purchasable: false } as unknown as TipCatalogWire);
    expect(c.products).toEqual([]);
    expect(c.purchasable).toBe(false);
  });
});

describe('adaptSummary', () => {
  it('history status 枚举校验：delivered/refunded 保留，其余丢弃', () => {
    const wire: TipSummaryWire = {
      entitlements: [{ key: 'supporter_badge', granted_at: '2026-09-01T00:00:00.000Z' }],
      supporter_badge: true,
      tip_count: 3,
      support_score: 109,
      badge_hidden: false,
      has_pending_orders: true,
      history: [
        { out_trade_no: 'T-a', time: '2026-09-02T00:00:00.000Z', title: '咖啡', status: 'delivered', support_delta: 99 },
        { out_trade_no: 'T-b', time: '2026-09-01T00:00:00.000Z', title: '鼓励', status: 'expired', support_delta: 10 },
        { out_trade_no: 'T-c', time: '2026-09-03T00:00:00.000Z', title: '大单', status: 'refunded', support_delta: 1874 },
      ],
    };
    const s = adaptSummary(wire);
    expect(s.supporterBadge).toBe(true);
    expect(s.tipCount).toBe(3);
    expect(s.supportScore).toBe(109);
    expect(s.hasPendingOrders).toBe(true);
    expect(s.entitlements[0]).toEqual({ key: 'supporter_badge', grantedAt: '2026-09-01T00:00:00.000Z' });
    expect(s.history).toHaveLength(2);
    expect(s.history.map((h) => h.status)).toEqual(['delivered', 'refunded']);
    expect(s.history[0]).toMatchObject({ dateText: '2026-09-02', supportDelta: 99 });
    // out_trade_no 必须透传：settling 用它判定「本单已发货」（丢了会退化成 tipCount 基线比较）
    expect(s.history.map((h) => h.outTradeNo)).toEqual(['T-a', 'T-c']);
  });

  it('granted_at 为 null 时映射为 null', () => {
    const s = adaptSummary({
      entitlements: [{ key: 'supporter_badge', granted_at: null }],
      supporter_badge: true,
      tip_count: 1,
      support_score: 10,
      badge_hidden: true,
      has_pending_orders: false,
      history: [],
    });
    expect(s.entitlements[0]?.grantedAt).toBeNull();
  });
});

describe('adaptCreateOrderResult', () => {
  it('合法响应通过（客户端原样回传字符串字段，不重组）', () => {
    const wire: CreateTipOrderWire = {
      out_trade_no: 'T' + 'a'.repeat(30),
      pay_data: { signData: '{"offerId":"o"}', paySig: 'p', signature: 's', mode: 'short_series_goods' },
    };
    const r = adaptCreateOrderResult(wire);
    expect(r.outTradeNo).toBe('T' + 'a'.repeat(30));
    expect(r.payData).toEqual({ signData: '{"offerId":"o"}', paySig: 'p', signature: 's', mode: 'short_series_goods' });
  });

  it('malformed 响应抛错（缺 pay_data / mode 不符 / 字段非字符串）', () => {
    expect(() => adaptCreateOrderResult({} as CreateTipOrderWire)).toThrow(/malformed/);
    expect(() =>
      adaptCreateOrderResult({
        out_trade_no: 'T1',
        pay_data: { signData: '{}', paySig: 'p', signature: 's', mode: 'other_mode' },
      }),
    ).toThrow(/malformed/);
    expect(() =>
      adaptCreateOrderResult({
        out_trade_no: 'T1',
        pay_data: { signData: 1 as unknown as string, paySig: 'p', signature: 's', mode: 'short_series_goods' },
      }),
    ).toThrow(/malformed/);
  });
});

describe('formatYuan', () => {
  it('整元不带小数；非整元去尾随零', () => {
    expect(formatYuan(100)).toBe('1');
    expect(formatYuan(990)).toBe('9.9');
    expect(formatYuan(18740)).toBe('187.4');
    expect(formatYuan(1050)).toBe('10.5');
    expect(formatYuan(199)).toBe('1.99');
  });
});

describe('商品目录缓存（tech-spec §7.5）', () => {
  it('无缓存且离线（wx 未定义）⇒ null（调用方强制不可购买）', async () => {
    clearTipCatalogCache();
    expect(await getCachedCatalog()).toBeNull();
  });

  it('clearTipCatalogCache 幂等（localReset 登记项）', () => {
    expect(() => {
      clearTipCatalogCache();
      clearTipCatalogCache();
    }).not.toThrow();
  });
});
