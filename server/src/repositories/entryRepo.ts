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
  /**
   * 同步引擎一致性水位（BUG-COSTRA-154v1.2升级 · 2026-05-22）
   * - PG SEQUENCE entries_change_seq 严格 distinct · CACHE1下单调递增
   * - 注意：CACHE > 1 时跨连接不保证时间顺序（已修复为CACHE 1）
   * - 每次 INSERT/UPDATE/softDelete 都分配新 seq
   * - sync pull 增量协议用此字段 · updated_at 仅展示语义
   * - JS Number 安全整数上限 2^53-1 ≈ 9 × 10^15 · MVP 永远跑不到
   * - 真PG BIGINT 通过 pg驱动返string · pg-mem 返 number · rowToEntity 用 Number() 统一
   */
  changeSeq: number;
  /**
   * 公共/个人支出标记（COSTRA-217 B2 · 2026-06-01）
   * - expense: 允许 'personal' / 'shared'; 未传时由服务端默认
   * - income / transfer: 必须为 null
   * - DB CHECK 约束: shared_type IS NULL OR type = 'expense'
   */
  sharedType: 'personal' | 'shared' | null;
  /**
   * 来源定时规则 id（T2 · COSTRA-5xx · 2026-07-21）
   * - 由定时调度器生成的 entry：值 = recurring_rules.id
   * - 用户手工记账的 entry：null
   * - 明细页据此渲染"定"字角标（product-spec §6）
   * - 外键 ON DELETE SET NULL：删除规则时保留历史 entry
   */
  sourceRecurringId: string | null;
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
  change_seq: string | number; // BIGINT · 真 PG 返 string · pg-mem 返 number
  shared_type: 'personal' | 'shared' | null; // COSTRA-217 B2
  source_recurring_id: string | null; // T2 · 来源定时规则
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
    changeSeq: Number(r.change_seq), // 同 amount 范式 · 跨驱动统一为 number
    sharedType: r.shared_type, // COSTRA-217 B2
    sourceRecurringId: r.source_recurring_id, // T2
  };
}

/**
 * 执行器抽象：允许 repo 在 Pool 或 tx PoolClient 上运行。
 */
type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: (EntryRow & Record<string, unknown>)[]; rowCount?: number | null }> };

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
  /** COSTRA-217 B2: 公共/个人支出标记 · 仅 expense 有值 · income/transfer 必须为 null */
  sharedType?: 'personal' | 'shared' | null;
  /** T2 · 来源定时规则 id · 由 recurringService 生成 entry 时透传 */
  sourceRecurringId?: string | null;
}

/**
 * 创建 entry。
 * client_ref_id 有值时走 UNIQUE (ledger_id, client_ref_id) 约束防重。
 *
 * change_seq（BUG-COSTRA-154 v1.2）：
 *   INSERT 不显式传 change_seq · 走列 DEFAULT nextval('entries_change_seq')
 *   事实源：migration 0006_entries_change_seq.sql §6 ALTER COLUMN ... SET DEFAULT
 */
