/**
 * Costra · Server · 幂等键服务
 *
 * 卡号：COSTRA-104 · 事实源：docs/api/sync-protocol.md §2.5 + id-strategy.md §3
 *
 * 职责：
 *   - 24h 去重窗口内同一 Idempotency-Key + 同 endpoint + 同 body_hash → 返回缓存 response
 *   - 同 key 但 body_hash 不同 → IDEMPOTENCY_KEY_MISMATCH（409）
 *   - 写 idempotency_keys 表（TTL 24h）
 *
 * 设计：
 *   - 幂等用 PG 而非 Redis（保证持久化 · server 重启不丢幂等记录）
 *   - 本卡仅提供 CRUD 函数；cron 清理由 DevOps 负责（FU-104-IDEMPOTENCY-CRON）
 */

import { getPool } from '../db/pool.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';

export interface CachedResponse {
  statusCode: number;
  body: unknown;
}

/**
 * 执行器抽象。
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: { key: string; endpoint: string; request_hash: string; response_status: number; response_body: unknown }[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

export interface CheckResult {
  /** null = 未命中；命中时返回缓存 response */
  cached: CachedResponse | null;
}

/**
 * 查询幂等键：
 *   - 未命中 → 返回 { cached: null }
 *   - 命中 + hash 同 → 返回 { cached: { statusCode, body } }
 *   - 命中 + hash 不一致 → 抛 IDEMPOTENCY_KEY_MISMATCH（409）
 */
export async function checkAndGet(
  key: string,
  endpoint: string,
  requestHash: string,
): Promise<CheckResult> {
  const runner = exec();
  const res = await runner.query(
    `SELECT key, endpoint, request_hash, response_status, response_body
       FROM idempotency_keys
      WHERE key = $1 AND endpoint = $2 AND expires_at > now()`,
    [key, endpoint],
  );

  if (res.rows.length === 0) {
    return { cached: null };
  }

  const row = res.rows[0];
  if (row.request_hash !== requestHash) {
    throw new AppError(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, {
      message: 'Idempotency-Key reuse with different request body',
      details: {
        provided_hash: requestHash,
        original_hash: row.request_hash,
      },
    });
  }

  return {
    cached: {
      statusCode: row.response_status,
      body: row.response_body,
    },
  };
}

export interface SaveOptions {
  /** 幂等键值 */
  key: string;
  /** API 端点路径 */
  endpoint: string;
  /** actor user id（记录操作人）*/
  actorUserId: string;
  /** 请求体 sha256 */
  requestHash: string;
  /** HTTP 响应状态码 */
  responseStatus: number;
  /** 响应体（JSON） */
  responseBody: unknown;
  /** TTL 小时数（默认 24h） */
  ttlHours?: number;
}

/**
 * 写入幂等键记录。
 * 使用 ON CONFLICT DO NOTHING（幂等键 PK 冲突时忽略，避免重复写入）。
 */
export async function save(opts: SaveOptions): Promise<void> {
  const { key, endpoint, actorUserId, requestHash, responseStatus, responseBody, ttlHours = 24 } = opts;
  const runner = exec();
  await runner.query(
    `INSERT INTO idempotency_keys (key, endpoint, actor_user_id, request_hash, response_status, response_body, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${ttlHours} hours')
     ON CONFLICT (key, endpoint) DO NOTHING`,
    [key, endpoint, actorUserId, requestHash, responseStatus, JSON.stringify(responseBody)],
  );
}

/**
 * 清理已过期的幂等键记录。
 * 本卡仅留 stub 函数；真正的 cron 调度由 DevOps 负责（FU-104-IDEMPOTENCY-CRON）。
 */
export async function cleanup(): Promise<number> {
  const runner = exec();
  const res = await runner.query(
    `DELETE FROM idempotency_keys WHERE expires_at < now() RETURNING key`,
    [],
  );
  return res.rowCount ?? 0;
}
