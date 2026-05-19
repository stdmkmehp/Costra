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

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export interface UserEntity {
  id: string;
  wxOpenid: string;
  wxUnionid: string | null;
  nickname: string;
  avatarUrl: string | null;
  timezone: string;
  hasCompletedProfile: boolean; // COSTRA-158: 严格资料判定字段
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
  has_completed_profile: boolean; // COSTRA-158
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
    hasCompletedProfile: r.has_completed_profile,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
  };
}

/**
 * 执行器抽象：允许 repo 在 Pool 或 tx PoolClient 上运行。
 * 与 sessionRepo.ts 的 Runner 保持同构（仅 rows 元素类型不同）。
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[]; rowCount?: number | null }> };

function exec(): Runner {
  // 默认用全局 Pool
  return getPool() as unknown as Runner;
}

/** 按 openid 查询用户（未软删）。 */
export async function findByOpenid(openid: string, client?: Runner): Promise<UserEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
            has_completed_profile,
            created_at, updated_at, deleted_at, version
       FROM users
      WHERE wx_openid = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [openid],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 按 id 查询（未软删）。 */
export async function findById(id: string, client?: Runner): Promise<UserEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
            has_completed_profile,
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
export async function create(input: CreateUserInput, client?: Runner): Promise<UserEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO users (id, wx_openid, wx_unionid, nickname, avatar_url, timezone)
          VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Asia/Shanghai'))
        RETURNING id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
                  has_completed_profile, created_at, updated_at, deleted_at, version`,
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
export async function upsertByOpenid(input: CreateUserInput, client?: Runner): Promise<UserEntity> {
  const existing = await findByOpenid(input.wxOpenid, client);
  if (existing) return existing;
  return create(input, client);
}

// --- COSTRA-158: PATCH /users/me 资料更新 ---

export interface UpdateProfileInput {
  nickname?: string;
  avatarUrl?: string | null;
  timezone?: string;
}

/**
 * 更新当前用户的画像信息（PATCH /users/me 路径消费）
 *
 * 行为约定：
 *   - 只更新传入的字段（部分更新语义 · COALESCE 兜底）
 *   - 任意字段更新成功后 has_completed_profile 设为 TRUE（语义：用户至少主动调过一次 PATCH）
 *   - version + 1（乐观锁支持 · 与 COSTRA-104 entryService 范式一致）
 *   - 软删用户（deleted_at IS NOT NULL）禁止更新
 *
 * 不做：
 *   - has_completed_profile 一旦 TRUE 不可降级回 FALSE（语义单调 · 简化判定）
 *   - 字段值校验由 service 层做（如 nickname 长度 · avatarUrl 格式）
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  client?: Runner,
): Promise<UserEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE users
        SET nickname = COALESCE($2, nickname),
            avatar_url = CASE WHEN $3::TEXT IS NULL AND $4::BOOLEAN THEN NULL
                              ELSE COALESCE($3, avatar_url) END,
            timezone = COALESCE($5, timezone),
            has_completed_profile = TRUE,
            updated_at = now(),
            version = version + 1
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
                has_completed_profile, created_at, updated_at, deleted_at, version`,
    [
      userId,
      input.nickname ?? null,
      input.avatarUrl ?? null,
      input.avatarUrl === null,  // 显式传 null = 想清空 avatar · 不是不更新
      input.timezone ?? null,
    ],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}
