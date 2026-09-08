/**
 * Costra · Server · family_members DAO
 *
 * 卡号：COSTRA-221 · 事实源：server/db/migrations/0001_init.sql `family_members` 表
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
  /** 0~7 座位号（原 color_slot 改名 · migration 0017）· 唯一、单调递增、用于稳定排序 · NULL = 已 left，seat 已释放 */
  seatOrder: number | null;
  /** 0~7 用户自选偏好色（migration 0017）· 允许撞色 · NULL = 已 left 的成员 */
  colorChoice: number | null;
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
  seat_order: number | null;
  color_choice: number | null;
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
    seatOrder: r.seat_order,
    colorChoice: r.color_choice,
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
 * 在写事务中锁定 active membership，避免授权检查后与 leave/remove 并发产生 TOCTOU。
 * FOR UPDATE 会与 setLeftAt/setAllActiveLeftAt 的 UPDATE 冲突，锁持有至调用方事务结束。
 */
export async function lockActiveMember(
  userId: string,
  familyId: string,
  client: Runner,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM family_members
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
      FOR UPDATE`,
    [familyId, userId],
  );
  return (res.rows as unknown[]).length > 0;
}

/**
 * 在写事务中按 ledger 锁定 active membership（entry update / softDelete 路径）。
 *
 * 与 lockActiveMember 的区别：入参是 ledger_id 而非 family_id，省掉调用方
 * 先查 ledger 拿 family_id 的一次往返。内部用常量标量子查询（非相关子查询），
 * 只锁 family_members 行，不会连带锁 ledgers。
 *
 * 加锁顺序必须为「family_members → entries → ledgers」（与 entryService create
 * 路径一致），否则与 create 并发时存在循环等待。调用方须在 `findByIdForUpdate`
 * 之前调用本函数。
 *
 * @returns 是否 active 成员（ledger 不存在时亦为 false · 不泄露存在性）
 */
export async function lockActiveMemberByLedger(
  userId: string,
  ledgerId: string,
  client: Runner,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM family_members
      WHERE family_id = (SELECT family_id FROM ledgers WHERE id = $1)
        AND user_id = $2 AND left_at IS NULL
      FOR UPDATE`,
    [ledgerId, userId],
  );
  return (res.rows as unknown[]).length > 0;
}

/**
 * 在写事务中按 family + user_ids 集合锁定活跃成员行（导入 worker 复核 · §7.5）。
 *
 * 与 lockActiveMember 的区别：入参是 id 集合，返回仍活跃的 user_id 列表。
 * 逐 id 按字典序加锁（与 ORDER BY user_id 单语句等价的全序），防并发路径间死锁；
 * FOR UPDATE 与 setLeftAt/setAllActiveLeftAt 的 UPDATE 冲突，锁持有至事务结束（堵 TOCTOU）。
 * 逐 id 而非 `= ANY($2)`：pg-mem 不支持数组参数 ANY 比较（测试通道与真 PG 行为须一致）。
 *
 * 加锁顺序必须为「family_members → entries → ledgers」（与 entryService 写路径一致）。
 */
export async function lockActiveMembersByIds(
  familyId: string,
  userIds: readonly string[],
  client: Runner,
): Promise<string[]> {
  const active: string[] = [];
  for (const userId of [...userIds].sort()) {
    const res = await client.query(
      `SELECT user_id FROM family_members
        WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
        FOR UPDATE`,
      [familyId, userId],
    );
    if ((res.rows as Array<{ user_id: string }>)[0]) active.push(userId);
  }
  return active;
}

/**
 * COSTRA-260: 校验 user 是否为 family 的成员（包含 active + left）
 *
 * 用途：统计接口的 user_id 维度越权防护 —— 允许查询已退出成员的历史数据，
 * 但 user_id 必须是该 family 的历史或当前成员（防越权探测他人在别 family 的数据）。
 */
