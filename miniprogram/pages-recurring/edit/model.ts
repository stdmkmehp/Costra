// pages-recurring/edit/model.ts · 编辑页纯函数/可测逻辑
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import { DateTime } from 'luxon';
import { findFirstSelectedMonth } from '../../components/recurring-selection';
import type { RecurringPeriod, RecurringBucket } from '../../services/recurringApi';
import type { WorkdayData } from '../../services/workdayApi';
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

const WEEK_GROUP: RecurringPeriod[] = ['weekly'];
const MONTH_GROUP: RecurringPeriod[] = ['monthly'];

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

  // 切换进/出 workday / daily → 跨组 · 清空已选日子（两档均无日子概念）
  if (oldPeriod === 'workday' || newPeriod === 'workday') return true;
  if (oldPeriod === 'daily' || newPeriod === 'daily') return true;

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
  periodInterval: number;
  bucket: RecurringBucket;
  startDate: string;
  daysOfWeek: number[];
  daysOfMonth: number[];
  yearMonthDays: number[];
  timezone: string;
  /** 编辑已有规则时使用服务端的 execute_hour/minute */
  executeHour?: number;
  executeMinute?: number;
  /** workday 周期的节假日数据（编辑页预加载传入）· 按年份组织 · 某年缺失降级周一~周五 */
  workdayData?: WorkdayData[];
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
    period_interval: input.periodInterval,
    timezone,
    start_date: startDate,
    execute_hour: hour,
    execute_minute: minute,
    days_of_week: daysOfWeek.length > 0 ? daysOfWeek : null,
    days_of_month: daysOfMonth.length > 0 ? daysOfMonth : null,
    year_month_days: yearMonthDays.length > 0 ? yearMonthDays : null,
    workday_data: input.workdayData ?? [],
  };

  try {
    const nowZ = DateTime.fromJSDate(now, { zone: timezone });
    const startDateZ = DateTime.fromISO(startDate, { zone: timezone }).startOf('day');
    const todayStartZ = nowZ.startOf('day');
    const hasServerExecuteTime = input.executeHour !== undefined && input.executeMinute !== undefined;

    // 预览分两种语义：
    // - 编辑已有规则且保留服务端 execute_hour/minute：对齐服务端 update 情形 3，
    //   start_date 非未来时从 now 严格 > 重算，不回到历史 start_date。
    // - 新建规则 / 编辑时切换 bucket：对齐 create / bucketChanged 语义，仍使用 bucket 窗口保护。
    let computeFrom: Date;
    if (startDateZ > todayStartZ) {
      computeFrom = startDateZ.minus({ minutes: 1 }).toJSDate();
    } else if (hasServerExecuteTime) {
      computeFrom = now;
    } else {
      const window = BUCKET_WINDOWS[bucket];
      const windowStartToday = nowZ.set({ hour: window.startHour, minute: 0, second: 0, millisecond: 0 });
      if (nowZ >= windowStartToday) {
        const windowEndToday = nowZ.set({ hour: window.endHour, minute: 0, second: 0, millisecond: 0 });
        computeFrom = windowEndToday.toJSDate();
      } else if (nowZ.hasSame(startDateZ, 'day')) {
        computeFrom = startDateZ.minus({ minutes: 1 }).toJSDate();
      } else {
        computeFrom = now;
      }
    }

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

/**
 * 格式化服务端返回的 next_run_at（ISO 字符串）为预览展示用的 dateStr。
 *
 * edit 模式下"预计下次执行"优先用服务端权威值，而非本地 computePreviewNextRun 重算——
 * 后者从 start_date 起算，无法感知服务端已执行过哪些日期，导致显示陈旧到起始日。
 *
 * @param nextRunAtIso  服务端 RecurringRule.next_run_at（ISO 字符串）
 * @param timezone      规则时区（格式化到此时区）
 * @returns dateStr "YYYY-MM-DD"，或 null 表示无法解析
 */
export function formatServerNextRunAt(
  nextRunAtIso: string,
  timezone: string,
): string | null {
  const zoned = DateTime.fromISO(nextRunAtIso, { zone: timezone });
  if (!zoned.isValid) return null;
  return zoned.toFormat('yyyy-MM-dd');
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
