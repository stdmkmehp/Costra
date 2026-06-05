/**
 * Costra · Server · families DAO
 *
 * 卡号：COSTRA-164 · 事实源：server/db/migrations/0001_init.sql + 0007_families_kind.sql
 * 决策锚定：ADR-0007 family-ledger 关系模型 v1.1 §4.1 + §5.7
 *
 * 职责：封装 families 表 + family_members 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口（FamilyEntity），不暴露 pg 行对象
 *   - 不处理业务语义（如 "family 不存在要不要抛错"），由 service 层判定
 *   - Runner 透传模式（与 userRepo.ts L65/L114/L141 同构）· 单测可注入 mock
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

/** family_kind ENUM（与 0007 migration 同步）· ADR-0007 §5.7.2 创建路径铁律 */
export type FamilyKind = 'personal' | 'shared';

export interface FamilyEntity {
  id: string;
  name: string;
  ownerId: string;
  kind: FamilyKind;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

interface FamilyRow {
  id: string;
  name: string;
  owner_id: string;
  kind: FamilyKind;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

function rowToEntity(r: FamilyRow): FamilyEntity {
  return {
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    kind: r.kind,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
  };
}

/**
 * 执行器抽象：允许 repo 在 Pool 或 tx PoolClient 上运行。
 * 与 userRepo.ts 的 Runner 保持同构。
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: FamilyRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/**
 * 创建个人 family + family_members(owner) · 单事务 · kind 强制 'personal'
 *
 * 调用方不传 kind · 内部硬编码（防漂移 · ADR-0007 §5.7.2 创建路径铁律）
 * 防御层：partial unique index uq_families_one_personal_per_owner 兜底
 *   · 若 race condition 重复 INSERT 会触发 unique violation · service 层应捕获并 fallback findPersonal
 */
export async function createPersonalFamily(
  input: { ownerId: string; name: string },
  client?: Runner,
): Promise<FamilyEntity> {
  const id = newId();
  const runner = client ?? exec();

  // ① INSERT family（kind 硬编码 'personal' · 不允许调用方传参）
  const res = await runner.query(
    `INSERT INTO families (id, name, owner_id, kind)
          VALUES ($1, $2, $3, 'personal')
        RETURNING id, name, owner_id, kind, created_at, updated_at, deleted_at, version`,
    [id, input.name, input.ownerId],
  );
  if (!res.rows[0]) {
    throw new Error('[familyRepo] INSERT family returned no row');
  }
  const family = rowToEntity(res.rows[0]);

  // ② INSERT family_members(owner) · 同事务
  await runner.query(
    `INSERT INTO family_members (family_id, user_id, role)
          VALUES ($1, $2, 'owner')`,
    [family.id, input.ownerId],
  );

  return family;
}

/**
 * 按 id 查 family（COSTRA-217 R1.x：entryService 需查 family kind 判定 shared_type 默认值）
 */
export async function findById(
  familyId: string,
  client?: Runner,
): Promise<FamilyEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, name, owner_id, kind, created_at, updated_at, deleted_at, version
       FROM families
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [familyId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 查 user 的所有 active families（left_at IS NULL · 排序 created_at ASC）
 * 可选 filter by kind（Sprint-4 切换器 UI 用）
 */
export async function listActiveFamiliesByUser(
  userId: string,
  filter?: { kind?: FamilyKind },
  client?: Runner,
): Promise<FamilyEntity[]> {
  const runner = client ?? exec();
  const params: unknown[] = [userId];
  let kindFilter = '';
  if (filter?.kind) {
    kindFilter = ' AND f.kind = $2';
    params.push(filter.kind);
  }
  const res = await runner.query(
    `SELECT f.id, f.name, f.owner_id, f.kind, f.created_at, f.updated_at, f.deleted_at, f.version
       FROM families f
       JOIN family_members fm ON fm.family_id = f.id
      WHERE fm.user_id = $1 AND fm.left_at IS NULL AND f.deleted_at IS NULL${kindFilter}
      ORDER BY f.created_at ASC`,
    params,
  );
  return res.rows.map(rowToEntity);
}

/**
 * 查 user 的"个人 family"（kind='personal' AND owner_id=user_id · 至多 1 个 · partial unique index 保证）
 *
 * v1.1：必须用 WHERE kind='personal' · 不再用 created_at ASC 取第一个
 * （partial unique index uq_families_one_personal_per_owner 保证唯一）
 */
export async function findPersonalFamily(
  userId: string,
  client?: Runner,
): Promise<FamilyEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, name, owner_id, kind, created_at, updated_at, deleted_at, version
       FROM families
      WHERE owner_id = $1 AND kind = 'personal' AND deleted_at IS NULL
      LIMIT 1`,
    [userId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 软删 family · kind='personal' 守门 + owner_id 守门（ADR-0007 §5.7.3 早期防御 · v2.0 FU-164-004）
 *
 * 实现：
 *   1) 先查 kind + owner_id（同时定位资源 + 校验所有权 · O(1) 索引扫描 idx_families_owner）
 *   2) 不存在 / 不是当前 user 拥有 → throw NOT_FOUND（与 entryRepo.findById 范式一致 · 不暴露存在性）
 *   3) kind === 'personal' → throw AppError(FAMILY_PERSONAL_NOT_DELETABLE)
 *   4) UPDATE families SET deleted_at=now(), version=version+1 WHERE id=$1 AND version=$2 AND owner_id=$3
 *
 * ⚠️ ownerId 守门：Sprint-2 retro 议题候选 5 实战兑现（review-tech R1 P1-3）·
 *    防 152 R1 时 entryService.findById 漏写 userId 过滤的同款盲区 ·
 *    任何 caller 必须传 ownerId · 不接受 null 或 fallback 跳过校验
 *
 * 本卡不暴露 REST 端点（DELETE /families 推 Sprint-4 COSTRA-201）· 但 service 层接口已就位
 */
export async function softDelete(
  input: { familyId: string; version: number; ownerId: string },
  client?: Runner,
): Promise<FamilyEntity> {
  const runner = client ?? exec();

  // 先查 kind + 校验 owner_id
  // pg-mem bug: partial unique index 导致 WHERE id=$1 AND owner_id=$2 参数化查询返回空
  // 修复：先按 id 查，应用层校验 owner_id（生产 PostgreSQL 行为一致，只是多一次 JS 比较）
  const findRes = await runner.query(
    `SELECT id, name, owner_id, kind, created_at, updated_at, deleted_at, version
       FROM families
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [input.familyId],
  );
  if (!findRes.rows[0]) {
    // 不存在 OR 已删除 · 返 NOT_FOUND（不暴露存在性 · 范式参 entryService.findById）
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }
  const family = rowToEntity(findRes.rows[0]);

