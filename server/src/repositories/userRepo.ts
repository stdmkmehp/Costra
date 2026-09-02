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
  /** migration 0018: GM 权限标记（唯一写入路径 = 运维 SQL） */
  isGm: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
  /** migration 0011: 用户上次选择的 family（可 null） */
  preferredFamilyId: string | null;
  /** migration 0011: 用户上次选择的 ledger（可 null） */
  preferredLedgerId: string | null;
  /** 用户偏好最后一次写入 revision（客户端单调递增，防旧请求覆盖） */
  preferredRevision: number;
  /** 用户偏好最后一次成功写入时间 */
  preferredUpdatedAt: Date | null;
}

interface UserRow {
  id: string;
  wx_openid: string;
  wx_unionid: string | null;
  nickname: string;
  avatar_url: string | null;
  timezone: string;
  has_completed_profile: boolean; // COSTRA-158
  is_gm: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
  preferred_family_id: string | null;
  preferred_ledger_id: string | null;
  preferred_revision: number | string | null;
  preferred_updated_at: Date | null;
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
    isGm: r.is_gm,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
    preferredFamilyId: r.preferred_family_id ?? null,
    preferredLedgerId: r.preferred_ledger_id ?? null,
    preferredRevision: Number(r.preferred_revision ?? 0),
    preferredUpdatedAt: r.preferred_updated_at ?? null,
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
            has_completed_profile, is_gm,
            created_at, updated_at, deleted_at, version,
            preferred_family_id, preferred_ledger_id, preferred_revision, preferred_updated_at
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
            has_completed_profile, is_gm,
            created_at, updated_at, deleted_at, version,
            preferred_family_id, preferred_ledger_id, preferred_revision, preferred_updated_at
       FROM users
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [id],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

// --- GM 用户双榜单（GET /gm/users 消费 · 均不返回 openid · D3）---

/** 活跃榜条目：近 7 天 entries 数 + 最后活跃时间 */
export interface ActiveUserSummary {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  createdAt: Date;
  entryCount7d: number;
  lastActiveAt: Date;
}

/** 注册榜条目 */
export interface RecentUserSummary {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  createdAt: Date;
}

/**
 * GM 活跃榜：近 7 天（since 起）有 entries 写入的用户，entryCount7d DESC,
 * lastActiveAt DESC, id DESC 稳定排序；INNER JOIN 天然排除无流水用户；排除软删。
 * 窗口起点由调用方传入（避免 SQL interval 字面量，兼容 pg-mem）。
 */
export async function listActiveUsers(
  since: Date,
  limit: number,
  client?: Runner,
): Promise<ActiveUserSummary[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT u.id, u.nickname, u.avatar_url, u.created_at,
            e.cnt AS entry_count_7d, e.last_at AS last_active_at
       FROM users u
       JOIN (
             SELECT created_by, count(*) AS cnt, max(created_at) AS last_at
               FROM entries
              WHERE created_at >= $1
                AND deleted_at IS NULL
              GROUP BY created_by
            ) e ON e.created_by = u.id
      WHERE u.deleted_at IS NULL
      ORDER BY e.cnt DESC, e.last_at DESC, u.id DESC
      LIMIT $2`,
    [since, limit],
  );
  type ActiveRow = UserRow & { entry_count_7d: number | string; last_active_at: Date };
  return (res.rows as unknown as ActiveRow[]).map((r) => ({
    id: r.id,
    nickname: r.nickname,
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
    entryCount7d: Number(r.entry_count_7d), // count(*) → int8 · node-pg 返回 string
    lastActiveAt: r.last_active_at,
  }));
}

/** GM 注册榜：created_at DESC, id DESC 稳定排序；排除软删。 */
export async function listRecentRegistered(
  limit: number,
  client?: Runner,
): Promise<RecentUserSummary[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT u.id, u.nickname, u.avatar_url, u.created_at
       FROM users u
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    nickname: r.nickname,
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
  }));
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
                  has_completed_profile, is_gm, created_at, updated_at, deleted_at, version,
                  preferred_family_id, preferred_ledger_id, preferred_revision, preferred_updated_at`,
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
                has_completed_profile, is_gm, created_at, updated_at, deleted_at, version,
                preferred_family_id, preferred_ledger_id, preferred_revision, preferred_updated_at`,
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

// --- migration 0011: preferred family/ledger ---

export interface UpdatePreferenceInput {
  preferredFamilyId: string | null;
  preferredLedgerId: string | null;
  /** 客户端生成的单调 revision；旧客户端不传时由服务端生成 */
  clientRevision?: number;
}

/**
 * 更新用户的偏好 family + ledger（PUT /users/me/preference 路径消费）
 *
 * 防旧覆盖：
 * - 新客户端传 clientRevision 时，仅允许 revision 不小于当前值的请求覆盖。
 * - 旧客户端不传 revision 时，服务端生成递增 revision，保持兼容。
 *
 * 返回 null 表示用户不存在或传入 revision 已过期；路由层对 stale 按幂等成功处理。
 */
export async function updatePreference(
  userId: string,
  input: UpdatePreferenceInput,
  client?: Runner,
): Promise<UserEntity | null> {
  const runner = client ?? exec();
  const clientRevision = input.clientRevision ?? null;
  const res = await runner.query(
    `UPDATE users
        SET preferred_family_id = $2,
            preferred_ledger_id  = $3,
            preferred_revision   = COALESCE($4::BIGINT, preferred_revision + 1),
            preferred_updated_at = now(),
            updated_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ($4::BIGINT IS NULL OR preferred_revision <= $4::BIGINT)
      RETURNING id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
                has_completed_profile, is_gm, created_at, updated_at, deleted_at, version,
                preferred_family_id, preferred_ledger_id, preferred_revision, preferred_updated_at`,
    [userId, input.preferredFamilyId, input.preferredLedgerId, clientRevision],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 清除指定用户指向某 family 的偏好（离开/被移出当前 active family 时调用） */
export async function clearPreferenceForFamily(
  userId: string,
  familyId: string,
  client?: Runner,
): Promise<UserEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE users
        SET preferred_family_id = NULL,
            preferred_ledger_id  = NULL,
            preferred_revision   = preferred_revision + 1,
            preferred_updated_at = now(),
            updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL AND preferred_family_id = $2
      RETURNING id, wx_openid, wx_unionid, nickname, avatar_url, timezone,
                has_completed_profile, is_gm, created_at, updated_at, deleted_at, version,
                preferred_family_id, preferred_ledger_id, preferred_revision, preferred_updated_at`,
    [userId, familyId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/** 清除所有指向某 family 的用户偏好（解散 family 时调用） */
export async function clearAllPreferencesForFamily(
  familyId: string,
  client?: Runner,
): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE users
        SET preferred_family_id = NULL,
            preferred_ledger_id  = NULL,
            preferred_revision   = preferred_revision + 1,
            preferred_updated_at = now(),
            updated_at = now()
      WHERE preferred_family_id = $1 AND deleted_at IS NULL`,
    [familyId],
  );
  return res.rowCount ?? 0;
}
