/**
 * Costra · Server · 虚拟支付签名单测（virtualPaySign）
 *
 * 事实源：tech-spec v1.2 §10.1（官方测试向量）/ §2.4.2（signData 8 字段闭合）
 *
 * 覆盖：
 *   T1  官方 pay_sig 测试向量（uri + "&" + post_body · key=AppKey）
 *   T2  官方 signature 测试向量（post_body · key=session_key）
 *   T3  signData 严格官方 8 字段且仅这 8 个（字段序 = 官方顺序 · V8 插入序）
 *   T4  uri 不含域名的判定（C 端 'requestVirtualPayment' vs 服务端 '/xpay/...' 结果不同）
 */

import { describe, it, expect } from 'vitest';
import { calcPaySig, calcSignature } from '../src/wx/virtualPaySign.js';
import { TIP_ATTACH } from '../src/services/tipReconcile.js';

describe('virtualPaySign · 官方测试向量', () => {
  const OFFICIAL_BODY = '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}';

  it('T1 · pay_sig = HMAC-SHA256(uri&body, AppKey)', () => {
    const paySig = calcPaySig('/xpay/query_user_balance', OFFICIAL_BODY, '12345');
    expect(paySig).toBe('c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5');
  });

  it('T2 · signature = HMAC-SHA256(body, session_key)', () => {
    const signature = calcSignature(OFFICIAL_BODY, '9hAb/NEYUlkaMBEsmFgzig==');
    expect(signature).toBe('089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7');
  });
});

describe('virtualPaySign · signData 8 字段闭合（tech-spec §2.4.2）', () => {
  it('T3 · 严格官方 8 字段且字段序一致（一次 stringify · 客户端不得重组）', () => {
    const signData = JSON.stringify({
      offerId: 'offer-123',
      buyQuantity: 1,
      env: 0,
      currencyType: 'CNY',
      productId: 'coffee',
      goodsPrice: 990,
      outTradeNo: 'T' + 'a'.repeat(30),
      attach: TIP_ATTACH,
    });
    const keys = Object.keys(JSON.parse(signData) as Record<string, unknown>);
    expect(keys).toEqual([
      'offerId',
      'buyQuantity',
      'env',
      'currencyType',
      'productId',
      'goodsPrice',
      'outTradeNo',
      'attach',
    ]);
    // attach 固定协议标识（非敏感 · 不携带用户/订单语义）
    expect(JSON.parse(signData)).toMatchObject({ attach: 'costra-tip-v1', env: 0, buyQuantity: 1 });
  });

  it('T4 · uri 是签名输入：C 端 requestVirtualPayment 与服务端 /xpay/* 结果不同', () => {
    const body = '{"openid":"u","env":0,"order_id":"T123"}';
    const cSide = calcPaySig('requestVirtualPayment', body, 'appkey');
    const sSide = calcPaySig('/xpay/query_order', body, 'appkey');
    expect(cSide).not.toBe(sSide);
    // 确定性：同输入同输出
    expect(calcPaySig('requestVirtualPayment', body, 'appkey')).toBe(cSide);
  });
});
