// pages-family/support/index.ts · 赞赏页（支持 Costra）
// 卡号：tips · 事实源：docs/design/monetization-tipping-product-spec.md v1.2 §5.2/§3.3
//                     docs/design/monetization-tipping-tech-spec.md v1.2 §7.1/§7.2
//
// 状态机 idle / paying / settling / done（纯 UI 状态机 · 与服务端订单状态机无对应关系）：
//   - 前端 success 不可作为发货依据 ⇒ 必须经 settling 以服务端权益状态为唯一真相；
//   - settling 轮询按退避序列 0/2/2/4/8/15 秒（t=0/2/4/8/16/31 共 6 个请求时刻）——
//     与服务端 tipProbeMinIntervalSec=3 成对计算（tech-spec §4.6.1 · 改任一必须重算）；
//   - 只在新权益/次数出现后进入 done；超时降级"稍后自动到账"，不报错、不引导重复付款。

import * as tipApi from '../../services/tipApi';
import { eventBus, EventNames } from '../../services/eventBus';
import {
  readPayEligibility,
  ineligibilityText,
  isApiUnsupportedError,
  isOrderSettled,
  isUserCancelError,
  SETTLING_DELAYS_MS,
} from '../../utils/virtualPay';
import { logger } from '../../utils/logger';

