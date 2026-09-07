/**
 * Costra · Server · 虚拟支付消息推送（xpay notify）XML 解码器
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §4.2.2
 * 推送格式：明文 XML 单实现（后台「推送数据格式：xml / 签名认证：不使用签名认证」）。
 *
 * 三类事件：
 *   - xpay_goods_deliver_notify        发货推送 ⇒ goods_delivery（触发 probe）
 *   - xpay_refund_notify               退款推送 ⇒ refund_succeeded（只 warn + 成功回包 · 不改账）
 *   - xpay_subscribe_ios_refund_query_notify iOS 退款查询 ⇒ ios_refund_query（info + 成功回包）
 *   - 其余 Event                        ⇒ unknown（debug + 成功回包）
 *
 * 安全：
 *   - 禁 DTD/外部实体（出现即拒绝）+ 标签数上限（防畸形/攻击 XML 放大 CPU）。
 *   - authenticated 为启发式（明文模式无验签能力：Sign 字段非空 ⇒ true），只影响日志分级。
 *   - 解析失败抛 Error ⇒ 路由映射 HTTP 400（微信重推，下一份明文包仍可恢复）。
 */

import { XMLParser } from 'fast-xml-parser';

/** 微信成功回包（固定 XML 常量 · tech-spec §4.2.1） */
export const XPAY_NOTIFY_ACK_XML = '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>';

/** 标签数上限（bodyLimit 已限 64KB · 防畸形 XML 节点爆炸） */
const MAX_TAG_COUNT = 2_000;

export interface XpayGoodsDeliverySignal {
  event: 'goods_delivery';
  outTradeNo: string;
  /** WeChatPayInfo.MchOrderNo（微信侧支付单号） */
  wxOrderId: string | null;
  /** WeChatPayInfo.AppleIAPOrderID（iOS 渠道单号） */
  channelOrderId: string | null;
  /** WeChatPayInfo.TransactionId（微信支付交易号 · Android/鸿蒙/Windows） */
  wxpayOrderId: string | null;
  /** WeChatPayInfo.PaidTime（unix 秒） */
  paidTime: number | null;
  /** GoodsInfo.ProductId */
  productId: string | null;
  /** GoodsInfo.Quantity */
  quantity: number | null;
  authenticated: boolean;
}

export interface XpayRefundSignal {
  event: 'refund_succeeded';
  wxOrderId: string | null;
  mchOrderId: string | null;
  refundFee: string | null;
  retCode: string | null;
  authenticated: boolean;
}

export interface XpayIosRefundQuerySignal {
  event: 'ios_refund_query';
  authenticated: boolean;
}

export interface XpayUnknownSignal {
  event: 'unknown';
  eventName: string | null;
  authenticated: boolean;
}

export type NormalizedXpaySignal =
  | XpayGoodsDeliverySignal
  | XpayRefundSignal
  | XpayIosRefundQuerySignal
  | XpayUnknownSignal;

const parser = new XMLParser({
  // fast-xml-parser 默认不解析/不展开 DTD 与实体；标签保原名（微信字段为 PascalCase）
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * 解析 xpay 明文 XML 推送。
 * @param raw 请求体 Buffer（content-type parser 已按 buffer 交付 · 上限 64KB）
 * @throws Error XML 解析失败 / 含 DTD/实体 / 节点超限 / 缺 <xml> 根
 */
export function decodeXpayXml(raw: Buffer): NormalizedXpaySignal {
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    throw new Error('[xpayNotify] empty body');
  }
  const text = raw.toString('utf8');
  if (/<!doctype|<!entity/i.test(text)) {
    throw new Error('[xpayNotify] DTD/entity declarations are forbidden');
  }
  const tagCount = (text.match(/</g) ?? []).length;
  if (tagCount > MAX_TAG_COUNT) {
    throw new Error(`[xpayNotify] too many xml nodes (${tagCount})`);
  }

  let doc: unknown;
  try {
    doc = parser.parse(text);
  } catch (err) {
    throw new Error(`[xpayNotify] xml parse failed: ${(err as Error).message}`);
  }
  const root = asRecord(asRecord(doc)['xml']);
  if (Object.keys(root).length === 0) {
    throw new Error('[xpayNotify] missing <xml> root');
  }

  const eventName = str(root['Event']);
  const authenticated = str(root['Sign']) != null;

  if (eventName === 'xpay_goods_deliver_notify') {
    const outTradeNo = str(root['OutTradeNo']);
    if (!outTradeNo) throw new Error('[xpayNotify] goods_delivery missing OutTradeNo');
    const payInfo = asRecord(root['WeChatPayInfo']);
    const goodsInfo = asRecord(root['GoodsInfo']);
    return {
      event: 'goods_delivery',
      outTradeNo,
      wxOrderId: str(payInfo['MchOrderNo']),
      channelOrderId: str(payInfo['AppleIAPOrderID']),
      wxpayOrderId: str(payInfo['TransactionId']),
      paidTime: num(payInfo['PaidTime']),
      productId: str(goodsInfo['ProductId']),
      quantity: num(goodsInfo['Quantity']),
      authenticated,
    };
  }

  if (eventName === 'xpay_refund_notify') {
    return {
      event: 'refund_succeeded',
      wxOrderId: str(root['WxOrderId']),
      mchOrderId: str(root['MchOrderId']),
      refundFee: str(root['RefundFee']),
      retCode: str(root['RetCode']),
      authenticated,
    };
  }

  if (eventName === 'xpay_subscribe_ios_refund_query_notify') {
    return { event: 'ios_refund_query', authenticated };
  }

  return { event: 'unknown', eventName, authenticated };
}
