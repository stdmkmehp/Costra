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

// ─── 账本切换时分类保留判定 ────────────────────────────────────────────────────

/**
 * 切换账本后是否应保留当前已选分类。
 *
 * 判定依据（对齐产品设计）：
 *   - 系统预设分类（familyId===null）所有账本通用 → 保留；
 *   - 家庭自定义分类仅在其所属家庭有效 → 仅当属于目标家庭（familyId === targetFamilyId）才保留；
 *   - 分类信息无法解析（currentCategory 为 undefined）→ 保守保留，避免误删用户已选分类。
 *
 * 注意：不能用"目标家庭的全量分类是否含该 id"来判定——分类数据内存缓存只保留单个家庭，
 * 跨家庭读取会退化为系统预设 fallback，从而把家庭自定义分类误判为不存在而错误重置。
 *
 * @param currentCategory 当前选中的分类（含 id 与归属 familyId）
 * @param targetFamilyId  切换后目标家庭 ID
 */
export function shouldKeepCategoryOnLedgerChange(
  currentCategory: { id: string; familyId: string | null } | undefined,
  targetFamilyId: string,
): boolean {
  if (!currentCategory) return true; // 无法判定 → 保守保留
  if (currentCategory.familyId === null) return true; // 系统预设 · 通用
  return currentCategory.familyId === targetFamilyId; // 家庭自定义 · 仅限所属家庭
}

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
    // 与后端 create 逻辑同步：起始日=今天时，判断当前时刻是否已进入 bucket 窗口
    // (1) 当前时刻 < 窗口起点 → 今天会触发（从 start_date 00:00 起算）
    // (2) 当前时刻 >= 窗口起点 → 跳过今天（从 now 起算）
    const nowZ = DateTime.fromJSDate(now, { zone: timezone });
    const startDateZ = DateTime.fromISO(startDate, { zone: timezone }).startOf('day');
    const isToday = nowZ.hasSame(startDateZ, 'day');
    const computeFrom = isToday
      ? (() => {
          const window = BUCKET_WINDOWS[bucket];
          const windowStartToday = nowZ.set({ hour: window.startHour, minute: 0, second: 0, millisecond: 0 });
          // 当前时刻已进入或超过 bucket 窗口起点 → 从 now 起算（跳过今天）
          if (nowZ >= windowStartToday) return now;
          // 窗口还没开始 → 从 start_date 00:00 起算（今天触发）
          return startDateZ.minus({ minutes: 1 }).toJSDate();
        })()
      : startDateZ.minus({ minutes: 1 }).toJSDate();

    const next = computeNextRunAt(rule, computeFrom);
    // 按 rule timezone 格式化日期（不用宿主本地时区）
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
