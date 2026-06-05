/**
 * Costra · Server · ledgers DAO
 *
 * 卡号：COSTRA-164 · 事实源：server/db/migrations/0001_init.sql `ledgers` 表
 * 决策锚定：ADR-0007 §3.1 family:ledger=1:1 产品语义
 *
 * 职责：封装 ledgers 表的 SQL 访问；业务层禁止直接写 SQL。
 *
 * 设计原则：
 *   - 参数化查询；严禁字符串拼接
 *   - 返回领域实体接口（LedgerEntity），不暴露 pg 行对象
 *   - Runner 透传模式（与 userRepo.ts L65/L114/L141 同构）· 单测可注入 mock
 */

import { getPool } from '../db/pool.js';
import { newId } from '../id/idGen.js';

export interface LedgerEntity {
  id: string;
  familyId: string;
  name: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

interface LedgerRow {
  id: string;
  family_id: string;
  name: string;
  currency: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

function rowToEntity(r: LedgerRow): LedgerEntity {
  return {
    id: r.id,
    familyId: r.family_id,
    name: r.name,
    currency: r.currency,
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
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: LedgerRow[]; rowCount?: number | null }> };

function exec(): Runner {
  return getPool() as unknown as Runner;
}

/**
 * 创建默认 ledger（个人 family 的唯一账本）
 * 产品语义 family:ledger=1:1（schema 物理 1:N 保留扩展空间）
 */
export async function createDefaultLedger(
  input: { familyId: string; name: string; currency: string },
  client?: Runner,
): Promise<LedgerEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO ledgers (id, family_id, name, currency)
          VALUES ($1, $2, $3, $4)
        RETURNING id, family_id, name, currency, created_at, updated_at, deleted_at, version`,
    [id, input.familyId, input.name, input.currency],
  );
  if (!res.rows[0]) {
    throw new Error('[ledgerRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

/**
 * 按 family_id 更新 ledger name（重命名 family 时同步 · 产品语义 1:1）
 * 返回更新后的 ledger entity；无匹配行时返回 null（数据异常 · service 层兜底）
 */
export async function updateNameByFamilyId(
  input: { familyId: string; name: string },
  client?: Runner,
): Promise<LedgerEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE ledgers
        SET name = $2, updated_at = now()
      WHERE family_id = $1 AND deleted_at IS NULL
     RETURNING id, family_id, name, currency, created_at, updated_at, deleted_at, version`,
    [input.familyId, input.name],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 按 id 查 ledger（COSTRA-217 R1.x：entryService 需通过 ledger→family 判定 shared_type 默认值）
 */
export async function findById(
  ledgerId: string,
  client?: Runner,
): Promise<LedgerEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, name, currency, created_at, updated_at, deleted_at, version
       FROM ledgers
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    [ledgerId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 查 family 的第一个 active ledger（产品语义 1:1 · 取第一个即可）
 * 返回 null 表示该 family 无 ledger（数据异常 · service 层自愈补建）
 */
export async function findFirstByFamilyId(
  familyId: string,
  client?: Runner,
): Promise<LedgerEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT id, family_id, name, currency, created_at, updated_at, deleted_at, version
       FROM ledgers
      WHERE family_id = $1 AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1`,
    [familyId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}
