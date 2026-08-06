/**
 * Costra · Server · recurring_rules DAO
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：
 *   - server/db/migrations/0011_recurring_entries.sql
 *   - docs/design/recurring-entry-tech-spec.md §4/§5
 *
 * 职责：
 *   - 封装 recurring_rules 表的 SQL 访问
 *   - 返回领域实体 RecurringRuleEntity（camelCase）· 不暴露 pg 行对象
 *   - 不处理业务语义（比如"权限过滤"）· 由 recurringService 判定
 *
 * 权限约束（service 层套壳）：
 *   所有写操作在 service 层 WHERE created_by = $userId AND deleted_at IS NULL
 *   匹配不上返 404（不返 403 · 防止越权者探测 id 存在性）
 */

import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';

// ==============================================================================
// 类型定义
// ==============================================================================

export type Period =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'trimonthly'
  | 'yearly';

export type ExecuteBucket = 'dawn' | 'morning' | 'afternoon' | 'night';

export type RecurringStatus = 'active' | 'paused' | 'ended' | 'auto_paused';

export type EntryType = 'income' | 'expense' | 'transfer';

export type SharedType = 'personal' | 'shared';

export interface RecurringRuleEntity {
  id: string;
  ledgerId: string;
  createdBy: string;

  // 模板字段
  type: EntryType;
  amount: number; // 单位：分
  currency: string;
  categoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  note: string | null;
  sharedType: SharedType | null;

  // 周期配置
  period: Period;
  daysOfWeek: number[] | null;
  daysOfMonth: number[] | null;
  yearMonthDays: number[] | null;

  // 时段
  executeBucket: ExecuteBucket;
  executeHour: number;
  executeMinute: number;
  timezone: string;

  // 生命周期
  startDate: string; // 'YYYY-MM-DD'
  endDate: string | null;
  status: RecurringStatus;

  // 调度水位
  nextRunAt: Date; // UTC
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  consecutiveFailures: number;

  // 审计 / 版本
  changeSeq: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

interface RecurringRuleRow {
  id: string;
  ledger_id: string;
  created_by: string;

  type: EntryType;
  amount: string | number;
  currency: string;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  note: string | null;
  shared_type: SharedType | null;

  period: Period;
  days_of_week: number[] | null;
  days_of_month: number[] | null;
  year_month_days: number[] | null;

  execute_bucket: ExecuteBucket;
  execute_hour: number;
  execute_minute: number;
  timezone: string;

  start_date: string | Date;
  end_date: string | Date | null;
  status: RecurringStatus;

  next_run_at: Date;
  last_run_at: Date | null;
  last_run_status: string | null;
  consecutive_failures: number;

