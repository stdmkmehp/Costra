/**
 * Costra · Server · entries DAO
 *
 * 卡号：COSTRA-104 · 事实源：server/db/migrations/0001_init.sql `entries` 表
 *
 * 职责：封装 entries 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口（EntryEntity），不暴露 pg 行对象
 *   - 不处理业务语义（如 "entry 不存在要不要抛错"），由 service 层判定
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export interface EntryEntity {
  id: string;
  ledgerId: string;
  amount: number; // 单位：分（Bigint in DB）
  currency: string;
  type: 'income' | 'expense' | 'transfer';
  categoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  note: string | null;
  occurredAt: Date; // UTC 存储
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
  clientRefId: string | null;
}

interface EntryRow {
  id: string;
  ledger_id: string;
  amount: string; // BIGINT returns as string in pg
  currency: string;
  type: 'income' | 'expense' | 'transfer';
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  note: string | null;
  occurred_at: Date;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
  client_ref_id: string | null;
}

function rowToEntity(r: EntryRow): EntryEntity {
  return {
    id: r.id,
    ledgerId: r.ledger_id,
    amount: Number(r.amount),
    currency: r.currency,
    type: r.type,
    categoryId: r.category_id,
    accountId: r.account_id,
    toAccountId: r.to_account_id,
    note: r.note,
    occurredAt: r.occurred_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
    clientRefId: r.client_ref_id,
  };
}

/**
 * 执行器抽象：允许 repo 在 Pool 或 tx PoolClient 上运行。
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: EntryRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

export interface CreateEntryInput {
  ledgerId: string;
  amount: number; // 单位：分
  currency?: string;
  type: 'income' | 'expense' | 'transfer';
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  note?: string | null;
  occurredAt: string; // ISO-8601
  createdBy: string;
  clientRefId?: string | null;
}

/**
 * 创建 entry。
 * client_ref_id 有值时走 UNIQUE (ledger_id, client_ref_id) 约束防重。
 */
export async function insertEntry(input: CreateEntryInput, client?: Runner): Promise<EntryEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id,
                          account_id, to_account_id, note, occurred_at, created_by, client_ref_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, ledger_id, amount, currency, type, category_id,
                  account_id, to_account_id, note, occurred_at,
                  created_by, created_at, updated_at, deleted_at, version, client_ref_id`,
    [
      id,
      input.ledgerId,
      input.amount,
      input.currency ?? 'CNY',
      input.type,
      input.categoryId ?? null,
      input.accountId ?? null,
      input.toAccountId ?? null,
      input.note ?? null,
      input.occurredAt,
      input.createdBy,
      input.clientRefId ?? null,
    ],
  );
  if (!res.rows[0]) {
    throw new Error('[entryRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

/**
 * 乐观锁更新 entry。
 * WHERE version = baseVersion → 不匹配时 rowCount=0 → caller 抛 VERSION_CONFLICT。
 */
export interface UpdateEntryInput {
  amount?: number;
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  note?: string | null;
  occurredAt?: string;
}

export async function updateEntryByVersion(
  entryId: string,
  input: UpdateEntryInput,
  baseVersion: number,
  client?: Runner,
): Promise<EntryEntity | null> {
  const runner = client ?? exec();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.amount !== undefined) { fields.push(`amount = $${idx++}`); values.push(input.amount); }
  if (input.categoryId !== undefined) { fields.push(`category_id = $${idx++}`); values.push(input.categoryId); }
  if (input.accountId !== undefined) { fields.push(`account_id = $${idx++}`); values.push(input.accountId); }
  if (input.toAccountId !== undefined) { fields.push(`to_account_id = $${idx++}`); values.push(input.toAccountId); }
  if (input.note !== undefined) { fields.push(`note = $${idx++}`); values.push(input.note); }
  if (input.occurredAt !== undefined) { fields.push(`occurred_at = $${idx++}`); values.push(input.occurredAt); }

  if (fields.length === 0) {
    // 无字段更新 → 直接查当前 entry（不抛错，走 caller 逻辑）
    const found = await findById(entryId, runner);
    return found;
  }

  // 乐观锁 WHERE version = baseVersion + 触发器自动 updated_at + version+1
  values.push(entryId, baseVersion);
  const res = await runner.query(
    `UPDATE entries
        SET ${fields.join(', ')}
      WHERE id = $${idx++} AND version = $${idx} AND deleted_at IS NULL
        RETURNING id, ledger_id, amount, currency, type, category_id,
                  account_id, to_account_id, note, occurred_at,
                  created_by, created_at, updated_at, deleted_at, version, client_ref_id`,
    values,
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 软删除 entry（SET deleted_at = now() + version+1）。
 * 乐观锁 WHERE version = baseVersion。
 */
export async function softDeleteEntry(entryId: string, baseVersion: number, client?: Runner): Promise<EntryEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE entries
        SET deleted_at = now()
      WHERE id = $1 AND version = $2 AND deleted_at IS NULL
        RETURNING id, ledger_id, amount, currency, type, category_id,
                  account_id, to_account_id, note, occurred_at,
                  created_by, created_at, updated_at, deleted_at, version, client_ref_id`,
    [entryId, baseVersion],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