export async function isMemberIncludingLeft(
  userId: string,
  familyId: string,
  client?: Runner,
): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT 1 FROM family_members
      WHERE family_id = $1 AND user_id = $2
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
    `SELECT fm.family_id, fm.user_id, fm.role, fm.seat_order, fm.color_choice, fm.joined_at, fm.left_at,
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
 * 选取该 family 当前未被占用的最小 seat_order（0~maxFamilyMembers-1）
 *
 * 并发安全：
 *   1. 调用方必须在事务内（withTx）调用，并把 client（PoolClient）传入 runner。
 *   2. 本函数 SELECT ... FOR UPDATE 锁住该 family 所有 active 成员行，
 *      串行化两个并发 acceptInvite 在同 family 上的 seat 分配。
 *   3. 应用层兜底：partial unique index uq_family_members_seat_active 是最后一道闸；
 *      若仍发生 unique violation（理论上不应发生）会以 23505 错误码上抛，由 service 层兜底。
 *
 * 失败语义：
 *   若所有 seat 都被占用，抛 RangeError，由调用方 joinFamily 转为 AppError(BUSINESS_RULE_VIOLATION)。
 *   理论上 acceptInvite 已在事务外校验 activeCount < maxFamilyMembers，但事务外检查与
 *   事务内分配存在 TOCTOU 窗口，本函数 + joinFamily 二次校验是最终保障。
 *
 * 注：`seat_order IS NOT NULL` 是防御性过滤——active 成员的 seat 由应用层保证非 NULL，
 * 但极端不一致数据下避免 null 混入 used Set；勿删。
 */
async function selectAvailableSlot(familyId: string, runner: Runner): Promise<number> {
  const res = await runner.query(
    `SELECT seat_order FROM family_members
      WHERE family_id = $1 AND left_at IS NULL AND seat_order IS NOT NULL
      FOR UPDATE`,
    [familyId],
  );
  const used = new Set<number>(
    (res.rows as unknown as { seat_order: number }[]).map(r => r.seat_order),
  );
  for (let s = 0; s < maxFamilyMembers; s += 1) {
    if (!used.has(s)) return s;
  }
  throw new RangeError(
    `[familyMemberRepo] no available seat_order for family ${familyId} (all ${maxFamilyMembers} occupied)`,
  );
}

/**
 * 加入 family（INSERT family_members）
 * 若历史成员 left_at IS NOT NULL，UPDATE 为重新加入（SET left_at = NULL, role, joined_at, seat_order + color_choice 全部重新分配）
 *
 * 并发：调用方需保证在事务内执行（withTx），selectAvailableSlot 内部 FOR UPDATE 串行化分配；
 * partial unique index uq_family_members_seat_active 是最终兜底。
 *
 * 错误转换：
 *   - selectAvailableSlot 抛 RangeError（seat 全占满）→ 转 AppError(BUSINESS_RULE_VIOLATION, family_member_limit)
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
        message: 'family member limit reached (seat exhausted)',
        details: { rule: 'family_member_limit', max: maxFamilyMembers },
      });
    }
    throw err;
  }

  // INSERT or UPDATE（历史成员重新加入）
  // ON CONFLICT 分支同时刷新 seat_order + color_choice：left 时已置 NULL，重新加入时按当前空位重新分配
  // color_choice 初始 = seat_order（默认体验与旧版一致，用户可后续自改）
  const res = await runner.query(
    `INSERT INTO family_members (family_id, user_id, role, seat_order, color_choice)
          VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (family_id, user_id)
     DO UPDATE SET left_at = NULL, role = $3, joined_at = now(), seat_order = $4, color_choice = $4
     RETURNING family_id, user_id, role, seat_order, color_choice, joined_at, left_at`,
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
 * 同步释放 seat_order + color_choice（置 NULL）：
 *   - partial unique index `WHERE left_at IS NULL` 不会再约束此行
 *   - 新人加入时 selectAvailableSlot 可立即复用该 seat
 */
export async function setLeftAt(
  familyId: string,
  userId: string,
  client?: Runner,
): Promise<FamilyMemberEntity> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE family_members
        SET left_at = now(), seat_order = NULL, color_choice = NULL
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
     RETURNING family_id, user_id, role, seat_order, color_choice, joined_at, left_at`,
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

/**
 * 选择 family 中除 excludeUserId 之外、最早加入的 active 成员，作为所有权移交目标。
 *
 * 卡号：COSTRA-229 · 决策：D-029 §2.2
 *
 * 排序规则：`joined_at ASC` —— 最早加入的 active 成员优先继承所有权。
 *   - 不读全量列表后再 JS 排序（用户偏好「不写硬逻辑」）
 *   - 数据库直接给出有序结果，O(1) 索引扫描（family_members(family_id, joined_at) 现有索引）
 *
 * 返回：候选 user_id；若家庭仅剩 excludeUserId 一人 active → 返回 null（调用方应走「自动解散」分支）。
 */
