/**
 * Costra · Server · GM 用户双榜单 read-through 缓存
 *
 * 事实源：docs/ops/gm-impersonate-design.md §2.5（v2 修订）
 *
 * 设计要点：
 *   - 单 key `cache:v1:gm:active-users` 承载整份有序双榜（active + recent，各 ≤200 条），
 *     值 = JSON envelope `{"v":<payload>}`（沿用 redis-cache-tech-spec 的 envelope 惯例）。
 *   - TTL = `ttl().gmActiveUsersSec`（默认 1800s，固定不过期刷新）；无主动失效挂钩。
 *   - 缓存 payload 为**响应线形**（日期已序列化为 ISO string），命中时零映射直接下发。
 *   - Redis 读/写任何异常均降级为直查 loader（SQL），warn 日志，GM 功能不阻塞；
 *     envelope 缺 `v`（坏数据）按 miss 处理并重算覆盖。
 *   - 缓存正当性：GM 低频内部工具，一次聚合多次翻页复用；鉴权（requireGm）不经过本缓存。
 */

import { getRedis } from '../db/redis.js';
import { ttl } from '../config/ttl.js';

const KEY = 'cache:v1:gm:active-users';

/** 最小日志接口（路由层传 app.log；测试可传 stub） */
export interface GmCacheLogger {
  warn: (obj: unknown, msg: string) => void;
}

const noopLogger: GmCacheLogger = { warn: () => undefined };

/**
 * 读穿获取 GM 双榜单：命中 → 缓存 payload；miss/坏数据/Redis 异常 → loader 重算并回写。
 * T 由路由层定义为响应线形（如 `{ active: ActiveItem[]; recent: RecentItem[] }`）。
 */
export async function getGmListsCached<T>(
  loader: () => Promise<T>,
  log: GmCacheLogger = noopLogger,
): Promise<T> {
  try {
    const raw = await getRedis().get(KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { v?: T };
      if (parsed.v !== undefined) return parsed.v;
      // envelope 缺 v = 坏数据，按 miss 走重算覆盖
    }
  } catch (err) {
    log.warn({ err }, 'gm user lists cache read failed, fallback to sql');
  }

  const value = await loader();

  try {
    await getRedis().set(KEY, JSON.stringify({ v: value }), 'EX', ttl().gmActiveUsersSec);
  } catch (err) {
    log.warn({ err }, 'gm user lists cache write failed');
  }
  return value;
}
