/**
 * Costra · Server · 分类业务编排层
 *
 * 卡号：COSTRA-218 · 事实源：server/api/openapi.yaml §categories
 *
 * 职责：
 *   - listCategories：权限校验 + 查询系统/家庭分类 + children_count 计算
 *   - createCategory：权限校验 + 层级校验 + 同名去重 + 插入
 *
 * 设计原则：
 *   - 权限守门：userId 必须属于 familyId（family_members 表校验）
 *   - children_count 应用层计算（内存 COUNT 按 parent_id 分组）
 *   - 不引入新依赖
 */

import { getPool } from '../db/pool.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as categoryRepo from '../repositories/categoryRepo.js';
import type { CategoryEntity } from '../repositories/categoryRepo.js';

// --- Wire 响应类型（与 OpenAPI Category schema 对齐）---

export interface CategoryResponse {
  id: string;
  family_id: string | null;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  color: string | null;
  sort_order: number;
  is_system: boolean;
  parent_id: string | null;
  is_direct_default: boolean;
  // migration 0013：精确标记"点父一级时自动选中的默认子分类"
  is_parent_default: boolean;
  // migration 0013：全局二级展示区的展示顺序，NULL = 不展示
  display_order: number | null;
  children_count: number;
}

export interface CreateCategoryPayload {
  family_id: string;
  name: string;
  type: 'income' | 'expense';
  icon: string;
  color?: string | null;
  parent_id?: string | null;
}

/**
 * 校验 user 是否属于 family（含 left_at IS NULL 排除已退出成员）
 * 与 syncPullService.isUserInFamily 同构 · FU-154-FAMILY-MEMBER-REPO 统一抽公共函数后合并
 */
async function isUserInFamily(userId: string, familyId: string): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT 1 FROM family_members
      WHERE family_id = $1 AND user_id = $2 AND left_at IS NULL
      LIMIT 1`,
    [familyId, userId],
  );
  return res.rows.length > 0;
}

function entityToResponse(e: CategoryEntity, childrenCount: number): CategoryResponse {
  return {
    id: e.id,
    family_id: e.familyId,
    name: e.name,
    type: e.type,
    icon: e.icon,
    color: e.color,
    sort_order: e.sortOrder,
    is_system: e.isSystem,
    parent_id: e.parentId,
    is_direct_default: e.isDirectDefault,
    is_parent_default: e.isParentDefault,
    display_order: e.displayOrder,
    children_count: childrenCount,
  };
}

/**
 * 应用层计算 children_count：按 parent_id 分组 COUNT
 * 一级分类 children_count = 其下二级数量；二级分类 children_count = 0
 */
function computeChildrenCounts(categories: CategoryEntity[]): Map<string, number> {
  const countMap = new Map<string, number>();
  for (const cat of categories) {
    if (cat.parentId) {
      countMap.set(cat.parentId, (countMap.get(cat.parentId) ?? 0) + 1);
    }
  }
  return countMap;
}

/**
 * 列出分类（系统预设 + 家庭自定义），返回平铺 Category[]（含 children_count）
 */
export async function listCategories(userId: string, familyId: string): Promise<CategoryResponse[]> {
  // 权限守门：userId 必须属于 familyId
  const isMember = await isUserInFamily(userId, familyId);
  if (!isMember) {
    throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, {
      message: 'user is not a member of this family',
      details: { family_id: familyId },
    });
  }

  const categories = await categoryRepo.findByFamily(familyId);
  const childrenCounts = computeChildrenCounts(categories);

  return categories.map((cat) => entityToResponse(cat, childrenCounts.get(cat.id) ?? 0));
}

/**
 * 创建家庭自定义分类
 *
 * 校验链：
 *   1. userId 属于 familyId（权限守门）
 *   2. parent_id 若存在，必须是一级分类（parentId 为 null），禁止三层
 *   3. 同名同类型同 parent 下不重复（应用层校验 + DB UNIQUE 约束兜底）
 */
export async function createCategory(userId: string, payload: CreateCategoryPayload): Promise<CategoryResponse> {
  // 1. 权限守门
  const isMember = await isUserInFamily(userId, payload.family_id);
  if (!isMember) {
    throw new AppError(ErrorCode.FAMILY_NOT_MEMBER, {
      message: 'user is not a member of this family',
      details: { family_id: payload.family_id },
    });
  }

  // 2. 层级校验：parent_id 指向的分类必须是一级（其 parent_id 为 null）
  if (payload.parent_id) {
    const parent = await categoryRepo.findById(payload.parent_id);
    if (!parent) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: 'parent category not found',
        details: { parent_id: payload.parent_id },
      });
    }
    if (parent.parentId !== null) {
      throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
        message: 'category hierarchy exceeds 2 levels (parent is already a child)',
        details: { rule: 'max_two_levels', parent_id: payload.parent_id },
      });
    }
  }

  // 3. 同名同类型同 parent 去重校验（应用层 + DB UNIQUE 约束双重保障）
  const existing = await categoryRepo.findByFamily(payload.family_id);
  const normalisedParentId = payload.parent_id ?? null;
  const duplicate = existing.some(
    (cat) => cat.name === payload.name && cat.type === payload.type && cat.parentId === normalisedParentId,
  );
  if (duplicate) {
    throw new AppError(ErrorCode.DUPLICATE_RESOURCE, {
      message: 'category with same name, type and parent already exists in this family',
      details: { name: payload.name, type: payload.type, parent_id: normalisedParentId },
    });
  }

  // 4. 插入（DB uq_categories_family_name_type_parent 兜底）
  try {
    const entity = await categoryRepo.insert({
      familyId: payload.family_id,
      name: payload.name,
      type: payload.type,
      icon: payload.icon,
      color: payload.color,
      parentId: payload.parent_id,
    });
    return entityToResponse(entity, 0);
  } catch (err: unknown) {
    const msg = (err as { message?: string }).message ?? '';
    if (msg.includes('uq_categories_family_name_type_parent') || msg.includes('duplicate key')) {
      throw new AppError(ErrorCode.DUPLICATE_RESOURCE, {
        message: 'category with same name, type and parent already exists in this family',
        details: { name: payload.name, type: payload.type, parent_id: payload.parent_id ?? null },
      });
    }
    throw err;
  }
}
