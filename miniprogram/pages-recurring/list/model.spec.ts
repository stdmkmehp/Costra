// pages-recurring/list/model.spec.ts · 列表页纯函数单测
// 卡号占位：COSTRA-5xx（T3）
// Refs: COSTRA-5xx

import { describe, it, expect } from 'vitest';
import { groupRules, clampMenuPosition, buildPeriodLabel, buildStatusHint } from './model';
import type { RecurringRule } from '../../services/recurringApi';

function makeRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'r1',
    ledger_id: 'l1',
    created_by: 'u1',
    type: 'expense',
    amount: 1000,
    currency: 'CNY',
    category_id: null,
    account_id: null,
    to_account_id: null,
    note: null,
    shared_type: null,
    period: 'weekly',
    days_of_week: [1, 3, 5],
    days_of_month: null,
    year_month_days: null,
    execute_bucket: 'morning',
    execute_hour: 9,
    execute_minute: 0,
    timezone: 'Asia/Shanghai',
    start_date: '2026-01-01',
    end_date: null,
    status: 'active',
    next_run_at: '2026-01-06T01:00:00.000Z',
    last_run_at: null,
    last_run_status: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('list/model', () => {
  describe('groupRules', () => {
    it('empty rules → empty groups, empty summary', () => {
      const { enabled, disabled, summary } = groupRules([], [], []);
      expect(enabled).toHaveLength(0);
      expect(disabled).toHaveLength(0);
      expect(summary.total).toBe(0);
      expect(summary.summaryText).toBe('');
    });

    it('all active → only enabled group', () => {
      const rules = [makeRule({ id: 'r1' }), makeRule({ id: 'r2' })];
      const { enabled, disabled, summary } = groupRules(rules, [], []);
      expect(enabled).toHaveLength(2);
      expect(disabled).toHaveLength(0);
      expect(summary.summaryText).toContain('2 条定时');
    });

    it('mixed → correct grouping and summary', () => {
      const rules = [
        makeRule({ id: 'r1', status: 'active' }),
        makeRule({ id: 'r2', status: 'paused' }),
        makeRule({ id: 'r3', status: 'active' }),
      ];
      const { enabled, disabled, summary } = groupRules(rules, [], []);
      expect(enabled).toHaveLength(2);
      expect(disabled).toHaveLength(1);
      expect(summary.disabledCount).toBe(1);
      expect(summary.summaryText).toContain('1 条已禁用');
    });

    it('all disabled → specific summary', () => {
      const rules = [makeRule({ id: 'r1', status: 'paused' })];
      const { summary } = groupRules(rules, [], []);
      expect(summary.summaryText).toContain('全部处于禁用状态');
    });
  });

  describe('clampMenuPosition', () => {
    it('center position stays unchanged', () => {
      const { x, y } = clampMenuPosition(200, 300, 400, 800);
      expect(x).toBe(200);
      expect(y).toBe(300);
    });

    it('right overflow clamped', () => {
      const { x } = clampMenuPosition(390, 300, 400, 800);
      expect(x).toBeLessThan(390);
    });

    it('bottom overflow clamped', () => {
      const { y } = clampMenuPosition(200, 750, 400, 800);
      expect(y).toBeLessThan(750);
    });
  });

  describe('buildPeriodLabel', () => {
    it('weekly → 每周', () => expect(buildPeriodLabel('weekly')).toBe('每周'));
    it('biweekly → 每两周', () => expect(buildPeriodLabel('biweekly')).toBe('每两周'));
    it('monthly → 每月', () => expect(buildPeriodLabel('monthly')).toBe('每月'));
    it('yearly → 每年', () => expect(buildPeriodLabel('yearly')).toBe('每年'));
  });

  describe('buildStatusHint', () => {
    it('active → 空文案', () => {
      expect(buildStatusHint({ status: 'active', last_run_status: null })).toBe('');
    });
    it('paused → 已禁用', () => {
  expect(buildStatusHint({ status: 'paused', last_run_status: null })).toBe('已禁用');
    });
    it('ended → 已到期', () => {
      expect(buildStatusHint({ status: 'ended', last_run_status: 'ok' })).toBe('已到期');
    });
    it('auto_paused · 账本被删 → 账本已删除', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'failed_ledger_deleted' }))
 .toBe('账本已删除');
    });
    it('auto_paused · 家庭解散 → 所在家庭已解散', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'failed_family_deleted' }))
     .toBe('所在家庭已解散');
    });
    it('auto_paused · 用户退出家庭 → 你已退出该家庭', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'failed_user_left_family' }))
        .toBe('你已退出该家庭');
    });
    it('auto_paused · 连续失败 3 次 → 连续失败已停用', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'auto_paused_after_3_failures' }))
        .toBe('连续失败已停用');
    });
    it('auto_paused · 未知原因 → 已自动停用', () => {
    expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'anything_else' }))
        .toBe('已自动停用');
    });
  });
});
