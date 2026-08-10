// pages/statistics/formatters.ts · 统计页格式化工具函数
// 卡号: COSTRA-264 · P0 拆分 index.ts 低于 1000 行
// Refs: COSTRA-264

import { toYuan } from '../../utils/money';

/** cents → 元（带千分位） */
export function fmtAmount(cents: number): string {
  const yuanStr = toYuan(Math.abs(cents));
  const parts = yuanStr.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intPart}.${parts[1]}`;
}

/** cents → ¥X,XXX.XX（含负号） */
export function fmtYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}¥${fmtAmount(cents)}`;
}

/** 支出金额专用：cents → -¥X,XXX.XX（始终带负号前缀，0 时显示 ¥0.00） */
export function fmtExpense(cents: number): string {
  if (cents === 0) return '¥0.00';
  return `-¥${fmtAmount(cents)}`;
}

/** 万分比 → 百分比文本，如 4250 → "42.5%"；整数时省略小数，如 10000 → "100%" */
export function fmtRatio(bps: number): string {
  const pct = bps / 100;
  return pct === Math.floor(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function getCurrentYearValue(): string {
  return `${new Date().getFullYear()}`;
}

export function formatMonthDisplay(value: string): string {
  const parts = value.split('-');
  return `${parts[0]}年${parseInt(parts[1], 10)}月`;
}

export function formatYearDisplay(value: string): string {
  return `${value}年`;
}

export function prevMonth(value: string): string {
  const [y, m] = value.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function nextMonth(value: string): string {
  const [y, m] = value.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function prevYear(v: string): string { return `${parseInt(v, 10) - 1}`; }
export function nextYear(v: string): string { return `${parseInt(v, 10) + 1}`; }

/** 判断给定月份值是否为本机当前自然月 */
export function isCurrentMonth(value: string): boolean {
  return value === getCurrentMonthValue();
}

/** 判断给定年份值是否为本机当前自然年 */
export function isCurrentYear(value: string): boolean {
  return value === getCurrentYearValue();
}

/** 构造空态标题：当前月/年简洁展示，历史/未来带时间提醒 */
export function buildEmptyTitleMonth(monthValue: string): string {
  return isCurrentMonth(monthValue) ? '暂无记录' : `${formatMonthDisplay(monthValue)} 暂无记录`;
}

export function buildEmptyTitleYear(yearValue: string): string {
  return isCurrentYear(yearValue) ? '暂无记录' : `${formatYearDisplay(yearValue)} 暂无记录`;
}

/** ISO UTC → 6月3日 (Asia/Shanghai) */
export function formatEntryDate(isoUtc: string): string {
  const utc = new Date(isoUtc);
  const sh = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  return `${sh.getUTCMonth() + 1}月${sh.getUTCDate()}日`;
}

/** ISO UTC → 14:30 (Asia/Shanghai · 24 小时制) */
export function formatEntryTime(isoUtc: string): string {
  const utc = new Date(isoUtc);
  const sh = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  return `${String(sh.getUTCHours()).padStart(2, '0')}:${String(sh.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 构造"最大单笔"摘要格的展示文本：`金额 · 备注`。
 * - 有备注 → `金额 · 备注`（超长由 CSS ellipsis 兜底截断）
 * - 无备注但有二级分类名 → `金额 · 分类名`
 * - 都无（或无支出） → 仅金额
 */
export function buildMaxSingleLabel(
  amountCents: number,
  note: string | null,
  categoryName: string | null,
): string {
  const amount = fmtYuan(amountCents);
  const label = note || categoryName;
  return label ? `${amount} · ${label}` : amount;
}
