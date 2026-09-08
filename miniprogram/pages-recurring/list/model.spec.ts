// pages-recurring/list/model.spec.ts · 列表页纯函数单测
// 卡号占位：COSTRA-5xx（T3）
// Refs: COSTRA-5xx

import { describe, it, expect } from 'vitest';
import { groupRules, clampMenuPosition, buildPeriodLabel, buildStatusTag, buildStatusHint, toDisplayRule } from './model';
import { ICON_GLYPH } from '../../services/iconMap';
import type { RecurringRule } from '../../services/recurringApi';
import type { CategoryItem } from '../../services/categoryService';
import type { FamilyItem } from '../../services/familyApi';

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
    period_interval: 1,
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
    // 窗口 400×800，rpxToPx = 400/750 ≈ 0.5333
    // menuW = 320 × 0.5333 ≈ 170.67, menuH = 408 × 0.5333 ≈ 217.6
    it('居中触点：left = x - menuW/2，向下展开 top = y', () => {
      const { left, top } = clampMenuPosition(200, 300, 400, 800, 0);
      // left = 200 - 170.67/2 ≈ 114.67
      expect(left).toBeCloseTo(114.67, 1);
      // 下方空间 800-300=500 > menuH+margin，向下展开
      expect(top).toBe(300);
    });

    it('右溢出：left 被 clamp 到 winW - menuW - margin', () => {
      const { left } = clampMenuPosition(390, 300, 400, 800, 0);
      // 左上角 left = 390 - 85.33 ≈ 304.67 > 400 - 170.67 - 12 ≈ 217.33 → clamp 到 217.33
      expect(left).toBeCloseTo(217.33, 1);
      expect(left).toBeLessThan(390);
    });

    it('左溢出：left 被 clamp 到 margin', () => {
      const { left } = clampMenuPosition(10, 300, 400, 800, 0);
      // left = 10 - 80 = -70 < 12 → clamp 到 12
      expect(left).toBe(12);
    });

    it('下溢出：下方空间不足时向上翻转，top = y - menuH', () => {
      const { top } = clampMenuPosition(200, 750, 400, 800, 0);
      // 750 + 217.6 + 12 > 800 → 向上翻转 top = 750 - 217.6 = 532.4
      expect(top).toBeLessThan(750);
      expect(top).toBeCloseTo(750 - 408 * (400 / 750), 1);
    });

    it('上边界保护：top 不低于 statusBarHeight + 8', () => {
      const { top } = clampMenuPosition(200, 50, 400, 800, 44);
      // 向上翻转 top = 50 - 217.6 = -167.6 < 44+8=52 → clamp 到 52
      expect(top).toBe(52);
    });
  });

  describe('buildPeriodLabel', () => {
    it('weekly → 每周', () => expect(buildPeriodLabel('weekly')).toBe('每周'));
    it('weekly + interval=2 → 每两周', () => expect(buildPeriodLabel('weekly', 2)).toBe('每2周'));
    it('monthly → 每月', () => expect(buildPeriodLabel('monthly')).toBe('每月'));
    it('yearly → 每年', () => expect(buildPeriodLabel('yearly')).toBe('每年'));
    it('workday → 每个工作日', () => expect(buildPeriodLabel('workday')).toBe('每个工作日'));
    it('daily → 每天', () => expect(buildPeriodLabel('daily')).toBe('每天'));
    it('daily + interval=3 → 每3天', () => expect(buildPeriodLabel('daily', 3)).toBe('每3天'));
  });

  describe('buildStatusTag', () => {
    it('active → 空文案', () => {
      expect(buildStatusTag({ status: 'active', last_run_status: null })).toBe('');
    });
    it('paused → 已禁用', () => {
      expect(buildStatusTag({ status: 'paused', last_run_status: null })).toBe('已禁用');
    });
    it('ended · 正常到期 → 已到期', () => {
      expect(buildStatusTag({ status: 'ended', last_run_status: 'ended_by_end_date' })).toBe('已到期');
    });
    it('ended · lapsed_in_window → 已失效（区别于已到期）', () => {
      expect(buildStatusTag({ status: 'ended', last_run_status: 'lapsed_in_window' })).toBe('已失效');
    });
    it('auto_paused · 账本被删 → 账本已删除', () => {
      expect(buildStatusTag({ status: 'auto_paused', last_run_status: 'failed_ledger_deleted' }))
        .toBe('账本已删除');
    });
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
    it('ended · lapsed_in_window · 无结束日 → 已失效', () => {
      expect(buildStatusHint({ status: 'ended', last_run_status: 'lapsed_in_window', end_date: null }))
        .toBe('已失效');
    });
    it('ended · lapsed_in_window · 附结束日 → 已失效（结束日 X 前已无执行点）', () => {
      expect(buildStatusHint({ status: 'ended', last_run_status: 'lapsed_in_window', end_date: '2026-08-06' }))
        .toBe('已失效（结束日 2026-08-06 前已无执行点）');
    });
    it('auto_paused · 账本被删 → 账本已删除', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'failed_ledger_deleted' }))
 .toBe('账本已删除');
    });
    it('auto_paused · 家庭解散 → 家庭已解散', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'failed_family_deleted' }))
     .toBe('家庭已解散');
    });
    it('auto_paused · 用户退出家庭 → 已退出家庭', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'failed_user_left_family' }))
        .toBe('已退出家庭');
    });
    it('auto_paused · 连续失败 3 次 → 连续失败停用', () => {
      expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'auto_paused_after_3_failures' }))
        .toBe('连续失败停用');
    });
    it('auto_paused · 未知原因 → 已自动停用', () => {
    expect(buildStatusHint({ status: 'auto_paused', last_run_status: 'anything_else' }))
        .toBe('已自动停用');
    });
  });

  describe('toDisplayRule · 分类图标与标题', () => {
    const family: FamilyItem = {
      id: 'fam1', name: 'F1', kind: 'shared', owner_id: 'u1',
      ledger_id: 'l1', ledger_name: '账本认',
      member_count: 1, created_at: '2026-01-01T00:00:00.000Z', version: 1,
    };
    const baseRule: RecurringRule = {
      id: 'r1', ledger_id: 'l1', created_by: 'u1',
      type: 'income', amount: 45500, currency: 'CNY',
      category_id: 'c-child', account_id: null, to_account_id: null,
      note: null, shared_type: null,
      period: 'monthly', period_interval: 1,
      days_of_week: null, days_of_month: [2, 4, 13], year_month_days: null,
      execute_bucket: 'night', execute_hour: 21, execute_minute: 0,
      timezone: 'Asia/Shanghai', start_date: '2026-01-01', end_date: null,
      status: 'active', next_run_at: '', last_run_at: null, last_run_status: null,
      created_at: '', updated_at: '', version: 1,
    };

    it('cat.icon 经 resolveIconGlyph 解析为 PUA 字形，不再渲染原始 key', () => {
      const categories: CategoryItem[] = [{
        id: 'c-child', familyId: 'fam1', name: '兼职', type: 'income',
        icon: 'part_time', sortOrder: 3, isSystem: true, parentId: 'c-parent',
        isDirectDefault: true, isParentDefault: false, displayOrder: 2, childrenCount: 0,
      }];
      const display = toDisplayRule(baseRule, categories, [family]);
      // 关键断言：渲染的字形等于 ICON_GLYPH['part_time']，绝不是 'part_time' 字符串
      expect(display.categoryIcon).toBe(ICON_GLYPH['part_time']);
      expect(display.categoryIcon).not.toBe('part_time');
    });

    it('二级分类标题为「父·子」，例：兼职 → 职业收入·兼职', () => {
      const categories: CategoryItem[] = [
        { id: 'c-parent', familyId: 'fam1', name: '职业收入', type: 'income',
          icon: 'salary', sortOrder: 1, isSystem: true, parentId: null,
          isDirectDefault: false, isParentDefault: true, displayOrder: null, childrenCount: 4 },
        { id: 'c-child', familyId: 'fam1', name: '兼职', type: 'income',
          icon: 'part_time', sortOrder: 3, isSystem: true, parentId: 'c-parent',
          isDirectDefault: true, isParentDefault: false, displayOrder: 2, childrenCount: 0 },
      ];
      const display = toDisplayRule(baseRule, categories, [family]);
      expect(display.title).toBe('职业收入·兼职');
    });

    it('无父级的一级分类，标题只显示子名', () => {
      const categories: CategoryItem[] = [{
        id: 'c-child', familyId: 'fam1', name: '转账', type: 'transfer',
        icon: 'transfer', sortOrder: 1, isSystem: true, parentId: null,
        isDirectDefault: true, isParentDefault: true, displayOrder: null, childrenCount: 3,
      }];
      const display = toDisplayRule(baseRule, categories, [family]);
      expect(display.title).toBe('转账');
      expect(display.categoryIcon).toBe(ICON_GLYPH['transfer']);
    });

    it('note 优先级高于分类名', () => {
      const ruleWithNote: RecurringRule = { ...baseRule, note: '收入定时' };
      const categories: CategoryItem[] = [{
        id: 'c-child', familyId: 'fam1', name: '兼职', type: 'income',
        icon: 'part_time', sortOrder: 3, isSystem: true, parentId: 'c-parent',
        isDirectDefault: true, isParentDefault: false, displayOrder: 2, childrenCount: 0,
      }];
      const display = toDisplayRule(ruleWithNote, categories, [family]);
      expect(display.title).toBe('收入定时');
    });

    it('无分类且无 note → 未分类', () => {
      const ruleNoCat: RecurringRule = { ...baseRule, category_id: null, note: null };
      const display = toDisplayRule(ruleNoCat, [], [family]);
      expect(display.title).toBe('未分类');
    });

    it('未知 icon_key 不崩，回退到「其他」字形', () => {
      const categories: CategoryItem[] = [{
        id: 'c-child', familyId: 'fam1', name: 'X', type: 'expense',
        icon: 'unknown_icon_key', sortOrder: 1, isSystem: true, parentId: null,
        isDirectDefault: true, isParentDefault: true, displayOrder: null, childrenCount: 0,
      }];
      const display = toDisplayRule(baseRule, categories, [family]);
      // resolveIconGlyph 兜底 → other
      expect(display.categoryIcon).toBe(ICON_GLYPH['other']);
    });
  });
});
