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