  change_seq: string | number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

function toIsoDate(v: string | Date): string {
  if (typeof v === 'string') return v.slice(0, 10);
  const y = v.getUTCFullYear();
  const m = String(v.getUTCMonth() + 1).padStart(2, '0');
  const d = String(v.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function rowToEntity(r: RecurringRuleRow): RecurringRuleEntity {
  return {
    id: r.id,
    ledgerId: r.ledger_id,
    createdBy: r.created_by,
    type: r.type,
    amount: Number(r.amount),
    currency: r.currency,
    categoryId: r.category_id,
    accountId: r.account_id,
    toAccountId: r.to_account_id,
    note: r.note,
    sharedType: r.shared_type,
    period: r.period,
    daysOfWeek: r.days_of_week,
    daysOfMonth: r.days_of_month,
    yearMonthDays: r.year_month_days,
    executeBucket: r.execute_bucket,
    executeHour: r.execute_hour,
    executeMinute: r.execute_minute,
    timezone: r.timezone,
    startDate: toIsoDate(r.start_date),
    endDate: r.end_date == null ? null : toIsoDate(r.end_date),
    status: r.status,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastRunStatus: r.last_run_status,
    consecutiveFailures: r.consecutive_failures,
    changeSeq: Number(r.change_seq),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
    version: r.version,
  };
}

// ==============================================================================
// 执行器抽象
// ==============================================================================

type Runner = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: (RecurringRuleRow & Record<string, unknown>)[]; rowCount?: number | null }>;
};

function exec(): Runner {
  return getPool() as unknown as Runner;
}

// ==============================================================================
// CRUD
// ==============================================================================

export interface CreateRecurringRuleInput {
  id: string; // 由 service 层生成（先生成 id 再调 assignBucketMinute）
  ledgerId: string;
  createdBy: string;
  type: EntryType;
  amount: number;
  currency?: string;
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  note?: string | null;
  sharedType?: SharedType | null;
  period: Period;
  daysOfWeek?: number[] | null;
  daysOfMonth?: number[] | null;
  yearMonthDays?: number[] | null;
  executeBucket: ExecuteBucket;
  executeHour: number;
  executeMinute: number;
  timezone: string;
  startDate: string;
  endDate?: string | null;
  nextRunAt: Date;
  /**
   * 初始 status · 默认 'active'。
   * 仅 create 路径用得到：当 next_run_at 已超 end_date 闭区间时直接落 'ended'，
   * 与 update 路径的 end_date 收敛语义对齐（不再抛 BUSINESS_RULE_VIOLATION）。
   */
  status?: RecurringStatus;
}

export async function insertRule(
  input: CreateRecurringRuleInput,
  client?: Runner,
): Promise<RecurringRuleEntity> {
  const runner = client ?? exec();
  const status = input.status ?? 'active';
  const res = await runner.query(
    `INSERT INTO recurring_rules (
       id, ledger_id, created_by,
       type, amount, currency, category_id, account_id, to_account_id, note, shared_type,
       period, days_of_week, days_of_month, year_month_days,
       execute_bucket, execute_hour, execute_minute, timezone,
       start_date, end_date, next_run_at, status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
     )
     RETURNING *`,
    [
      input.id,
      input.ledgerId,
      input.createdBy,
      input.type,
      input.amount,
      input.currency ?? 'CNY',
      input.categoryId ?? null,
      input.accountId ?? null,
      input.toAccountId ?? null,
      input.note ?? null,
      input.sharedType ?? null,
      input.period,
      input.daysOfWeek ?? null,
      input.daysOfMonth ?? null,
      input.yearMonthDays ?? null,
      input.executeBucket,
      input.executeHour,
      input.executeMinute,
      input.timezone,
      input.startDate,
      input.endDate ?? null,
      input.nextRunAt,
      status,
    ],
  );
  if (!res.rows[0]) {
    throw new Error('[recurringRepo] INSERT returned no row');
  }
  return rowToEntity(res.rows[0]);
}

/**
 * 查规则 · 走 (id, created_by, deleted_at IS NULL) 三元过滤
 * 权限外的调用（如 scheduler tick）用 findByIdRaw
 */
export async function findByIdForUser(
  ruleId: string,
  userId: string,
  client?: Runner,
): Promise<RecurringRuleEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT * FROM recurring_rules
      WHERE id = $1 AND created_by = $2 AND deleted_at IS NULL`,
    [ruleId, userId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 内部使用 · 不过滤 created_by（scheduler / audit）
 */
export async function findByIdRaw(
  ruleId: string,
  client?: Runner,
): Promise<RecurringRuleEntity | null> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT * FROM recurring_rules WHERE id = $1 AND deleted_at IS NULL`,
    [ruleId],
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

export interface ListByUserFilter {
  status?: RecurringStatus | 'all';
}

export async function listByUser(
  userId: string,
  filter: ListByUserFilter,
  client?: Runner,
): Promise<RecurringRuleEntity[]> {
  const runner = client ?? exec();
  let sql = `SELECT * FROM recurring_rules
              WHERE created_by = $1 AND deleted_at IS NULL`;
  const params: unknown[] = [userId];
  if (filter.status && filter.status !== 'all') {
    sql += ` AND status = $2`;
    params.push(filter.status);
  }
  sql += ` ORDER BY created_at DESC`;
  const res = await runner.query(sql, params);
  return res.rows.map(rowToEntity);
}

/**
 * 统计用户当前拥有的规则总数（含 active / paused / ended / auto_paused · 不含软删）。
 * 用于「单用户规则上限」校验：创建 / 复制前先 count，达上限即拒绝。
 */
export async function countByUser(
  userId: string,
  client?: Runner,
): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT COUNT(*) AS cnt
       FROM recurring_rules
      WHERE created_by = $1 AND deleted_at IS NULL`,
    [userId],
  );
  const row = res.rows[0] as unknown as { cnt?: string | number } | undefined;
  return Number(row?.cnt ?? 0);
}

// ==============================================================================
// 更新（乐观锁）
// ==============================================================================

export interface UpdateRecurringRuleInput {
  amount?: number;
  categoryId?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
  note?: string | null;
  sharedType?: SharedType | null;
  type?: EntryType;
  period?: Period;
  daysOfWeek?: number[] | null;
  daysOfMonth?: number[] | null;
  yearMonthDays?: number[] | null;
  executeBucket?: ExecuteBucket;
  executeHour?: number;
  executeMinute?: number;
  timezone?: string;
  startDate?: string;
  endDate?: string | null;
  nextRunAt?: Date;
  /** T2 · PATCH end_date 后若已过期，可一并置 'ended' */
  status?: RecurringStatus;
}

/**
 * 乐观锁 UPDATE · WHERE version = baseVersion
 * 匹配失败返 null → caller 判 conflict
 *
 * 同时 UPDATE change_seq = nextval('entries_change_seq') · version = version + 1
 */
export async function updateRuleByVersion(
  ruleId: string,
  userId: string,
  input: UpdateRecurringRuleInput,
  baseVersion: number,
  client?: Runner,
): Promise<RecurringRuleEntity | null> {
  const runner = client ?? exec();
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const push = (col: string, val: unknown) => {
    fields.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (input.amount !== undefined) push('amount', input.amount);
  if (input.categoryId !== undefined) push('category_id', input.categoryId);
  if (input.accountId !== undefined) push('account_id', input.accountId);
  if (input.toAccountId !== undefined) push('to_account_id', input.toAccountId);
  if (input.note !== undefined) push('note', input.note);
  if (input.sharedType !== undefined) push('shared_type', input.sharedType);
  if (input.type !== undefined) push('type', input.type);
  if (input.period !== undefined) push('period', input.period);
  if (input.daysOfWeek !== undefined) push('days_of_week', input.daysOfWeek);
  if (input.daysOfMonth !== undefined) push('days_of_month', input.daysOfMonth);
  if (input.yearMonthDays !== undefined)
    push('year_month_days', input.yearMonthDays);
  if (input.executeBucket !== undefined)
    push('execute_bucket', input.executeBucket);
  if (input.executeHour !== undefined) push('execute_hour', input.executeHour);
  if (input.executeMinute !== undefined)
    push('execute_minute', input.executeMinute);
  if (input.timezone !== undefined) push('timezone', input.timezone);
  if (input.startDate !== undefined) push('start_date', input.startDate);
  if (input.endDate !== undefined) push('end_date', input.endDate);
  if (input.nextRunAt !== undefined) push('next_run_at', input.nextRunAt);
  if (input.status !== undefined) push('status', input.status);

  if (fields.length === 0) {
    // 无实际字段变更 · 直接返回当前行（保持幂等）
    return findByIdForUser(ruleId, userId, client);
  }

  fields.push(`version = version + 1`);
  fields.push(`change_seq = nextval('entries_change_seq')`);

  values.push(ruleId, userId, baseVersion);
  const res = await runner.query(
    `UPDATE recurring_rules
        SET ${fields.join(', ')}
      WHERE id = $${idx++} AND created_by = $${idx++} AND version = $${idx++} AND deleted_at IS NULL
    RETURNING *`,
    values,
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 状态切换（pause/resume/auto_pause/ended）· 内部使用
 * 不校验版本 · 幂等
 */
export async function updateStatus(
  ruleId: string,
  status: RecurringStatus,
  extra: {
    nextRunAt?: Date;
    lastRunAt?: Date;
    lastRunStatus?: string;
    consecutiveFailures?: number;
  } = {},
  client?: Runner,
): Promise<RecurringRuleEntity | null> {
  const runner = client ?? exec();
  const fields: string[] = ['status = $2'];
  const values: unknown[] = [ruleId, status];
  let idx = 3;
  if (extra.nextRunAt !== undefined) {
    fields.push(`next_run_at = $${idx++}`);
    values.push(extra.nextRunAt);
  }
  if (extra.lastRunAt !== undefined) {
    fields.push(`last_run_at = $${idx++}`);
    values.push(extra.lastRunAt);
  }
  if (extra.lastRunStatus !== undefined) {
    fields.push(`last_run_status = $${idx++}`);
    values.push(extra.lastRunStatus);
  }
  if (extra.consecutiveFailures !== undefined) {
    fields.push(`consecutive_failures = $${idx++}`);
    values.push(extra.consecutiveFailures);
  }
  fields.push(`version = version + 1`);
  fields.push(`change_seq = nextval('entries_change_seq')`);

  const res = await runner.query(
    `UPDATE recurring_rules
        SET ${fields.join(', ')}
      WHERE id = $1 AND deleted_at IS NULL
    RETURNING *`,
    values,
  );
  return res.rows[0] ? rowToEntity(res.rows[0]) : null;
}

/**
 * 软删 · 乐观锁 · WHERE created_by = $userId
 */
export async function softDelete(
  ruleId: string,
  userId: string,
  baseVersion: number,
  client?: Runner,
): Promise<boolean> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE recurring_rules
        SET deleted_at = now(),
            version = version + 1,
            change_seq = nextval('entries_change_seq')
      WHERE id = $1 AND created_by = $2 AND version = $3 AND deleted_at IS NULL`,
    [ruleId, userId, baseVersion],
  );
  return (res.rowCount ?? 0) > 0;
}

