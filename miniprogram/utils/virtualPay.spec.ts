// utils/virtualPay.spec.ts · 虚拟支付闸门单测
// 事实源：tech-spec v1.2 §10（客户端闸门测试行）
//
// 覆盖：
//   - canIUse=false 置灰（含 Android）· canIUse=true 但 typeof 非 function 同样置灰（v1.2 双判回归）
//   - 开发者工具禁付 · iOS <15 或微信 <8.0.68 置灰 · iOS 达标放行
//   - Android / 鸿蒙 / Windows / macOS / 未知平台一律放行（防回退到默认禁付）
//   - 版本比较逐段数值（'8.0.9' 不得被判为 ≥ '8.0.68'）
//   - stripPlatformPrefix('iOS 15.4') === '15.4'
//   - settling 退避序列固定为 [0,2s,2s,4s,8s,15s]（与服务端节流 3s 耦合 · D2）
//   - isOrderSettled：按本单单号判定，历史单不得造成"到账"误判（AC-4 回归）

import { describe, it, expect } from 'vitest';
import {
  checkPayEligibility,
  isOrderSettled,
  stripPlatformPrefix,
  versionAtLeast,
  isApiUnsupportedError,
  isUserCancelError,
  SETTLING_DELAYS_MS,
  type VirtualPayEnv,
} from './virtualPay';

function env(overrides: Partial<VirtualPayEnv> = {}): VirtualPayEnv {
  return {
    canIUse: true,
    apiExists: true,
    platform: 'android',
    system: 'Android 13',
    wechatVersion: '8.0.40',
    ...overrides,
  };
}

describe('stripPlatformPrefix', () => {
  it('剥平台前缀', () => {
    expect(stripPlatformPrefix('iOS 15.4')).toBe('15.4');
    expect(stripPlatformPrefix('Android 13')).toBe('13');
    expect(stripPlatformPrefix('iOS 17.5.1')).toBe('17.5.1');
  });
  it('裸版本号原样返回', () => {
    expect(stripPlatformPrefix('15.4')).toBe('15.4');
  });
});

describe('versionAtLeast · 逐段数值比较', () => {
  it('关键回归：8.0.9 不得被判为 ≥ 8.0.68（字典序陷阱）', () => {
    expect(versionAtLeast('8.0.9', '8.0.68')).toBe(false);
    expect(versionAtLeast('8.0.68', '8.0.68')).toBe(true);
    expect(versionAtLeast('8.0.69', '8.0.68')).toBe(true);
  });
  it('段数不同时缺省段按 0 计', () => {
    expect(versionAtLeast('15', '15')).toBe(true);
    expect(versionAtLeast('15.0', '15')).toBe(true);
    expect(versionAtLeast('14.9', '15')).toBe(false);
    expect(versionAtLeast('15.0.1', '15')).toBe(true);
  });
  it('非数字段 ⇒ false（保守判不达标）', () => {
    expect(versionAtLeast('iOS', '15')).toBe(false);
    expect(versionAtLeast('', '15')).toBe(false);
  });
});

