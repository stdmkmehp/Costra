// services/tipApi.ts · 赞赏（虚拟支付）API + 商品目录本地缓存
// 卡号：tips · 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §7.2/§7.5
//
// 职责：
//   - fetchProducts：GET /tips/products（无 query 参数 · 无渠道维度）
//   - createOrder：POST /tips/orders（body 仅 {product_key, code}）
//   - fetchSummary：GET /tips/summary（派生权益聚合 · 触发服务端加速核实信号）
//   - setBadgeHidden：PUT /tips/summary/badge-visibility
//   - 商品目录缓存：只持久化公共字段，**不保存 purchasable**；
//     离线回退时强制不可购买（tech-spec §7.5）
//
// adapter 约定：wire DTO 保持 snake_case；单一 adapter 转 camelCase 并对
// type/status 做运行时枚举校验（非法枚举丢弃该条目而不是整单失败）。

import { request } from './request';
import { getItem, setItem } from './storage';

// ─── wire DTO（snake_case · 与 server/api/openapi.yaml 对齐） ─────────────────

export interface TipProductWire {
  type: string;
  product_key: string;
  title: string;
  price_cents: number;
  support_delta: number;
  entitlement_keys: string[];
  sub_desc: string;
}

export interface TipCatalogWire {
  purchasable: boolean;
  products: TipProductWire[];
}

export interface TipSummaryWire {
  entitlements: Array<{ key: string; granted_at: string | null }>;
  supporter_badge: boolean;
  tip_count: number;
  support_score: number;
  badge_hidden: boolean;
  has_pending_orders: boolean;
  history: Array<{
    out_trade_no: string;
    time: string;
    title: string;
    status: string;
    support_delta: number;
  }>;
}

export interface CreateTipOrderWire {
  out_trade_no: string;
  pay_data: { signData: string; paySig: string; signature: string; mode: string };
}

// ─── 页面模型（camelCase） ────────────────────────────────────────────────────

export interface TipProduct {
  type: 'tip';
  productKey: string;
  title: string;
  priceCents: number;
  /** 展示价格（元 · adapter 预计算：整元不带小数，否则两位） */
  priceText: string;
  supportDelta: number;
  entitlementKeys: string[];
  subDesc: string;
}

export interface TipCatalog {
  purchasable: boolean;
  products: TipProduct[];
}

export interface TipHistoryItem {
  /** 本人业务单号（settling 判定「本单已发货」用 · 不展示） */
  outTradeNo: string;
  time: string;
  /** 展示日期（YYYY-MM-DD · adapter 预计算 · WXML 不可调用 slice） */
  dateText: string;
  title: string;
  status: 'delivered' | 'refunded';
  supportDelta: number;
}

export interface TipSummary {
  entitlements: Array<{ key: string; grantedAt: string | null }>;
  supporterBadge: boolean;
  tipCount: number;
  supportScore: number;
  badgeHidden: boolean;
  hasPendingOrders: boolean;
  history: TipHistoryItem[];
}

export interface TipPayData {
  signData: string;
  paySig: string;
  signature: string;
  mode: string;
}

export interface CreateTipOrderResult {
  outTradeNo: string;
  payData: TipPayData;
}

// ─── adapter（单一出口 · 运行时枚举校验） ─────────────────────────────────────

/** 分 → 展示元：整元不带小数；否则最多两位并去尾随零（100→'1' · 990→'9.9' · 18740→'187.4'） */
export function formatYuan(priceCents: number): string {
  const yuan = priceCents / 100;
  if (Number.isInteger(yuan)) return String(yuan);
  return String(Number(yuan.toFixed(2)));
}

function adaptProduct(w: TipProductWire): TipProduct | null {
  if (w.type !== 'tip') return null;
  if (typeof w.product_key !== 'string' || w.product_key === '') return null;
  if (!Number.isInteger(w.price_cents) || w.price_cents <= 0) return null;
  if (!Number.isInteger(w.support_delta) || w.support_delta <= 0) return null;
  return {
    type: 'tip',
    productKey: w.product_key,
    title: String(w.title ?? ''),
    priceCents: w.price_cents,
    priceText: formatYuan(w.price_cents),
    supportDelta: w.support_delta,
    entitlementKeys: Array.isArray(w.entitlement_keys) ? w.entitlement_keys : [],
    subDesc: String(w.sub_desc ?? ''),
  };
}

