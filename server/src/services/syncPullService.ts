/**
 * Costra · Server · /sync/pull 业务层
 *
 * 卡号：COSTRA-154 · 事实源：docs/api/sync-protocol.md §3 + §6.3 + §7
 *
 * 职责：
 *   - 校验 user 属于 family（防越权 · 协议 §7）
 *   - 调 entryRepo.findEntriesByFamilySince 拉增量
 *   - watermark 推进策略：本批次 entries 中最大的 updated_at（协议 §6.3）
 *     - 若 rows.length === 0 → watermark 不变（保持 since 入参）
 *     - 若 rows.length > 0 → watermark = max(rows[i].updatedAt)
 *     - 单调性：server 端所有写操作用 NOW() 保证 updated_at 不回退（协议 §6.3）
 *   - 实体顺序：MVP 阶段仅返 entries · ledgers/categories/budgets 留 follow-up
 *
 * 不做：
 *   - 自动推进 client watermark（client 自己存 watermark · 见 COSTRA-150）
 *   - conflict 处理（pull 不引入冲突 · server 是真源）
 */

import { findEntriesByFamilySince, type PullEntryRow } from '../repositories/entryRepo.js';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';

export interface SyncPullInput {
  userId: string;
  familyId: string;
  since: Date;
  limit: number;
}

export interface SyncPullResult {
  watermark: string;  // ISO 8601
  has_more: boolean;
  changes: {
    entries: ReturnType<typeof entryToWire>[];
    categories: never[];  // MVP 留空 · follow-up FU-154-CATEGORIES-PULL
    budgets: never[];
    ledgers: never[];
  };
}

/**
 * 校验 user 是否属于 family（含 left_at IS NULL 排除已退出成员）
 * ⚠️ familyMemberRepo.ts 不存在 · inline SQL 兜底 · follow-up FU-154-FAMILY-MEMBER-REPO
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

export async function syncPull(input: SyncPullInput): Promise<SyncPullResult> {
  // 1. 防越权（协议 §7）
  const member = await isUserInFamily(input.userId, input.familyId);
  if (!member) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, {
      message: 'user not in family',
      details: { family_id: input.familyId },
    });
  }

  // 2. 拉增量（rows: PullEntryRow[] = EntryEntity & { familyId } · familyId 来自 JOIN ledgers）
  const { rows, hasMore } = await findEntriesByFamilySince({
    since: input.since,
    familyId: input.familyId,
    limit: input.limit,
  });

  // 3. watermark 推进
  const watermark = rows.length > 0
    ? new Date(Math.max(...rows.map(r => r.updatedAt.getTime()))).toISOString()
    : input.since.toISOString();

  return {
    watermark,
    has_more: hasMore,
    changes: {
      entries: rows.map(entryToWire),
      categories: [],
      budgets: [],
      ledgers: [],
    },
  };
}

/**
 * PullEntryRow → wire（snake_case · 协议契约对齐）
 * 含软删行：deleted_at !== null 时 client 据此本地软删
 * family_id 由 A 项 JOIN ledgers 注入 · entries 表本身无此列
 */
function entryToWire(e: PullEntryRow) {
  return {
    id: e.id,
    ledger_id: e.ledgerId,
    family_id: e.familyId,                          // 来自 JOIN ledgers · 非 entries 表列
    user_id: e.createdBy,                           // entries 表列名是 created_by · 协议 wire 字段名 user_id
    client_ref_id: e.clientRefId,
    account_id: e.accountId,
    to_account_id: e.toAccountId,
    type: e.type,
    amount: e.amount,
    currency: e.currency,                           // 与 findEntriesByLedger SELECT 对齐 · 协议 §3.2 entries[*].currency
    category_id: e.categoryId,
    occurred_at: e.occurredAt.toISOString(),
    note: e.note,
    server_version: e.version,                      // 协议字段名 server_version vs DB 列名 version
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
    deleted_at: e.deletedAt ? e.deletedAt.toISOString() : null,
  };
}