export async function findNextOwnerCandidate(
  familyId: string,
  excludeUserId: string,
  client?: Runner,
): Promise<string | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT user_id FROM family_members
      WHERE family_id = $1 AND user_id != $2 AND left_at IS NULL
      ORDER BY joined_at ASC
      LIMIT 1`,
    [familyId, excludeUserId],
  );
  if ((res.rows as unknown[]).length === 0) return null;
  return (res.rows as unknown as { user_id: string }[])[0].user_id;
}

/**
 * 在事务内把所有权从 fromUserId 移交给 toUserId。
 *
 * 卡号：COSTRA-229 · 决策：D-029 §2.2
 *
 * 调用方 MUST 在事务内调用并传入 client（PoolClient），保证以下四步要么全成功要么全回滚：
 *   1) 旧 owner SET role='member'
 *   2) 新 owner SET role='owner'
 *   3) 同步更新 families.owner_id = toUserId（保证两表 owner 一致）
 *   4) （由调用方）setLeftAt(fromUserId)
 *
 * 防御：两条 UPDATE 都加 `AND left_at IS NULL`，防御「极小窗口内目标成员先离开」的竞态
 *   —— 若任一行命中 0 行（理论上不会，因为 leaveFamily 入口 assertActiveMember 已守门），
 *      抛 NOT_FOUND 让事务回滚，业务侧表现为「移交失败 → 事务回滚 → 客户端可重试」。
 */
export async function transferOwnership(
  familyId: string,
  fromUserId: string,
  toUserId: string,
  client: Runner,
): Promise<void> {
  // 旧 owner 降级为 member
  const oldRes = await client.query(
    `UPDATE family_members
        SET role = 'member'
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [familyId, fromUserId],
  );
  if ((oldRes.rowCount ?? 0) === 0) {
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'transfer source member not found or already left',
      details: { family_id: familyId, user_id: fromUserId },
    });
  }

  // 新 owner 升级
  const newRes = await client.query(
    `UPDATE family_members
        SET role = 'owner'
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [familyId, toUserId],
  );
  if ((newRes.rowCount ?? 0) === 0) {
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'transfer target member not found or already left',
      details: { family_id: familyId, user_id: toUserId },
    });
  }

  // 同步 families.owner_id，保证 family_members.role 与 families.owner_id 一致
  await client.query(
    `UPDATE families
        SET owner_id = $2, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [familyId, toUserId],
  );
}

/**
 * 解散 family 时批量将所有 active 成员置为 left_at=now() 并释放 seat_order + color_choice。
 *
 * 卡号：COSTRA-229 · 决策：D-029 §2.3
 *
 * 调用方 MUST 在事务内调用并传入 client，与 familyRepo.softDelete 配对：
 *   - 必须先调本函数，再调 softDelete，保证「family 软删」与「成员 left_at 已写」一致
 *   - 单条 UPDATE 一次性完成，不需要 N 次往返
 *
 * 返回受影响行数（仅供日志/调试用，业务路径不依赖）。
 */
export async function setAllActiveLeftAt(
  familyId: string,
  client: Runner,
): Promise<number> {
  const res = await client.query(
    `UPDATE family_members
        SET left_at = now(), seat_order = NULL, color_choice = NULL
      WHERE family_id = $1 AND left_at IS NULL`,
    [familyId],
  );
  return res.rowCount ?? 0;
}

/**
 * 更新当前用户在 family 中的自选代表色（color_choice）
 *
 * migration 0017：color_choice 允许撞色，不做 unique 约束。
 * 仅 active 成员可调用（service 层 assertActiveMember 守门）。
 *
 * 返回更新后的 color_choice 值（供 service 层组装响应）。
 */
export async function updateColorChoice(
  familyId: string,
  userId: string,
  colorChoice: number,
  client?: Runner,
): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE family_members
        SET color_choice = $3
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
     RETURNING color_choice`,
    [familyId, userId, colorChoice],
  );
  if ((res.rows as unknown[]).length === 0) {
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'member not found or already left' });
  }
  return (res.rows as unknown as { color_choice: number }[])[0].color_choice;
}
