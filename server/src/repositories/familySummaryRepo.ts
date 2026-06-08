/**
 * Costra · Server · 家庭财务聚合 DAO
 *
 * 卡号：COSTRA-222 · 事实源：server/db/migrations/0001_init.sql `entries` 表
 *
 * 职责：封装家庭月度聚合所需的 SQL 查询；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回聚合结果接口，不暴露 pg 行对象
 *   - 不做业务语义判定（如权限守门），由 service 层负责
 *   - 查询必须 JOIN family/ledger/member 做 family 边界
 *
 * 性能边界（P2-2 吸收）：
 *   - R1 目标：单月 entries ≤ 5000 时 summary P95 ≤ 500ms
 *   - 超过该量级触发 FU-222-SUMMARY-PERF-INDEX 复合索引评估
 *   - 当前索引：idx_entries_ledger_occurred + idx_entries_shared_type
 */

import { getPool } from '../db/pool.js';

// --- 聚合结果类型 ---

/** 总计聚合行 */
export interface TotalsRow {
  expense: number;
  income: number;
  shared_expense: number;
  personal_expense: number;
  entry_count: number;
  skipped_unclassified_expense_count: number;
}

/** 成员维度聚合行 */
export interface MemberAggRow {
  user_id: string;
  personal_expense: number;
  paid_contribution: number;
  expense_count: number;
}

/** 分类排行行 */
export interface CategoryRankRow {
  category_id: string | null;
  category_name: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  amount: number;
  entry_count: number;
}

export interface MemberCategoryRankRow extends CategoryRankRow {
  user_id: string;
}

/**
 * 执行器抽象
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/**
 * 获取月度总计聚合
 *
 * 口径：
 *   - expense = SUM(amount) WHERE type='expense' AND shared_type IN ('shared','personal')
 *   - income = SUM(amount) WHERE type='income'
 *   - shared_expense = SUM(amount) WHERE type='expense' AND shared_type='shared'
 *   - personal_expense = SUM(amount) WHERE type='expense' AND shared_type='personal'
 *   - entry_count = COUNT(*) WHERE type IN ('income','expense')
 *   - skipped_unclassified_expense_count = COUNT(*) WHERE type='expense' AND shared_type IS NULL
 *   - transfer 不计入任何聚合
 */
export async function getTotals(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  client?: Runner,
): Promise<TotalsRow> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT
       COALESCE(SUM(CASE WHEN e.type = 'expense' AND e.shared_type IN ('shared','personal') THEN e.amount ELSE 0 END), 0) AS expense,
       COALESCE(SUM(CASE WHEN e.type = 'income' THEN e.amount ELSE 0 END), 0) AS income,
       COALESCE(SUM(CASE WHEN e.type = 'expense' AND e.shared_type = 'shared' THEN e.amount ELSE 0 END), 0) AS shared_expense,
       COALESCE(SUM(CASE WHEN e.type = 'expense' AND e.shared_type = 'personal' THEN e.amount ELSE 0 END), 0) AS personal_expense,
       COUNT(CASE WHEN e.type IN ('income','expense') THEN 1 END) AS entry_count,
       COUNT(CASE WHEN e.type = 'expense' AND e.shared_type IS NULL THEN 1 END) AS skipped_unclassified_expense_count
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3`,
    [ledgerId, rangeStartUtc, rangeEndUtc],
  );
  const r = res.rows[0];
  return {
    expense: Number(r?.expense ?? 0),
    income: Number(r?.income ?? 0),
    shared_expense: Number(r?.shared_expense ?? 0),
    personal_expense: Number(r?.personal_expense ?? 0),
    entry_count: Number(r?.entry_count ?? 0),
    skipped_unclassified_expense_count: Number(r?.skipped_unclassified_expense_count ?? 0),
  };
}

/**
 * 获取成员维度聚合
 *
 * 口径：
 *   - personal_expense: SUM(amount) WHERE type='expense' AND shared_type='personal' AND created_by=该成员
 *   - paid_contribution: SUM(amount) WHERE type='expense' AND shared_type='shared' AND created_by=该成员
 *   - expense_count: COUNT(*) WHERE type='expense' AND created_by=该成员
 *   - shared_type IS NULL 的 expense 不计入
 */
export async function getMemberAggregates(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  client?: Runner,
): Promise<MemberAggRow[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT
       e.created_by AS user_id,
       COALESCE(SUM(CASE WHEN e.shared_type = 'personal' THEN e.amount ELSE 0 END), 0) AS personal_expense,
       COALESCE(SUM(CASE WHEN e.shared_type = 'shared' THEN e.amount ELSE 0 END), 0) AS paid_contribution,
       COUNT(CASE WHEN e.type = 'expense' AND e.shared_type IN ('shared','personal') THEN 1 END) AS expense_count
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type = 'expense'
       AND e.shared_type IS NOT NULL
     GROUP BY e.created_by`,
    [ledgerId, rangeStartUtc, rangeEndUtc],
  );
  return res.rows.map((r) => ({
    user_id: String(r.user_id),
    personal_expense: Number(r.personal_expense ?? 0),
    paid_contribution: Number(r.paid_contribution ?? 0),
    expense_count: Number(r.expense_count ?? 0),
  }));
}

