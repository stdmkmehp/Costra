/**
 * Costra · Server · 虚拟支付签名（HMAC-SHA256）
 *
 * 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §2.4.1 / 官方测试向量 §10.1
 *   - signature = hmac_sha256(postBody, session_key)                  —— C 端调起支付用
 *   - pay_sig   = hmac_sha256(uri + "&" + post_body, 虚拟支付 AppKey)  —— 服务端 query_order 用
 *
 * 约束：
 *   - 纯函数，无副作用；密钥以参数注入（不直接读 env，便于单测）。
 *   - signData 序列化只在服务端发生一次（对象字面量按官方字段序构造，V8 保持插入序）；
 *     客户端不得自行 stringify 字段，必须原样回传 signature / paySig / signData 字符串。
 */

import { createHmac } from 'node:crypto';

/**
 * 计算 C 端支付签名 signature。
 * @param postBody   已按官方 8 字段序 stringify 的 signData JSON 字符串
 * @param sessionKey 用户会话 session_key（不落库、不进日志）
 */
export function calcSignature(postBody: string, sessionKey: string): string {
  return createHmac('sha256', sessionKey).update(postBody, 'utf8').digest('hex');
}

/**
 * 计算服务端 pay_sig。
 * 官方原文：`hmac_sha256(该接口的 uri 和请求体的拼接字符串, 虚拟支付 AppKey)`，
 * 拼接形如 `/xpay/query_order&{"openid":...}`（uri + "&" + body）。
 * @param uri      请求路径（如 /xpay/query_order；C 端调起支付固定 'requestVirtualPayment'）
 * @param postBody POST body 原文（JSON 字符串）
 * @param appKey   虚拟支付 AppKey
 */
export function calcPaySig(uri: string, postBody: string, appKey: string): string {
  return createHmac('sha256', appKey).update(`${uri}&${postBody}`, 'utf8').digest('hex');
}