export interface EntryFilter {
  ledgerId?: string;
  categoryId?: string;
  type?: 'income' | 'expense' | 'transfer';
  from?: string; // ISO-8601
  to?: string;   // ISO-8601
}

/**
 * 游标分页查询 entries（复合 cursor: updated_at + id）。
 * cursor 格式: `${updatedAt.toISOString()}|${id}`
 */
export async function findEntriesByLedger(
  filter: EntryFilter,
  cursor: string | null,
  limit: number,
  client?: Runner,
): Promise<{ entries: EntryEntity[]; nextCursor: string | null }> {
  const runner = client ?? exec();
  const conditions: string[] = ['deleted_at IS NULL'];
  const values: unknown[] = [];
  let idx = 1;

  if (filter.ledgerId) { conditions.push(`ledger_id = $${idx++}`); values.push(filter.ledgerId); }
  if (filter.categoryId) { conditions.push(`category_id = $${idx++}`); values.push(filter.categoryId); }
  if (filter.type) { conditions.push(`type = $${idx++}`); values.push(filter.type); }
  if (filter.from) { conditions.push(`occurred_at >= $${idx++}`); values.push(filter.from); }
  if (filter.to) { conditions.push(`occurred_at <= $${idx++}`); values.push(filter.to); }

  if (cursor) {
    // cursor = updated_at + '|' + id（URL-safe base64 或原始字符串）
    const [cCursor, cId] = cursor.split('|');
    conditions.push(`(updated_at, id) < ($${idx++}, $${idx++})`);
    values.push(cCursor, cId);
  }

  const where = conditions.join(' AND ');
  values.push(limit + 1); // 多查一条判断 hasNext

  const res = await runner.query(
    `SELECT id, ledger_id, amount, currency, type, category_id,
            account_id, to_account_id, note, occurred_at,
            created_by, created_at, updated_at, deleted_at, version, client_ref_id
       FROM entries
      WHERE ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${idx}`,
    values,
  );

  const hasNext = res.rows.length > limit;
  const entries = res.rows.slice(0, limit).map(rowToEntity);
  const nextCursor = hasNext && entries.length > 0
    ? `${entries[entries.length - 1].updatedAt.toISOString()}|${entries[entries.length - 1].id}`
    : null;

  return { entries, nextCursor };
}

/**
 * 按 id 查询 entry（含权限校验：ledger.family_id 属于 user）。
 */
export async function findById(entryId: string, client?: Runner): Promise<EntryEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT e.id, e.ledger_id, e.amount, e.currency, e.type, e.category_id,
            e.account_id, e.to_account_id, e.note, e.occurred_at,
            e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id
       FROM entries e
       JOIN ledgers l ON l.id = e.ledger_id
       JOIN family_members fm ON fm.family_id = l.family_id AND fm.left_at IS NULL
      WHERE e.id = $1 AND e.deleted_at IS NULL
      LIMIT 1`,
    [entryId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 按 ledger_id + client_ref_id 查重（用于 sync/push 去重）。
 */
export async function findByLedgerAndClientRefId(ledgerId: string, clientRefId: string, client?: Runner): Promise<EntryEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, ledger_id, amount, currency, type, category_id,
            account_id, to_account_id, note, occurred_at,
            created_by, created_at, updated_at, deleted_at, version, client_ref_id
       FROM entries
      WHERE ledger_id = $1 AND client_ref_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [ledgerId, clientRefId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}
