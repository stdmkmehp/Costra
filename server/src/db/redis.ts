/**
 * Costra · Server · Redis 连接
 *
 * 卡号：COSTRA-101 · 依据：ADR-0006 §2.3 Redis 7 + ioredis 5.x
 *
 * 用途：
 *   - 热路径加速 `refresh:{jti}` 会话查询 / 撤销；真实事实源仍是 user_sessions 表。
 *   - Idempotency-Key 去重（Sprint-2 落地）
 *   - 限流令牌桶（Sprint-2 落地）
 *
 * 单例设计与 db/pool.ts 对称；测试用 ioredis-mock 替换。
 */

import Redis from 'ioredis';
import { appEnv } from '../config/env.js';

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (_redis == null) {
    _redis = new Redis(appEnv().redisUrl, {
      // 简化：登录链路对连接失败直接报 5xx（业务可接受），不做复杂的 offline queue
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }
  return _redis;
}

/** 测试注入（ioredis-mock 实例）。 */
export function setRedisForTests(client: Redis): void {
  _redis = client;
}

/** 优雅关闭。 */
export async function closeRedis(): Promise<void> {
  if (_redis != null) {
    await _redis.quit().catch(() => {
      /* ignore */
    });
    _redis = null;
  }
}
