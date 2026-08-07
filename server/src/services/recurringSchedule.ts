// costra · recurringSchedule.ts · T1 同源基础设施
//
// 卡号占位：COSTRA-5xx（T1 · Sprint-4 · Epic-E）
// 事实源：
//   - docs/design/recurring-entry-tech-spec.md §7 v0.2.1
//   - docs/design/recurring-entry-product-spec.md §4/§5 v0.3.2
//
// ★★★ byte-level 同源约束 ★★★
//   本文件必须与 miniprogram/services/recurringSchedule.ts 内容完全一致（含空行、注释）
//   CI 由 scripts/verify-recurring-schedule-parity.mjs 卡关
//   任一处改动，两边必须同步

import { DateTime } from 'luxon';

// ===== 类型定义 =====

export type Period =
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'workday';

export type ExecuteBucket = 'dawn' | 'morning' | 'afternoon' | 'night';

/**
 * 工作日节假日数据（workday 周期用）
 * 由调用方从 workdayProvider（server）或 workdayApi（miniprogram）加载后传入，
 * 保证 computeNextRunAt 是纯同步函数。
 * 按年份组织为数组，计算时按 cursor.year 动态查找对应年份数据；
 * 某年缺失则降级为周一~周五判定。
 */
export interface WorkdayData {
  year: number;
  holidays: string[]; // 'MM-DD'
  workdays: string[]; // 'MM-DD'
}

/**
 * 用于 computeNextRunAt 计算的最小字段集
 * 与 recurring_rules 表的字段名保持一致（snake_case），便于直接从 DB row 消费
 */
export interface RecurringRuleForCompute {
  period: Period;
  period_interval: number; // 周期间隔倍数 · 默认 1
  timezone: string; // IANA 时区名· 例'Asia/Shanghai'
  start_date: string; // 'YYYY-MM-DD'
  execute_hour: number; // 0-23
  execute_minute: number; // 0-59
  days_of_week: number[] | null; // 1=周一...7=周日 · weekly用
  days_of_month: number[] | null; // 1..31 · monthly 用
  year_month_days: number[] | null; // 编码month*100+day · yearly 用
  workday_data: WorkdayData[]; // workday 周期用 · 按 year 查 · 空数组降级周一~周五
}

// ===== 时段窗口常量（tech-spec §3.5 v0.2.1 · 内缩边界）=====

export interface BucketWindow {
  startHour: number;
  endHour: number;
}

export const BUCKET_WINDOWS: Record<ExecuteBucket, BucketWindow> = {
  dawn: { startHour: 0, endHour: 6 }, // 00:00 ~ 05:59
  morning: { startHour: 6, endHour: 12 }, // 06:00 ~ 11:59
  afternoon: { startHour: 12, endHour: 18 }, // 12:00 ~ 17:59
  night: { startHour: 18, endHour: 24 }, // 18:00 ~ 23:59
};

/** 每个 6h 窗口的首尾内缩 30 分钟 · 让 hash 只落在中段 5 小时内 */
export const INNER_MARGIN_MINUTES = 30;

// ===== fnv1a64 · 纯 BigInt 实现 · 跨端可复现 =====

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a 64-bit 哈希
 * 纯函数 · 无 crypto/Buffer 依赖 · Node 与小程序端行为一致
 */
export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_64;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // 处理多字节字符：拆成低 8 + 高 8 两轮，保持 UTF-16 稳定性
    hash = ((hash ^ BigInt(code & 0xff)) * FNV_PRIME_64) & MASK_64;
    if (code > 0xff) {
      hash = ((hash ^ BigInt((code >> 8) & 0xff)) * FNV_PRIME_64) & MASK_64;
    }
  }
  return hash;
}

// ===== 错峰分钟分配（tech-spec §3.5 v0.2.1）=====

