/**
 * Costra · Server · 工作日节假日数据提供者
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：docs/design/workday-recurring-tech-spec.md §6.1
 *
 * 职责：
 *   - 从 workday_calendars 表加载节假日数据到内存缓存（Map<year, {holidays, workdays}>）
 *   - 提供纯同步的 isWorkday() 供 tryMatchOnDay 调用
 *   - 无某年数据时降级为周一~周五判定，并打日志
 *
 * 刷新时机：
 *   1. 服务启动时（见 app.ts buildApp）
 *   2. 每天凌晨（recurringScheduler tick 检测到跨天时触发）
 *
 * 降级策略（tech-spec §10）：
 *   - DB 无某年数据 → isWorkday 返回按周一~周五
 *   - 降级会漏调休补班的周末 / 多记放假的周中，属可接受（外部数据源缺失时兜底）
 */

import { getPool } from '../db/pool.js';

interface YearData {
  /** 'MM-DD' 放假日集合 */
  holidays: Set<string>;
  /** 'MM-DD' 调休补班日集合 */
  workdays: Set<string>;
}

const cache = new Map<number, YearData>();

/**
 * 刷新缓存 · 从 DB 读取所有年份的节假日数据
 *
 * 调用时机：
 *   1. 服务启动时
 *   2. 每天凌晨（scheduler tick 检测到跨天时触发）
 */
export async function refreshCache(): Promise<void> {
  const pool = getPool();
  const result = await pool.query<{
    year: number;
    holidays: string[];
    workdays: string[];
  }>('SELECT year, holidays, workdays FROM workday_calendars');

  cache.clear();
  for (const row of result.rows) {
    cache.set(row.year, {
      holidays: new Set(row.holidays),
      workdays: new Set(row.workdays),
    });
  }
}

/**
 * 纯同步 · 判断某天是否为工作日
 *
 * @param year     年份
 * @param weekday  ISO 周几 (1=Mon, 7=Sun)
 * @param monthDay 'MM-DD' 格式
 * @returns true = 工作日, false = 非工作日
 */
export function isWorkday(
  year: number,
  weekday: number,
  monthDay: string,
): boolean {
  const data = cache.get(year);
  if (!data) {
    // 降级：无数据 → 按周一~周五（tech-spec §10）
    console.warn(`[workdayProvider] no calendar data for year ${year}, fallback to Mon-Fri`);
    return weekday <= 5;
  }
  // 周末补班日 → 是工作日
  if (data.workdays.has(monthDay)) return true;
  // 节假日放假 → 不是工作日
  if (data.holidays.has(monthDay)) return false;
  // 普通日 → 按周一~五判断
  return weekday <= 5;
}

/**
 * 从缓存读取某年数据，转换为 RecurringRuleForCompute.workday_data 所需形状。
 * 无该年数据返回 null（调用方据此降级）。
 */
export function getWorkdayData(year: number): {
  year: number;
  holidays: string[];
  workdays: string[];
} | null {
  const data = cache.get(year);
  if (!data) return null;
  return {
    year,
    holidays: [...data.holidays],
    workdays: [...data.workdays],
  };
}

/**
 * 从缓存读取所有年份的节假日数据，供 RecurringRuleForCompute.workday_data 使用。
 * 计算时按 cursor.year 动态查找对应年份，某年缺失则降级周一~周五。
 */
export function getAllWorkdayData(): {
  year: number;
  holidays: string[];
  workdays: string[];
}[] {
  const result: { year: number; holidays: string[]; workdays: string[] }[] = [];
  for (const [year, data] of cache) {
    result.push({
      year,
      holidays: [...data.holidays],
      workdays: [...data.workdays],
    });
  }
  return result;
}

/**
 * 测试辅助：清空缓存并注入指定年份的数据。
 * 仅测试环境调用。
 */
export function __setWorkdayCacheForTests(
  year: number,
  data: { holidays: string[]; workdays: string[] },
): void {
  cache.set(year, {
    holidays: new Set(data.holidays),
    workdays: new Set(data.workdays),
  });
}

/**
 * 测试辅助：清空整个缓存。
 * 仅测试环境调用。
 */
export function __clearWorkdayCacheForTests(): void {
  cache.clear();
}
