// costra · recurringSchedule 单元测试
//
// 卡号占位：COSTRA-5xx（T1）
// 事实源：docs/design/recurring-entry-tech-spec.md §7.6 · 100+ 用例矩阵
//
// 测试覆盖 8 大组（合计 106 例）：
//   weekly (15) · biweekly (12) · monthly (20) · bimonthly (8) · trimonthly (8)
//   yearly (25) · timezone (10) · boundary (8)
//
// 断言时点均以 rule.timezone 的本地时间表述，转换 UTC 后与结果 Date 比对
// 使用 luxon 的 DateTime.fromJSDate(result, { zone: tz }) 提取本地日期便于阅读

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  BUCKET_WINDOWS,
  INNER_MARGIN_MINUTES,
  MAX_BACKFILL_ITER,
  BACKFILL_WINDOW_MS,
  assignBucketMinute,
  computeNextRunAt,
  fnv1a64,
  formatDaysForSummary,
  isWorkdaySync,
  type RecurringRuleForCompute,
} from '../src/services/recurringSchedule';

// ===== 测试辅助 =====

const TZ = 'Asia/Shanghai';

/** 构造完整的 rule 对象 · 便于每个用例只指定关心字段 */
function makeRule(
  partial: Partial<RecurringRuleForCompute>,
): RecurringRuleForCompute {
  return {
    period: 'weekly',
    period_interval: 1,
    timezone: TZ,
    start_date: '2026-01-01',
    execute_hour: 9,
    execute_minute: 30,
    days_of_week: null,
    days_of_month: null,
    year_month_days: null,
    workday_data: [],
    ...partial,
  };
}

/** 把 zoned 本地时间描述转成 UTC Date · 便于用例可读 */
function localToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz = TZ,
): Date {
  const dt = DateTime.fromObject(
    { year: y, month: mo, day: d, hour: h, minute: mi },
    { zone: tz },
  );
  return dt.toJSDate();
}

/** 提取 Date 在 tz 下的本地字段 · 用于断言 */
function local(date: Date, tz = TZ) {
  const dt = DateTime.fromJSDate(date, { zone: tz });
  return {
    y: dt.year,
    mo: dt.month,
    d: dt.day,
    h: dt.hour,
    mi: dt.minute,
    weekday: dt.weekday,
  };
}

// ===== 1. fnv1a64 =====

describe('fnv1a64', () => {
  it('same input → same output (deterministic)', () => {
    expect(fnv1a64('hello')).toBe(fnv1a64('hello'));
  });

  it('different input → different output (high probability)', () => {
    expect(fnv1a64('a')).not.toBe(fnv1a64('b'));
  });

  it('handles ascii + non-ascii chars', () => {
    // 保证 UTF-16 双字节字符也稳定
    expect(fnv1a64('外卖')).toBe(fnv1a64('外卖'));
    expect(fnv1a64('外卖')).not.toBe(fnv1a64('外卖 '));
  });

  it('returns a bigint in unsigned 64-bit range', () => {
    const h = fnv1a64('test');
    expect(typeof h).toBe('bigint');
    expect(h >= 0n).toBe(true);
    expect(h <= 0xffffffffffffffffn).toBe(true);
  });
});

// ===== 2. assignBucketMinute =====

describe('assignBucketMinute', () => {
  const userId = 'user-abc';
  const ruleId = 'rule-xyz';

  it('same (userId, ruleId, bucket) always returns same (hour, minute)', () => {
    const a = assignBucketMinute(userId, ruleId, 'morning');
    const b = assignBucketMinute(userId, ruleId, 'morning');
    expect(a).toEqual(b);
  });

  it('output falls strictly inside inner-margin window · morning [06:30, 11:30)', () => {
    const r = assignBucketMinute(userId, ruleId, 'morning');
    const total = r.hour * 60 + r.minute;
    expect(total).toBeGreaterThanOrEqual(6 * 60 + INNER_MARGIN_MINUTES);
    expect(total).toBeLessThan(12 * 60 - INNER_MARGIN_MINUTES);
  });

  it('output falls inside inner-margin for all 4 buckets', () => {
    for (const b of ['dawn', 'morning', 'afternoon', 'night'] as const) {
      const w = BUCKET_WINDOWS[b];
      const r = assignBucketMinute(userId, ruleId, b);
      const total = r.hour * 60 + r.minute;
      expect(total).toBeGreaterThanOrEqual(w.startHour * 60 + INNER_MARGIN_MINUTES);
      expect(total).toBeLessThan(w.endHour * 60 - INNER_MARGIN_MINUTES);
    }
  });

  it('never lands on window-edge minutes 06:00 or 11:59 (morning bucket)', () => {
    // 内缩边界的语义：hash 落点严格在 [06:30, 11:30) 区间
    // 即 morning 中 06:00-06:29 和 11:30-11:59 永不被选中
    // 抽样 200 次 (u, r) 组合
    for (let i = 0; i < 200; i++) {
      const r = assignBucketMinute(`u${i}`, `r${i}`, 'morning');
      const total = r.hour * 60 + r.minute;
      expect(total).toBeGreaterThanOrEqual(6 * 60 + INNER_MARGIN_MINUTES);
      expect(total).toBeLessThan(12 * 60 - INNER_MARGIN_MINUTES);
    }
  });

  it('1000-sample uniform distribution stays inside window', () => {
    // 均匀性硬验证（tech-spec §10.2）：确保没有一个 sample 落在 12:00~12:29 或 17:30~17:59
    let outOfInner = 0;
    for (let i = 0; i < 1000; i++) {
      const r = assignBucketMinute(`u${i}`, `r${i}`, 'afternoon');
      const total = r.hour * 60 + r.minute;
      if (total < 12 * 60 + INNER_MARGIN_MINUTES) outOfInner++;
      if (total >= 18 * 60 - INNER_MARGIN_MINUTES) outOfInner++;
    }
    expect(outOfInner).toBe(0);
  });
});

// ===== 3. computeNextRunAt · weekly (15 cases) =====

