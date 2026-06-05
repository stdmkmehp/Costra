/**
 * Costra · Server · 统计页 DAO
 *
 * 卡号：COSTRA-224 · 事实源：docs/design/statistics-page-tech-spec.md §3
 *
 * 职责：封装统计页所需的 SQL 查询；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回聚合接口/原始行；不暴露 pg 行对象
 *   - 不做业务语义判定（如权限守门），由 service 层负责
 *   - 时区转换与日/月分桶在 service 层用 JS 完成（避免 pg-mem 兼容问题）
 *
 * 性能边界：
 *   - 依赖 migration 0014 新增的 idx_entries_category_id + idx_categories_parent_id
 *   - 单月 entries ≤ 5000 时：monthly P95 ≤ 500ms · yearly P95 ≤ 800ms · drill-down ≤ 200ms
 */

import { getPool } from '../db/pool.js';

// --- 行类型 ---

/** 月度/年度 totals 聚合 */
export interface StatTotalsRow {
  expense: number;
  income: number;
  entry_count: number;
}

/** entry 原始行（用于日/月分桶 + max_single + max_day 计算） */
export interface RawEntryForStat {
  amount: number;
  type: 'expense' | 'income';
  occurred_at: string;        // ISO UTC
  shared_type: 'shared' | 'personal' | null;
  category_id: string | null;
}

/** 分类排行行（含 category 元信息） */
export interface CategoryRankAggRow {
  category_id: string;
  amount: number;
  entry_count: number;
}

/** 单笔明细行（用于 L3 下钻） */
export interface EntryDetailRow {
  entry_id: string;
  amount: number;
  note: string | null;
  occurred_at: string;
  shared_type: 'shared' | 'personal' | null;
  created_by: string;
  nickname: string;
  avatar_url: string | null;
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/**
 * 拉取指定 ledger + 时间范围内的"原始 expense/income entry 数据"。
 *
 * 返回最小字段集（amount/type/occurred_at/shared_type/category_id），
 * 由 service 层在 JS 中：
 *   - 按 Asia/Shanghai 时区分桶到日/月
 *   - 计算 totals / max_single_expense / max_day_expense
 *   - 排除 transfer 与 shared_type IS NULL 的 expense（与 family summary 一致）
 *
 * 单月 5000 条 entries 实测：JS 分桶 < 5ms，总开销主要在 SQL 拉取（~50ms）。
 * 此方案优于 SQL date_trunc + AT TIME ZONE（pg-mem 兼容性问题）。
 */
export async function listEntriesInRange(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  client?: Runner,
): Promise<RawEntryForStat[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT
       e.amount AS amount,
       e.type AS type,
       e.occurred_at AS occurred_at,
       e.shared_type AS shared_type,
       e.category_id AS category_id
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type IN ('expense', 'income')
       -- 与 family summary 一致：expense 必须有 shared_type
       AND (e.type = 'income' OR e.shared_type IS NOT NULL)`,
    [ledgerId, rangeStartUtc, rangeEndUtc],
  );
  return res.rows.map((r) => ({
    amount: Number(r.amount ?? 0),
    type: r.type as 'expense' | 'income',
    occurred_at: typeof r.occurred_at === 'string'
      ? r.occurred_at
      : (r.occurred_at as Date).toISOString(),
    shared_type: (r.shared_type as 'shared' | 'personal' | null) ?? null,
    category_id: r.category_id ? String(r.category_id) : null,
  }));
}

/**
 * L1 一级分类排行 · 按 entries.category_id 分组聚合后，
 * service 层再用 categories.parent_id 把二级累加到一级。
 *
 * 返回的是按 category_id（即二级 id）分组的聚合，
 * service 层负责"二级 → 一级"的折叠。
 *
 * 仅 expense + shared_type IS NOT NULL（与 family summary 一致）。
 */
export async function getCategoryAggregates(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  client?: Runner,
): Promise<CategoryRankAggRow[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT
       e.category_id AS category_id,
       COALESCE(SUM(e.amount), 0) AS amount,
       COUNT(*) AS entry_count
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type = 'expense'
       AND e.shared_type IS NOT NULL
       AND e.category_id IS NOT NULL
     GROUP BY e.category_id`,
    [ledgerId, rangeStartUtc, rangeEndUtc],
  );
  return res.rows.map((r) => ({
    category_id: String(r.category_id),
    amount: Number(r.amount ?? 0),
    entry_count: Number(r.entry_count ?? 0),
  }));
}

