/**
 * Costra · Server · user_sessions DAO
 *
 * 卡号：COSTRA-101 · 事实源：server/db/migrations/0001_init.sql `user_sessions` 表
 *
 * 职责：封装 user_sessions 表访问；与 Redis 的 `refresh:{jti}` 构成双写结构。
 *   - DB 为真源（source of truth）：登出、撤销、回收历史都从 DB 判定
 *   - Redis 为热路径加速：refresh 链路优先查 Redis，miss 回源 DB
 *
 * 设计：
 *   - insert：签发 refresh_token 时写入一行
 *   - findActive：校验 refresh_token 时查询（必须满足 revoked_at IS NULL 且 expires_at > now()）
 *   - revoke：登出 / refresh 后作废旧 session
 *   - revokeStaleByUser：登录时回收该用户的"陈旧活跃会话"（过期未标记 + 同设备旧会话）
 *   - touchRefresh：refresh 成功后更新 last_refresh_at（非强制，便于运维观察）
 */

import { getPool } from '../db/pool.js';

export interface UserSession {
  jti: string;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  clientFp: string | null;
  lastRefreshAt: Date | null;
}

interface SessionRow {
  jti: string;
  user_id: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  client_fp: string | null;
  last_refresh_at: Date | null;
}

function rowToEntity(r: SessionRow): UserSession {
  return {
    jti: r.jti,
    userId: r.user_id,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    clientFp: r.client_fp,
    lastRefreshAt: r.last_refresh_at,
  };
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: SessionRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

export interface InsertSessionInput {
  jti: string;
  userId: string;
  expiresAt: Date;
  clientFp?: string | null;
}

/** 新建一条 session 行（刚签发 refresh_token 时）。 */
export async function insert(input: InsertSessionInput, client?: Runner): Promise<UserSession> {
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO user_sessions (jti, user_id, expires_at, client_fp)
          VALUES ($1, $2, $3, $4)
        RETURNING jti, user_id, issued_at, expires_at, revoked_at, client_fp, last_refresh_at`,
    [input.jti, input.userId, input.expiresAt, input.clientFp ?? null],
  );
  if (!res.rows[0]) throw new Error('[sessionRepo] INSERT returned no row');
  return rowToEntity(res.rows[0]);
}

/**
 * 查询一条仍生效的 session：
 *   - revoked_at IS NULL
 *   - expires_at > now()
 *
 * 刷新 / 登出链路使用。
 */
export async function findActive(jti: string, client?: Runner): Promise<UserSession | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT jti, user_id, issued_at, expires_at, revoked_at, client_fp, last_refresh_at
       FROM user_sessions
      WHERE jti = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [jti],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 作废一条 session（置 revoked_at = now()）。幂等：重复调用无副作用。 */
export async function revoke(jti: string, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `UPDATE user_sessions
        SET revoked_at = now()
      WHERE jti = $1 AND revoked_at IS NULL`,
    [jti],
  );
}

export interface RevokeStaleInput {
  userId: string;
  /** 当前登录设备指纹；为 null 时同设备分支自然不匹配（NULL 等值恒不成立） */
  clientFp: string | null;
  /** 同设备会话若签发早于此刻则回收（业务约定 = now - 1h） */
  sameDeviceIssuedBefore: Date;
}

/**
 * 登录时回收该用户的"陈旧活跃会话"（仅置 revoked_at · 物理删除交由后续定时清理）：
 *   - 已过期但尚未标记的活跃会话（expires_at <= now）；
 *   - 同设备（client_fp 相同）且签发早于 sameDeviceIssuedBefore 的活跃会话。
 *
 * 允许多设备并存：不同 client_fp 的其它设备会话不受影响。
 * clientFp 为 null 时 `client_fp = NULL` 恒不成立 → 只回收过期会话。
 *
 * @returns 被回收行数
 */
export async function revokeStaleByUser(input: RevokeStaleInput, client?: Runner): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE user_sessions
        SET revoked_at = now()
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND ( expires_at <= now()
           OR (client_fp = $2 AND issued_at < $3) )`,
    [input.userId, input.clientFp, input.sameDeviceIssuedBefore],
  );
  return res.rowCount ?? 0;
}

/**
 * 作废指定用户的全部在线 session（登出全部设备 / 安全回收场景）。
 * 本轮 COSTRA-101 不开放对应端点，仅保留 API 形状。
 */
export async function revokeAllByUser(userId: string, client?: Runner): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE user_sessions
        SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return res.rowCount ?? 0;
}

/** 记录一次 refresh（观察用途，不强制）。 */
export async function touchRefresh(jti: string, client?: Runner): Promise<void> {
  const runner = client ?? exec();
  await runner.query(
    `UPDATE user_sessions
        SET last_refresh_at = now()
      WHERE jti = $1`,
    [jti],
  );
}