describe('checkPayEligibility · 客户端闸门全格', () => {
  it('canIUse=false ⇒ wechat_version（全平台 · 含 Android）', () => {
    expect(checkPayEligibility(env({ canIUse: false }))).toEqual({ ok: false, reason: 'wechat_version' });
  });

  it('canIUse=true 但 apiExists=false ⇒ wechat_version（v1.2 双判：旧客户端+新基础库）', () => {
    expect(checkPayEligibility(env({ canIUse: true, apiExists: false }))).toEqual({
      ok: false,
      reason: 'wechat_version',
    });
  });

  it('开发者工具 ⇒ devtools', () => {
    expect(checkPayEligibility(env({ platform: 'devtools' }))).toEqual({ ok: false, reason: 'devtools' });
  });

  it('iOS 系统 <15 ⇒ ios_version', () => {
    expect(checkPayEligibility(env({ platform: 'ios', system: 'iOS 14.5', wechatVersion: '8.0.68' }))).toEqual({
      ok: false,
      reason: 'ios_version',
    });
  });

  it('iOS ≥15 但微信 <8.0.68 ⇒ wechat_version（含 8.0.9 字典序回归）', () => {
    expect(checkPayEligibility(env({ platform: 'ios', system: 'iOS 15.4', wechatVersion: '8.0.60' }))).toEqual({
      ok: false,
      reason: 'wechat_version',
    });
    expect(checkPayEligibility(env({ platform: 'ios', system: 'iOS 16.0', wechatVersion: '8.0.9' }))).toEqual({
      ok: false,
      reason: 'wechat_version',
    });
  });

  it('iOS 达标 ⇒ 放行', () => {
    expect(checkPayEligibility(env({ platform: 'ios', system: 'iOS 15.0', wechatVersion: '8.0.68' }))).toEqual({
      ok: true,
    });
    expect(checkPayEligibility(env({ platform: 'ios', system: 'iOS 17.5.1', wechatVersion: '8.1.0' }))).toEqual({
      ok: true,
    });
  });

  it('Android / 鸿蒙 / Windows / macOS / 未知平台一律放行（官方路由表覆盖）', () => {
    for (const platform of ['android', 'ohos', 'windows', 'mac', 'harmonyos-next', 'something-unknown']) {
      expect(checkPayEligibility(env({ platform })), platform).toEqual({ ok: true });
    }
  });
});

describe('fail 回调错误识别', () => {
  it('isApiUnsupportedError：API 不支持类错误', () => {
    expect(isApiUnsupportedError('requestVirtualPayment:fail not supported')).toBe(true);
    expect(isApiUnsupportedError('wx.requestVirtualPayment is not a function')).toBe(true);
    expect(isApiUnsupportedError('function does not exist')).toBe(true);
    expect(isApiUnsupportedError('requestVirtualPayment:fail cancel')).toBe(false);
    expect(isApiUnsupportedError(undefined)).toBe(false);
  });

  it('isUserCancelError：用户取消', () => {
    expect(isUserCancelError('requestVirtualPayment:fail cancel')).toBe(true);
    expect(isUserCancelError('requestVirtualPayment:fail cancel by user')).toBe(true);
    expect(isUserCancelError('requestVirtualPayment:fail system error')).toBe(false);
    expect(isUserCancelError(undefined)).toBe(false);
  });
});

describe('SETTLING_DELAYS_MS · 退避序列（与服务端节流 3s 耦合 · D2）', () => {
  it('固定为 [0, 2s, 2s, 4s, 8s, 15s]（请求时刻 t=0/2/4/8/16/31）', () => {
    expect([...SETTLING_DELAYS_MS]).toEqual([0, 2000, 2000, 4000, 8000, 15000]);
    // 算术回归：累计时刻
    let t = 0;
    const timeline = SETTLING_DELAYS_MS.map((d) => (t += d));
    expect(timeline).toEqual([0, 2000, 4000, 8000, 16000, 31000]);
  });
});

describe('isOrderSettled · settling done 判据（AC-4）', () => {
  const own = { outTradeNo: 'T-current' };
  const older = [{ outTradeNo: 'T-old-1' }, { outTradeNo: 'T-old-2' }];

  it('本单出现在已结算历史 ⇒ true', () => {
    expect(isOrderSettled([own, ...older], 'T-current')).toBe(true);
    expect(isOrderSettled([...older, own], 'T-current')).toBe(true);
  });

  it('历史里只有旧单 ⇒ false（关键回归：旧实现按 tipCount>基线 会在基线缺失时误判到账）', () => {
    expect(isOrderSettled(older, 'T-current')).toBe(false);
    expect(isOrderSettled([], 'T-current')).toBe(false);
  });

  it('单号缺失（adapter 兜底为空串）⇒ false，绝不因空串互等而误判', () => {
    expect(isOrderSettled([{ outTradeNo: '' }], '')).toBe(false);
    expect(isOrderSettled([{ outTradeNo: '' }], 'T-current')).toBe(false);
  });
});