export async function insertEntry(input: CreateEntryInput, client?: Runner): Promise<EntryEntity> {
  const id = newId();
  const runner = client ?? exec();
  const res = await runner.query(
    `INSERT INTO entries (id, ledger_id, amount, currency, type, category_id,
                          account_id, to_account_id, note, occurred_at, created_by, client_ref_id, shared_type, source_recurring_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id, ledger_id, amount, currency, type, category_id,
                  account_id, to_account_id, note, occurred_at,
                  created_by, created_at, updated_at, deleted_at, version, client_ref_id, change_seq, shared_type, source_recurring_id`,
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
      input.clientRefId ?? id,
      input.sharedType ?? null, // COSTRA-217 B2
      input.sourceRecurringId ?? null, // T2
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
  /** COSTRA-217 B2: 公共/个人支出标记 · 仅 expense 可修改 */
  sharedType?: 'personal' | 'shared' | null;
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
  if (input.sharedType !== undefined) { fields.push(`shared_type = $${idx++}`); values.push(input.sharedType); } // COSTRA-217 B2

  if (fields.length === 0) {
    // 无字段更新 → 直接查当前 entry（不抛错，走 caller 逻辑）
    const found = await findById(entryId, runner);
    return found;
  }

  // 乐观锁 WHERE version = baseVersion + 触发器自动 updated_at
  // version+1 必须应用层显式 SET（pg-mem 不支持 plpgsql trigger · 真 PG 同行为）
  // change_seq（BUG-COSTRA-154 v1.2）：UPDATE 必须显式 SET change_seq = nextval
  //   事实源：pg-mem 不支持 plpgsql trigger · 应用层显式 nextval 是真 PG 与 pg-mem 共同行为
  //   migration 0006 已为 INSERT 加 DEFAULT nextval · 但 UPDATE 不会自动调用 DEFAULT
  fields.push(`version = version + 1`);
  fields.push(`change_seq = nextval('entries_change_seq')`);
  values.push(entryId, baseVersion);
  const res = await runner.query(
    `UPDATE entries
        SET ${fields.join(', ')}
      WHERE id = $${idx++} AND version = $${idx} AND deleted_at IS NULL
        RETURNING id, ledger_id, amount, currency, type, category_id,
                  account_id, to_account_id, note, occurred_at,
                  created_by, created_at, updated_at, deleted_at, version, client_ref_id, change_seq, shared_type, source_recurring_id`,
    values,
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 软删除 entry（SET deleted_at = now() + version+1）。
 * 乐观锁 WHERE version = baseVersion。
 *
 * change_seq（BUG-COSTRA-154 v1.2）：软删走 UPDATE 路径 · 必须显式 SET change_seq
 *   client 通过 sync pull 增量收到软删行（协议 §3.5 软删行为）· 必须能感知到 change_seq 推进
 */
export async function softDeleteEntry(entryId: string, baseVersion: number, client?: Runner): Promise<EntryEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE entries
        SET deleted_at = now(),
            version = version + 1,
            change_seq = nextval('entries_change_seq')
      WHERE id = $1 AND version = $2 AND deleted_at IS NULL
        RETURNING id, ledger_id, amount, currency, type, category_id,
                  account_id, to_account_id, note, occurred_at,
                  created_by, created_at, updated_at, deleted_at, version, client_ref_id, change_seq, shared_type, source_recurring_id`,
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
  /** 当前请求用户 · 存在时按 family_members active membership 过滤，防跨账本越权读 */
  userId?: string;
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
  const conditions: string[] = ['e.deleted_at IS NULL'];
  const values: unknown[] = [];
  let idx = 1;
  let membershipJoin = '';

  if (filter.userId) {
    membershipJoin = `
       JOIN ledgers l ON l.id = e.ledger_id
       JOIN family_members fm ON fm.family_id = l.family_id
                              AND fm.user_id = $${idx++}
                              AND fm.left_at IS NULL`;
    values.push(filter.userId);
  }

  if (filter.ledgerId) { conditions.push(`e.ledger_id = $${idx++}`); values.push(filter.ledgerId); }
  if (filter.categoryId) { conditions.push(`e.category_id = $${idx++}`); values.push(filter.categoryId); }
  if (filter.type) { conditions.push(`e.type = $${idx++}`); values.push(filter.type); }
  if (filter.from) { conditions.push(`e.occurred_at >= $${idx++}`); values.push(filter.from); }
  if (filter.to) { conditions.push(`e.occurred_at <= $${idx++}`); values.push(filter.to); }

  if (cursor) {
    // cursor = updated_at + '|' + id（URL-safe base64 或原始字符串）
    const [cCursor, cId] = cursor.split('|');
    conditions.push(`(e.updated_at, e.id) < ($${idx++}, $${idx++})`);
    values.push(cCursor, cId);
  }

  const where = conditions.join(' AND ');
  values.push(limit + 1); // 多查一条判断 hasNext

  const res = await runner.query(
    `SELECT e.id, e.ledger_id, e.amount, e.currency, e.type, e.category_id,
            e.account_id, e.to_account_id, e.note, e.occurred_at,
            e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id, e.change_seq, e.shared_type, e.source_recurring_id
       FROM entries e
       ${membershipJoin}
      WHERE ${where}
      ORDER BY e.updated_at DESC, e.id DESC
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

// --- COSTRA-154: sync/pull 增量拉取 ---

/**
 * 增量拉取游标参数
 * ⚠️ entries 表无 family_id 列 · 必须 JOIN ledgers · 参 findById L272-273 范式
 *
 * BUG-COSTRA-154 v1.2 升级（2026-05-22 选项 B 彻底修复 · 协议 v1.2）：
 *   since 类型从 string（微秒 ISO） 改为 number（BIGINT change_seq）
 *   - PG SEQUENCE CACHE 1 下单调递增（已从 CACHE 100 修复为 CACHE 1）
 *   - ⚠️ 残余风险：先取号后提交的毫秒级窗口仍可能导致 watermark 跳过未提交行（独立课题）
 *   - 字符串字典序 → 数字大小比较 · 语义更清晰
 *   - 协议契约：sync-protocol.md §6.3 watermark 铁律（v1.2+）
 */
export interface PullCursor {
  /** since watermark · BIGINT change_seq · 0 表示首次全量拉取（默认值） */
  since: number;
  /** family_id · 必须先校验属于当前 user · service 层用 isUserInFamily */
  familyId: string;
  /** 单批次最多返回 · 默认 200 · 上限 500 */
  limit: number;
  /**
   * 导入 sync-hold 钳制上界（方案 §5.2.4 · E2b）：非 null 时只下发 change_seq <= cap 的行。
   * cap = 该 family 所有未过期 hold 的 MIN(sync_hold_seq)；无 hold 传 null（常态 · 零回归面）。
   * has_more 在 <= cap 的结果集内判定（截断即 false · 客户端本轮收敛下轮再来）。
   */
  cap?: number | null;
}

/**
 * 增量拉取 entries 含 family_id（JOIN ledgers · 不直接读 entries 表 family_id 列）
 * 用于 sync/pull 行返回 · 与 EntryEntity 区别：附加 familyId 字段
 *
 * BUG-COSTRA-154 v1.2 升级：
 *   PullEntryRow 直接含 changeSeq（继承自 EntryEntity）· 不再需要 updatedAtIso 微秒精度字段
 *   updated_at 在 wire 层用 e.updatedAt.toISOString()（毫秒精度足够展示）
 */
export type PullEntryRow = EntryEntity & {
  familyId: string;
};

/**
 * 增量拉取 entries（按 ledgers.family_id + entries.change_seq 推进 watermark）
 *
 * 行为约定（BUG-COSTRA-154 v1.2）：
 *   - JOIN ledgers · WHERE l.family_id = $1 AND e.change_seq > $2 · ORDER BY e.change_seq ASC
 *   - **不过滤 deleted_at**（协议 §3.5：软删行仍需在 since 窗口内返回 · client 据此本地软删）
 *   - LIMIT $3 + 1（多取一行用于 has_more 判定 · 实际返 LIMIT 行）
 *   - change_seq 严格唯一 · ORDER BY 不需要 id 兜底（消除 v1.1 同微秒漏拉风险）
 *   - 索引：idx_entries_ledger_change_seq (ledger_id, change_seq) · 但 family_id 在 ledgers
 *     PG 优化器会用 ledgers.family_id 索引 + entries.idx_entries_ledger_change_seq join
 *
 * 返回：{ rows: PullEntryRow[]（EntryEntity + familyId）, hasMore: boolean }
 */
export async function findEntriesByFamilySince(
  cursor: PullCursor,
  client?: Runner,
): Promise<{ rows: PullEntryRow[]; hasMore: boolean }> {
  const runner = client ?? exec();
  const limitPlusOne = cursor.limit + 1;
  const res = await runner.query(
    `SELECT e.id, e.ledger_id, l.family_id, e.amount, e.currency, e.type, e.category_id,
            e.account_id, e.to_account_id, e.note, e.occurred_at,
            e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id, e.change_seq, e.shared_type, e.source_recurring_id
       FROM entries e
       JOIN ledgers l ON l.id = e.ledger_id
      WHERE l.family_id = $1
        AND e.change_seq > $2
        AND ($4::bigint IS NULL OR e.change_seq <= $4)
      ORDER BY e.change_seq ASC
      LIMIT $3`,
    [cursor.familyId, cursor.since, limitPlusOne, cursor.cap ?? null],
  );
  const rows = res.rows.slice(0, cursor.limit).map((row): PullEntryRow => ({
    ...rowToEntity(row),
    familyId: row.family_id as string,  // 来自 JOIN · 非 entries 表列
  }));
  return { rows, hasMore: res.rows.length > cursor.limit };
}

/**
 * 按 id 查询 entry（含权限校验：ledger.family_id 属于 user + userId 过滤防越权）。
 *
 * COSTRA-152 R1 跨 family 守门补丁（COSTRA-104 R1 漏 · 153 R2 卡审捕获）：
 *   - entryRepo.findById 加 userId 参数 · JOIN family_members 增加 fm.user_id = $2 过滤
 *   - 返 null 时即跨 family / 不存在 · 调用方统一抛 NOT_FOUND
 *   - 影响 GET /entries/{id} + PATCH + DELETE 三处共享守门
 */
export async function findById(entryId: string, userIdOrClient?: string | Runner, client?: Runner): Promise<EntryEntity | null> {
  // 兼容旧调用：findById(entryId, client?) → userId undefined · 不过滤 userId（仅内部 repo 调用）
  let userId: string | undefined;
  let runner: Runner;
  if (typeof userIdOrClient === 'string') {
    userId = userIdOrClient;
    runner = client ?? exec();
  } else {
    userId = undefined;
    runner = userIdOrClient ?? exec();
  }

  if (userId) {
    const res = await runner.query(
      `SELECT e.id, e.ledger_id, e.amount, e.currency, e.type, e.category_id,
              e.account_id, e.to_account_id, e.note, e.occurred_at,
              e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id, e.change_seq, e.shared_type, e.source_recurring_id
         FROM entries e
         JOIN ledgers l ON l.id = e.ledger_id
         JOIN family_members fm ON fm.family_id = l.family_id
                                AND fm.user_id = $2
                                AND fm.left_at IS NULL
        WHERE e.id = $1 AND e.deleted_at IS NULL
        LIMIT 1`,
      [entryId, userId],
    );
    return res.rows[0] ? rowToEntity(res.rows[0]) : null;
  }

  // 无 userId 时走原始路径（内部 repo 调用 · 如 updateWithVersion/softDelete 冲突回查）
  const res = await runner.query(
    `SELECT e.id, e.ledger_id, e.amount, e.currency, e.type, e.category_id,
            e.account_id, e.to_account_id, e.note, e.occurred_at,
            e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id, e.change_seq, e.shared_type, e.source_recurring_id
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
 * 事务内 SELECT ... FOR UPDATE 读取 entry（COSTRA-4xx · spec §4.2）
 *
 * 用途：update/softDelete 分支在推进 change_seq 之前，需要拿到旧值（amount/type/change_seq）
 *并锁住行，防止 sync-push 批处理/定时补偿等未来路径绕过entries.version 乐观锁
 *      时读到脏 old 值。
 *
 *⚠️ 必须在事务内调用（传 PoolClient）；否则 FOR UPDATE 在自动提交模式下无意义。
 *
 *⚠️ 只锁 entries 行，不 JOIN 其它表做权限守门 —— 原因见下。
 *
 * 曾考虑把 active 成员守门并入这次查询（JOIN ledgers + family_members），省一次
 * 事务外读。两条硬约束使其不可行：
 *   1. pg-mem 不支持 `FOR UPDATE OF <alias>`，多表 JOIN 的裸 `FOR UPDATE` 会连带
 *      锁住 ledgers 与 family_members 行；
 *   2. 连带锁的加锁顺序由执行计划决定（大概率 entries → ledgers → family_members），
 *      与 create 路径的顺序（family_members → entries → ledgers）相反 → 死锁面。
 * 正确做法是在本查询**之前**单独锁一次成员行（familyMemberRepo.lockActiveMemberByLedger），
 * 保持与 create 相同的加锁顺序。
 */
export async function findByIdForUpdate(
  entryId: string,
  client: Runner,
): Promise<EntryEntity | null> {
  const res = await client.query(
    `SELECT id, ledger_id, amount, currency, type, category_id,
            account_id, to_account_id, note, occurred_at,
            created_by, created_at, updated_at, deleted_at, version, client_ref_id, change_seq, shared_type, source_recurring_id
       FROM entries
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE`,
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
            created_by, created_at, updated_at, deleted_at, version, client_ref_id, change_seq, shared_type, source_recurring_id
       FROM entries
      WHERE ledger_id = $1 AND client_ref_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [ledgerId, clientRefId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 按 client_ref_id 查找 entry（sync/push update/delete 使用）
 * 权限校验通过 JOIN families_users 确保调用者是 family 成员
 */
export async function findByClientRefId(clientRefId: string, userId: string, client?: Runner): Promise<EntryEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT e.id, e.ledger_id, e.amount, e.currency, e.type, e.category_id,
            e.account_id, e.to_account_id, e.note, e.occurred_at,
            e.created_by, e.created_at, e.updated_at, e.deleted_at, e.version, e.client_ref_id, e.change_seq, e.shared_type, e.source_recurring_id
       FROM entries e
       JOIN ledgers l ON l.id = e.ledger_id
       JOIN family_members fm ON fm.family_id = l.family_id AND fm.user_id = $2
      WHERE e.client_ref_id = $1 AND e.deleted_at IS NULL
      LIMIT 1`,
    [clientRefId, userId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}