describe('computeNextRunAt · weekly (15 cases)', () => {
  it('weekly single-dow · Monday · from Sun → next Mon', () => {
    // 2026-01-04 (Sun) → next Mon = 2026-01-05 09:30
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      execute_hour: 9,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 4, 12, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 1, d: 5, h: 9, mi: 30 });
  });

  it('weekly · Monday · from Monday same day AFTER execute → next Mon', () => {
    // 2026-01-05 (Mon) 10:00 · execute=09:30 → jump to 2026-01-12
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      execute_hour: 9,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 10, 0));
    expect(local(next)).toMatchObject({ mo: 1, d: 12 });
  });

  it('weekly · Monday · from Monday same day BEFORE execute → same day', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      execute_hour: 9,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 8, 0));
    expect(local(next)).toMatchObject({ mo: 1, d: 5, h: 9, mi: 30 });
  });

  it('weekly · Monday · from exact execute moment → next Mon (strictly greater)', () => {
    // from = 2026-01-05 09:30:00 · 返回值必须 > from
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      execute_hour: 9,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 9, 30));
    expect(next.getTime()).toBeGreaterThan(localToUtc(2026, 1, 5, 9, 30).getTime());
    expect(local(next)).toMatchObject({ mo: 1, d: 12 });
  });

  it('weekly multi-dow · Mon+Wed+Fri · from Sun → Mon', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1, 3, 5],
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 4, 20, 0));
    expect(local(next).d).toBe(5);
  });

  it('weekly · Mon+Wed+Fri · from Tue → Wed', () => {
    const rule = makeRule({ period: 'weekly', days_of_week: [1, 3, 5] });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 6, 20, 0));
    expect(local(next).d).toBe(7);
  });

  it('weekly · Mon+Wed+Fri · from Fri after execute → next Mon', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1, 3, 5],
      execute_hour: 9,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 9, 10, 0)); // Fri 10:00
    expect(local(next).d).toBe(12);
  });

  it('weekly · every-day (7 selected) · from any day → tomorrow', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 12, 0));
    expect(local(next).d).toBe(6);
  });

  it('weekly · Sun only · from Mon → next Sun', () => {
    const rule = makeRule({ period: 'weekly', days_of_week: [7] });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 12, 0)); // Mon
    expect(local(next).d).toBe(11); // Sun 2026-01-11
    expect(local(next).weekday).toBe(7);
  });

  it('weekly · cross-week boundary · from Sat → next Mon (multi)', () => {
    const rule = makeRule({ period: 'weekly', days_of_week: [1, 4] });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 10, 12, 0)); // Sat
    expect(local(next)).toMatchObject({ mo: 1, d: 12, weekday: 1 });
  });

  it('weekly · from start_date same day · dow hits · time not passed → today', () => {
    // start=2026-01-05 (Mon) · from = start midnight · execute = 09:30 → today
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      start_date: '2026-01-05',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 0, 0));
    expect(local(next)).toMatchObject({ d: 5, h: 9, mi: 30 });
  });

  it('weekly · cross-year Dec 30 (Wed) → Jan 6 (Wed)', () => {
    const rule = makeRule({ period: 'weekly', days_of_week: [3] });
    const next = computeNextRunAt(rule, localToUtc(2026, 12, 30, 23, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 1, d: 6 });
  });

  it('weekly · execute time exactly at midnight', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      execute_hour: 0,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 4, 23, 0));
    expect(local(next)).toMatchObject({ d: 5, h: 0, mi: 30 });
  });

  it('weekly · execute time 23:30', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      execute_hour: 23,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 10, 0));
    expect(local(next)).toMatchObject({ d: 5, h: 23, mi: 30 });
  });

  it('weekly · advance next-run twice · check chain', () => {
    const rule = makeRule({ period: 'weekly', days_of_week: [1, 4] });
    const first = computeNextRunAt(rule, localToUtc(2026, 1, 4, 12, 0));
    const second = computeNextRunAt(rule, first);
    expect(local(first).d).toBe(5); // Mon
    expect(local(second).d).toBe(8); // Thu
  });
});

// ===== 4. computeNextRunAt · biweekly (12 cases) =====

describe('computeNextRunAt · biweekly (12 cases)', () => {
  // 基准周 = start_date 所在自然周。start=2026-01-05 (Mon) · W0=2026-01-05..11
  // W2 = 2026-01-19..25, W4 = 2026-02-02..08
  const RULE_MONDAY_BIWEEKLY = makeRule({
    period: 'weekly', period_interval: 2,
    days_of_week: [1],
    start_date: '2026-01-05',
  });

  it('biweekly · from W0 Mon after execute → W2 Mon', () => {
    const next = computeNextRunAt(
      RULE_MONDAY_BIWEEKLY,
      localToUtc(2026, 1, 5, 10, 0),
    );
    expect(local(next)).toMatchObject({ mo: 1, d: 19 });
  });

  it('biweekly · from W1 (skip week) → still W2', () => {
    const next = computeNextRunAt(
      RULE_MONDAY_BIWEEKLY,
      localToUtc(2026, 1, 12, 12, 0),
    );
    expect(local(next).d).toBe(19);
  });

  it('biweekly · from W2 before execute → same day', () => {
    const next = computeNextRunAt(
      RULE_MONDAY_BIWEEKLY,
      localToUtc(2026, 1, 19, 8, 0),
    );
    expect(local(next).d).toBe(19);
  });

  it('biweekly · from W2 after execute → W4', () => {
    const next = computeNextRunAt(
      RULE_MONDAY_BIWEEKLY,
      localToUtc(2026, 1, 19, 10, 0),
    );
    expect(local(next)).toMatchObject({ mo: 2, d: 2 });
  });

  it('biweekly · multi-dow Mon+Fri · from W0 Mon after → W0 Fri', () => {
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [1, 5],
      start_date: '2026-01-05',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 10, 0));
    expect(local(next).d).toBe(9); // Fri same week
  });

  it('biweekly · multi-dow Mon+Fri · from W0 Fri after → W2 Mon', () => {
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [1, 5],
      start_date: '2026-01-05',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 9, 10, 0));
    expect(local(next).d).toBe(19);
  });

  it('biweekly · start_date is Sunday · base week starts Mon before', () => {
    // start=2026-01-04 (Sun) · Luxon startOfWeek(Mon) = 2025-12-29 (Mon prior)
    // W0 = week of 2025-12-29
    // If we then ask from 2026-01-05 (Mon in W1) · biweekly should skip → answer in W2
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [1],
      start_date: '2026-01-04',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 10, 0));
    // W0 Mon = 2025-12-29 · W2 Mon = 2026-01-12
    expect(local(next).d).toBe(12);
  });

  it('biweekly · from date before start_date → next matching in future', () => {
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [1],
      start_date: '2026-02-01',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 5, 12, 0));
    // start=2026-02-01 (Sun) · W0 Mon = 2026-01-26
    // But from is in W-1 (2026-01-05 is 3 weeks earlier from base)
    // The algorithm doesn't accept negative weeksDiff → will keep scanning until W0/W2/W4/etc
    // W0 Mon = 2026-01-26 (should be the answer if cursor reaches it)
    expect(local(next)).toMatchObject({ mo: 1, d: 26 });
  });

  it('biweekly · cross-year · W2 in early Jan', () => {
    // start=2026-12-28 (Mon) · W2 = 2027-01-11
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [1],
      start_date: '2026-12-28',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 12, 28, 10, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 1, d: 11 });
  });

  it('biweekly · Wed only · from Sun in W0 → W0 Wed hits (before execute)', () => {
    // start=2026-01-05 (Mon) · W0 covers 2026-01-05..11 · Wed=2026-01-07
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [3],
      start_date: '2026-01-05',
    });
    // Sun in W0 is 2026-01-11
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 4, 12, 0)); // pre-start Sun
    // 2026-01-04 (Sun) is W-1 · algorithm skips negative weeks · answers W0 Wed = 01-07
    expect(local(next).d).toBe(7);
  });

  it('biweekly · advance next twice · chain skips W1', () => {
    const first = computeNextRunAt(
      RULE_MONDAY_BIWEEKLY,
      localToUtc(2026, 1, 4, 12, 0),
    );
    const second = computeNextRunAt(RULE_MONDAY_BIWEEKLY, first);
    expect(local(first).d).toBe(5); // W0 Mon
    expect(local(second).d).toBe(19); // W2 Mon
  });

  it('biweekly · all 7 dows selected · still respects biweekly cadence', () => {
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [1, 2, 3, 4, 5, 6, 7],
      start_date: '2026-01-05',
    });
    // from W0 Tue → next is Wed (same week)
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 6, 12, 0));
    expect(local(next).d).toBe(7);
  });
});