export function adaptCatalog(w: TipCatalogWire): TipCatalog {
  const products = (Array.isArray(w.products) ? w.products : [])
    .map(adaptProduct)
    .filter((p): p is TipProduct => p !== null);
  return { purchasable: w.purchasable === true, products };
}

export function adaptSummary(w: TipSummaryWire): TipSummary {
  const history = (Array.isArray(w.history) ? w.history : [])
    .filter((h): h is TipSummaryWire['history'][number] =>
      h != null && (h.status === 'delivered' || h.status === 'refunded'),
    )
    .map((h) => {
      const time = String(h.time);
      return {
        outTradeNo: String(h.out_trade_no ?? ''),
        time,
        dateText: time.slice(0, 10),
        title: String(h.title),
        status: h.status as 'delivered' | 'refunded',
        supportDelta: Number(h.support_delta) || 0,
      };
    });
  return {
    entitlements: (Array.isArray(w.entitlements) ? w.entitlements : []).map((e) => ({
      key: String(e.key),
      grantedAt: e.granted_at ?? null,
    })),
    supporterBadge: w.supporter_badge === true,
    tipCount: Number(w.tip_count) || 0,
    supportScore: Number(w.support_score) || 0,
    badgeHidden: w.badge_hidden === true,
    hasPendingOrders: w.has_pending_orders === true,
    history,
  };
}

export function adaptCreateOrderResult(w: CreateTipOrderWire): CreateTipOrderResult {
  if (!w || typeof w.out_trade_no !== 'string' || !w.pay_data) {
    throw new Error('tipApi: malformed create order response');
  }
  const { signData, paySig, signature, mode } = w.pay_data;
  if (
    typeof signData !== 'string' ||
    typeof paySig !== 'string' ||
    typeof signature !== 'string' ||
    mode !== 'short_series_goods'
  ) {
    throw new Error('tipApi: malformed pay_data');
  }
  return {
    outTradeNo: w.out_trade_no,
    payData: { signData, paySig, signature, mode },
  };
}

// ─── 商品目录缓存（tech-spec §7.5） ───────────────────────────────────────────

const CATALOG_STORAGE_KEY = 'tip:catalog';

interface CachedCatalog {
  products: TipProduct[];
  cachedAt: number;
}

/** 模块级内存镜像（logout 需显式清 · 已在 localReset.ts 登记） */
let _memoryCatalog: CachedCatalog | null = null;

/** 读缓存的商品公共字段（无缓存 ⇒ null · 离线回退由调用方强制不可购买） */
export async function getCachedCatalog(): Promise<TipProduct[] | null> {
  if (_memoryCatalog) return _memoryCatalog.products;
  const stored = await getItem<CachedCatalog>(CATALOG_STORAGE_KEY);
  if (stored && Array.isArray(stored.products)) {
    _memoryCatalog = stored;
    return stored.products;
  }
  return null;
}

/** 清模块级内存镜像（logout 由 localReset 调用 · 持久化部分由 clearAllForReset 全量清） */
export function clearTipCatalogCache(): void {
  _memoryCatalog = null;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export async function fetchProducts(): Promise<TipCatalog> {
  const wire = await request<TipCatalogWire>({ method: 'GET', path: '/tips/products' });
  const catalog = adaptCatalog(wire);
  _memoryCatalog = { products: catalog.products, cachedAt: Date.now() };
  await setItem(CATALOG_STORAGE_KEY, _memoryCatalog);
  return catalog;
}

export async function createOrder(productKey: string, code: string): Promise<CreateTipOrderResult> {
  const wire = await request<CreateTipOrderWire>({
    method: 'POST',
    path: '/tips/orders',
    body: { product_key: productKey, code },
  });
  return adaptCreateOrderResult(wire);
}

export async function fetchSummary(): Promise<TipSummary> {
  const wire = await request<TipSummaryWire>({ method: 'GET', path: '/tips/summary' });
  return adaptSummary(wire);
}

export async function setBadgeHidden(hidden: boolean): Promise<void> {
  await request({
    method: 'PUT',
    path: '/tips/summary/badge-visibility',
    body: { badge_hidden: hidden },
  });
}
