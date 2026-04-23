/**
 * Costra · Server · users DAO
 *
 * 卡号：COSTRA-101 · 事实源：server/db/migrations/0001_init.sql `users` 表
 *
 * 职责：封装 users 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口（UserEntity），不暴露 pg 行对象
 *   - 不处理业务语义（如 "用户不存在要不要抛错"），由 service 层判定
 */

import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export interface UserEntity {
  id: string;
  wxOpenid: string;
  wxUnionid: string | null;
  nickname: string;
  avatarUrl: string | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

interface UserRow {
  id: string;
  wx_openid: string;
  wx_unionid: string | null;
  nickname: string;
  avatar_url: string | null;
  timezone: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

function rowToEntity(r: UserRow): UserEntity {
  return {
    id: r.id,
    wxOpenid: r.wx_openid,
    wxUnionid: r.wx_unionid,
    nickname: r.nickname,
    avatarUrl: r.avatar_url,
    timezone: r.timezone,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
  };
}

/** 执行器抽象：允许 repo 在 Pool 或 tx PoolClient 上运行。 */
type Executor = Pick<PoolClient, 'query'> | { query: typeof getPool extends never ? never : ReturnType<typeof getPool>['query'] };

function exec(): { query: (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[] }> } {
  // 默认用全局 Pool
  return getPool() as unknown as { query: (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[] }> };
}

/** 按 openid 查询用户（未软删）。 */
export async function findByOpenid(openid: string, client?: Executor): Promise<UserEntity | null> {
  const runner = (client ?? exec()) as { query: (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[] }> };
  const res = await runner.query(
    `SELECT id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
            created_at, updated_at, deleted_at, version
       FROM users
      WHERE wx_openid = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [openid],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 按 id 查询（未软删）。 */
export async function findById(id: string, client?: Executor): Promise<UserEntity | null> {
  const runner = (client ?? exec()) as { query: (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[] }> };
  const res = await runner.query(
    `SELECT id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
            created_at, updated_at, deleted_at, version
       FROM users
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [id],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

export interface CreateUserInput {
  wxOpenid: string;
  wxUnionid?: string | null;
  nickname: string;
  avatarUrl?: string | null;
  timezone?: string;
}

/**
 * 创建新用户。
 * 说明：id 由应用层（UUID v7）生成；nickname 默认写占位串（真实昵称由用户后续 PATCH /users/me 补齐）。
 */
export async function create(input: CreateUserInput, client?: Executor): Promise<UserEntity> {
  const id = newId();
  const runner = (client ?? exec()) as { query: (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[] }> };
  const res = await runner.query(
    `INSERT INTO users (id, wx_openid, wx_unionid, nickname, avatar_url, timezone)
          VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Asia/Shanghai'))
        RETURNING id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
                  created_at, updated_at, deleted_at, version`,
    [
      id,
      input.wxOpenid,
      input.wxUnionid ?? null,
      input.nickname,
      input.avatarUrl ?? null,
      input.timezone ?? null,
    ],
  );
  if (!res.rows[0]) {
    throw new Error('[userRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

/**
 * upsert by openid：若 openid 已存在则返回现有用户；否则创建。
 * 在 code2Session 登录链路里使用。
 */
export async function upsertByOpenid(input: CreateUserInput, client?: Executor): Promise<UserEntity> {
  const existing = await findByOpenid(input.wxOpenid, client);
  if (existing) return existing;
  return create(input, client);
}
