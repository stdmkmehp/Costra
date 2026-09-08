/**
 * Costra · Server · 静态商品目录（赞赏道具）
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §5.4（结构）+
 *         docs/design/monetization-tipping-product-spec.md v1.2 §3.1（三档定价/文案）
 *
 * 契约：
 *   - price_cents / wx_product_id 与微信侧道具必须逐档一致（B2 双人核对）；
 *     与微信侧不一致 ⇒ 线上行为 = 全部 real 单 conflict ⇒ 先于改目录改微信侧。
 *   - wx_product_id 未回填前带 `TODO_B2_` 前缀，`assertTipProductsPublishable()` 在
 *     `WX_PAY_MODE !== 'off'` 时拒绝启动（B2 的机器闸门，不依赖清单提醒）。
 *   - support_delta 在下单时快照进 tip_orders.support_delta（改价不追溯历史订单）。
 *   - 目录不进数据库：金额类事实按代码评审 + 提审流程保护；改价 = 代码改动 + 重新提审。
 *   - wx_product_id 不下发客户端（仅服务端用于 signData.productId）。
 */

export type TipProductType = 'tip';

export interface TipProduct {
  type: TipProductType;
  productKey: string;
  title: string;
  subDesc: string;
  supportDelta: number;
  entitlementKeys: string[];
  /** 微信 MP 后台道具 ID（signData.productId · 与微信侧逐档一致 · 不下发） */
  wxProductId: string;
  priceCents: number;
  enabled: boolean;
}

/**
 * 未回填的 MP 后台道具 ID 占位前缀。
 * 官方硬要求 `signData.productId` 与后台道具 ID、`goodsPrice` 与后台价格双一致，
 * 占位值上生产 ⇒ 每一笔真单在微信侧下单即失败。因此占位必须可被机器识别。
 */
export const WX_PRODUCT_ID_PLACEHOLDER_PREFIX = 'TODO_B2_';

export const TIP_PRODUCTS: readonly TipProduct[] = Object.freeze([
  Object.freeze({
    type: 'tip',
    productKey: 'encourage',
    title: '一次暖心的鼓励',
    subDesc: '一份小小的心意，助力服务器与域名的日常开销',
    supportDelta: 10,
    entitlementKeys: Object.freeze(['supporter_badge']) as unknown as string[],
    wxProductId: '50101',
    priceCents: 100,
    enabled: true,
  }),
  Object.freeze({
    type: 'tip',
    productKey: 'coffee',
    title: '请开发者喝一杯咖啡',
    subDesc: '一杯咖啡的温度，就是继续写下去的动力',
    supportDelta: 99,
    entitlementKeys: Object.freeze(['supporter_badge']) as unknown as string[],
    wxProductId: '50102',
    priceCents: 990,
    enabled: true,
  }),
  Object.freeze({
    type: 'tip',
    productKey: 'server',
    title: '赞助一个月的腾讯云机器',
    subDesc: '= 一个月腾讯云轻量服务器（2核4G）的实际账单',
    supportDelta: 1874,
    entitlementKeys: Object.freeze(['supporter_badge']) as unknown as string[],
    wxProductId: '50103',
    priceCents: 18740,
    enabled: true,
  }),
]);

export function findTipProduct(productKey: string): TipProduct | null {
  return TIP_PRODUCTS.find((p) => p.productKey === productKey && p.enabled) ?? null;
}

/** 仍带占位前缀（= B2 未回填）的启用档位 productKey 列表。 */
export function listUnpublishedProducts(products: readonly TipProduct[] = TIP_PRODUCTS): string[] {
  return products
    .filter((p) => p.enabled && p.wxProductId.startsWith(WX_PRODUCT_ID_PLACEHOLDER_PREFIX))
    .map((p) => p.productKey);
}

/**
 * B2 发布闸门：`WX_PAY_MODE !== 'off'` 时由进程入口调用，占位未回填即拒绝启动。
 * 放在启动期而非下单期，是为了让"忘了回填道具 ID"在部署那一刻暴露，
 * 而不是等到某个用户点了支付才以一次失败的真单暴露。
 */
export function assertTipProductsPublishable(products: readonly TipProduct[] = TIP_PRODUCTS): void {
  const pending = listUnpublishedProducts(products);
  if (pending.length > 0) {
    throw new Error(
      `[tipProducts] wx_product_id 仍是占位值（B2 未完成）：${pending.join(', ')}。` +
        `WX_PAY_MODE 非 off 时禁止启动——占位 ID 与 MP 后台道具不一致，每一笔真单都会下单失败。`,
    );
  }
}
