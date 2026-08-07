// services/workdayApi.ts · 节假日数据获取 + 本地缓存
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// 事实源：docs/design/workday-recurring-tech-spec.md §8.1
// Refs: COSTRA-5xx
//
// 注意：isWorkdaySync 定义在共享的 recurringSchedule.ts（byte-level 跨端同源），
// 本文件只负责「获取 + 缓存」节假日数据。

import { request } from './request';

export interface WorkdayData {
  year: number;
  holidays: string[]; // 'MM-DD' 放假日
  workdays: string[]; // 'MM-DD' 调休补班日
}

const STORAGE_KEY_PREFIX = 'workday_calendar_';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CachedEntry {
  year: number;
  data: WorkdayData;
  timestamp: number;
}

function storageKey(year: number): string {
  return `${STORAGE_KEY_PREFIX}${year}`;
}

/**
 * 获取指定年份的节假日数据
 * 1. 本地缓存（TTL 24h · 按年份独立存储）→ 2. 请求 API → 3. 降级 null
 * 降级时由调用方按周一~周五判定。
 */
export async function getWorkdayData(year: number): Promise<WorkdayData | null> {
  let cached: CachedEntry | undefined;
  try {
    cached = wx.getStorageSync(storageKey(year)) as CachedEntry | undefined;
  } catch { /* storage 不可用时降级走网络 */ }

  if (cached && cached.year === year && Date.now() - cached.timestamp < TTL_MS) {
    return cached.data;
  }

  try {
    const res = await request<WorkdayData>({
      method: 'GET',
      path: `/workday-calendar/${year}`,
    });
    try {
      wx.setStorageSync(storageKey(year), { year, data: res, timestamp: Date.now() });
    } catch { /* 缓存失败不影响返回 */ }
    return res;
  } catch {
    return null;
  }
}
