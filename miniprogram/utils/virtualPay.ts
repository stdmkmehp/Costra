// utils/virtualPay.ts · 虚拟支付可用性闸门（纯函数，便于单测）
// 事实源：docs/design/monetization-tipping-tech-spec.md v1.2 §2.4.3 / §7.2
//
// 三道闸（顺序敏感）：
//   1. API 可用性双判：canIUse（查基础库能力表）+ typeof（查运行时实际存在性）。
//      单判 canIUse 不够：旧微信客户端 + 新基础库时 canIUse 可能返回 true，
//      而真实门槛在微信客户端版本（v1.2 双判回归）。
//   2. 开发者工具禁付（devtools 无真实支付环境）。
//   3. iOS 侧官方门槛：系统 ≥ 15 且微信 ≥ 8.0.68（仅 iOS 有官方下限）。
//   其余平台（Android / 鸿蒙 / Windows / macOS / 未知）一律放行：
//   官方设备路由表覆盖它们，禁付的代价是确定性损失用户。
//
// 禁 wx.getSystemInfoSync()（已废弃）——用 wx.getDeviceInfo() + wx.getAppBaseInfo()。
// 版本比较必须逐段数值比较：'8.0.9' 不得被判为 ≥ '8.0.68'（字典序会判错）。

/**
 * settling 轮询退避序列（毫秒）：请求时刻 t=0/2/4/8/16/31。
 * 与服务端 tipProbeMinIntervalSec=3 成对计算（tech-spec v1.2 §4.6.1 算术：
 * 仅 t=2 被 3s 租约挡掉，得 5 次有效探测覆盖 0~31 秒）。
 * **改动本序列必须回到 §4.6.1 重算并同步服务端节流值（D2 耦合）。**
 */
export const SETTLING_DELAYS_MS: readonly number[] = Object.freeze([0, 2000, 2000, 4000, 8000, 15000]);

/**
 * settling 的 done 判据：**本单**是否已出现在服务端已结算历史中。
 *
 * 不用「tipCount 是否比下单前变大」：那需要一个下单前基线，而基线在 summary 首拉失败或
 * 用户抢先点击档位时并不存在——取 0 兜底会让已有赞赏记录的用户在第一拍就误判"到账"
 * （违反产品 AC-4）。history 由服务端按 `delivered_at IS NOT NULL` 收口，
 * 本单出现即等价于"本单权益已发放"，与历史单数无关。
 */
export function isOrderSettled(
  history: ReadonlyArray<{ outTradeNo: string }>,
  outTradeNo: string,
): boolean {
  if (!outTradeNo) return false;
  return history.some((h) => h.outTradeNo === outTradeNo);
}

export type PayIneligibilityReason = 'wechat_version' | 'devtools' | 'ios_version';

export type PayEligibility = { ok: true } | { ok: false; reason: PayIneligibilityReason };

/** 闸门输入（与 wx API 解耦，单测直接构造） */
export interface VirtualPayEnv {
  /** wx.canIUse('requestVirtualPayment') */
  canIUse: boolean;
  /** typeof wx.requestVirtualPayment === 'function' */
  apiExists: boolean;
  /** wx.getDeviceInfo().platform */
  platform: string;
  /** wx.getDeviceInfo().system（形如 'iOS 15.4' / 'Android 13' · 带平台前缀） */
  system: string;
  /** wx.getAppBaseInfo().version（裸版本号 · 形如 '8.0.68'） */
  wechatVersion: string;
}

/**
 * 剥掉系统字符串的平台前缀：'iOS 15.4' → '15.4' · 'Android 13' → '13'。
 * 已是裸版本号则原样返回；无法识别时原样返回（由版本比较兜底判 false）。
 */
export function stripPlatformPrefix(system: string): string {
  const m = /(\d+(?:\.\d+)*)/
    .exec(system);
  return m ? m[1]! : system;
}

/** 逐段数值比较：version ≥ minimum？缺省段按 0 计；任一段非数字 ⇒ false（保守判不达标） */
export function versionAtLeast(version: string, minimum: string): boolean {
  const a = version.split('.').map((s) => Number(s));
  const b = minimum.split('.').map((s) => Number(s));
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return false;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

/** 支付可用性判定（§7.2 伪代码的逐行落地） */
export function checkPayEligibility(env: VirtualPayEnv): PayEligibility {
  // 第一道：双判（canIUse 查基础库 · typeof 查运行时）
  if (!env.canIUse || !env.apiExists) {
    return { ok: false, reason: 'wechat_version' };
  }
  if (env.platform === 'devtools') {
    return { ok: false, reason: 'devtools' };
  }
  if (env.platform === 'ios') {
    // ⚠️ 待证实 R2（docs/testing/tips-known-limits.md §1）：官方《虚拟支付：个人》原文
    // 只要求 iOS 侧微信 ≥8.0.68 + 小程序简称 + 开通 IAP，**未提系统版本下限**。
    // 本判定属保守多判——不致错单，但会确定性置灰 iOS 12~14 用户。B13 真机核实后按结论删留。
    if (!versionAtLeast(stripPlatformPrefix(env.system), '15')) {
      return { ok: false, reason: 'ios_version' };
    }
    if (!versionAtLeast(env.wechatVersion, '8.0.68')) {
      return { ok: false, reason: 'wechat_version' };
    }
  }
  return { ok: true };
}

/** 读取当前运行环境的支付可用性（页面渲染期调用 · 不通过则置灰档位卡片） */
export function readPayEligibility(): PayEligibility {
  try {
    const dev = wx.getDeviceInfo();
    const base = wx.getAppBaseInfo();
    return checkPayEligibility({
      canIUse: wx.canIUse('requestVirtualPayment'),
      apiExists: typeof wx.requestVirtualPayment === 'function',
      platform: dev.platform,
      system: dev.system ?? '',
      wechatVersion: base.version ?? '',
    });
  } catch {
    // 老基础库缺 getDeviceInfo/getAppBaseInfo：保守判不可用（点击后失败是 AC-6 明令禁止的）
    return { ok: false, reason: 'wechat_version' };
  }
}

/** 置灰文案（产品 §3.4 异常表 · 不暴露技术细节） */
export function ineligibilityText(reason: PayIneligibilityReason): string {
  switch (reason) {
    case 'devtools':
      return '开发者工具暂不支持虚拟支付，请使用真机';
    case 'ios_version':
      return '当前系统版本暂不支持，iOS 15 及以上可用';
    case 'wechat_version':
      return '当前微信版本暂不支持，请升级微信后重试';
  }
}

/** fail 回调中的"API 不支持"类错误识别（双判无法覆盖的残留情形 · §7.2 兜底） */
export function isApiUnsupportedError(errMsg: string | undefined): boolean {
  if (!errMsg) return false;
  return /not supported|function does not exist|not implemented|is not a function/i.test(errMsg);
}

/** fail 回调中的"用户取消"识别（静默回 idle · 产品 §3.2：取消无任何提示） */
export function isUserCancelError(errMsg: string | undefined): boolean {
  if (!errMsg) return false;
  return /cancel/i.test(errMsg);
}