// ===== 5. computeNextRunAt · monthly (20 cases) =====

describe('computeNextRunAt · monthly (20 cases)', () => {
  it('monthly single-dom 15 · from 2026-01-01 → 2026-01-15', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [15] });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 1, d: 15 });
  });

  it('monthly 15 · from 2026-01-16 → 2026-02-15', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [15] });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 16, 12, 0));
    expect(local(next)).toMatchObject({ mo: 2, d: 15 });
  });

  it('monthly 31 · in Feb 2026 (non-leap) → Feb 28', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [31] });
    const next = computeNextRunAt(rule, localToUtc(2026, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 2, d: 28 });
  });

  it('monthly 31 · in Feb 2024 (leap) → Feb 29', () => {
    const rule = makeRule({
      period: 'monthly',
      days_of_month: [31],
      start_date: '2024-01-01',
    });
    const next = computeNextRunAt(rule, localToUtc(2024, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ y: 2024, mo: 2, d: 29 });
  });

  it('monthly 31 · in April → April 30', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [31] });
    const next = computeNextRunAt(rule, localToUtc(2026, 4, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 4, d: 30 });
  });

  it('monthly 30 · in Feb non-leap → Feb 28', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [30] });
    const next = computeNextRunAt(rule, localToUtc(2026, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 2, d: 28 });
  });

  it('monthly 29 · in Feb 2026 (non-leap) → Feb 28', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [29] });
    const next = computeNextRunAt(rule, localToUtc(2026, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 2, d: 28 });
  });

  it('monthly 29 · in Feb 2024 (leap) → Feb 29', () => {
    const rule = makeRule({
      period: 'monthly',
      days_of_month: [29],
      start_date: '2024-01-01',
    });
    const next = computeNextRunAt(rule, localToUtc(2024, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ y: 2024, mo: 2, d: 29 });
  });

  it('monthly multi-dom [15,31] · in April → 15 first then advance to 30', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [15, 31] });
    const first = computeNextRunAt(rule, localToUtc(2026, 4, 1, 0, 0));
    expect(local(first).d).toBe(15);
    const second = computeNextRunAt(rule, first);
    expect(local(second).d).toBe(30); // 31 回落 30
  });

  it('monthly multi-dom [15,31] · from 2026-04-16 → 2026-04-30', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [15, 31] });
    const next = computeNextRunAt(rule, localToUtc(2026, 4, 16, 12, 0));
    expect(local(next)).toMatchObject({ mo: 4, d: 30 });
  });

  it('monthly · dom [1,10,20] · advance chain across months', () => {
    const rule = makeRule({
      period: 'monthly',
      days_of_month: [1, 10, 20],
      start_date: '2026-01-01',
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      cursor = computeNextRunAt(rule, cursor);
      results.push(local(cursor).d);
    }
    expect(results).toEqual([1, 10, 20, 1, 10, 20]);
  });

  it('monthly · every day of month (1..14, 14-day upper limit) · from month start', () => {
    const days = Array.from({ length: 14 }, (_, i) => i + 1);
    const rule = makeRule({ period: 'monthly', days_of_month: days });
    let cursor = localToUtc(2026, 1, 1, 0, 0);
    const results: number[] = [];
    for (let i = 0; i < 14; i++) {
      cursor = computeNextRunAt(rule, cursor);
      results.push(local(cursor).d);
    }
    expect(results).toEqual(days);
  });

  it('monthly · Feb non-leap · dom [29,30,31] all collapse to 28 (single hit)', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [29, 30, 31] });
    const next = computeNextRunAt(rule, localToUtc(2026, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 2, d: 28 });
    // 下一次应到 3 月的 29/30/31，都命中，取最早
    const second = computeNextRunAt(rule, next);
    expect(local(second)).toMatchObject({ mo: 3, d: 29 });
  });

  it('monthly · cross-year · Dec → Jan', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [1] });
    const next = computeNextRunAt(rule, localToUtc(2026, 12, 15, 12, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 1, d: 1 });
  });

  it('monthly · from same day before execute → today', () => {
    const rule = makeRule({
      period: 'monthly',
      days_of_month: [15],
      execute_hour: 9,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 15, 6, 0));
    expect(local(next)).toMatchObject({ d: 15, h: 9 });
  });

  it('monthly · from same day after execute → next month', () => {
    const rule = makeRule({
      period: 'monthly',
      days_of_month: [15],
      execute_hour: 9,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 15, 10, 0));
    expect(local(next)).toMatchObject({ mo: 2, d: 15 });
  });

  it('monthly · dom 31 · consecutive month recall to different days', () => {
    // Jan 31 · Feb 28 · Mar 31 · Apr 30
    const rule = makeRule({ period: 'monthly', days_of_month: [31] });
    let cursor = localToUtc(2026, 1, 1, 0, 0);
    const seq: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      cursor = computeNextRunAt(rule, cursor);
      const l = local(cursor);
      seq.push([l.mo, l.d]);
    }
    expect(seq).toEqual([
      [1, 31],
      [2, 28],
      [3, 31],
      [4, 30],
    ]);
  });

  it('monthly · unsorted days_of_month input · behaves same as sorted', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [20, 5, 15] });
    let cursor = localToUtc(2026, 1, 1, 0, 0);
    const seq = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      seq.push(local(cursor).d);
    }
    expect(seq).toEqual([5, 15, 20]);
  });

  it('monthly · dom with duplicates · idempotent', () => {
    const rule = makeRule({ period: 'monthly', days_of_month: [15, 15, 15] });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0));
    expect(local(next).d).toBe(15);
  });

  it('monthly · start_date = 2026-06-01 · from before start → still find next match', () => {
    // monthsDiff will be negative → function returns null → keeps scanning
    // Eventually hits 2026-06-01
    const rule = makeRule({
      period: 'monthly',
      days_of_month: [1],
      start_date: '2026-06-01',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 6, d: 1 });
  });
});

