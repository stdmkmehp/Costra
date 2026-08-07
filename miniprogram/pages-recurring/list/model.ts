// pages-recurring/list/model.ts · 列表页纯函数/可测逻辑
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import type { RecurringRule, RecurringPeriod } from '../../services/recurringApi';
import { toYuan } from '../../utils/money';
import { formatDaysForSummary, type FormatContext } from '../../services/recurringFormat';
import { resolveIconGlyph } from '../../services/iconMap';
import type { CategoryItem } from '../../services/categoryService';
import type { FamilyItem } from '../../services/familyApi';

// ─── 辅助类型 ──────────────────────────────────────────────────────────────

export interface DisplayRule {
  id: string;
  categoryIcon: string;
  title: string;
  subtitle: string;
  amountText: string;
  isDisabled: boolean;
  status: string;
  /**
   * 行首状态 tag 短标签，例如"已禁用"、"已到期"、"已失效"、"账本已删除"。
   * status === 'active' 时为空。用于列表行首醒目位置。
   */
  statusTag: string;
  /**
   * 完整原因文案（可能比 statusTag 更长，例如"已失效（结束日 X 前已无执行点）"）。
   * 供长按/详情等需要更完整说明的场景使用；status === 'active' 时为空。
   */
  statusHint: string;
  version: number;
  raw: RecurringRule;
}

export interface ListSummary {
  total: number;
  enabledCount: number;
  disabledCount: number;
  summaryText: string;
}

const BUCKET_LABELS: Record<string, string> = {
  dawn: '凌晨', morning: '上午', afternoon: '下午', night: '夜晚',
};

/**
 * 把服务端返回的 status + last_run_status 翻译为一句给用户看的「状态短标签」。
 * 供列表行首醒目位置使用；status === 'active' 时为空。
 */
export function buildStatusTag(r: Pick<RecurringRule, 'status' | 'last_run_status'>): string {
  if (r.status === 'active') return '';
  if (r.status === 'ended') {
    // ended 但 last_run_status 标记了"窗口内已无有效执行点"（结束日未到但
    // 下一次执行已越过）→ 归为"已失效"，区别于真正到期的"已到期"。
    return r.last_run_status === 'lapsed_in_window' ? '已失效' : '已到期';
  }
  if (r.status === 'paused') return '已禁用';
  // auto_paused：解析 last_run_status
  switch (r.last_run_status) {
    case 'failed_ledger_deleted':
      return '账本已删除';
    case 'failed_family_deleted':
      return '家庭已解散';
    case 'failed_user_left_family':
      return '已退出家庭';
    case 'auto_paused_after_3_failures':
      return '连续失败停用';
    default:
    return '已自动停用';
  }
}

/**
 * 完整原因文案（可能比 statusTag 更长）。status === 'active' 时为空。
 * 供需要更完整说明的场景（如"已失效"附结束日）使用。
 */
export function buildStatusHint(
  r: Pick<RecurringRule, 'status' | 'last_run_status'> & { end_date?: string | null },
): string {
  if (r.status === 'active') return '';
  if (r.status === 'ended' && r.last_run_status === 'lapsed_in_window') {
    return r.end_date ? `已失效（结束日 ${r.end_date} 前已无执行点）` : '已失效';
  }
  return buildStatusTag(r);
}

// ─── 纯函数 ──────────────────────────────────────────────────────────────────

export function buildPeriodLabel(period: RecurringPeriod, periodInterval?: number): string {
  const interval = periodInterval || 1;
  if (period === 'yearly') return '每年';
  if (period === 'weekly') {
    return interval === 1 ? '每周' : `每${interval}周`;
  }
  if (period === 'monthly') {
    return interval === 1 ? '每月' : `每${interval}月`;
  }
  if (period === 'workday') return '每个工作日';
  return '';
}

