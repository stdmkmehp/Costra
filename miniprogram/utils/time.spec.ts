// utils/time.spec.ts · toUtcIso P0-8 双减 BUG 修复单测
// 卡号: COSTRA-102 · D2.10
import { describe, it, expect } from 'vitest';
import { toUtcIso } from './time';

describe('utils/time · toUtcIso (P0-8 fix)', () => {
  it('UTC 输入恒等：toUtcIso(new Date("2026-04-27T01:23:45.678Z")) === 原字符串', () => {
    const s = '2026-04-27T01:23:45.678Z';
    expect(toUtcIso(new Date(s))).toBe(s);
  });

  it('本地构造 Date 不双减时区：等同原 Date#toISOString()', () => {
    // 本地时间 2026-04-27 09:00（JS 本地时区）构造的 Date，
    // 其 toISOString() 本身就是正确的 UTC 字符串。
    // 原骨架 `new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString()`
    // 会再减一次 offset，产生 16 小时（东八区）错位。
    // 修复后：toUtcIso(d) 必须恒等于 d.toISOString()。
    const d = new Date(2026, 3, 27, 9, 0); // month is 0-based → 4 月
    expect(toUtcIso(d)).toBe(d.toISOString());
  });
});