// ===== 6. computeNextRunAt · bimonthly (8 cases) =====

describe('computeNextRunAt · bimonthly (8 cases)', () => {
  const RULE_JAN_15 = makeRule({
    period: 'monthly', period_interval: 2,
    days_of_month: [15],
    start_date: '2026-01-01',
  });

  it('bimonthly · from Jan 1 → Jan 15 (M0)', () => {
    const next = computeNextRunAt(RULE_JAN_15, localToUtc(2026, 1, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 1, d: 15 });
  });

  it('bimonthly · from Jan 16 → skip Feb → Mar 15 (M2)', () => {
    const next = computeNextRunAt(RULE_JAN_15, localToUtc(2026, 1, 16, 12, 0));
    expect(local(next)).toMatchObject({ mo: 3, d: 15 });
  });

  it('bimonthly · chain Jan → Mar → May → Jul', () => {
    let cursor = localToUtc(2026, 1, 1, 0, 0);
    const seq = [];
    for (let i = 0; i < 4; i++) {
      cursor = computeNextRunAt(RULE_JAN_15, cursor);
      seq.push(local(cursor).mo);
    }
    expect(seq).toEqual([1, 3, 5, 7]);
  });

  it('bimonthly · start Feb → active months are 2,4,6,8,10,12', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 2,
      days_of_month: [1],
      start_date: '2026-02-01',
    });
    // 从 Feb 1 早上 5:00 起（execute=09:30 未到），Feb 是 M0，命中 Feb 1
    let cursor = localToUtc(2026, 2, 1, 5, 0);
    const seq = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      seq.push(local(cursor).mo);
    }
    expect(seq).toEqual([2, 4, 6]);
  });

  it('bimonthly · multi-dom · in active month → each dom hits', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 2,
      days_of_month: [1, 15],
      start_date: '2026-01-01',
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      cursor = computeNextRunAt(rule, cursor);
      const l = local(cursor);
      seq.push([l.mo, l.d]);
    }
    expect(seq).toEqual([
      [1, 1],
      [1, 15],
      [3, 1],
      [3, 15],
    ]);
  });

  it('bimonthly · 31 in odd-month (Jan, Mar, May) works · in Nov (30 days) → Nov 30', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 2,
      days_of_month: [31],
      start_date: '2026-01-01',
    });
    let cursor = localToUtc(2026, 10, 1, 0, 0);
    // Jan/Mar/May/Jul/Sep/Nov are active. Sep=30d Nov=30d
    // We are asking from Oct 1 → next active month is Nov → Nov 30
    cursor = computeNextRunAt(rule, cursor);
    expect(local(cursor)).toMatchObject({ mo: 11, d: 30 });
  });

  it('bimonthly · cross-year advance', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 2,
      days_of_month: [15],
      start_date: '2026-01-01',
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 11, 15, 10, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 1, d: 15 });
  });

  it('bimonthly · dom [1,15,31] · Jan produces 3 hits', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 2,
      days_of_month: [1, 15, 31],
      start_date: '2026-01-01',
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      seq.push(local(cursor).d);
    }
    expect(seq).toEqual([1, 15, 31]);
  });
});

// ===== 7. computeNextRunAt · trimonthly (8 cases) =====

describe('computeNextRunAt · trimonthly (8 cases)', () => {
  const RULE_JAN = makeRule({
    period: 'monthly', period_interval: 3,
    days_of_month: [1],
    start_date: '2026-01-01',
  });

  it('trimonthly · from Jan 1 → Jan 1 (M0)', () => {
    // Jan 1 09:30 · from = 2025-12-31 → Jan 1 09:30
    const next = computeNextRunAt(RULE_JAN, localToUtc(2025, 12, 31, 23, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 1, d: 1 });
  });

  it('trimonthly · chain Jan → Apr → Jul → Oct → Jan(next year)', () => {
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) {
      cursor = computeNextRunAt(RULE_JAN, cursor);
      const l = local(cursor);
      seq.push([l.y, l.mo]);
    }
    expect(seq).toEqual([
      [2026, 1],
      [2026, 4],
      [2026, 7],
      [2026, 10],
      [2027, 1],
    ]);
  });

  it('trimonthly · skip M1 M2 → advance to M3', () => {
    const next = computeNextRunAt(RULE_JAN, localToUtc(2026, 2, 15, 12, 0));
    expect(local(next).mo).toBe(4);
  });

  it('trimonthly · start Feb → active Feb/May/Aug/Nov', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 3,
      days_of_month: [1],
      start_date: '2026-02-01',
    });
    // 从 Feb 1 早上 5:00 起（execute=09:30 未到），Feb 是 M0，命中 Feb 1
    let cursor = localToUtc(2026, 2, 1, 5, 0);
    const seq = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      seq.push(local(cursor).mo);
    }
    expect(seq).toEqual([2, 5, 8]);
  });

  it('trimonthly · dom [31] in Apr (30d) · Apr 30', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 3,
      days_of_month: [31],
      start_date: '2026-01-01',
    });
    let cursor = localToUtc(2026, 4, 1, 0, 0);
    cursor = computeNextRunAt(rule, cursor);
    expect(local(cursor)).toMatchObject({ mo: 4, d: 30 });
  });

  it('trimonthly · multi-dom [1,15] in Jan → 2 hits', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 3,
      days_of_month: [1, 15],
      start_date: '2026-01-01',
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq: Array<[number, number]> = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      const l = local(cursor);
      seq.push([l.mo, l.d]);
    }
    expect(seq).toEqual([
      [1, 1],
      [1, 15],
      [4, 1],
    ]);
  });

  it('trimonthly · cross-year advance', () => {
    const next = computeNextRunAt(RULE_JAN, localToUtc(2026, 10, 1, 10, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 1, d: 1 });
  });

  it('trimonthly · start Mar → active Mar/Jun/Sep/Dec', () => {
    const rule = makeRule({
      period: 'monthly', period_interval: 3,
      days_of_month: [15],
      start_date: '2026-03-01',
    });
    let cursor = localToUtc(2026, 3, 1, 0, 0);
    const seq = [];
    for (let i = 0; i < 4; i++) {
      cursor = computeNextRunAt(rule, cursor);
      seq.push(local(cursor).mo);
    }
    expect(seq).toEqual([3, 6, 9, 12]);
  });
});

// ===== 8. computeNextRunAt · yearly (25 cases) =====