// ==============================================================================
// 调度器查询
// ==============================================================================

/**
 * 拉取所有 due 规则 · 用于 scheduler tick
 * 事务内调用 · 需要传 PoolClient 才能配合 FOR UPDATE SKIP LOCKED
 *
 * pg-mem 兼容：NODE_ENV === 'test' 时省略 FOR UPDATE SKIP LOCKED
 *   （pg-mem 不支持 SKIP LOCKED 关键字 · 本期单实例调度，等价语义）
 */
export async function findDueRules(
  now: Date,
  limit: number,
  client: PoolClient,
): Promise<RecurringRuleEntity[]> {
  const isTest = process.env.NODE_ENV === 'test';
  const lockClause = isTest ? '' : 'FOR UPDATE SKIP LOCKED';
  const res = await client.query<RecurringRuleRow>(
    `SELECT * FROM recurring_rules
      WHERE status = 'active'
        AND deleted_at IS NULL
        AND next_run_at <= $1
        AND (end_date IS NULL OR end_date + INTERVAL '1 day' > $1)
      ORDER BY next_run_at ASC
      LIMIT $2
      ${lockClause}`,
    [now, limit],
  );
  return res.rows.map(rowToEntity);
}

/**
 * 账本失效级联降级：找出所有归属该 ledger 的 active 规则
 * 用于 ledger 删除时联动 auto_paused
 */
