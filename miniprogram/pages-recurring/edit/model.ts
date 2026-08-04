// pages-recurring/edit/model.ts · 编辑页纯函数/可测逻辑
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import { DateTime } from 'luxon';
import { findFirstSelectedMonth } from '../../components/recurring-selection';
import type { RecurringPeriod, RecurringBucket } from '../../services/recurringApi';
import {
  computeNextRunAt,
  BUCKET_WINDOWS,
  type RecurringRuleForCompute,
} from '../../services/recurringSchedule';

// ─── 周期同组保留/跨组清空逻辑 ──────────────────────────────────────────────

const WEEK_GROUP: RecurringPeriod[] = ['weekly', 'biweekly'];
const MONTH_GROUP: RecurringPeriod[] = ['monthly', 'bimonthly', 'trimonthly'];

export function shouldClearDaysOnPeriodChange(
  oldPeriod: RecurringPeriod,
  newPeriod: RecurringPeriod,
): boolean {
  if (oldPeriod === newPeriod) return false;
  const oldInWeek = WEEK_GROUP.includes(oldPeriod);
  const newInWeek = WEEK_GROUP.includes(newPeriod);
  if (oldInWeek && newInWeek) return false;

  const oldInMonth = MONTH_GROUP.includes(oldPeriod);
  const newInMonth = MONTH_GROUP.includes(newPeriod);
  if (oldInMonth && newInMonth) return false;

  // yearly → yearly 不清（不可能 · 同值已排除）
  return true;
}

// ─── DOM 上限 ──────────────────────────────────────────────────────────────

export const DOM_MAX = 14;
export const YEARLY_MAX = 12;
export const DOW_MAX = 7;

// ─── 预览：bucket 代表时点 ──────────────────────────────────────────────────

/**
 * 根据 bucket 返回一个稳定的代表时点（窗口中点）
 * dawn: 03:00, morning: 09:00, afternoon: 15:00, night: 21:00
 */
export function bucketRepresentativeTime(bucket: RecurringBucket): { hour: number; minute: number } {
  const w = BUCKET_WINDOWS[bucket];
  const midMinutes = Math.floor((w.startHour * 60 + w.endHour * 60) / 2);
  return { hour: Math.floor(midMinutes / 60), minute: midMinutes % 60 };
}

// ─── 预览：下次执行日期计算 ──────────────────────────────────────────────────

export interface PreviewInput {
  period: RecurringPeriod;
  bucket: RecurringBucket;
  startDate: string;
  daysOfWeek: number[];
  daysOfMonth: number[];
  yearMonthDays: number[];
  timezone: string;
  /** 编辑已有规则时使用服务端的 execute_hour/minute */
  executeHour?: number;
  executeMinute?: number;
}

/**
 * 计算预览下次执行时间
 * - 编辑已有规则：使用服务端 execute_hour/minute
 * - 新建规则：使用 bucket 窗口的稳定代表时点
 * - 日期按 rule timezone 格式化（不是宿主本地时区）
 */
export function computePreviewNextRun(
  input: PreviewInput,
  now: Date,
): { dateStr: string; timeStr: string } | null {
  const { period, bucket, startDate, daysOfWeek, daysOfMonth, yearMonthDays, timezone } = input;

  // 确定 execute hour/minute
  let hour: number;
  let minute: number;
  if (input.executeHour !== undefined && input.executeMinute !== undefined) {
    hour = input.executeHour;
    minute = input.executeMinute;
  } else {
    const rep = bucketRepresentativeTime(bucket);
    hour = rep.hour;
    minute = rep.minute;
  }

  const rule: RecurringRuleForCompute = {
    period,
    timezone,
    start_date: startDate,
    execute_hour: hour,
    execute_minute: minute,
    days_of_week: daysOfWeek.length > 0 ? daysOfWeek : null,
    days_of_month: daysOfMonth.length > 0 ? daysOfMonth : null,
    year_month_days: yearMonthDays.length > 0 ? yearMonthDays : null,
  };

  try {
    const next = computeNextRunAt(rule, now);
    // 按 rule timezone 格式化日期（不用宿主本地时区）
    // 使用简单 UTC offset 计算（避免引入 luxon 到 model 层）
    const formatted = formatDateInTimezone(next, timezone);
    return formatted;
  } catch {
    return null;
  }
}

/**
 * 简单日期格式化：在指定时区下格式化日期和时间
 * 输出 dateStr: "YYYY-MM-DD", timeStr: bucket label
 */
function formatDateInTimezone(
  date: Date,
  timezone: string,
): { dateStr: string; timeStr: string } {
  const zoned = DateTime.fromJSDate(date, { zone: timezone });
  if (!zoned.isValid) return { dateStr: '—', timeStr: '' };
  return { dateStr: zoned.toFormat('yyyy-MM-dd'), timeStr: '' };
}

// ─── 409 判定 ──────────────────────────────────────────────────────────────

export function isVersionConflict(e: any): boolean {
  return e?.status === 409 || e?.code === 'VERSION_CONFLICT';
}

// ─── Yearly 默认定位 ──────────────────────────────────────────────────────────

/**
 * 给定已选 yearMonthDays 数组，返回最近有选中项的月份（若无则 1 月）
 */
export function findNearestSelectedMonth(yearMonthDays: number[]): number {
  return findFirstSelectedMonth(yearMonthDays);
}
