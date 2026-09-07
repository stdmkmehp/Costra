/**
 * Costra · Server · 微信上游 URL 模块常量
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §2.4
 * 设计决策：WX_*_URL 不设 env 覆盖——与既有 wxCode2SessionUrl 可注入 mock 不同，
 *   虚拟支付链路的测试通过 setVirtualPayFetchForTests / setStableTokenFetchForTests
 *   注入伪 fetch 替换整个调用，不需要替换 URL。
 */

/** 虚拟支付 query_order（查询用户订单） */
export const WX_XPAY_QUERY_ORDER_URL =
  'https://api.weixin.qq.com/xpay/query_order';

/** 微信稳定版接口调用凭据 getStableAccessToken */
export const WX_STABLE_TOKEN_URL =
  'https://api.weixin.qq.com/cgi-bin/stable_token';
