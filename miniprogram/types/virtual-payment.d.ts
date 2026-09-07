// types/virtual-payment.d.ts · wx.requestVirtualPayment 类型声明
// 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §2.4.2 + 官方虚拟支付文档
//
// miniprogram-api-typings@3.12.x 尚未收录该 API（虚拟支付 2024 年新增），
// 按官方接口形态手工声明； typings 升级收录后本文件可删除。
//
// signData 为服务端一次 stringify 的 JSON 字符串（客户端原样回传，不得重组字段）。

declare namespace WechatMiniprogram {
  interface RequestVirtualPaymentOption {
    /** 官方 8 字段 JSON 字符串（offerId/buyQuantity/env/currencyType/productId/goodsPrice/outTradeNo/attach） */
    signData: string;
    /** HMAC-SHA256('requestVirtualPayment'&signData, AppKey) */
    paySig: string;
    /** HMAC-SHA256(signData, session_key) */
    signature: string;
    /** 道具直购固定 'short_series_goods' */
    mode: string;
    success?: (res: unknown) => void;
    fail?: (err: { errMsg?: string }) => void;
    complete?: () => void;
  }

  interface Wx {
    /**
     * 调起微信虚拟支付面板（个人主体 · 道具直购）。
     * 设备路由由平台强制：iOS → Apple 支付（IAP），Android/鸿蒙/Windows → 微信支付。
     */
    requestVirtualPayment(option: RequestVirtualPaymentOption): void;
  }
}