/**
 * 为 (userId, ruleId) 稳定分配一个 bucket 内的具体 hour/minute
 *
 * 属性保证：
 *   - 同一 (userId, ruleId, bucket) 输入永远返回同一个 (hour, minute)
 *   - 输出严格落在 [startHour*60 + 30, endHour*60 - 30) 区间
 *   - 避开整点报时（避开 hh:00 和 hh:59 边界）
 *
 * 用户切换 bucket → 后端调用一次本函数覆盖 execute_hour/execute_minute
 */
export function assignBucketMinute(
  userId: string,
  ruleId: string,
  bucket: ExecuteBucket,
): { hour: number; minute: number } {
  const w = BUCKET_WINDOWS[bucket];
  const windowTotalMinutes = (w.endHour - w.startHour) * 60;
  const usableMinutes = windowTotalMinutes - INNER_MARGIN_MINUTES * 2;
  if (usableMinutes <= 0) {
    throw new Error(
      `assignBucketMinute: usableMinutes must be > 0 (got ${usableMinutes})`,
    );
  }
  const h = fnv1a64(`${userId}|${ruleId}`);
  const offset = Number(h % BigInt(usableMinutes));
  const totalMinutes = w.startHour * 60 + INNER_MARGIN_MINUTES + offset;
  return {
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  };
}

// ===== 补齐 loop 窗口常量（tech-spec §3.4 v0.2.1）=====

export const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_BACKFILL_ITER = 100;

// ===== computeNextRunAt · 核心调度算法 =====

const MAX_COMPUTE_ITER = 800; // 每年最坏 366 + buffer

/**
 * 计算 rule 严格大于 from 的下一次执行时点
 *
 * 语义：
 *   - 返回值总是 execute_hour:execute_minute:00.000 in rule.timezone
 *   - 返回值 > from（严格大于）
 *   - 每月 31 号在小月回落到月末（e.g. 2 月落 28/29 · 4 月落 30）
 *   - 每年 2/29 平年落 2/28
 *   - 若 800 天内无匹配（配置异常）→ 抛错
 */
export function computeNextRunAt(
  rule: RecurringRuleForCompute,
  from: Date,
): Date {
  const tz = rule.timezone;
  const fromZ = DateTime.fromJSDate(from, { zone: tz });
  if (!fromZ.isValid) {
    throw new Error(`computeNextRunAt: invalid timezone "${tz}"`);
  }

  // 起点：把 from 推到"下一分钟"再 set 到 execute 时点
  //   之所以先 +1 分钟：让"from 恰好正整分钟"也能正确推进（避免返回等值）
  let cursor = fromZ.plus({ minutes: 1 }).set({
    hour: rule.execute_hour,
    minute: rule.execute_minute,
    second: 0,
    millisecond: 0,
  });
  // set 可能把 cursor 回退到 from 之前（例如 from=15:00 · execute=09:00 → set 后是当天 09:00 < from）
  // 修正：若 cursor <= from，推到下一天
  if (cursor <= fromZ) {
    cursor = cursor.plus({ days: 1 });
  }

  for (let i = 0; i < MAX_COMPUTE_ITER; i++) {
    const match = tryMatchOnDay(rule, cursor);
    if (match) return match.toJSDate();
    cursor = cursor.plus({ days: 1 });
  }
  throw new Error(
    `computeNextRunAt: no match within ${MAX_COMPUTE_ITER} days · rule config invalid`,
  );
}

/**
 * 判断 cursor 是否命中 rule 的匹配日 · 命中返回 cursor 本身；否则返回 null
 * cursor 已经 set 到 execute_hour:execute_minute
 */
