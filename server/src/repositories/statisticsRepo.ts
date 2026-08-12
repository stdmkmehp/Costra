/**
 * Costra · Server · 统计页 DAO
 *
 * 卡号：COSTRA-224 / COSTRA-260 · 事实源：docs/design/statistics-page-tech-spec.md §3
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
 *
 * COSTRA-260: 四个查询函数尾参重构为 opts 对象化模式，新增 createdBy 过滤支持。
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
  note: string | null;
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
  source_recurring_id: string | null;
  created_by: string;
  nickname: string;
  avatar_url: string | null;
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/** COSTRA-260: 统一 opts 类型
 *
 * 收入分类排行迭代：新增 entryType 参数用于筛选 entries.type。
 *   - entryType='expense'（默认）：保留原口径（AND type='expense' AND shared_type IS NOT NULL）
 *   - entryType='income'：AND type='income'（income 没有 shared 语义，不加 shared_type 过滤）
 */
export type EntryTypeFilter = 'expense' | 'income';

export interface StatQueryOpts {
  createdBy?: string;
  entryType?: EntryTypeFilter;
  client?: Runner;
}

/**
 * 生成 entryType 相关的 SQL 片段。
 *   - expense：AND e.type = 'expense' AND e.shared_type IS NOT NULL
 *   - income： AND e.type = 'income'
 * 注意：调用方需自行确定占位符编号（返回的 SQL 不含占位符，type 直接内联字面量以避免多分支拼接复杂度；
 * 字面量固定枚举无注入风险）。
 */
