/**
 * Costra · Server · budgets DAO（v2）
 *
 * 卡号：COSTRA-4xx · 事实源：server/db/migrations/0013_budgets_v2.sql
 *
 * 职责：封装 budgets 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口（BudgetEntity），不暴露 pg 行对象
 *   - Runner 透传模式（与 ledgerRepo/userRepo 同构）· 单测可注入 mock
 *
 * 表语义：
 *   - (ledger_id, month) 唯一 · 一个账本一个月度一个预算
 *   - category_id 不再使用（v1 早期预留，v2 已去除）
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export interface BudgetEntity {
  id: string;
  ledgerId: string;
  month: string;            // YYYY-MM
  amountCents: number;
  currency: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

interface BudgetRow {
  id: string;
  ledger_id: string;
  month: string;
  amount_cents: string | number;  // BIGINT
  currency: string;
  updated_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

function rowToEntity(r: BudgetRow): BudgetEntity {
  return {
    id: r.id,
    ledgerId: r.ledger_id,
    month: r.month,
    amountCents: Number(r.amount_cents),
    currency: r.currency,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
  };
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: BudgetRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

const SELECT_COLUMNS = `
  id, ledger_id, month, amount_cents, currency, updated_by,
  created_at, updated_at, deleted_at, version
`;

/**
 * 按 (ledger_id, month) 查 active 预算。
 * 返回 null 表示该月未设置预算（客户端据此显示"未设置"）。
 */
export async function findByLedgerAndMonth(
  ledgerId: string,
  month: string,
  client?: Runner,
): Promise<BudgetEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT ${SELECT_COLUMNS}
       FROM budgets
      WHERE ledger_id = $1 AND month = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [ledgerId, month],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 查指定账本中距离 givenMonth 最近的一条 active 预算。
 *
 * 用于"预算跟随账本走"回退逻辑：当月未单独设置预算时，
 * 继承该账本最近一次设定的预算上限（amount_cents）。
 *
 * 查找顺序：
 *   1. month <= givenMonth 中最近的（往前找）
 *   2. month > givenMonth 中最近的（往后找）
 *
 * 典型场景：用户 8 月设了预算，回看 6 月时 6 月没设过 → 往前没有 →
 * 往后找到 8 月的预算，继承其上限。
 *
 * 返回 null 表示该账本从未设过任何预算。
 */
export async function findNearestActive(
  ledgerId: string,
  month: string,
  client?: Runner,
): Promise<BudgetEntity | null> {
  const runner = client ?? exec();
  // 先往前找
  const before = await runner.query(
    `SELECT ${SELECT_COLUMNS}
       FROM budgets
      WHERE ledger_id = $1
        AND month <= $2
        AND deleted_at IS NULL
      ORDER BY month DESC
      LIMIT 1`,
    [ledgerId, month],
  );
  if (before.rows[0]) return rowToEntity(before.rows[0]);

  // 往后找
  const after = await runner.query(
    `SELECT ${SELECT_COLUMNS}
       FROM budgets
      WHERE ledger_id = $1
        AND month > $2
        AND deleted_at IS NULL
      ORDER BY month ASC
      LIMIT 1`,
    [ledgerId, month],
  );
  return after.rows[0] ? rowToEntity(after.rows[0]) : null;
}

/**
 * 创建预算（用于首次设置）。
 * 唯一约束 uq_budgets_ledger_month 保证幂等性；冲突由 service 层捕获并改走 update。
 */
export async function insertBudget(
  input: {
    ledgerId: string;
    month: string;
    amountCents: number;
    currency?: string;
    updatedBy: string;
  },
  client?: Runner,
): Promise<BudgetEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO budgets (id, ledger_id, month, amount_cents, currency, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING ${SELECT_COLUMNS}`,
    [id, input.ledgerId, input.month, input.amountCents, input.currency ?? 'CNY', input.updatedBy],
  );
  if (!res.rows[0]) {
    throw new Error('[budgetRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

/**
 * 乐观锁更新预算 amount（用于修改已存在的预算）。
 * WHERE version = baseVersion → 不匹配时返回 null（caller 抛 409）
 */
export async function updateAmountByVersion(
  input: {
    budgetId: string;
    amountCents: number;
    updatedBy: string;
    baseVersion: number;
  },
  client?: Runner,
): Promise<BudgetEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE budgets
        SET amount_cents = $2,
            updated_by  = $3,
            version     = version + 1
      WHERE id = $1
        AND version = $4
        AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [input.budgetId, input.amountCents, input.updatedBy, input.baseVersion],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 软删预算（暂未在 API 暴露，留 FU）。
 */
export async function softDelete(
  input: { budgetId: string; baseVersion: number },
  client?: Runner,
): Promise<BudgetEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE budgets
        SET deleted_at = now(),
            version    = version + 1
      WHERE id = $1
        AND version = $2
        AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    [input.budgetId, input.baseVersion],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}
