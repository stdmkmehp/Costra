// utils/time.spec.ts · toUtcIso P0-8 双减 BUG 修复单测 + combineDateKeyWithTimeOfDay 记账时间组装单测
// 卡号: COSTRA-102 · D2.10
import { describe, it, expect } from 'vitest';
import { toUtcIso, combineDateKeyWithTimeOfDay } from './time';

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

describe('utils/time · combineDateKeyWithTimeOfDay', () => {
  it('新增语义：所选自然日 + timeSource 的本地时分秒（补记非今天也保留当下时间）', () => {
    const src = new Date(2026, 8, 11, 15, 26, 40, 123); // 本地 2026-09-11 15:26:40.123
    const d = new Date(combineDateKeyWithTimeOfDay('2026-06-01', src));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 6, 1]);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([15, 26, 40, 123]);
  });

  it('编辑语义：仅换日期，保留原 occurred_at 的本地时分秒', () => {
    const originalIso = new Date(2026, 0, 2, 7, 8, 9, 10).toISOString();
    const d = new Date(combineDateKeyWithTimeOfDay('2026-09-10', new Date(originalIso)));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 10]);
    const orig = new Date(originalIso);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()])
      .toEqual([orig.getHours(), orig.getMinutes(), orig.getSeconds(), orig.getMilliseconds()]);
  });

  it('所选日期 = timeSource 当天 ⇒ 与 timeSource 完全同刻（UTC 字符串恒等）', () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(combineDateKeyWithTimeOfDay(todayKey, now)).toBe(now.toISOString());
  });
});
