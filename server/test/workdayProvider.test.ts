/**
 * Costra · Server · workdayProvider 单元测试
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：docs/design/workday-recurring-tech-spec.md §6.1 / §10
 *
 * 覆盖：
 *   - refreshCache：从 workday_calendars 表加载到内存缓存
 *   - isWorkday：假日 / 补班 / 普通日 / 降级（无数据）
 *   - getWorkdayData：读取某年数据（供 RecurringRuleForCompute.workday_data）
 *
 * 依赖 pg-mem（setup.ts 已建 workday_calendars 表）。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { getPool } from '../src/db/pool.js';
import {
  refreshCache,
  isWorkday,
  getWorkdayData,
  __clearWorkdayCacheForTests,
} from '../src/services/workdayProvider.js';

async function seedCalendar(
  year: number,
  holidays: string[],
  workdays: string[],
): Promise<void> {
  await getPool().query(
    `INSERT INTO workday_calendars (year, holidays, workdays)
     VALUES ($1, $2, $3)
     ON CONFLICT (year) DO UPDATE SET holidays = EXCLUDED.holidays, workdays = EXCLUDED.workdays`,
    [year, holidays, workdays],
  );
}

beforeEach(() => {
  __clearWorkdayCacheForTests();
});

describe('workdayProvider · refreshCache', () => {
  it('从 workday_calendars 表加载到缓存', async () => {
    await seedCalendar(2026, ['01-01'], ['02-08']);
    await refreshCache();
    expect(isWorkday(2026, 4, '01-01')).toBe(false); // 放假
    expect(isWorkday(2026, 7, '02-08')).toBe(true); // 补班
  });

  it('重复 refreshCache 会覆盖旧数据', async () => {
    await seedCalendar(2026, ['01-01'], []);
    await refreshCache();
    expect(isWorkday(2026, 4, '01-01')).toBe(false);

    // 改为无假日 → 周四 01-01 变工作日
    await seedCalendar(2026, [], []);
    await refreshCache();
    expect(isWorkday(2026, 4, '01-01')).toBe(true);
  });
});

describe('workdayProvider · isWorkday', () => {
  it('无缓存数据 → 降级周一~周五', () => {
    expect(isWorkday(2026, 7, '01-01')).toBe(false); // 周日 → false
    expect(isWorkday(2026, 1, '01-01')).toBe(true); // 周一 → true
  });

  it('补班日（周末）→ 是工作日', async () => {
    await seedCalendar(2026, [], ['02-08']);
    await refreshCache();
    expect(isWorkday(2026, 7, '02-08')).toBe(true);
  });

  it('放假日（周一~周五）→ 不是工作日', async () => {
    await seedCalendar(2026, ['01-01'], []);
    await refreshCache();
    expect(isWorkday(2026, 4, '01-01')).toBe(false);
  });

  it('普通工作日 → 是工作日', async () => {
    await seedCalendar(2026, ['01-01'], []);
    await refreshCache();
    expect(isWorkday(2026, 1, '01-05')).toBe(true);
  });

  it('普通周末 → 不是工作日', async () => {
    await seedCalendar(2026, ['01-01'], []);
    await refreshCache();
    expect(isWorkday(2026, 7, '01-11')).toBe(false);
  });
});

describe('workdayProvider · getWorkdayData', () => {
  it('返回某年数据（holidays/workdays 展开为数组）', async () => {
    await seedCalendar(2026, ['01-01', '02-15'], ['02-08']);
    await refreshCache();
    const data = getWorkdayData(2026);
    expect(data?.year).toBe(2026);
    expect(data?.holidays.sort()).toEqual(['01-01', '02-15']);
    expect(data?.workdays).toEqual(['02-08']);
  });

  it('无该年数据 → null', () => {
    expect(getWorkdayData(2030)).toBeNull();
  });
});