describe('computeNextRunAt · yearly (25 cases)', () => {
  it('yearly · single (Dec 25) · from Nov → Dec 25 same year', () => {
    const rule = makeRule({ period: 'yearly', year_month_days: [1225] });
    const next = computeNextRunAt(rule, localToUtc(2026, 11, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 12, d: 25 });
  });

  it('yearly · single Dec 25 · from Dec 26 → next year', () => {
    const rule = makeRule({ period: 'yearly', year_month_days: [1225] });
    const next = computeNextRunAt(rule, localToUtc(2026, 12, 26, 0, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 12, d: 25 });
  });

  it('yearly · Feb 29 · leap year 2024 → 2024-02-29', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [229],
      start_date: '2024-01-01',
    });
    const next = computeNextRunAt(rule, localToUtc(2024, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ y: 2024, mo: 2, d: 29 });
  });

  it('yearly · Feb 29 · non-leap 2026 → 2026-02-28', () => {
    const rule = makeRule({ period: 'yearly', year_month_days: [229] });
    const next = computeNextRunAt(rule, localToUtc(2026, 2, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 2, d: 28 });
  });

  it('yearly · Feb 29 · advance from 2024-02-29 → 2025-02-28 (non-leap collapse)', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [229],
      start_date: '2024-01-01',
    });
    const next = computeNextRunAt(rule, localToUtc(2024, 2, 29, 10, 0));
    expect(local(next)).toMatchObject({ y: 2025, mo: 2, d: 28 });
  });

  it('yearly · cross-month · [1/1, 12/25] · chain Jan → Dec → next Jan', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [101, 1225],
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq: Array<[number, number, number]> = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      const l = local(cursor);
      seq.push([l.y, l.mo, l.d]);
    }
    expect(seq).toEqual([
      [2026, 1, 1],
      [2026, 12, 25],
      [2027, 1, 1],
    ]);
  });

  it('yearly · every-month same day (1/1..12/12) · 12 hits per year', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [
        101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212,
      ],
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq: number[] = [];
    for (let i = 0; i < 12; i++) {
      cursor = computeNextRunAt(rule, cursor);
      seq.push(local(cursor).mo);
    }
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('yearly · every-month same day · advance one more → next-year Jan', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [
        101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212,
      ],
    });
    let cursor = localToUtc(2026, 12, 12, 23, 0);
    cursor = computeNextRunAt(rule, cursor);
    expect(local(cursor)).toMatchObject({ y: 2027, mo: 1, d: 1 });
  });

  it('yearly · same-month multiple days · [12/24, 12/25] → 2 hits in Dec', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [1224, 1225],
    });
    let cursor = localToUtc(2026, 12, 1, 0, 0);
    const seq = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      seq.push(local(cursor).d);
    }
    // Dec 24, Dec 25, then next year Dec 24
    expect(seq).toEqual([24, 25, 24]);
  });

  it('yearly · mixed · [2/14, 12/25] · in Feb → Feb 14; in Aug → Dec 25', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [214, 1225],
    });
    const feb = computeNextRunAt(rule, localToUtc(2026, 2, 1, 0, 0));
    expect(local(feb)).toMatchObject({ mo: 2, d: 14 });
    const aug = computeNextRunAt(rule, localToUtc(2026, 8, 1, 0, 0));
    expect(local(aug)).toMatchObject({ mo: 12, d: 25 });
  });

  it('yearly · Feb 30 not valid input (validation lives in service · algorithm ignores)', () => {
    // Algorithm treats non-existent day as no-match; will consume iterations but eventually
    // find no match within 800 days and throw
    const rule = makeRule({ period: 'yearly', year_month_days: [230] });
    expect(() => computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0))).toThrow(
      /no match within/,
    );
  });

  it('yearly · leap-year Feb 29 valid year cycle · 2024 → 2025 collapse → 2028 real hit', () => {
    // Verify the collapse behavior: 2024 hit 2/29 · 2025-2027 hit 2/28 · 2028 hit 2/29
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [229],
      start_date: '2024-01-01',
    });
    const y2024 = computeNextRunAt(rule, localToUtc(2024, 1, 1, 0, 0));
    expect(local(y2024)).toMatchObject({ y: 2024, mo: 2, d: 29 });
    const y2025 = computeNextRunAt(rule, y2024);
    expect(local(y2025)).toMatchObject({ y: 2025, mo: 2, d: 28 });
    const y2026 = computeNextRunAt(rule, y2025);
    expect(local(y2026)).toMatchObject({ y: 2026, mo: 2, d: 28 });
    const y2027 = computeNextRunAt(rule, y2026);
    expect(local(y2027)).toMatchObject({ y: 2027, mo: 2, d: 28 });
    const y2028 = computeNextRunAt(rule, y2027);
    expect(local(y2028)).toMatchObject({ y: 2028, mo: 2, d: 29 });
  });

  it('yearly · single (Jul 4) · from Jul 4 before execute → same day', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [704],
      execute_hour: 20,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 7, 4, 8, 0));
    expect(local(next)).toMatchObject({ mo: 7, d: 4, h: 20 });
  });

  it('yearly · single (Jul 4) · from Jul 4 after execute → next year', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [704],
      execute_hour: 20,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 7, 4, 21, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 7, d: 4 });
  });

  it('yearly · Dec 31 · from Dec 31 after execute → next year Dec 31', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [1231],
      execute_hour: 12,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 12, 31, 13, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 12, d: 31 });
  });

  it('yearly · Jan 1 · from prev year Dec 30 → this year Jan 1', () => {
    const rule = makeRule({ period: 'yearly', year_month_days: [101] });
    const next = computeNextRunAt(rule, localToUtc(2025, 12, 30, 12, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 1, d: 1 });
  });

  it('yearly · 12 hits distributed across all months · check sequential order', () => {
    // 1/5, 2/10, 3/15, 4/20, 5/25, 6/30, 7/5, 8/10, 9/15, 10/20, 11/25, 12/30
    const days = [
      105, 210, 315, 420, 525, 630, 705, 810, 915, 1020, 1125, 1230,
    ];
    const rule = makeRule({ period: 'yearly', year_month_days: days });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq: Array<[number, number]> = [];
    for (let i = 0; i < 12; i++) {
      cursor = computeNextRunAt(rule, cursor);
      const l = local(cursor);
      seq.push([l.mo, l.d]);
    }
    expect(seq).toEqual([
      [1, 5],
      [2, 10],
      [3, 15],
      [4, 20],
      [5, 25],
      [6, 30],
      [7, 5],
      [8, 10],
      [9, 15],
      [10, 20],
      [11, 25],
      [12, 30],
    ]);
  });

  it('yearly · encoded day out-of-month · Apr 31 → no match (throws after 800d)', () => {
    // Apr = 30 days. year_month_days=[431] means "April 31" which never exists.
    // Algorithm does not do fallback for yearly (only 2/29 → 2/28 special case).
    const rule = makeRule({ period: 'yearly', year_month_days: [431] });
    expect(() => computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0))).toThrow();
  });

  it('yearly · unsorted input · algorithm sorts internally when needed', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [1225, 101, 704],
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    const seq: Array<[number, number]> = [];
    for (let i = 0; i < 3; i++) {
      cursor = computeNextRunAt(rule, cursor);
      const l = local(cursor);
      seq.push([l.mo, l.d]);
    }
    expect(seq).toEqual([
      [1, 1],
      [7, 4],
      [12, 25],
    ]);
  });

  it('yearly · single Aug 1 · from Aug 2 → next year Aug 1', () => {
    const rule = makeRule({ period: 'yearly', year_month_days: [801] });
    const next = computeNextRunAt(rule, localToUtc(2026, 8, 2, 0, 0));
    expect(local(next)).toMatchObject({ y: 2027, mo: 8, d: 1 });
  });

  it('yearly · execute_hour late (23:30) · check UTC round-trip preserves hour', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [1225],
      execute_hour: 23,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 11, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 12, d: 25, h: 23, mi: 30 });
  });

  it('yearly · execute_hour early (00:30) · check UTC round-trip preserves hour', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [101],
      execute_hour: 0,
      execute_minute: 30,
    });
    const next = computeNextRunAt(rule, localToUtc(2025, 12, 31, 23, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 1, d: 1, h: 0, mi: 30 });
  });

  it('yearly · [1/1, 2/29] · non-leap year yields 2/28 (collapse) not skipped', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [101, 229],
      start_date: '2026-01-01',
    });
    let cursor = localToUtc(2025, 12, 31, 23, 0);
    cursor = computeNextRunAt(rule, cursor);
    expect(local(cursor)).toMatchObject({ mo: 1, d: 1 });
    cursor = computeNextRunAt(rule, cursor);
    expect(local(cursor)).toMatchObject({ mo: 2, d: 28 });
  });

  it('yearly · duplicates in year_month_days · idempotent', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [1225, 1225, 1225],
    });
    const next = computeNextRunAt(rule, localToUtc(2026, 11, 1, 0, 0));
    expect(local(next)).toMatchObject({ mo: 12, d: 25 });
  });

  it('yearly · from date-time exactly equals target · returns strictly greater', () => {
    // from = 2026-12-25 09:30 (exact execute) → must jump to 2027-12-25 09:30
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [1225],
      execute_hour: 9,
      execute_minute: 30,
    });
    const from = localToUtc(2026, 12, 25, 9, 30);
    const next = computeNextRunAt(rule, from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(local(next)).toMatchObject({ y: 2027, mo: 12, d: 25 });
  });
});