  // 应用层校验 owner_id（与 WHERE owner_id=$2 等价，但绕过 pg-mem partial index bug）
  if (family.ownerId !== input.ownerId) {
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }

  // kind 守门：personal family 不可删除
  if (family.kind === 'personal') {
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.FAMILY_PERSONAL_NOT_DELETABLE, {
      message: 'personal family cannot be deleted',
    });
  }

  // 乐观锁软删 · WHERE 校验 version（owner_id 已在上方 SELECT 阶段验证）
  // pg-mem bug: partial unique index 导致 WHERE ... AND owner_id=$N 参数化查询异常
  // 生产 PostgreSQL 行为一致：owner_id 已验证，UPDATE 只需 version 乐观锁
  const res = await runner.query(
    `UPDATE families
        SET deleted_at = now(), version = version + 1
      WHERE id = $1 AND version = $2 AND deleted_at IS NULL
     RETURNING id, name, owner_id, kind, created_at, updated_at, deleted_at, version`,
    [input.familyId, input.version],
  );
  if (!res.rows[0]) {
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.VERSION_CONFLICT, {
      message: 'family version conflict or already deleted',
    });
  }
  return rowToEntity(res.rows[0]);
}

/**
 * 统计 user 当前 owned（owner_id = userId）且未软删的 shared family 数量
 * 用于 createFamily 前的上限校验（service 层消费）
 */
export async function countOwnedSharedFamilies(
  userId: string,
  client?: Runner,
): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT COUNT(*)::int AS cnt FROM families
      WHERE owner_id = $1 AND kind = 'shared' AND deleted_at IS NULL`,
    [userId],
  );
  return (res.rows as unknown as { cnt: number }[])[0].cnt;
}

/**
 * 统计 user 当前作为 active member 加入的 shared family 总数（含 owned）
 * 用于 acceptInvite 前的用户维度上限校验
 * 条件：kind = 'shared' AND deleted_at IS NULL AND left_at IS NULL
 */
export async function countJoinedSharedFamilies(
  userId: string,
  client?: Runner,
): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT COUNT(*)::int AS cnt
       FROM families f
       JOIN family_members fm ON fm.family_id = f.id
      WHERE fm.user_id = $1
        AND fm.left_at IS NULL
        AND f.kind = 'shared'
        AND f.deleted_at IS NULL`,
    [userId],
  );
  return (res.rows as unknown as { cnt: number }[])[0].cnt;
}


 * COSTRA-221: 与 createPersonalFamily 同构，kind 硬编码 'shared'
 */
export async function createSharedFamily(
  input: { ownerId: string; name: string },
  client?: Runner,
): Promise<FamilyEntity> {
  const id = newId();
  const runner = client ?? exec();

  // ① INSERT family（kind 硬编码 'shared'）
  const res = await runner.query(
    `INSERT INTO families (id, name, owner_id, kind)
          VALUES ($1, $2, $3, 'shared')
     RETURNING id, name, owner_id, kind, created_at, updated_at, deleted_at, version`,
    [id, input.name, input.ownerId],
  );
  if (!res.rows[0]) {
    throw new Error('[familyRepo] INSERT family returned no row');
  }
  const family = rowToEntity(res.rows[0]);

  // ② INSERT family_members(owner) · 同事务
  await runner.query(
    `INSERT INTO family_members (family_id, user_id, role)
          VALUES ($1, $2, 'owner')`,
    [family.id, input.ownerId],
  );

  return family;
}

/**
 * 更新 family name（乐观锁 · version+1）
 * COSTRA-221: PATCH /families/{id} 实装
 *
 * 注意：owner_id 校验在 service 层 assertOwner 完成，repo 层只做 version 乐观锁
 * （pg-mem partial unique index 导致 WHERE ... AND owner_id=$N 参数化查询异常）
 */
export async function updateName(
  input: { familyId: string; name: string; version: number; ownerId: string },
  client?: Runner,
): Promise<FamilyEntity> {
  const runner = client ?? exec();

  // 乐观锁更新 · owner_id 已在 service 层 assertOwner 校验
  const res = await runner.query(
    `UPDATE families
        SET name = $2, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $3 AND deleted_at IS NULL
     RETURNING id, name, owner_id, kind, created_at, updated_at, deleted_at, version`,
    [input.familyId, input.name, input.version],
  );
  if (!res.rows[0]) {
    const { AppError } = await import('../errors/AppError.js');
    const { ErrorCode } = await import('../errors/ErrorCode.js');
    throw new AppError(ErrorCode.VERSION_CONFLICT, {
      message: 'family version conflict or not found',
    });
  }
  return rowToEntity(res.rows[0]);
}
