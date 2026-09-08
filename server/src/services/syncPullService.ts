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
import * as ledgerRepo from '../repositories/ledgerRepo.js';
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
  /**
   * 系统分类签名（migration 0004 配套 · spec §4）
   *
   * L13（§4.3）：仅在收敛轮（has_more=false）计算并返回。has_more=true 的分页轮跳过
   *   computeSystemCategoriesRevision()（全表扫系统分类 + JS 排序 + 拼串），避免分页循环
   *   把这项 per-request 固定成本 ×10~40。因此类型为 optional。
   *
   * 签名规范（与 miniprogram/services/categoryService.ts computeCategoriesSignature
   * 双端必须逐字符一致）：
   *   - 仅纳入 family_id IS NULL（系统分类）且 deleted_at IS NULL 的行
   *   - 排序：sortOrder ASC，相同 sortOrder 再按 id localeCompare ASC
   *   - 单条字段顺序（'|' 连接）：id | parentId(空串若NULL) | name | icon | type
   *     | sortOrder | isDirectDefault(1/0) | isParentDefault(1/0)
   *     | displayOrder(空串若NULL)
   *   - 条目之间用 ';' 连接
   *
   * 客户端比对此值与本地缓存签名，不一致则绕过 24h TTL 强刷分类列表，
   * 关闭"分类改动 24h 内客户端不可见"的窗口。
   */
  categories_revision?: string;
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

/**
 * 计算系统分类签名（与前端 computeCategoriesSignature 双端逐字符一致）
 *
 * 仅纳入系统分类（family_id IS NULL）且未软删（deleted_at IS NULL）。
 * 字段顺序、排序键、分隔符均严格对齐 miniprogram/services/categoryService.ts。
 */
async function computeSystemCategoriesRevision(): Promise<string> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT id, parent_id, name, icon, type, sort_order,
            is_direct_default, is_parent_default, display_order
       FROM categories
      WHERE family_id IS NULL
        AND deleted_at IS NULL`,
    [],
  );
  type Row = {
    id: string;
    parent_id: string | null;
    name: string;
    icon: string;
    type: string;
    sort_order: number;
    is_direct_default: boolean;
    is_parent_default: boolean;
    display_order: number | null;
  };
  const rows = res.rows as Row[];
  // 排序：sortOrder ASC，相同再按 id localeCompare ASC（与前端一致）
  rows.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id.localeCompare(b.id);
  });
  return rows
    .map(r => [
      r.id,
      r.parent_id ?? '',
      r.name,
      r.icon,
      r.type,
      r.sort_order,
      r.is_direct_default ? 1 : 0,
      r.is_parent_default ? 1 : 0,
      r.display_order ?? '',
    ].join('|'))
    .join(';');
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

  // 2. sync-hold 钳制（导入方案 v1.0 §5.2.4 · E2b）：
  //    cap = 该 family 所有未过期 hold 的 MIN(sync_hold_seq)（不变量 H4：取 min 而非"所属 ledger"，防 1:N 放开后漏闸门）；
  //    cap === null（无 hold · 常态）⇒ 行为与既有完全一致，零回归面；
  //    cap !== null ⇒ entries 查询加 change_seq <= cap，watermark 天然不越过 cap，
  //    has_more 在钳制后的结果集内判定（截断即 false · 客户端本轮收敛，下轮周期/mutation 再来——
  //    不得为 hold 造"服务端还有数据但拉不到"的 has_more=true，否则客户端在 300ms 续拉里空转）。
  const ledgerEntities = await ledgerRepo.findAllActiveByFamilyId(input.familyId);
  const now = new Date();
  const activeHolds = ledgerEntities
    .filter((l) => l.syncHoldSeq !== null && l.syncHoldUntil !== null && l.syncHoldUntil > now)
    .map((l) => l.syncHoldSeq as number);
  const cap = activeHolds.length > 0 ? Math.min(...activeHolds) : null;

  // 3. 拉增量（rows: PullEntryRow[] = EntryEntity & { familyId } · 含 changeSeq）
  const { rows, hasMore } = await findEntriesByFamilySince({
    since: input.since,
    familyId: input.familyId,
    limit: input.limit,
    cap,
  });

  // 4. watermark 推进（v1.2：用 changeSeq 单调推进）
  //    rows 已按 change_seq ASC 排序（entryRepo SQL）+ sequence 严格单调 → 末位即最大
  //    rows.length === 0 时保持 since 不变（协议 §6.3 单调铁律）
  //    sync-hold 下 rows 天然 ≤ cap（查询已钳制），watermark 不可能越过未提交号段（§5.2.4）
  const watermark = rows.length > 0
    ? rows[rows.length - 1].changeSeq
    : input.since;

  // 5. 计算系统分类签名（spec §4）
  //    L13 §4.3：仅收敛轮（has_more=false）计算；分页轮跳过，避免全表扫系统分类的
  //    per-request 固定成本被分页循环 ×10~40。字段 optional，向后兼容。
  const categoriesRevision = hasMore ? undefined : await computeSystemCategoriesRevision();

  // 6. COSTRA-4xx：下发该 family 下所有 active ledger 的最新状态（含 balance + sync_epoch）
  //    1:1 语义下，一个 family 就一行 ledger，数据量可忽略，每次都全量下发（含分页轮）：
  //    - 供客户端 E1 epoch 前置比对（L13 §4.2）
  //    - 供资产不断供（每轮覆盖写 ledgerBalanceApi 缓存）
  //    sync-hold 是纯服务端机制：LedgerWire 不新增字段（§5.2.4 · 客户端零改动）
  const ledgers = ledgerEntities.map(ledgerToWire);

  return {
    watermark,
    has_more: hasMore,
    categories_revision: categoriesRevision,
    changes: {
      entries: rows.map(entryToWire),
      categories: [],
      budgets: [],
      ledgers,
    },
  };
}

interface LedgerWire {
  id: string;
  family_id: string;
  name: string;
  currency: string;
  balance_cents: number;
  balance_baseline_seq: number;
  balance_version: number;
  /** L13 E1：批量写入版本戳。客户端据此前置比对，不一致则全量重拉（§4.2） */
  sync_epoch: number;
  updated_at: string;
  version: number;
}

function ledgerToWire(l: import('../repositories/ledgerRepo.js').LedgerEntity): LedgerWire {
  return {
    id: l.id,
    family_id: l.familyId,
    name: l.name,
    currency: l.currency,
    balance_cents: l.balanceCents,
    balance_baseline_seq: l.balanceBaselineSeq,
    balance_version: l.balanceVersion,
    sync_epoch: l.syncEpoch,
    updated_at: l.updatedAt.toISOString(),
    version: l.version,
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
    shared_type: e.sharedType,                      // COSTRA-217 B2: 公共/个人支出标记
    source_recurring_id: e.sourceRecurringId,       // T4: 定时规则来源；手工流水为 null
  };
}