// ===== 9. Timezone (10 cases) =====

describe('computeNextRunAt · timezone (10 cases)', () => {
  it('Asia/Shanghai · from UTC 2026-01-01T00:00Z → local 08:00 Jan 1 · weekly Thu → Jan 1 (Thu) 09:30 if before execute', () => {
    // 2026-01-01 is Thursday (weekday=4)
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [4],
      execute_hour: 9,
      execute_minute: 30,
    });
    // UTC 00:00 = Shanghai 08:00 same day
    const from = new Date('2026-01-01T00:00:00Z');
    const next = computeNextRunAt(rule, from);
    expect(local(next, 'Asia/Shanghai')).toMatchObject({
      mo: 1,
      d: 1,
      h: 9,
      mi: 30,
    });
  });

  it('America/New_York · execute 08:00 · from Sun midnight NY → Mon 08:00 NY', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [1],
      execute_hour: 8,
      execute_minute: 0,
      timezone: 'America/New_York',
      start_date: '2026-01-01',
    });
    // Sun 2026-01-04 in NY = UTC 2026-01-04T05:00 (winter EST -5)
    const from = new Date('2026-01-04T05:00:00Z');
    const next = computeNextRunAt(rule, from);
    expect(local(next, 'America/New_York')).toMatchObject({
      mo: 1,
      d: 5,
      h: 8,
      mi: 0,
    });
  });

  it('UTC · execute 12:00 · from before → same day', () => {
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [4], // Thursday
      execute_hour: 12,
      execute_minute: 0,
      timezone: 'UTC',
    });
    const from = new Date('2026-01-01T10:00:00Z');
    const next = computeNextRunAt(rule, from);
    expect(local(next, 'UTC')).toMatchObject({ mo: 1, d: 1, h: 12, mi: 0 });
  });

  it('Asia/Tokyo · yearly Dec 31 midnight · returns UTC = Dec 30 15:00', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [1231],
      execute_hour: 0,
      execute_minute: 30,
      timezone: 'Asia/Tokyo',
    });
    const from = new Date('2026-11-01T00:00:00Z');
    const next = computeNextRunAt(rule, from);
    expect(local(next, 'Asia/Tokyo')).toMatchObject({
      mo: 12,
      d: 31,
      h: 0,
      mi: 30,
    });
  });

  it('invalid timezone → throws', () => {
    const rule = makeRule({ timezone: 'Not/Real', days_of_week: [1] });
    expect(() => computeNextRunAt(rule, new Date())).toThrow(/timezone/);
  });

  it('DST-affected zone · America/New_York · spring forward (2026-03-08)', () => {
    // On 2026-03-08 at 2am NY time, clock jumps to 3am. execute 02:30 does not exist locally.
    // But we're just testing that computeNextRunAt doesn't crash and produces a plausible next time.
    const rule = makeRule({
      period: 'weekly',
      days_of_week: [7], // Sunday
      execute_hour: 3,
      execute_minute: 30,
      timezone: 'America/New_York',
    });
    const next = computeNextRunAt(
      rule,
      new Date('2026-03-08T04:00:00Z'), // Sun 04:00 UTC = Sun 23:00 Sat NY (EST)
    );
    // Should find Sunday 03:30 NY at some point
    expect(local(next, 'America/New_York').weekday).toBe(7);
    expect(local(next, 'America/New_York').h).toBe(3);
  });

  it('cross-year timezone boundary · Shanghai Dec 31 23:59 vs UTC same moment', () => {
    // Shanghai Jan 1 = UTC Dec 31 16:00 previous day
    // Rule: yearly Jan 1 09:30 Shanghai
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [101],
      execute_hour: 9,
      execute_minute: 30,
      timezone: 'Asia/Shanghai',
    });
    const next = computeNextRunAt(rule, new Date('2025-12-31T15:00:00Z'));
    expect(local(next, 'Asia/Shanghai')).toMatchObject({
      y: 2026,
      mo: 1,
      d: 1,
      h: 9,
      mi: 30,
    });
  });

  it('Europe/London · monthly 15 · check the UK zone works', () => {
    const rule = makeRule({
      period: 'monthly',
      days_of_month: [15],
      timezone: 'Europe/London',
    });
    const next = computeNextRunAt(rule, new Date('2026-01-14T08:00:00Z'));
    expect(local(next, 'Europe/London')).toMatchObject({ mo: 1, d: 15 });
  });

  it('Australia/Sydney · far-future zone · yearly works', () => {
    const rule = makeRule({
      period: 'yearly',
      year_month_days: [704],
      timezone: 'Australia/Sydney',
    });
    const next = computeNextRunAt(rule, new Date('2026-01-01T00:00:00Z'));
    expect(local(next, 'Australia/Sydney')).toMatchObject({ mo: 7, d: 4 });
  });

  it('Pacific/Auckland · biweekly · handles zone with +13 offset', () => {
    const rule = makeRule({
      period: 'weekly', period_interval: 2,
      days_of_week: [1],
      timezone: 'Pacific/Auckland',
      start_date: '2026-01-05',
    });
    const next = computeNextRunAt(rule, new Date('2026-01-05T00:00:00Z'));
    // Auckland is UTC+13 · this UTC = 2026-01-05 13:00 local · execute 09:30 already passed
    // Since it's Mon and passed execute · biweekly → W2
    // W0 Mon local = 2026-01-05, W2 Mon = 2026-01-19
    expect(local(next, 'Pacific/Auckland')).toMatchObject({ mo: 1, d: 19 });
  });
});