type Phase = 'idle' | 'paying' | 'settling' | 'done';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    phase: 'idle' as Phase,
    products: [] as tipApi.TipProduct[],
    purchasable: false,
    catalogReady: false,
    catalogOffline: false,
    payEligible: true,
    ineligibleText: '',
    summary: null as tipApi.TipSummary | null,
    payingKey: '',
    errorText: '',
    settlingTimedOut: false,
    badgeSwitchBusy: false,
  },

  _settlingCancelled: false,

  async onLoad() {
    // 支付闸门：渲染期置灰档位卡片（AC-6 · 绝不允许点击后再报错）
    const eligibility = readPayEligibility();
    if (!eligibility.ok) {
      this.setData({
        payEligible: false,
        ineligibleText: ineligibilityText(eligibility.reason),
      });
    }

    // 商品目录：缓存先展示 + 后台拉新覆盖；离线回退强制不可购买（tech-spec §7.5）
    const cached = await tipApi.getCachedCatalog();
    if (cached) this.setData({ products: cached });
    try {
      const catalog = await tipApi.fetchProducts();
      this.setData({
        products: catalog.products,
        purchasable: catalog.purchasable,
        catalogReady: true,
      });
    } catch {
      // 离线/拉取失败：保留缓存目录展示但强制不可购买（tech-spec §7.5）；
      // 标记 catalogOffline，避免误显示"赞赏暂未开放"（产品 §3.4：断网点击提示"网络不可用"）
      this.setData({ purchasable: false, catalogReady: true, catalogOffline: true });
    }

    void this._refreshSummary();
  },

  onUnload() {
    this._settlingCancelled = true;
  },

  async _refreshSummary(): Promise<void> {
    try {
      const summary = await tipApi.fetchSummary();
      this.setData({ summary });
    } catch {
      // 静默：记录区保持上次值或空态
    }
  },

  /** 点击档位卡片 */
  async onTapProduct(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset['key'] as string;
    const product = this.data.products.find((p) => p.productKey === key);
    if (!product) return;
    // 离线：目录来自本地缓存、强制不可购买；点击仅提示，不进入支付流程（产品 §3.4）
    if (this.data.catalogOffline) {
      wx.showToast({ title: '网络不可用', icon: 'none' });
      return;
    }
    // 双保险：渲染期已置灰，此处再拦一次（paying/settling 中同样不可点）
    if (!this.data.payEligible || !this.data.purchasable) return;
    if (this.data.phase === 'paying' || this.data.phase === 'settling') return;

    // 二次确认（产品 §5.3 三项缺一不可：金额档位 + 获得物 + 退款规则一句话）
    const confirmRes = await wx.showModal({
      title: `${product.title} · ¥${product.priceText}`,
      content:
        '获得「支持者纪念章」徽章（不影响任何功能）。\n' +
        '退款规则：iOS 用户由 Apple 处理退款，其他平台可通过意见反馈联系开发者。',
      confirmText: '去支付',
      cancelText: '再想想',
    });
    if (!confirmRes.confirm) return;

    this.setData({ phase: 'paying', payingKey: key, errorText: '', settlingTimedOut: false });
    try {
      const app = getApp<AppWithBootstrap>();
      await app.bootstrapPromise; // 确认会话有效（tech-spec §5.2 唯一保留的串行点）
      // wx.login → createOrder → 立即调起支付（中间不插入其他等待 · 禁止预生成/复用 payData）
      const code = await new Promise<string>((resolve, reject) => {
        wx.login({
          success: (r) => (r.code ? resolve(r.code) : reject(new Error('wx.login empty code'))),
          fail: (err) => reject(new Error(err.errMsg || 'wx.login failed')),
        });
      });
      const order = await tipApi.createOrder(key, code);
      this._requestVirtualPayment(order);
    } catch (err) {
      // 下单/签名类失败：丢弃 payData，允许重新下单（绝不重放旧请求）
      logger.warn('support', 'create order failed', err);
      this.setData({ phase: 'idle', payingKey: '', errorText: '支付发起失败，请稍后重试' });
    }
  },

  _requestVirtualPayment(order: tipApi.CreateTipOrderResult): void {
    wx.requestVirtualPayment({
      signData: order.payData.signData,
      paySig: order.payData.paySig,
      signature: order.payData.signature,
      mode: order.payData.mode,
      success: () => {
        // 前端 success 可能丢失且不可作为发货依据 ⇒ 进入 settling 轮询服务端权益
        this.setData({ phase: 'settling' });
        void this._runSettling(order.outTradeNo);
      },
      fail: (err) => {
        const errMsg = err?.errMsg;
        if (isUserCancelError(errMsg)) {
          // 用户取消：静默回 idle，无任何提示（产品 §3.2）
          this.setData({ phase: 'idle', payingKey: '' });
          return;
        }
        if (isApiUnsupportedError(errMsg)) {
          // 双判未覆盖的残留情形：置灰 + 文案（不违反 AC-6 · tech-spec §7.2 兜底）
          this.setData({
            phase: 'idle',
            payingKey: '',
            payEligible: false,
            ineligibleText: ineligibilityText('wechat_version'),
          });
          return;
        }
        // 其他失败（余额/风控/上游/非大陆 App Store 账户）：单行提示 + 保持可重试
        this.setData({ phase: 'idle', payingKey: '', errorText: '支付未完成，请重试' });
      },
    });
  },

  /**
   * settling 退避轮询：只在**本单**出现在 summary.history 后进入 done（提前命中即停止后续轮询）。
   *
   * 判据用「本单单号是否已结算」而不是「次数是否比下单前变大」：后者需要一个下单前的
   * tipCount 基线，而该基线在 summary 首拉失败或用户抢先点击时并不存在——取 0 兜底会让
   * 已有赞赏记录的用户在第一拍就误判"到账"（违反 AC-4）。history 由服务端按
   * `delivered_at IS NOT NULL` 收口，出现即等价于"本单权益已发放"。
   */
  async _runSettling(outTradeNo: string): Promise<void> {
    this._settlingCancelled = false;
    for (const delay of SETTLING_DELAYS_MS) {
      if (this._settlingCancelled) return;
      if (delay > 0) await sleep(delay);
      if (this._settlingCancelled) return;
      try {
        const summary = await tipApi.fetchSummary();
        this.setData({ summary });
        if (isOrderSettled(summary.history, outTradeNo)) {
          // 服务端确认本单权益已发放 ⇒ done + 广播（mine 页横幅/徽章刷新）
          this.setData({ phase: 'done', payingKey: '' });
          eventBus.emit(EventNames.TIP_SUMMARY_UPDATED);
          return;
        }
      } catch {
        // 单次轮询失败不中断退避序列
      }
    }
    if (this._settlingCancelled) return;
    // 超时降级：不报错、不让用户重复付款；提供手动刷新（US-6）
    this.setData({ phase: 'idle', payingKey: '', settlingTimedOut: true });
  },

  /** 超时降级后的手动刷新状态 */
  async onTapRefreshStatus() {
    this.setData({ settlingTimedOut: false });
    await this._refreshSummary();
  },

  /** 徽章可见性开关（"仅自己可见" · 没有徽章时 UI 不展示该开关） */
  async onBadgeVisibilityChange(e: WechatMiniprogram.SwitchChange) {
    if (this.data.badgeSwitchBusy) return;
    // switch 打开 = 公开可见（hidden=false）；关闭 = 仅自己可见（hidden=true）
    const hidden = !e.detail.value;
    this.setData({ badgeSwitchBusy: true });
    try {
      await tipApi.setBadgeHidden(hidden);
      if (this.data.summary) {
        this.setData({ summary: { ...this.data.summary, badgeHidden: hidden } });
      }
      eventBus.emit(EventNames.TIP_SUMMARY_UPDATED);
    } catch {
      wx.showToast({ title: '设置失败，请重试', icon: 'none' });
    } finally {
      this.setData({ badgeSwitchBusy: false });
    }
  },
});