export function toDisplayRule(
  r: RecurringRule,
  categories: CategoryItem[],
  families: FamilyItem[],
): DisplayRule {
  const cat = categories.find((c) => c.id === r.category_id);
  const catParent = cat?.parentId ? categories.find((c) => c.id === cat.parentId) : null;
  // icon_key 必须经 resolveIconGlyph 解析为 PUA 字形；否则会直接渲染 "part_time" 这类 key 文本。
  const categoryIcon = resolveIconGlyph(cat?.icon);
  // 标题：二级 · 一级，例如「兼职 · 职业收入」；没有父级时只显示二级名。
  const title = r.note || (cat ? (catParent ? `${catParent.name}·${cat.name}` : cat.name) : '未分类');

  const ctx: FormatContext = {
    period: r.period,
    mode: 'compact',
    days_of_week: r.days_of_week,
    days_of_month: r.days_of_month,
    year_month_days: r.year_month_days,
  };
  const dayDesc = formatDaysForSummary(ctx);
  // workday 的 dayDesc 已是完整描述（"每个工作日"）· 前缀留空避免重复
  const periodPrefix = r.period === 'workday' ? '' : buildPeriodLabel(r.period, r.period_interval);
  const periodDesc = `${periodPrefix} ${dayDesc}`.trim();
  const bucketLabel = BUCKET_LABELS[r.execute_bucket] || '';
  const ledgerName = families.find((f) => f.ledger_id === r.ledger_id)?.ledger_name || '';
  const parts = [periodDesc, bucketLabel, ledgerName].filter(Boolean);
  const subtitle = parts.join(' · ');

  const yuan = toYuan(r.amount);
  let amountText = '';
  if (r.type === 'expense') amountText = `-¥ ${yuan}`;
  else if (r.type === 'income') amountText = `+¥ ${yuan}`;
  else amountText = `¥ ${yuan}`;

  return {
    id: r.id,
    categoryIcon,
    title,
 subtitle,
    amountText,
  isDisabled: r.status !== 'active',
  status: r.status,
    statusTag: buildStatusTag(r),
    statusHint: buildStatusHint(r),
    version: r.version,
    raw: r,
  };
}

export function groupRules(
  rules: RecurringRule[],
  categories: CategoryItem[],
  families: FamilyItem[],
): { enabled: DisplayRule[]; disabled: DisplayRule[]; summary: ListSummary } {
  const enabled: DisplayRule[] = [];
  const disabled: DisplayRule[] = [];

  for (const r of rules) {
    const display = toDisplayRule(r, categories, families);
    if (r.status === 'active') {
      enabled.push(display);
    } else {
      disabled.push(display);
    }
  }

  const total = rules.length;
  const disabledCount = disabled.length;
  const enabledCount = enabled.length;
  let summaryText = '';
  if (total === 0) {
    summaryText = '';
  } else if (disabledCount === 0) {
    summaryText = `你已设置 ${total} 条定时规则`;
  } else if (disabledCount === total) {
    summaryText = `你的 ${total} 条定时规则全部处于禁用状态`;
  } else {
    summaryText = `你已设置 ${total} 条定时规则（${disabledCount} 条已禁用）`;
  }

  return { enabled, disabled, summary: { total, enabledCount, disabledCount, summaryText } };
}

/**
 * 屏幕边界 clamp：确保菜单不超出可视区域
 */
export function clampMenuPosition(
  x: number,
  y: number,
  windowWidth: number,
  windowHeight: number,
  menuWidth = 140,
  menuHeight = 200,
): { x: number; y: number } {
  const margin = 12;
  let cx = x;
  let cy = y;
  // 右边界
  if (cx + menuWidth / 2 > windowWidth - margin) {
    cx = windowWidth - margin - menuWidth / 2;
  }
  // 左边界
  if (cx - menuWidth / 2 < margin) {
    cx = margin + menuWidth / 2;
  }
  // 下边界
  if (cy + menuHeight > windowHeight - margin) {
    cy = windowHeight - margin - menuHeight;
  }
  // 上边界
  if (cy < margin) {
    cy = margin;
  }
  return { x: cx, y: cy };
}