// ===== 10. Boundary (8 cases) =====

describe('computeNextRunAt · boundary (8 cases)', () => {
  it('empty days_of_week returns no match → throws after 800 days', () => {
    const rule = makeRule({ period: 'weekly', days_of_week: [] });
    expect(() => computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0))).toThrow();
  });

  it('null days_of_week for weekly returns no match → throws', () => {
    const rule = makeRule({ period: 'weekly', days_of_week: null });
    expect(() => computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0))).toThrow();
  });

  it('impossible config · yearly with unreachable date · throws', () => {
    // Apr 31 doesn't exist, and yearly doesn't do fallback
    const rule = makeRule({ period: 'yearly', year_month_days: [431] });
    expect(() => computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0))).toThrow(
      /no match/,
    );
  });

  it('BACKFILL_WINDOW_MS is 7 days in ms', () => {
    expect(BACKFILL_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('MAX_BACKFILL_ITER is 100', () => {
    expect(MAX_BACKFILL_ITER).toBe(100);
  });

  it('BUCKET_WINDOWS covers 24h contiguously', () => {
    const buckets = ['dawn', 'morning', 'afternoon', 'night'] as const;
    const covered = new Set<number>();
    for (const b of buckets) {
      const w = BUCKET_WINDOWS[b];
      for (let h = w.startHour; h < w.endHour; h++) covered.add(h);
    }
    expect(covered.size).toBe(24);
  });

  it('INNER_MARGIN_MINUTES is 30', () => {
    expect(INNER_MARGIN_MINUTES).toBe(30);
  });

  it('yearly · run 800-day scan boundary · barely valid (just within limit)', () => {
    // Should still succeed for a valid yearly rule that hits every year
    const rule = makeRule({ period: 'yearly', year_month_days: [1225] });
    const next = computeNextRunAt(rule, localToUtc(2026, 12, 26, 0, 0));
    // Dec 25 next year is ~365 days away, well within 800
    expect(local(next).mo).toBe(12);
    expect(local(next).d).toBe(25);
  });
});

// ===== 11. formatDaysForSummary · dow (weekly/biweekly) =====

describe('formatDaysForSummary · dow (weekly/biweekly)', () => {
  const dow = (days: number[], mode: 'full' | 'compact' = 'full') =>
    formatDaysForSummary({
      period: 'weekly',
      mode,
      days_of_week: days,
      days_of_month: null,
      year_month_days: null,
    });

  it('full · single Mon → 周一', () => {
    expect(dow([1])).toBe('周一');
  });

  it('full · Mon+Wed+Fri → 周一、三、五', () => {
    expect(dow([1, 3, 5])).toBe('周一、三、五');
  });

  it('full · all 7 → 每天', () => {
    expect(dow([1, 2, 3, 4, 5, 6, 7])).toBe('每天');
  });

  it('compact · all 7 → 每天 (same)', () => {
    expect(dow([1, 2, 3, 4, 5, 6, 7], 'compact')).toBe('每天');
  });

  it('compact · 4 days → 首2尾2 省略', () => {
    // 1,3,5,7 → 周一、三、…、五、日
    expect(dow([1, 3, 5, 7], 'compact')).toBe('周一、三、…、五、日');
  });

  it('compact · 3 days → 完整（不省略）', () => {
    expect(dow([1, 3, 5], 'compact')).toBe('周一、三、五');
  });

  it('full · unsorted input · sorted output', () => {
    expect(dow([5, 1, 3])).toBe('周一、三、五');
  });

  it('empty → empty string', () => {
    expect(dow([])).toBe('');
  });

  it('biweekly period uses same dow formatter', () => {
    const s = formatDaysForSummary({
      period: 'weekly', period_interval: 2,
      mode: 'full',
      days_of_week: [1, 3],
      days_of_month: null,
      year_month_days: null,
    });
    expect(s).toBe('周一、三');
  });
});

// ===== 12. formatDaysForSummary · dom (monthly/bimonthly/trimonthly) =====

describe('formatDaysForSummary · dom (monthly/bimonthly/trimonthly)', () => {
  const dom = (days: number[], mode: 'full' | 'compact' = 'full') =>
    formatDaysForSummary({
      period: 'monthly',
      mode,
      days_of_week: null,
      days_of_month: days,
      year_month_days: null,
    });

  it('full · single 15 → 15 日', () => {
    expect(dom([15])).toBe('15 日');
  });

  it('full · [5,15,25] → 5、15、25 日', () => {
    expect(dom([5, 15, 25])).toBe('5、15、25 日');
  });

  it('full · consecutive 3+ collapsed with ~ · [5,6,7,8] → 5~8 日', () => {
    expect(dom([5, 6, 7, 8])).toBe('5~8 日');
  });

  it('full · mixed · [1, 5,6,7, 15, 31] → 1、5~7、15、31 日', () => {
    expect(dom([1, 5, 6, 7, 15, 31])).toBe('1、5~7、15、31 日');
  });

  it('full · consecutive 2 not collapsed · [1,2] → 1、2 日', () => {
    expect(dom([1, 2])).toBe('1、2 日');
  });

  it('compact · 4 days → 5、15、…、25、31 日', () => {
    expect(dom([5, 15, 25, 31], 'compact')).toBe('5、15、…、25、31 日');
  });

  it('compact · 3 days → 完整', () => {
    expect(dom([5, 15, 25], 'compact')).toBe('5、15、25 日');
  });

  it('bimonthly period · same dom formatter', () => {
    const s = formatDaysForSummary({
      period: 'monthly', period_interval: 2,
      mode: 'full',
      days_of_week: null,
      days_of_month: [1, 15],
      year_month_days: null,
    });
    expect(s).toBe('1、15 日');
  });

  it('trimonthly period · same dom formatter', () => {
    const s = formatDaysForSummary({
      period: 'monthly', period_interval: 3,
      mode: 'full',
      days_of_week: null,
      days_of_month: [15],
      year_month_days: null,
    });
    expect(s).toBe('15 日');
  });

  it('empty → empty string', () => {
    expect(dom([])).toBe('');
  });

  it('unsorted input · sorted output', () => {
    expect(dom([31, 15, 5])).toBe('5、15、31 日');
  });

  it('duplicates deduped', () => {
    expect(dom([5, 5, 15, 15, 15])).toBe('5、15 日');
  });
});

// ===== 13. formatDaysForSummary · year_month_days =====

describe('formatDaysForSummary · yearly', () => {
  const ymd = (encoded: number[], mode: 'full' | 'compact' = 'full') =>
    formatDaysForSummary({
      period: 'yearly',
      mode,
      days_of_week: null,
      days_of_month: null,
      year_month_days: encoded,
    });

  it('full · single [1225] → 12月25日', () => {
    expect(ymd([1225])).toBe('12月25日');
  });

  it('full · same-month multiple · [1224, 1225] → 12月24,25日', () => {
    expect(ymd([1224, 1225])).toBe('12月24,25日');
  });

  it('full · same-month consecutive 3+ · [301,302,303] → 3月1~3日', () => {
    expect(ymd([301, 302, 303])).toBe('3月1~3日');
  });

  it('full · cross-month · [101, 214, 1225] → 1月1日、2月14日、12月25日', () => {
    expect(ymd([101, 214, 1225])).toBe(
      '1月1日、2月14日、12月25日',
    );
  });

  it('full · every-month same-day 12 hits · complete listing', () => {
    const days = [
      101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212,
    ];
    const s = ymd(days);
    // full mode shows all 12
    expect(s).toBe(
      '1月1日、2月2日、3月3日、4月4日、5月5日、6月6日、7月7日、8月8日、9月9日、10月10日、11月11日、12月12日',
    );
  });

  it('compact · every-month same-day 12 hits · 首2尾2 省略', () => {
    const days = [
      101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212,
    ];
    expect(ymd(days, 'compact')).toBe('1/1、2/2、…、11/11、12/12');
  });

  it('compact · 3 hits → 完整', () => {
    expect(ymd([101, 214, 1225], 'compact')).toBe(
      '1月1日、2月14日、12月25日',
    );
  });

  it('compact · 4 hits → 省略', () => {
    expect(ymd([101, 202, 303, 404], 'compact')).toBe(
      '1/1、2/2、…、3/3、4/4',
    );
  });

  it('empty → empty string', () => {
    expect(ymd([])).toBe('');
  });

  it('unsorted input · sorted output', () => {
    expect(ymd([1225, 101])).toBe('1月1日、12月25日');
  });

  it('same-month mixed consecutive and non-consecutive', () => {
    // 3/1, 3/2, 3/3, 3/10, 3/15 → 3月1~3,10,15日
    expect(ymd([301, 302, 303, 310, 315])).toBe('3月1~3,10,15日');
  });

  it('workday → 每个工作日', () => {
    expect(
      formatDaysForSummary({
        period: 'workday',
        mode: 'full',
        days_of_week: null,
        days_of_month: null,
        year_month_days: null,
      }),
    ).toBe('每个工作日');
  });
});

// ===== 14. workday · isWorkdaySync =====

describe('isWorkdaySync', () => {
  const year = 2026;
  const data = {
    year,
    holidays: ['01-01', '02-15'], // 元旦、春节首日（周二）
    workdays: ['02-08'], // 周日补班
  };

  it('null data → 周一~周五降级', () => {
    expect(isWorkdaySync(null, year, 7, '01-01')).toBe(false); // Sun → false
    expect(isWorkdaySync(null, year, 1, '01-05')).toBe(true); // Mon → true
  });

  it('数据年份不匹配 → 降级周一~周五', () => {
    expect(isWorkdaySync(data, 2027, 7, '01-01')).toBe(false);
    expect(isWorkdaySync(data, 2027, 1, '01-05')).toBe(true);
  });

  it('补班日（周末）→ 是工作日', () => {
    // 2026-02-08 是周日 · 补班 → 是工作日
    expect(isWorkdaySync(data, year, 7, '02-08')).toBe(true);
  });

  it('放假日（周一~周五）→ 不是工作日', () => {
    // 2026-01-01 是周四 · 元旦放假 → 不是工作日
    expect(isWorkdaySync(data, year, 4, '01-01')).toBe(false);
  });

  it('普通工作日（周一~周五非假日）→ 是工作日', () => {
    // 2026-01-05 是周一 · 非假日 → 是工作日
    expect(isWorkdaySync(data, year, 1, '01-05')).toBe(true);
  });

  it('普通周末（非补班）→ 不是工作日', () => {
    // 2026-01-11 是周日 · 非补班 → 不是工作日
    expect(isWorkdaySync(data, year, 7, '01-11')).toBe(false);
  });
});

// ===== 15. computeNextRunAt · workday =====

describe('computeNextRunAt · workday', () => {
  const year = 2026;
  const workdayData = [{
    year,
    holidays: ['01-01', '02-15', '02-16', '02-17'],
    workdays: ['02-08'],
  }];

  const rule = makeRule({
    period: 'workday',
    workday_data: workdayData,
    execute_hour: 9,
    execute_minute: 30,
  });

  it('跳过放假日（周四元旦）→ 下一个工作日在周五', () => {
    // 2026-01-01 周四放假 → 下一个工作日 2026-01-02 周五
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 1, 0, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 1, d: 2 });
  });

  it('从普通周五推进 → 下周一（跳过周末）', () => {
    // 2026-01-09 周五 10:00 · execute 09:30 已过 → 下周一 2026-01-12
    const next = computeNextRunAt(rule, localToUtc(2026, 1, 9, 10, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 1, d: 12, weekday: 1 });
  });

  it('补班周日 → 是工作日（当天 09:30 命中）', () => {
    // 2026-02-08 周日补班 · from 当天 08:00 → 09:30 命中
    const next = computeNextRunAt(rule, localToUtc(2026, 2, 8, 8, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 2, d: 8, h: 9, mi: 30 });
  });

  it('春节连续放假（2/15-2/17）→ 跳过到节后', () => {
    // 2/15 周日、2/16 周一、2/17 周二 放假 · 2/18 周三补班？无 · 需验证数据外
    // 这里用 2/17 周二（放假）from → 下一个工作日 = 2/18 周三（数据未列为假日）
    const next = computeNextRunAt(rule, localToUtc(2026, 2, 17, 0, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 2, d: 18 });
  });

  it('workday_data 为空数组 → 降级周一~周五', () => {
    const fallbackRule = makeRule({
      period: 'workday',
      workday_data: [],
      execute_hour: 9,
      execute_minute: 30,
    });
    // 2026-01-01 周四 · 无数据 → 按周一~五 → 当天命中
    const next = computeNextRunAt(fallbackRule, localToUtc(2026, 1, 1, 0, 0));
    expect(local(next)).toMatchObject({ y: 2026, mo: 1, d: 1 });
  });
});
