/**
 * Costra · Server · categories DAO
 *
 * 卡号：COSTRA-218 · 事实源：server/db/migrations/0001_init.sql `categories` 表
 *
 * 职责：封装 categories 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口（CategoryEntity），不暴露 pg 行对象
 *   - 不处理业务语义（如 "分类不存在要不要抛错"），由 service 层判定
 *   - Runner 模式（与 entryRepo.ts 同构），支持 Pool / PoolClient 事务注入
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export interface CategoryEntity {
  id: string;
  familyId: string | null; // null = 系统预设
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon: string;
  color: string | null;
  sortOrder: number;
  isSystem: boolean;
  parentId: string | null; // null = 一级分类
  isDirectDefault: boolean;
  // migration 0013：精确标记"点父一级时自动选中的默认子分类"
  isParentDefault: boolean;
  // migration 0013：全局二级展示区的展示顺序，NULL = 不展示
  displayOrder: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CategoryRow {
  id: string;
  family_id: string | null;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon: string;
  color: string | null;
  sort_order: number;
  is_system: boolean;
  parent_id: string | null;
  is_direct_default: boolean;
  is_parent_default: boolean;
  display_order: number | null;
  created_at: Date;
  updated_at: Date;
}

function rowToEntity(r: CategoryRow): CategoryEntity {
  return {
    id: r.id,
    familyId: r.family_id,
    name: r.name,
    type: r.type,
    icon: r.icon,
    color: r.color,
    sortOrder: r.sort_order,
    isSystem: r.is_system,
    parentId: r.parent_id,
    isDirectDefault: r.is_direct_default,
    isParentDefault: r.is_parent_default,
    displayOrder: r.display_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * 执行器抽象：允许 repo 在 Pool 或 tx PoolClient 上运行。
 * 与 entryRepo.ts 的 Runner 保持同构。
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: (CategoryRow & Record<string, unknown>)[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

export interface CreateCategoryInput {
  familyId: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  icon: string;
  color?: string | null;
  sortOrder?: number;
  parentId?: string | null;
}

/**
 * 查询系统分类 + 指定家庭自定义分类。
 * 系统分类 family_id IS NULL，家庭自定义分类 family_id = $1。
 * 按 sort_order ASC 排序。
 */
export async function findByFamily(familyId: string, client?: Runner): Promise<CategoryEntity[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, name, type, icon, color, sort_order, is_system,
            parent_id, is_direct_default, is_parent_default, display_order,
            created_at, updated_at
       FROM categories
      WHERE deleted_at IS NULL
        AND (family_id IS NULL OR family_id = $1)
      ORDER BY sort_order ASC`,
    [familyId],
  );
  return res.rows.map(rowToEntity);
}

/**
 * 按 id 查询分类。
 */
export async function findById(categoryId: string, client?: Runner): Promise<CategoryEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, name, type, icon, color, sort_order, is_system,
            parent_id, is_direct_default, is_parent_default, display_order,
            created_at, updated_at
       FROM categories
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [categoryId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 插入自定义分类。
 * is_system 默认 false，is_direct_default 默认 false（自定义分类不参与直选映射）。
 * is_parent_default 默认 false、display_order 默认 NULL（自定义分类暂不开放设置入口 · migration 0013）。
 */
export async function insert(input: CreateCategoryInput, client?: Runner): Promise<CategoryEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO categories (id, family_id, name, type, icon, color, sort_order, is_system,
                              parent_id, is_direct_default, is_parent_default, display_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, false, false, NULL)
        RETURNING id, family_id, name, type, icon, color, sort_order, is_system,
                  parent_id, is_direct_default, is_parent_default, display_order,
                  created_at, updated_at`,
    [
      id,
      input.familyId,
      input.name,
      input.type,
      input.icon,
      input.color ?? null,
      input.sortOrder ?? 0,
      input.parentId ?? null,
    ],
  );
  if (!res.rows[0]) {
    throw new Error('[categoryRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 降级校验支持（migration 0004 · 配套 entry 写入 category_id 降级）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 查重定向表：硬删后服务端"category_id 不存在 → 找重定向 new_id"的唯一事实源。
 * 表语义见 migration 0004 Step C-1。
 */
export async function findRedirect(
  oldId: string,
  client?: Runner,
): Promise<{ newId: string } | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT new_id FROM category_redirects WHERE old_id = $1 LIMIT 1`,
    [oldId],
  );
  const row = res.rows[0] as { new_id?: string } | undefined;
  return row && row.new_id ? { newId: row.new_id } : null;
}

/**
 * 按 entry type 取兜底 category。
 *
 * 用途：entry 写入时 category_id 既不命中 categories 也不命中 category_redirects 时，
 * 落到同 type 的默认子分类，避免产生 entry.type 与 category.type 不一致的脏数据。
 *
 * 当前策略：
 *   - expense → 其他 · 其他
 *   - income  → 意外收入 · 其他
 *   - transfer → 第一个 transfer 一级下的默认子（当前为 储值 · 储值）
 */
export async function findFallbackCategoryId(
  type: 'income' | 'expense' | 'transfer',
  client?: Runner,
): Promise<string | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT c.id
       FROM categories c
       JOIN categories p ON p.id = c.parent_id
      WHERE c.family_id IS NULL
        AND c.type = $1
        AND c.deleted_at IS NULL
        AND c.is_parent_default = true
        AND p.family_id IS NULL
        AND p.parent_id IS NULL
        AND p.deleted_at IS NULL
        AND (
          ($1 = 'expense'  AND p.name = '其他')
          OR ($1 = 'income'   AND p.name = '意外收入')
          OR ($1 = 'transfer')
        )
      ORDER BY p.sort_order ASC, c.sort_order ASC, c.id ASC
      LIMIT 1`,
    [type],
  );
  const row = res.rows[0] as { id?: string } | undefined;
  return row && row.id ? row.id : null;
}
