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
  if (period === 'daily') {
    return interval === 1 ? '每天' : `每${interval}天`;
  }
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
 * 菜单位置自适应：参照明细页长按菜单的逻辑，根据触点坐标计算菜单左上角位置。
 *
 * - 菜单尺寸通过 rpx → px 换算（与 .ctx-menu CSS 保持同步），而非硬编码 px 值。
 * - 水平方向：菜单居中于触点，左右 clamp 防溢出。
 * - 垂直方向：优先向下展开（菜单顶部对齐触点），下方空间不足时向上翻转（菜单底部对齐触点）。
 * - 上边界保护：不低于 statusBarHeight + 8，避免被状态栏/导航栏遮挡。
 *
 * @param x           触点 clientX
 * @param y           触点 clientY
 * @param windowWidth 窗口宽度（px），用于 rpx→px 换算
 * @param windowHeight 窗口高度（px）
 * @param statusBarHeight 状态栏高度（px），用于上边界保护
 * @returns 菜单左上角坐标 { left, top }（px）
 */
export function clampMenuPosition(
  x: number,
  y: number,
  windowWidth: number,
  windowHeight: number,
  statusBarHeight = 0,
): { left: number; top: number } {
  const rpxToPx = (windowWidth || 375) / 750;
  // 菜单尺寸须与 styles/ctx-menu.wxss .ctx-menu 保持同步：
  // 宽 300rpx；高 = 4×96rpx item + 上下 padding 8rpx×2 + 删除项 margin 6rpx = 408rpx
  const menuW = 300 * rpxToPx;
  const menuH = 408 * rpxToPx;
  const margin = 12;

  // 水平：居中于触点，边界收拢防溢出
  let left = x - menuW / 2;
  if (left < margin) left = margin;
  if (left > windowWidth - menuW - margin) left = windowWidth - menuW - margin;

  // 垂直：优先向下展开，下方空间不足则向上翻转
  let top = y + menuH + margin <= windowHeight ? y : y - menuH;
  const minTop = statusBarHeight + 8;
  if (top < minTop) top = minTop;
  if (top > windowHeight - menuH - margin) top = windowHeight - menuH - margin;

  return { left, top };
}
