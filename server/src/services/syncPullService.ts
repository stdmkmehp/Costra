/**
 * Costra · Server · /sync/pull 业务层
 *
 * 卡号：COSTRA-154 · 事实源：docs/api/sync-protocol.md §3 + §6.3 + §7
 *
 * 职责：
 *   - 校验 user 属于 family（防越权 · 协议 §7）
 *   - 调 entryRepo.findEntriesByFamilySince 拉增量
 *   - watermark 推进策略：本批次 entries 中最大的 change_seq（协议 §6.3 v1.2）
 *     - 若 rows.length === 0 → watermark 不变（保持 since 入参）
 *     - 若 rows.length > 0 → watermark = rows[末位].changeSeq（ASC 排序 · 末位最大）
 *     - 严格单调：PG SEQUENCE 保证 change_seq 不回退 · 不依赖时钟
 *   - 实体顺序：MVP 阶段仅返 entries · ledgers/categories/budgets 留 follow-up
 *
 * BUG-COSTRA-154 v1.2 升级（2026-05-22 选项 B 彻底修复）：
 *   - since 类型从 string（ISO 微秒）改为 number（BIGINT change_seq）
 *   - watermark 推进改用 rows[末位].changeSeq（ASC 排序 + sequence 单调 · 末位即最大）
 *   - entryToWire 加 change_seq 字段输出 · updated_at 降级为毫秒精度展示用
 *   - 完全消除 §3.5 残余风险（同微秒并发 / NTP 回拨 / 主从切换）
 *   - 详见 qa/defects/2026-05-22-COSTRA-154-watermark-microsecond-precision.md §11
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
  /**
   * BIGINT change_seq · 0 表示首次全量拉取
   * BUG-COSTRA-154 v1.2 升级：从 string（ISO 微秒）改为 number
   */
  since: number;
  limit: number;
}

export interface SyncPullResult {
  /** BIGINT change_seq · 协议 v1.2 watermark 类型 */
  watermark: number;
  has_more: boolean;
  changes: {
    entries: ReturnType<typeof entryToWire>[];
    /**
     * MVP 留空 · ledgers/categories/budgets 增量拉取留 follow-up FU-154-CATEGORIES-PULL
     * 类型用 unknown[] 而非 never[]：避免后续 FU 实装时类型扩展撞编译错误
     * （R1 Review P1-1 修订 · OpenAPI 定义为 ledgers: Ledger[] · MVP 实际返 [] 与契约兼容）
     */
    categories: unknown[];
    budgets: unknown[];
    ledgers: unknown[];
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

  // 2. 拉增量（rows: PullEntryRow[] = EntryEntity & { familyId } · 含 changeSeq）
  const { rows, hasMore } = await findEntriesByFamilySince({
    since: input.since,
    familyId: input.familyId,
    limit: input.limit,
  });

  // 3. watermark 推进（v1.2：用 changeSeq 单调推进）
  //    rows 已按 change_seq ASC 排序（entryRepo SQL）+ sequence 严格单调 → 末位即最大
  //    rows.length === 0 时保持 since 不变（协议 §6.3 单调铁律）
  const watermark = rows.length > 0
    ? rows[rows.length - 1].changeSeq
    : input.since;

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
 *
 * BUG-COSTRA-154 v1.2 升级：
 *   - 加 change_seq 字段（协议核心 · sync 真源）
 *   - updated_at 降级为毫秒精度（toISOString 返毫秒 · 不再要求微秒）· 仅展示语义
 *   - 因为 client 不再用 updated_at 做 watermark 比较 · 微秒精度需求消失
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
    change_seq: e.changeSeq,                        // ✅ v1.2 协议核心字段
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),          // 毫秒精度展示用 · 不再参与 watermark
    deleted_at: e.deletedAt ? e.deletedAt.toISOString() : null,
  };
}
