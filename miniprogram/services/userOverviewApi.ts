// services/userOverviewApi.ts · mine 页宏观聚合 API
//
// 卡号：mine-overview · 配套后端 GET /v1/users/me/overview
// 契约事实源：server/api/openapi.yaml /users/me/overview
//
// 缓存策略：
//   - SWR（stale-while-revalidate）· TTL 5min · 与 statisticsApi 范式一致
//   - 单值缓存（user-scope · 不需要按 family/month 分 key）
//   - 失效时机：
//     · ENTRY_SAVED / ENTRY_UPDATED 后；
//     · SYNC_DONE 后（pulled>0 或 pushed>0）；
//     · 用户切账本（family_id 变化）也间接通过 SYNC_DONE 失效。
//
// 性能：后端单 SQL 索引扫描，单用户千条流水内 < 50ms。

import { request } from './request';

export interface UserOverview {
  /** 总记账笔数（含 income / expense / transfer · 不含 deleted） */
  entry_count: number;
  /** 有记账记录的天数（按 occurred_at 在 Asia/Shanghai 时区下的 DISTINCT date） */
  ledger_days: number;
}

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: UserOverview;
  timestamp: number;
}

let _cache: CacheEntry | null = null;

/** 命中且未过期则返回；否则 null */
export function getCachedUserOverview(): UserOverview | null {
  if (!_cache) return null;
  if (Date.now() - _cache.timestamp > TTL_MS) return null;
  return _cache.data;
}

/** 失效缓存（数据变更事件触发） */
export function invalidateUserOverview(): void {
  _cache = null;
}

/**
 * 拉取最新 overview · 自动写入缓存。
 * 调用方典型用法：
 *   const cached = getCachedUserOverview();
 *   if (cached) renderImmediate(cached);
 *   const fresh = await getUserOverview();  // 后台校准
 *   if (signature(fresh) !== signature(cached)) renderUpdate(fresh);
 */
export async function getUserOverview(): Promise<UserOverview> {
  const data = await request<UserOverview>({
    method: 'GET',
    path: '/users/me/overview',
  });
  _cache = { data, timestamp: Date.now() };
  return data;
}