function buildEntryTypeClause(entryType: EntryTypeFilter): string {
  if (entryType === 'income') {
    return `AND e.type = 'income'`;
  }
  return `AND e.type = 'expense' AND e.shared_type IS NOT NULL`;
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
 *
 * COSTRA-260: opts.createdBy 存在时拼 AND created_by = $N。
 */
export async function listEntriesInRange(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  opts?: StatQueryOpts,
): Promise<RawEntryForStat[]> {
  const runner = opts?.client ?? exec();
  const params: unknown[] = [ledgerId, rangeStartUtc, rangeEndUtc];
  let createdByClause = '';
  if (opts?.createdBy) {
    params.push(opts.createdBy);
    createdByClause = `AND e.created_by = $${params.length}`;
  }
  const res = await runner.query(
    `SELECT
       e.amount AS amount,
       e.type AS type,
       e.occurred_at AS occurred_at,
       e.shared_type AS shared_type,
       e.category_id AS category_id,
       e.note AS note
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       AND e.type IN ('expense', 'income')
       -- 与 family summary 一致：expense 必须有 shared_type
       AND (e.type = 'income' OR e.shared_type IS NOT NULL)
       ${createdByClause}`,
    params,
  );
  return res.rows.map((r) => ({
    amount: Number(r.amount ?? 0),
    type: r.type as 'expense' | 'income',
    occurred_at: typeof r.occurred_at === 'string'
      ? r.occurred_at
      : (r.occurred_at as Date).toISOString(),
    shared_type: (r.shared_type as 'shared' | 'personal' | null) ?? null,
    category_id: r.category_id ? String(r.category_id) : null,
    note: (r.note as string | null) ?? null,
  }));
}

/**
 * L1 一级分类排行 · 按 entries.category_id 分组聚合后，
 * service 层再用 categories.parent_id 把二级累加到一级。
 *
 * 返回的是按 category_id（即二级 id）分组的聚合，
 * service 层负责"二级 → 一级"的折叠。
 *
 * 支出口径：type='expense' AND shared_type IS NOT NULL（与 family summary 一致）
 * 收入口径：type='income'（income 不受 shared_type 约束，允许 NULL）
 *
 * COSTRA-260: opts.createdBy 存在时拼 AND created_by = $N。
 */
export async function getCategoryAggregates(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  opts?: StatQueryOpts,
): Promise<CategoryRankAggRow[]> {
  const runner = opts?.client ?? exec();
  const entryType: EntryTypeFilter = opts?.entryType ?? 'expense';
  const params: unknown[] = [ledgerId, rangeStartUtc, rangeEndUtc];
  let createdByClause = '';
  if (opts?.createdBy) {
    params.push(opts.createdBy);
    createdByClause = `AND e.created_by = $${params.length}`;
  }
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
       ${buildEntryTypeClause(entryType)}
       AND e.category_id IS NOT NULL
       ${createdByClause}
     GROUP BY e.category_id`,
    params,
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
 *
 * COSTRA-260: opts.createdBy 存在时拼 AND created_by = $N。
 */
export async function getSubCategoryAggregates(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  parentCategoryId: string,
  opts?: StatQueryOpts,
): Promise<CategoryRankAggRow[]> {
  const runner = opts?.client ?? exec();
  const entryType: EntryTypeFilter = opts?.entryType ?? 'expense';
  const params: unknown[] = [ledgerId, rangeStartUtc, rangeEndUtc, parentCategoryId];
  let createdByClause = '';
  if (opts?.createdBy) {
    params.push(opts.createdBy);
    createdByClause = `AND e.created_by = $${params.length}`;
  }
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
       ${buildEntryTypeClause(entryType)}
       AND c.parent_id = $4
       AND c.deleted_at IS NULL
       ${createdByClause}
     GROUP BY e.category_id`,
    params,
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

/** COSTRA-260: listEntriesByCategory opts 类型（含分页参数外的 createdBy + client + entryType） */
export interface ListEntriesByCategoryOpts {
  createdBy?: string;
  entryType?: EntryTypeFilter;
  client?: Runner;
}

/**
 * L3 单笔明细：指定 category_id 下的 entry 列表，按金额降序、时间降序。
 *
 * JOIN users 一次性拿 nickname + avatar_url。
 *
 * COSTRA-260: opts.createdBy 存在时拼 AND created_by = $N。
 * 收入分类排行迭代：opts.entryType 决定 type/shared_type 过滤口径。
 */
export async function listEntriesByCategory(
  ledgerId: string,
  rangeStartUtc: string,
  rangeEndUtc: string,
  categoryId: string,
  limit: number,
  offset: number,
  opts?: ListEntriesByCategoryOpts,
): Promise<{ items: EntryDetailRow[]; total: number }> {
  const runner = opts?.client ?? exec();
  const entryType: EntryTypeFilter = opts?.entryType ?? 'expense';

  const baseParams: unknown[] = [ledgerId, rangeStartUtc, rangeEndUtc, categoryId];
  let createdByClause = '';
  if (opts?.createdBy) {
    baseParams.push(opts.createdBy);
    createdByClause = `AND e.created_by = $${baseParams.length}`;
  }
  const typeClause = buildEntryTypeClause(entryType);

  // 总数（用于 has_more 判定）
  const countRes = await runner.query(
    `SELECT COUNT(*) AS total
     FROM entries e
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       ${typeClause}
       AND e.category_id = $4
       ${createdByClause}`,
    baseParams,
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  // 数据
  const dataParams: unknown[] = [...baseParams, limit, offset];
  const limitIdx = baseParams.length + 1;
  const offsetIdx = baseParams.length + 2;
  const dataRes = await runner.query(
    `SELECT
       e.id AS entry_id,
       e.amount AS amount,
       e.note AS note,
       e.occurred_at AS occurred_at,
       e.shared_type AS shared_type,
       e.source_recurring_id AS source_recurring_id,
       e.created_by AS created_by,
       u.nickname AS nickname,
       u.avatar_url AS avatar_url
     FROM entries e
     JOIN users u ON u.id = e.created_by
     WHERE e.ledger_id = $1
       AND e.deleted_at IS NULL
       AND e.occurred_at >= $2
       AND e.occurred_at < $3
       ${typeClause}
       AND e.category_id = $4
       ${createdByClause}
     ORDER BY e.amount DESC, e.occurred_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    dataParams,
  );

  const items: EntryDetailRow[] = dataRes.rows.map((r) => ({
    entry_id: String(r.entry_id),
    amount: Number(r.amount ?? 0),
    note: r.note != null ? String(r.note) : null,
    occurred_at: typeof r.occurred_at === 'string'
      ? r.occurred_at
      : (r.occurred_at as Date).toISOString(),
    shared_type: (r.shared_type as 'shared' | 'personal' | null) ?? null,
    source_recurring_id: r.source_recurring_id != null ? String(r.source_recurring_id) : null,
    created_by: String(r.created_by),
    nickname: String(r.nickname ?? ''),
    avatar_url: r.avatar_url != null ? String(r.avatar_url) : null,
  }));

  return { items, total };
}