/**
 * 获取分类排行（公共支出 or 个人支出）
 *
 * 口径：
 *   - 按 category_id 分组聚合 amount + entry_count
 *   - JOIN categories 获取 name + parent_id
 *   - 再 JOIN categories parent 获取 parent_name
 *   - 严格排除 amount = 0 的分类
 *   - 排序：amount DESC, category_name ASC
 *   - 限制 top_n 条
 *   - shared_type IS NULL 的 expense 不计入
 */
export async function getCategoryRanks(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  sharedType: 'shared' | 'personal',
  createdByUserId: string | null,
  topN: number,
  client?: Runner,
): Promise<CategoryRankRow[]> {
  const runner = client ?? exec();
  const conditions: string[] = [
    'e.ledger_id = $1',
    'e.deleted_at IS NULL',
    'e.occurred_at >= $2',
    'e.occurred_at < $3',
    "e.type = 'expense'",
    'e.shared_type = $4',
  ];
  const params: unknown[] = [ledgerId, rangeStartUtc, rangeEndUtc, sharedType];
  let idx = 5;

  if (createdByUserId) {
    conditions.push(`e.created_by = $${idx++}`);
    params.push(createdByUserId);
  }

  // 先按 entries 聚合，再单独批量查询 categories。
  // 原单 SQL LEFT JOIN + HAVING 在真 PG 可用，但 pg-mem 对 HAVING 聚合与部分 UUID LEFT JOIN 支持不完整。
  // 该实现仍保持非 N+1：最多 3 次查询（聚合 + category 批量 + parent 批量）。
  const aggRes = await runner.query(
    `SELECT
       e.category_id AS category_id,
       SUM(e.amount) AS amount,
       COUNT(*) AS entry_count
     FROM entries e
     WHERE ${conditions.join(' AND ')}
     GROUP BY e.category_id`,
    params,
  );

  type CategoryMeta = { id: string; name: string; parent_id: string | null };
  const categoryIds = Array.from(new Set(
    aggRes.rows
      .map((r) => (r.category_id ? String(r.category_id) : null))
      .filter((id): id is string => id !== null),
  ));

  const categoryMap = new Map<string, CategoryMeta>();
  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map((_, i) => `$${i + 1}`).join(', ');
    const catRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      categoryIds,
    );
    for (const row of catRes.rows) {
      const id = String(row.id);
      categoryMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  const parentIds = Array.from(new Set(
    Array.from(categoryMap.values())
      .map((c) => c.parent_id)
      .filter((id): id is string => id !== null),
  ));
  const parentMap = new Map<string, CategoryMeta>();
  if (parentIds.length > 0) {
    const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ');
    const parentRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      parentIds,
    );
    for (const row of parentRes.rows) {
      const id = String(row.id);
      parentMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  return aggRes.rows
    .map((r) => {
      const categoryId = r.category_id ? String(r.category_id) : null;
      const category = categoryId ? categoryMap.get(categoryId) : undefined;
      const parent = category?.parent_id ? parentMap.get(category.parent_id) : undefined;
      return {
        category_id: categoryId,
        category_name: category?.name ?? '未分类',
        parent_category_id: category?.parent_id ?? null,
        parent_category_name: parent?.name ?? null,
        amount: Number(r.amount ?? 0),
        entry_count: Number(r.entry_count ?? 0),
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => (b.amount - a.amount) || a.category_name.localeCompare(b.category_name, 'zh-Hans-CN'))
    .slice(0, topN);
}

/**
 * 批量获取所有成员 personal expense 的分类排行。
 *
 * 用于避免 service 层按 member 循环调用 getCategoryRanks 形成 N+1 查询。
 * 最多 3 次查询：聚合 + category 批量 + parent 批量。
 */
export async function getPersonalCategoryRanksByMember(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  topN: number,
  client?: Runner,
): Promise<MemberCategoryRankRow[]> {
  const runner = client ?? exec();
  const aggRes = await runner.query(
    `SELECT
       e.created_by AS user_id,
       e.category_id AS category_id,
       SUM(e.amount) AS amount,
       COUNT(*) AS entry_count
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type = 'expense'
       AND e.shared_type = 'personal'
     GROUP BY e.created_by, e.category_id`,
    [ledgerId, rangeStartUtc, rangeEndUtc],
  );

  type CategoryMeta = { id: string; name: string; parent_id: string | null };
  const categoryIds = Array.from(new Set(
    aggRes.rows
      .map((r) => (r.category_id ? String(r.category_id) : null))
      .filter((id): id is string => id !== null),
  ));

  const categoryMap = new Map<string, CategoryMeta>();
  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map((_, i) => `$${i + 1}`).join(', ');
    const catRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      categoryIds,
    );
    for (const row of catRes.rows) {
      const id = String(row.id);
      categoryMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  const parentIds = Array.from(new Set(
    Array.from(categoryMap.values())
      .map((c) => c.parent_id)
      .filter((id): id is string => id !== null),
  ));
  const parentMap = new Map<string, CategoryMeta>();
  if (parentIds.length > 0) {
    const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ');
    const parentRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      parentIds,
    );
    for (const row of parentRes.rows) {
      const id = String(row.id);
      parentMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  const grouped = new Map<string, MemberCategoryRankRow[]>();
  for (const r of aggRes.rows) {
    const userId = String(r.user_id);
    const categoryId = r.category_id ? String(r.category_id) : null;
    const category = categoryId ? categoryMap.get(categoryId) : undefined;
    const parent = category?.parent_id ? parentMap.get(category.parent_id) : undefined;
    const item: MemberCategoryRankRow = {
      user_id: userId,
      category_id: categoryId,
      category_name: category?.name ?? '未分类',
      parent_category_id: category?.parent_id ?? null,
      parent_category_name: parent?.name ?? null,
      amount: Number(r.amount ?? 0),
      entry_count: Number(r.entry_count ?? 0),
    };
    if (item.amount <= 0) continue;
    const list = grouped.get(userId) ?? [];
    list.push(item);
    grouped.set(userId, list);
  }

  const result: MemberCategoryRankRow[] = [];
  for (const list of grouped.values()) {
    result.push(
      ...list
        .sort((a, b) => (b.amount - a.amount) || a.category_name.localeCompare(b.category_name, 'zh-Hans-CN'))
        .slice(0, topN),
    );
  }
  return result;
}

/**
 * 获取分类排行（不截断版本）— 供 family summary L1 折叠使用。
 *
 * 与 getCategoryRanks 相同逻辑，但去掉最后的 .slice(0, topN)。
 * service 层在拿到 untrimmed leaf 后再做 L1 折叠 + topN 截断。
 *
 * 卡号：COSTRA-300
 */
export async function getCategoryRanksUntrimmed(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  sharedType: 'shared' | 'personal',
  createdByUserId: string | null,
  client?: Runner,
): Promise<CategoryRankRow[]> {
  const runner = client ?? exec();
  const conditions: string[] = [
    'e.ledger_id = $1',
    'e.deleted_at IS NULL',
    'e.occurred_at >= $2',
    'e.occurred_at < $3',
    "e.type = 'expense'",
    'e.shared_type = $4',
  ];
  const params: unknown[] = [ledgerId, rangeStartUtc, rangeEndUtc, sharedType];
  let idx = 5;

  if (createdByUserId) {
    conditions.push(`e.created_by = $${idx++}`);
    params.push(createdByUserId);
  }

  const aggRes = await runner.query(
    `SELECT
       e.category_id AS category_id,
       SUM(e.amount) AS amount,
       COUNT(*) AS entry_count
     FROM entries e
     WHERE ${conditions.join(' AND ')}
     GROUP BY e.category_id`,
    params,
  );

  type CategoryMeta = { id: string; name: string; parent_id: string | null };
  const categoryIds = Array.from(new Set(
    aggRes.rows
      .map((r) => (r.category_id ? String(r.category_id) : null))
      .filter((id): id is string => id !== null),
  ));

  const categoryMap = new Map<string, CategoryMeta>();
  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map((_, i) => `$${i + 1}`).join(', ');
    const catRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      categoryIds,
    );
    for (const row of catRes.rows) {
      const id = String(row.id);
      categoryMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  const parentIds = Array.from(new Set(
    Array.from(categoryMap.values())
      .map((c) => c.parent_id)
      .filter((id): id is string => id !== null),
  ));
  const parentMap = new Map<string, CategoryMeta>();
  if (parentIds.length > 0) {
    const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ');
    const parentRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      parentIds,
    );
    for (const row of parentRes.rows) {
      const id = String(row.id);
      parentMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  return aggRes.rows
    .map((r) => {
      const categoryId = r.category_id ? String(r.category_id) : null;
      const category = categoryId ? categoryMap.get(categoryId) : undefined;
      const parent = category?.parent_id ? parentMap.get(category.parent_id) : undefined;
      return {
        category_id: categoryId,
        category_name: category?.name ?? '未分类',
        parent_category_id: category?.parent_id ?? null,
        parent_category_name: parent?.name ?? null,
        amount: Number(r.amount ?? 0),
        entry_count: Number(r.entry_count ?? 0),
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => (b.amount - a.amount) || a.category_name.localeCompare(b.category_name, 'zh-Hans-CN'));
}

/**
 * 批量获取所有成员 personal expense 的分类排行（不截断版本）。
 *
 * 与 getPersonalCategoryRanksByMember 相同逻辑，但去掉成员级 .slice(0, topN)。
 * service 层在拿到 untrimmed leaf 后再做 L1 折叠 + topN 截断。
 *
 * 卡号：COSTRA-300
 */
export async function getPersonalCategoryRanksByMemberUntrimmed(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  client?: Runner,
): Promise<MemberCategoryRankRow[]> {
  const runner = client ?? exec();
  const aggRes = await runner.query(
    `SELECT
       e.created_by AS user_id,
       e.category_id AS category_id,
       SUM(e.amount) AS amount,
       COUNT(*) AS entry_count
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type = 'expense'
       AND e.shared_type = 'personal'
     GROUP BY e.created_by, e.category_id`,
    [ledgerId, rangeStartUtc, rangeEndUtc],
  );

  type CategoryMeta = { id: string; name: string; parent_id: string | null };
  const categoryIds = Array.from(new Set(
    aggRes.rows
      .map((r) => (r.category_id ? String(r.category_id) : null))
      .filter((id): id is string => id !== null),
  ));

  const categoryMap = new Map<string, CategoryMeta>();
  if (categoryIds.length > 0) {
    const placeholders = categoryIds.map((_, i) => `$${i + 1}`).join(', ');
    const catRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      categoryIds,
    );
    for (const row of catRes.rows) {
      const id = String(row.id);
      categoryMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  const parentIds = Array.from(new Set(
    Array.from(categoryMap.values())
      .map((c) => c.parent_id)
      .filter((id): id is string => id !== null),
  ));
  const parentMap = new Map<string, CategoryMeta>();
  if (parentIds.length > 0) {
    const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ');
    const parentRes = await runner.query(
      `SELECT id, name, parent_id FROM categories WHERE id IN (${placeholders})`,
      parentIds,
    );
    for (const row of parentRes.rows) {
      const id = String(row.id);
      parentMap.set(id, {
        id,
        name: String(row.name),
        parent_id: row.parent_id ? String(row.parent_id) : null,
      });
    }
  }

  const result: MemberCategoryRankRow[] = [];
  for (const r of aggRes.rows) {
    const userId = String(r.user_id);
    const categoryId = r.category_id ? String(r.category_id) : null;
    const category = categoryId ? categoryMap.get(categoryId) : undefined;
    const parent = category?.parent_id ? parentMap.get(category.parent_id) : undefined;
    const item: MemberCategoryRankRow = {
      user_id: userId,
      category_id: categoryId,
      category_name: category?.name ?? '未分类',
      parent_category_id: category?.parent_id ?? null,
      parent_category_name: parent?.name ?? null,
      amount: Number(r.amount ?? 0),
      entry_count: Number(r.entry_count ?? 0),
    };
    if (item.amount <= 0) continue;
    result.push(item);
  }

  // 按成员内排序（amount DESC, name ASC）但不截断
  const grouped = new Map<string, MemberCategoryRankRow[]>();
  for (const item of result) {
    const list = grouped.get(item.user_id) ?? [];
    list.push(item);
    grouped.set(item.user_id, list);
  }

  const sorted: MemberCategoryRankRow[] = [];
  for (const list of grouped.values()) {
    sorted.push(
      ...list.sort((a, b) => (b.amount - a.amount) || a.category_name.localeCompare(b.category_name, 'zh-Hans-CN')),
    );
  }
  return sorted;
}