/**
 * L2 二级分类排行：返回指定 parent_id 下的二级分类聚合（按 amount 降序）。
 *
 * 实现：先按 entries.category_id 聚合，再筛选出 parent_id = $4 的子分类。
 * 不带 LIMIT，由 service 层应用分页（避免 pg-mem 在某些 GROUP BY + LIMIT 场景下的兼容问题）。
 */
export async function getSubCategoryAggregates(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  parentCategoryId: string,
  client?: Runner,
): Promise<CategoryRankAggRow[]> {
  const runner = client ?? exec();
  // 注意：JOIN categories 用 parent_id 筛选 · 子分类的 entries 才计入
  const res = await runner.query(
    `SELECT
       e.category_id AS category_id,
       COALESCE(SUM(e.amount), 0) AS amount,
       COUNT(*) AS entry_count
     FROM entries e
     JOIN categories c ON c.id = e.category_id
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type = 'expense'
       AND e.shared_type IS NOT NULL
       AND c.parent_id = $4
       AND c.deleted_at IS NULL
     GROUP BY e.category_id`,
    [ledgerId, rangeStartUtc, rangeEndUtc, parentCategoryId],
  );
  return res.rows.map((r) => ({
    category_id: String(r.category_id),
    amount: Number(r.amount ?? 0),
    entry_count: Number(r.entry_count ?? 0),
  }));
}

/**
 * 批量获取 categories 元信息（含 parent_id）。
 *
 * 用于 service 层把"二级 category_id → 一级 parent_id + 名称/图标"映射建立。
 * 单次批量查询，避免 N+1。
 */
export interface CategoryMeta {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string;
  type: string;  // 'expense' | 'income'
}

export async function getCategoriesByIds(
  ids: string[],
  client?: Runner,
): Promise<CategoryMeta[]> {
  if (ids.length === 0) return [];
  const runner = client ?? exec();
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const res = await runner.query(
    `SELECT id, name, parent_id, icon, type
     FROM categories
     WHERE id IN (${placeholders})
       AND deleted_at IS NULL`,
    ids,
  );
  return res.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    parent_id: r.parent_id ? String(r.parent_id) : null,
    icon: String(r.icon ?? ''),
    type: String(r.type ?? 'expense'),
  }));
}

/**
 * L3 单笔明细：指定 category_id 下的 entry 列表，按金额降序、时间降序。
 *
 * JOIN users 一次性拿 nickname + avatar_url。
 */
export async function listEntriesByCategory(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  categoryId: string,
  limit: number,
  offset: number,
  client?: Runner,
): Promise<{ items: EntryDetailRow[]; total: number }> {
  const runner = client ?? exec();

  // 总数（用于 has_more 判定）
  const countRes = await runner.query(
    `SELECT COUNT(*) AS total
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type = 'expense'
       AND e.shared_type IS NOT NULL
       AND e.category_id = $4`,
    [ledgerId, rangeStartUtc, rangeEndUtc, categoryId],
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  // 数据
  const dataRes = await runner.query(
    `SELECT
       e.id AS entry_id,
       e.amount AS amount,
       e.note AS note,
       e.occurred_at AS occurred_at,
       e.shared_type AS shared_type,
       e.created_by AS created_by,
       u.nickname AS nickname,
       u.avatar_url AS avatar_url
     FROM entries e
     JOIN users u ON u.id = e.created_by
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type = 'expense'
       AND e.shared_type IS NOT NULL
       AND e.category_id = $4
     ORDER BY e.amount DESC, e.occurred_at DESC
     LIMIT $5 OFFSET $6`,
    [ledgerId, rangeStartUtc, rangeEndUtc, categoryId, limit, offset],
  );

  const items: EntryDetailRow[] = dataRes.rows.map((r) => ({
    entry_id: String(r.entry_id),
    amount: Number(r.amount ?? 0),
    note: r.note != null ? String(r.note) : null,
    occurred_at: typeof r.occurred_at === 'string'
      ? r.occurred_at
      : (r.occurred_at as Date).toISOString(),
    shared_type: (r.shared_type as 'shared' | 'personal' | null) ?? null,
    created_by: String(r.created_by),
    nickname: String(r.nickname ?? ''),
    avatar_url: r.avatar_url != null ? String(r.avatar_url) : null,
  }));

  return { items, total };
}
