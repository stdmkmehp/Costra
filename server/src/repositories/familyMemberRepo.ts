/**
 * Costra · Server · family_members DAO
 *
 * 卡号：COSTRA-221 · 事实源：server/db/migrations/0001_init.sql family_members 表
 *
 * 职责：封装 family_members 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口，不暴露 pg 行对象
 *   - Runner 透传模式（与 familyRepo.ts 同构）
 */

import { getPool } from '../db/pool.js';

export type FamilyRole = 'owner' | 'member' | 'viewer';

export interface FamilyMemberEntity {
  familyId: string;
  userId: string;
  role: FamilyRole;
  joinedAt: Date;
  leftAt: Date | null;
}

/** 成员列表项（JOIN users 获取 nickname/avatar_url） */
export interface FamilyMemberWithUser extends FamilyMemberEntity {
  nickname: string;
  avatarUrl: string | null;
}

interface FamilyMemberRow {
  family_id: string;
  user_id: string;
  role: FamilyRole;
  joined_at: Date;
  left_at: Date | null;
}

interface FamilyMemberWithUserRow extends FamilyMemberRow {
  nickname: string;
  avatar_url: string | null;
}

function rowToEntity(r: FamilyMemberRow): FamilyMemberEntity {
  return {
    familyId: r.family_id,
    userId: r.user_id,
    role: r.role,
    joinedAt: r.joined_at,
    leftAt: r.left_at,
  };
}

function rowToWithUser(r: FamilyMemberWithUserRow): FamilyMemberWithUser {
  return {
    ...rowToEntity(r),
    nickname: r.nickname,
    avatarUrl: r.avatar_url,
  };
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: FamilyMemberRow[] | FamilyMemberWithUserRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/**
 * 校验 user 是否为 family 的 active member（left_at IS NULL）
 */
export async function isActiveMember(
  userId: string,
  familyId: string,
  client?: Runner,
): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT 1 FROM family_members
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
      LIMIT 1`,
    [familyId, userId],
  );
  return (res.rows as unknown[]).length > 0;
}

/**
 * 获取 user 在 family 中的 role（仅 active member）
 */
export async function getActiveRole(
  userId: string,
  familyId: string,
  client?: Runner,
): Promise<FamilyRole | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT role FROM family_members
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
      LIMIT 1`,
    [familyId, userId],
  );
  if ((res.rows as unknown[]).length === 0) return null;
  return (res.rows as FamilyMemberRow[])[0].role;
}

/**
 * 列出 family 所有成员（active + left），JOIN users 获取 nickname/avatar_url
 * 排序：active members 按 joined_at ASC；left members 按 left_at DESC
 */
export async function listMembersWithUsers(
  familyId: string,
  client?: Runner,
): Promise<FamilyMemberWithUser[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT fm.family_id, fm.user_id, fm.role, fm.joined_at, fm.left_at,
            u.nickname, u.avatar_url
       FROM family_members fm
       JOIN users u ON u.id = fm.user_id
      WHERE fm.family_id = $1
      ORDER BY
        CASE WHEN fm.left_at IS NULL THEN 0 ELSE 1 END,
        CASE WHEN fm.left_at IS NULL THEN fm.joined_at END ASC,
        CASE WHEN fm.left_at IS NOT NULL THEN fm.left_at END DESC`,
    [familyId],
  );
  return (res.rows as FamilyMemberWithUserRow[]).map(rowToWithUser);
}

/**
 * 统计 family 的 active member 数量
 */
export async function countActiveMembers(
  familyId: string,
  client?: Runner,
): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT COUNT(*)::int AS cnt FROM family_members
      WHERE family_id = $1 AND left_at IS NULL`,
    [familyId],
  );
  return (res.rows as unknown as { cnt: number }[])[0].cnt;
}

/**
 * 加入 family（INSERT family_members）
 * 若历史成员 left_at IS NOT NULL，更新为重新加入（SET left_at = NULL, role = $3, joined_at = now()）
 */
export async function joinFamily(
  input: { familyId: string; userId: string; role: FamilyRole },
  client?: Runner,
): Promise<FamilyMemberEntity> {
  const runner = client ?? exec();

  // 先尝试 INSERT；若 PK 冲突（历史成员），UPDATE 为重新加入
  const res = await runner.query(
    `INSERT INTO family_members (family_id, user_id, role)
          VALUES ($1, $2, $3)
     ON CONFLICT (family_id, user_id)
     DO UPDATE SET left_at = NULL, role = $3, joined_at = now()
     RETURNING family_id, user_id, role, joined_at, left_at`,
    [input.familyId, input.userId, input.role],
  );
  if ((res.rows as unknown[]).length === 0) {
    throw new Error('[familyMemberRepo] INSERT/UPDATE family_members returned no row');
  }
  return rowToEntity((res.rows as FamilyMemberRow[])[0]);
}

/**
 * 移除成员（设置 left_at = now()，不物理删除）
 */
export async function setLeftAt(
  familyId: string,
  userId: string,
  client?: Runner,
): Promise<FamilyMemberEntity> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE family_members
        SET left_at = now()
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
     RETURNING family_id, user_id, role, joined_at, left_at`,
    [familyId, userId],
  );
  if ((res.rows as unknown[]).length === 0) {
    return await (async () => {
      const { AppError } = await import('../errors/AppError.js');
      const { ErrorCode } = await import('../errors/ErrorCode.js');
      throw new AppError(ErrorCode.NOT_FOUND, { message: 'member not found or already left' });
    })();
  }
  return rowToEntity((res.rows as FamilyMemberRow[])[0]);
}