export async function findActiveRulesByLedger(
  ledgerId: string,
  client?: Runner,
): Promise<RecurringRuleEntity[]> {
  const runner = client ?? exec();
  const res = await runner.query(
    `SELECT * FROM recurring_rules
      WHERE ledger_id = $1 AND status = 'active' AND deleted_at IS NULL`,
    [ledgerId],
  );
return res.rows.map(rowToEntity);
}

/**
 * 已过期 active 规则一次性置 'ended'。
 *
 * 场景：due 查询过滤掉了 `end_date + 1d <= now` 的 active 规则，导致它们永远进不了
 * processOneRule 更新状态。列表页会一直看到"启用中但不会执行"的僵尸规则。
 * 由 scheduler tick 每次调用一次，成本 O(表大小)，走 idx_recurring_rules_next_run 分区索引。
 *
 * 返回受影响行数，供 tick report 记录。
 */
export async function markEndedForExpired(
  now: Date,
  client?: Runner,
): Promise<number> {
  const runner = client ?? exec();
  const res = await runner.query(
    `UPDATE recurring_rules
        SET status = 'ended',
 last_run_at = $1,
            last_run_status = 'ended_by_end_date',
         version = version + 1,
            change_seq = nextval('entries_change_seq')
      WHERE status = 'active'
      AND deleted_at IS NULL
        AND end_date IS NOT NULL
        AND end_date + INTERVAL '1 day' <= $1`,
    [now],
  );
  return res.rowCount ?? 0;
}