function tryMatchOnDay(
  rule: RecurringRuleForCompute,
  cursor: DateTime,
): DateTime | null {
  const interval = rule.period_interval;

  switch (rule.period) {
    case 'weekly': {
      const dows = rule.days_of_week;
      if (!dows || dows.length === 0) return null;
      if (interval > 1) {
        const baseMonday = DateTime.fromISO(rule.start_date, {
          zone: rule.timezone,
        }).startOf('week');
        const cursorMonday = cursor.startOf('week');
        const weeksDiff = Math.round(
          cursorMonday.diff(baseMonday, 'weeks').weeks,
        );
        if (weeksDiff < 0 || weeksDiff % interval !== 0) return null;
      }
      return dows.includes(cursor.weekday) ? cursor : null;
    }

    case 'monthly': {
      const doms = rule.days_of_month;
      if (!doms || doms.length === 0) return null;
      const baseMonth = DateTime.fromISO(rule.start_date, {
        zone: rule.timezone,
      }).startOf('month');
      const cursorMonth = cursor.startOf('month');
      const monthsDiff = Math.round(
        cursorMonth.diff(baseMonth, 'months').months,
      );
      if (monthsDiff < 0 || monthsDiff % interval !== 0) return null;
      return matchDayOfMonth(cursor, doms);
    }

    case 'yearly': {
      const ymds = rule.year_month_days;
      if (!ymds || ymds.length === 0) return null;
      const M = cursor.month;
      const D = cursor.day;
      const dim = cursor.daysInMonth ?? 31;
      for (const encoded of ymds) {
        const eM = Math.floor(encoded / 100);
        const eD = encoded % 100;
        if (eM !== M) continue;
        // 2/29 平年落 2/28（唯一的每年跨月边界特例）
        const targetD = eM === 2 && eD === 29 && dim === 28 ? 28 : eD;
        if (targetD === D) return cursor;
      }
      return null;
    }

    case 'workday': {
      const weekday = cursor.weekday; // 1=Mon...7=Sun (Luxon)
      // Luxon 用 `MM-dd`（小写 d）表示两位日期；`DD` 是长日期格式名，非 MM-DD
      const monthDay = cursor.toFormat('MM-dd');
      // 按 cursor.year 从数据数组中查找对应年份的节假日数据
      const yearData = rule.workday_data.find((d) => d.year === cursor.year) ?? null;
      return isWorkdaySync(yearData, cursor.year, weekday, monthDay)
        ? cursor
        : null;
    }
  }
}

/**
 * 纯同步 · 判断某天是否为工作日（workday 周期共用 · 跨端 byte-level 一致）
 *
 * @param data     节假日数据 · null 时降级为周一~周五
 * @param year     年份
 * @param weekday  ISO 周几 (1=Mon, 7=Sun)
 * @param monthDay 'MM-DD' 格式
 * @returns true = 工作日, false = 非工作日
 */
export function isWorkdaySync(
  data: WorkdayData | null,
  year: number,
  weekday: number,
  monthDay: string,
): boolean {
  if (!data || data.year !== year) {
    // 降级：无数据 → 按周一~周五
    return weekday <= 5;
  }
  const holidays = new Set(data.holidays);
  const workdays = new Set(data.workdays);
  // 周末补班日 → 是工作日
  if (workdays.has(monthDay)) return true;
  // 节假日放假 → 不是工作日
  if (holidays.has(monthDay)) return false;
  // 普通日 → 按周一~五判断
  return weekday <= 5;
}

/**
 * 每月类的日子匹配 · 处理 31→月末的回落
 *
 * 例：days=[15, 31] · 4 月 · daysInMonth=30
 *   effective = {15, 30}（31 回落到 30）
 *   若 cursor.day === 15 或 30 则命中
 */
function matchDayOfMonth(cursor: DateTime, days: number[]): DateTime | null {
  const dim = cursor.daysInMonth ?? 31;
  const effective = new Set<number>();
  for (const d of days) {
    effective.add(Math.min(d, dim));
  }
  return effective.has(cursor.day) ? cursor : null;
}

// ===== formatDaysForSummary · 已选日子的展示格式化 =====
// 实现已提取至 recurringFormat.ts · 此处 re-export 保持 API 兼容

export { formatDaysForSummary } from './recurringFormat';
export type { FormatMode, FormatContext } from './recurringFormat';
