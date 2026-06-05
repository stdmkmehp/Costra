/**
 * Costra · Server · family_members DAO
 *
 * 卡号：COSTRA-221 · 事实源：server/db/migrations/0001_init.sql family_members 表
 *      + server/db/migrations/0012_family_members_color_slot.sql color_slot 列
 *
 * 职责：封装 family_members 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口，不暴露 pg 行对象
 *   - Runner 透传模式（与 familyRepo.ts 同构）
 */

import { getPool } from '../db/pool.js';
import { maxFamilyMembers } from '../config/defaults.js';

export type FamilyRole = 'owner' | 'member' | 'viewer';

export interface FamilyMemberEntity {
  familyId: string;
  userId: string;
  role: FamilyRole;
  /** 0~7 持久化配色槽位 · NULL = 该成员已 left，slot 已释放 */
  colorSlot: number | null;
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
  color_slot: number | null;
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
    colorSlot: r.color_slot,
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
    `SELECT fm.family_id, fm.user_id, fm.role, fm.color_slot, fm.joined_at, fm.left_at,
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
 * 选取该 family 当前未被占用的最小 color_slot（0~maxFamilyMembers-1）
 *
 * 并发安全：
 *   1. 调用方必须在事务内（withTx）调用，并把 client（PoolClient）传入 runner。
 *   2. 本函数 SELECT ... FOR UPDATE 锁住该 family 所有 active 成员行，
 *      串行化两个并发 acceptInvite 在同 family 上的 slot 分配。
 *   3. 应用层兜底：partial unique index uq_family_members_color_slot_active 是最后一道闸；
 *      若仍发生 unique violation（理论上不应发生）会以 23505 错误码上抛，由 service 层兜底。
 *
 * 失败语义：
 *   若所有 slot 都被占用，抛 RangeError，由调用方 joinFamily 转为 AppError(BUSINESS_RULE_VIOLATION)。
 *   理论上 acceptInvite 已在事务外校验 activeCount < maxFamilyMembers，但事务外检查与
 *   事务内分配存在 TOCTOU 窗口，本函数 + joinFamily 二次校验是最终保障。
 *
 * 注：`color_slot IS NOT NULL` 是防御性过滤——active 成员的 slot 由应用层保证非 NULL，
 * 但极端不一致数据下避免 null 混入 used Set；勿删。
 */
async function selectAvailableSlot(familyId: string, runner: Runner): Promise<number> {
  const res = await runner.query(
    `SELECT color_slot FROM family_members
      WHERE family_id = $1 AND left_at IS NULL AND color_slot IS NOT NULL
      FOR UPDATE`,
    [familyId],
  );
  const used = new Set<number>(
    (res.rows as unknown as { color_slot: number }[]).map(r => r.color_slot),
  );
  for (let s = 0; s < maxFamilyMembers; s += 1) {
    if (!used.has(s)) return s;
  }
  throw new RangeError(
    `[familyMemberRepo] no available color_slot for family ${familyId} (all ${maxFamilyMembers} occupied)`,
  );
}

/**
 * 加入 family（INSERT family_members）
 * 若历史成员 left_at IS NOT NULL，UPDATE 为重新加入（SET left_at = NULL, role, joined_at, color_slot 全部重新分配）
 *
 * 并发：调用方需保证在事务内执行（withTx），selectAvailableSlot 内部 FOR UPDATE 串行化分配；
 * partial unique index uq_family_members_color_slot_active 是最终兜底。
 *
 * 错误转换：
 *   - selectAvailableSlot 抛 RangeError（slot 全占满）→ 转 AppError(BUSINESS_RULE_VIOLATION, family_member_limit)
 *     （TOCTOU 兜底：service 层 acceptInvite 已先校验 activeCount，此处是事务内最后一道闸）
 */
export async function joinFamily(
  input: { familyId: string; userId: string; role: FamilyRole },
  client?: Runner,
): Promise<FamilyMemberEntity> {
  const runner = client ?? exec();

  let slot: number;
  try {
    slot = await selectAvailableSlot(input.familyId, runner);
  } catch (err) {
    if (err instanceof RangeError) {
      const { AppError } = await import('../errors/AppError.js');
      const { ErrorCode } = await import('../errors/ErrorCode.js');
      throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
        message: 'family member limit reached (color slot exhausted)',
        details: { rule: 'family_member_limit', max: maxFamilyMembers },
      });
    }
    throw err;
  }

  // INSERT or UPDATE（历史成员重新加入）
  // ON CONFLICT 分支同时刷新 color_slot：left 时已置 NULL，重新加入时按当前空位重新分配
  const res = await runner.query(
    `INSERT INTO family_members (family_id, user_id, role, color_slot)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (family_id, user_id)
     DO UPDATE SET left_at = NULL, role = $3, joined_at = now(), color_slot = $4
     RETURNING family_id, user_id, role, color_slot, joined_at, left_at`,
    [input.familyId, input.userId, input.role, slot],
  );
  if ((res.rows as unknown[]).length === 0) {
    throw new Error('[familyMemberRepo] INSERT/UPDATE family_members returned no row');
  }
  return rowToEntity((res.rows as FamilyMemberRow[])[0]);
}

/**
 * 移除成员（设置 left_at = now()，不物理删除）
 *
 * 同步释放 color_slot（置 NULL）：
 *   - partial unique index `WHERE left_at IS NULL` 不会再约束此行
 *   - 新人加入时 selectAvailableSlot 可立即复用该 slot
 */
export async function setLeftAt(
  familyId: string,
  userId: string,
  client?: Runner,
): Promise<FamilyMemberEntity> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE family_members
        SET left_at = now(), color_slot = NULL
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
     RETURNING family_id, user_id, role, color_slot, joined_at, left_at`,
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
