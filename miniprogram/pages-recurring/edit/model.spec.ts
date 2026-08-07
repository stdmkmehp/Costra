// pages-recurring/edit/model.spec.ts · 编辑页纯函数单测
// 卡号占位：COSTRA-5xx（T3）
// Refs: COSTRA-5xx

import { describe, it, expect } from 'vitest';
import {
  shouldClearDaysOnPeriodChange,
  shouldKeepCategoryOnLedgerChange,
  bucketRepresentativeTime,
  isVersionConflict,
  findNearestSelectedMonth,
  computePreviewNextRun,
  DOM_MAX,
  YEARLY_MAX,
} from './model';

describe('edit/model', () => {
  describe('shouldClearDaysOnPeriodChange', () => {
    it('weekly → biweekly: same group, no clear', () => {
      expect(shouldClearDaysOnPeriodChange('weekly', 'weekly')).toBe(false);
    });
    it('biweekly → weekly: same group, no clear', () => {
      expect(shouldClearDaysOnPeriodChange('weekly', 'weekly')).toBe(false);
    });
    it('monthly → bimonthly: same group, no clear', () => {
      expect(shouldClearDaysOnPeriodChange('monthly', 'monthly')).toBe(false);
    });
    it('monthly → trimonthly: same group, no clear', () => {
      expect(shouldClearDaysOnPeriodChange('monthly', 'monthly')).toBe(false);
    });
    it('weekly → monthly: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('weekly', 'monthly')).toBe(true);
    });
    it('monthly → yearly: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('monthly', 'yearly')).toBe(true);
    });
    it('yearly → weekly: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('yearly', 'weekly')).toBe(true);
    });
    it('same period: no clear', () => {
      expect(shouldClearDaysOnPeriodChange('weekly', 'weekly')).toBe(false);
    });
    it('weekly → workday: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('weekly', 'workday')).toBe(true);
    });
    it('workday → monthly: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('workday', 'monthly')).toBe(true);
    });
    it('workday → workday: same, no clear', () => {
      expect(shouldClearDaysOnPeriodChange('workday', 'workday')).toBe(false);
    });
    it('daily → daily: same, no clear', () => {
      expect(shouldClearDaysOnPeriodChange('daily', 'daily')).toBe(false);
    });
    it('weekly → daily: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('weekly', 'daily')).toBe(true);
    });
    it('daily → weekly: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('daily', 'weekly')).toBe(true);
    });
    it('monthly → daily: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('monthly', 'daily')).toBe(true);
    });
    it('daily → workday: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('daily', 'workday')).toBe(true);
    });
    it('workday → daily: cross group, clear', () => {
      expect(shouldClearDaysOnPeriodChange('workday', 'daily')).toBe(true);
    });
  });

  describe('shouldKeepCategoryOnLedgerChange', () => {
    it('系统预设分类（familyId=null）：任意账本保留', () => {
      expect(shouldKeepCategoryOnLedgerChange({ id: 'sys', familyId: null }, 'family-A')).toBe(true);
    });
    it('家庭自定义分类：属于目标家庭 → 保留', () => {
      expect(shouldKeepCategoryOnLedgerChange({ id: 'cat', familyId: 'family-A' }, 'family-A')).toBe(true);
    });
    it('家庭自定义分类：不属于目标家庭 → 清空', () => {
      expect(shouldKeepCategoryOnLedgerChange({ id: 'cat', familyId: 'family-A' }, 'family-B')).toBe(false);
    });
    it('分类无法解析（undefined）→ 保守保留', () => {
      expect(shouldKeepCategoryOnLedgerChange(undefined, 'family-B')).toBe(true);
    });
  });

  describe('bucketRepresentativeTime', () => {
    it('dawn: midpoint of 0-6 → 03:00', () => {
      const { hour, minute } = bucketRepresentativeTime('dawn');
      expect(hour).toBe(3);
      expect(minute).toBe(0);
    });
    it('morning: midpoint of 6-12 → 09:00', () => {
      const { hour, minute } = bucketRepresentativeTime('morning');
      expect(hour).toBe(9);
      expect(minute).toBe(0);
    });
    it('afternoon: midpoint of 12-18 → 15:00', () => {
      const { hour, minute } = bucketRepresentativeTime('afternoon');
      expect(hour).toBe(15);
      expect(minute).toBe(0);
    });
    it('night: midpoint of 18-24 → 21:00', () => {
      const { hour, minute } = bucketRepresentativeTime('night');
      expect(hour).toBe(21);
      expect(minute).toBe(0);
    });
  });

  describe('isVersionConflict', () => {
    it('status 409', () => {
      expect(isVersionConflict({ status: 409 })).toBe(true);
    });
    it('code VERSION_CONFLICT', () => {
      expect(isVersionConflict({ code: 'VERSION_CONFLICT' })).toBe(true);
    });
    it('both', () => {
      expect(isVersionConflict({ status: 409, code: 'VERSION_CONFLICT' })).toBe(true);
    });
    it('other error', () => {
      expect(isVersionConflict({ status: 400, code: 'INVALID_ARGUMENT' })).toBe(false);
    });
    it('null/undefined', () => {
      expect(isVersionConflict(null)).toBe(false);
      expect(isVersionConflict(undefined)).toBe(false);
    });
  });

  describe('findNearestSelectedMonth', () => {
    it('empty → 1', () => {
      expect(findNearestSelectedMonth([])).toBe(1);
    });
    it('single month → that month', () => {
      expect(findNearestSelectedMonth([315])).toBe(3); // 3*100+15
    });
    it('multiple months → smallest', () => {
      expect(findNearestSelectedMonth([510, 315, 720])).toBe(3);
    });
  });

  describe('constants', () => {
    it('DOM_MAX is 14', () => {
      expect(DOM_MAX).toBe(14);
    });
    it('YEARLY_MAX is 12', () => {
      expect(YEARLY_MAX).toBe(12);
    });
  });

  describe('computePreviewNextRun · start_date=today + window already entered', () => {
    // 2026-08-07 周五。afternoon 窗口 = 12:00~17:59，代表时点 15:00。

    it('daily · 起始日=今天 + now 已进入下午窗口 → 跳过今天，预览 = interval 天后', () => {
      // now=13:02（已进入下午窗口 12:00~17:59）→ 跳过今天 → 8/9
      const now = new Date('2026-08-07T13:02:00+08:00');
      const result = computePreviewNextRun({
        period: 'daily',
        periodInterval: 2,
        bucket: 'afternoon',
        startDate: '2026-08-07',
        daysOfWeek: [],
        daysOfMonth: [],
        yearMonthDays: [],
        timezone: 'Asia/Shanghai',
      }, now);
      expect(result).not.toBeNull();
      expect(result!.dateStr).toBe('2026-08-09');
    });

    it('daily · 起始日=今天 + now 在窗口之前 → 今天触发', () => {
      // now=07:00（早上，下午窗口还没开始）→ 今天会触发
      const now = new Date('2026-08-07T07:00:00+08:00');
      const result = computePreviewNextRun({
        period: 'daily',
        periodInterval: 2,
        bucket: 'afternoon',
        startDate: '2026-08-07',
        daysOfWeek: [],
        daysOfMonth: [],
        yearMonthDays: [],
        timezone: 'Asia/Shanghai',
      }, now);
      expect(result).not.toBeNull();
      expect(result!.dateStr).toBe('2026-08-07');
    });

    it('weekly · 起始日=今天且今天匹配 + now 已进入下午窗口 → 跳过今天，预览 = 下一个匹配日', () => {
      // 2026-08-07 周五（weekday=5）。days_of_week=[5]。now=13:02 → 跳过今天 → 下周五 8/14
      const now = new Date('2026-08-07T13:02:00+08:00');
      const result = computePreviewNextRun({
        period: 'weekly',
        periodInterval: 1,
        bucket: 'afternoon',
        startDate: '2026-08-07',
        daysOfWeek: [5],
        daysOfMonth: [],
        yearMonthDays: [],
        timezone: 'Asia/Shanghai',
      }, now);
      expect(result).not.toBeNull();
      expect(result!.dateStr).toBe('2026-08-14');
    });

    it('weekly · 起始日=今天且今天匹配 + now 在窗口之前 → 今天触发', () => {
      // now=07:00（早上，下午窗口还没开始）→ 今天会触发
      const now = new Date('2026-08-07T07:00:00+08:00');
      const result = computePreviewNextRun({
        period: 'weekly',
        periodInterval: 1,
        bucket: 'afternoon',
        startDate: '2026-08-07',
        daysOfWeek: [5],
        daysOfMonth: [],
        yearMonthDays: [],
        timezone: 'Asia/Shanghai',
      }, now);
      expect(result).not.toBeNull();
      expect(result!.dateStr).toBe('2026-08-07');
    });

    it('monthly · 起始日=今天且今天匹配 + now 已进入窗口 → 跳过今天，预览 = 下月', () => {
      // 2026-08-07。days_of_month=[7]。now=14:00 → 跳过今天 → 9/7
      const now = new Date('2026-08-07T14:00:00+08:00');
      const result = computePreviewNextRun({
        period: 'monthly',
        periodInterval: 1,
        bucket: 'afternoon',
        startDate: '2026-08-07',
        daysOfWeek: [],
        daysOfMonth: [7],
        yearMonthDays: [],
        timezone: 'Asia/Shanghai',
      }, now);
      expect(result).not.toBeNull();
      expect(result!.dateStr).toBe('2026-09-07');
    });

    it('起始日在未来 → 从起始日起算（不受窗口已进入影响）', () => {
      // now=2026-08-07 13:02，start_date=2026-08-15（未来）→ 不进入 isToday 分支
      const now = new Date('2026-08-07T13:02:00+08:00');
      const result = computePreviewNextRun({
        period: 'daily',
        periodInterval: 1,
        bucket: 'afternoon',
        startDate: '2026-08-15',
        daysOfWeek: [],
        daysOfMonth: [],
        yearMonthDays: [],
        timezone: 'Asia/Shanghai',
      }, now);
      expect(result).not.toBeNull();
      expect(result!.dateStr).toBe('2026-08-15');
    });
  });
});
