// pages-recurring/list/model.ts · 列表页纯函数/可测逻辑
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import type { RecurringRule, RecurringPeriod } from '../../services/recurringApi';
import { toYuan } from '../../utils/money';
import { formatDaysForSummary, type FormatContext } from '../../services/recurringFormat';
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
   * 已禁用/自动停用行的原因短文案，例如"已禁用"、"账本已删除"、"已退出家庭"。
   * status === 'active' 时为空。
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
  dawn: '凌晨', morning: '早上', afternoon: '下午', night: '晚上',
};

/**
 * 把服务端返回的 status + last_run_status 翻译为一句给用户看的原因短语。
 * 供 UI 在"已禁用"分组中区分「用户主动禁用」和「系统兜底停用」的具体原因。
 */
export function buildStatusHint(r: Pick<RecurringRule, 'status' | 'last_run_status'>): string {
  if (r.status === 'active') return '';
  if (r.status === 'ended') return '已到期';
  if (r.status === 'paused') return '已禁用';
  // auto_paused：解析 last_run_status
  switch (r.last_run_status) {
    case 'failed_ledger_deleted':
      return '账本已删除';
    case 'failed_family_deleted':
      return '所在家庭已解散';
    case 'failed_user_left_family':
      return '你已退出该家庭';
    case 'auto_paused_after_3_failures':
      return '连续失败已停用';
    default:
    return '已自动停用';
  }
}

// ─── 纯函数 ──────────────────────────────────────────────────────────────────

export function buildPeriodLabel(period: RecurringPeriod): string {
  switch (period) {
    case 'weekly': return '每周';
    case 'biweekly': return '每两周';
    case 'monthly': return '每月';
    case 'bimonthly': return '每两月';
    case 'trimonthly': return '每三月';
    case 'yearly': return '每年';
    default: return '';
  }
}

export function toDisplayRule(
  r: RecurringRule,
  categories: CategoryItem[],
  families: FamilyItem[],
): DisplayRule {
  const cat = categories.find((c) => c.id === r.category_id);
  const categoryIcon = cat?.icon || '📝';
  const title = r.note || cat?.name || '未分类';

  const ctx: FormatContext = {
    period: r.period,
    mode: 'compact',
    days_of_week: r.days_of_week,
    days_of_month: r.days_of_month,
    year_month_days: r.year_month_days,
  };
  const periodDesc = buildPeriodLabel(r.period) + ' ' + formatDaysForSummary(ctx);
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
    summaryText = `你已设置 ${total} 条定时`;
  } else if (disabledCount === total) {
    summaryText = `你的 ${total} 条定时全部处于禁用状态`;
  } else {
    summaryText = `你已设置 ${total} 条定时（${disabledCount} 条已禁用）`;
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
