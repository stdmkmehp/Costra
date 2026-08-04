/**
 * Costra · Server · 定时记账业务编排层
 *
 * 卡号占位：COSTRA-5xx（T2 · Sprint-4 · Epic-E）
 * 事实源：
 *   - docs/design/recurring-entry-product-spec.md v0.3.2 §4/§5
 *   - docs/design/recurring-entry-tech-spec.md v0.2.1 §3/§5
 *
 * 职责：
 *   - validateCreate/validateUpdate 输入校验
 *   - assertUserOwnsLedger 权限校验
 *   - assignBucketMinute + computeNextRunAt 后端首次计算并落库
 *   - processOneRule 单条规则的补齐 loop（tech-spec §3.4）· 事务内 · 幂等
 *   - CRUD 语义：pause/resume/copy/softDelete
 *
 * 依赖：
 *   - recurringRepo（DAO）
 *   - entryService（用于 createWithIdempotency 生成 entry）
 *   - familyMemberRepo（权限校验）
 *   - ledgerRepo / userRepo（时区快照 · 账本归属）
 *
 * 权限模型（v0.2 "跟人不跟账本"）：
 *   - 所有查询按 created_by = $userId 过滤 · 匹配不上返 404
 *   - 只有 ledger 所属 family 的 active member 才能创建规则（assertUserOwnsLedger）
 */

import { randomUUID } from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as recurringRepo from '../repositories/recurringRepo.js';
import type {
  RecurringRuleEntity,
  Period,
  ExecuteBucket,
  EntryType,
  SharedType,
  UpdateRecurringRuleInput,
} from '../repositories/recurringRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import {
  assignBucketMinute,
  computeNextRunAt,
  BACKFILL_WINDOW_MS,
  MAX_BACKFILL_ITER,
  type RecurringRuleForCompute,
} from './recurringSchedule.js';
import type { EntryService } from './entryService.js';
import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';

// ==============================================================================
// 类型 & payload
// ==============================================================================

export interface CreateRecurringPayload {
  ledger_id: string;
  type: EntryType;
  amount: number;
  currency?: string;
  category_id?: string | null;
  account_id?: string | null;
  to_account_id?: string | null;
  note?: string | null;
  shared_type?: SharedType | null;
  period: Period;
  days_of_week?: number[] | null;
  days_of_month?: number[] | null;
  year_month_days?: number[] | null;
  execute_bucket: ExecuteBucket;
  timezone?: string;
  start_date: string;
  end_date?: string | null;
}

export interface UpdateRecurringPayload {
  amount?: number;
  category_id?: string | null;
  account_id?: string | null;
  to_account_id?: string | null;
  note?: string | null;
  shared_type?: SharedType | null;
  type?: EntryType;
  period?: Period;
  days_of_week?: number[] | null;
  days_of_month?: number[] | null;
  year_month_days?: number[] | null;
  execute_bucket?: ExecuteBucket;
  timezone?: string;
  start_date?: string;
  end_date?: string | null;
}

// ==============================================================================
// 校验（tech-spec §5.4）
// ==============================================================================

const PERIODS: readonly Period[] = [
  'weekly',
  'biweekly',
  'monthly',
  'bimonthly',
  'trimonthly',
  'yearly',
];
const BUCKETS: readonly ExecuteBucket[] = ['dawn', 'morning', 'afternoon', 'night'];

function unique(arr: number[]): boolean {
  return new Set(arr).size === arr.length;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

function daysInMonth(month: number): number {
  // 用于 year_month_days 元素校验 · 2 月放开到 29 · 其余按大小月
  if (month === 2) return 29;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

export function validateCreate(p: CreateRecurringPayload): void {
  function invalid(msg: string, field?: string): never {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: msg,
      details: field ? { field } : undefined,
    });
  }

  if (!p.ledger_id) invalid('ledger_id required', 'ledger_id');
  if (!p.type || !['income', 'expense', 'transfer'].includes(p.type))
    invalid('type must be income|expense|transfer', 'type');
  if (!Number.isInteger(p.amount) || p.amount < 1)
    invalid('amount must be positive integer', 'amount');

  // shared_type 与 type 关系
  if (p.type === 'expense') {
    if (p.shared_type != null && !['personal', 'shared'].includes(p.shared_type))
      invalid('shared_type must be personal|shared', 'shared_type');
  } else {
    if (p.shared_type != null)
      throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
        message: 'shared_type is only allowed for expense entries',
        details: { field: 'shared_type', type: p.type },
      });
  }

  if (!PERIODS.includes(p.period)) invalid('invalid period', 'period');
  if (!BUCKETS.includes(p.execute_bucket))
    invalid('invalid execute_bucket', 'execute_bucket');

  // period 与三个数组字段互斥
  const isWeekly = p.period === 'weekly' || p.period === 'biweekly';
  const isMonthly =
    p.period === 'monthly' ||
    p.period === 'bimonthly' ||
    p.period === 'trimonthly';
  const isYearly = p.period === 'yearly';

  if (isWeekly) {
    if (p.days_of_month != null || p.year_month_days != null)
      invalid('days_of_month/year_month_days must be null for weekly-family');
    const dow = p.days_of_week;
    if (!Array.isArray(dow) || dow.length === 0)
      invalid('days_of_week required', 'days_of_week');
    if (dow.length > 7)
      invalid('days_of_week max length is 7', 'days_of_week');
    if (!unique(dow)) invalid('days_of_week has duplicates', 'days_of_week');
    for (const d of dow) {
      if (!Number.isInteger(d) || d < 1 || d > 7)
        invalid(`days_of_week element out of range [1,7]: ${d}`, 'days_of_week');
    }
  }

  if (isMonthly) {
    if (p.days_of_week != null || p.year_month_days != null)
      invalid('days_of_week/year_month_days must be null for monthly-family');
    const dom = p.days_of_month;
    if (!Array.isArray(dom) || dom.length === 0)
      invalid('days_of_month required', 'days_of_month');
    if (dom.length > 14)
      invalid('days_of_month max length is 14', 'days_of_month');
    if (!unique(dom))
      invalid('days_of_month has duplicates', 'days_of_month');
    for (const d of dom) {
      if (!Number.isInteger(d) || d < 1 || d > 31)
        invalid(`days_of_month element out of range [1,31]: ${d}`, 'days_of_month');
    }
  }

  if (isYearly) {
    if (p.days_of_week != null || p.days_of_month != null)
      invalid('days_of_week/days_of_month must be null for yearly');
    const ymd = p.year_month_days;
    if (!Array.isArray(ymd) || ymd.length === 0)
      invalid('year_month_days required', 'year_month_days');
    if (ymd.length > 12)
      invalid('year_month_days max length is 12', 'year_month_days');
    if (!unique(ymd))
      invalid('year_month_days has duplicates', 'year_month_days');
    for (const encoded of ymd) {
      if (!Number.isInteger(encoded) || encoded < 101 || encoded > 1231)
        invalid(`year_month_days element out of range: ${encoded}`, 'year_month_days');
      const m = Math.floor(encoded / 100);
      const d = encoded % 100;
      if (m < 1 || m > 12)
        invalid(`year_month_days month invalid: ${encoded}`, 'year_month_days');
      if (d < 1 || d > daysInMonth(m))
        invalid(`year_month_days day invalid for month ${m}: ${encoded}`, 'year_month_days');
    }
  }

  if (!isValidDate(p.start_date))
    invalid('start_date must be YYYY-MM-DD', 'start_date');
  if (p.end_date != null) {
    if (!isValidDate(p.end_date))
      invalid('end_date must be YYYY-MM-DD or null', 'end_date');
    if (p.end_date <= p.start_date)
      invalid('end_date must be strictly greater than start_date', 'end_date');
  }
  if (p.note != null && p.note.length > 200)
    invalid('note max length is 200', 'note');
}

export function validateUpdate(p: UpdateRecurringPayload): void {
  // patch 校验：所有字段都是可选，只对非 undefined 值校验
  const dummy: CreateRecurringPayload = {
    ledger_id: '00000000-0000-0000-0000-000000000000',
    type: p.type ?? 'expense',
    amount: p.amount ?? 1,
    currency: 'CNY',
    category_id: p.category_id,
    account_id: p.account_id,
    to_account_id: p.to_account_id,
    note: p.note ?? null,
    shared_type: p.shared_type,
    period: p.period ?? 'weekly',
    days_of_week: p.days_of_week ?? null,
    days_of_month: p.days_of_month ?? null,
    year_month_days: p.year_month_days ?? null,
    execute_bucket: p.execute_bucket ?? 'dawn',
    timezone: p.timezone,
    start_date: p.start_date ?? '2000-01-01',
    end_date: p.end_date,
  };
  // 覆盖必填联动：如果 period 有传，days_of_* 必须匹配；不传 period 时不校验数组
  if (p.period !== undefined) {
    validateCreate(dummy);
  } else {
    // 局部校验：amount / note / end_date
    if (p.amount !== undefined && (!Number.isInteger(p.amount) || p.amount < 1))
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'amount must be positive', details: { field: 'amount' } });
    if (p.note !== undefined && p.note != null && p.note.length > 200)
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'note max length is 200', details: { field: 'note' } });
    if (p.end_date !== undefined && p.end_date != null && !isValidDate(p.end_date))
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'end_date must be YYYY-MM-DD', details: { field: 'end_date' } });
    if (p.shared_type !== undefined && p.shared_type != null && !['personal', 'shared'].includes(p.shared_type))
      throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'invalid shared_type', details: { field: 'shared_type' } });
  }
}

// ==============================================================================
// 依赖注入
// ==============================================================================

export interface RecurringServiceDeps {
  entryService: EntryService;
}

export interface RecurringService {
  create(userId: string, payload: CreateRecurringPayload): Promise<RecurringRuleEntity>;
  update(
    userId: string,
    ruleId: string,
    payload: UpdateRecurringPayload,
    baseVersion: number,
  ): Promise<RecurringRuleEntity>;
  pause(userId: string, ruleId: string): Promise<RecurringRuleEntity>;
  resume(userId: string, ruleId: string): Promise<RecurringRuleEntity>;
  copy(userId: string, ruleId: string): Promise<RecurringRuleEntity>;
  softDelete(userId: string, ruleId: string, baseVersion: number): Promise<void>;
  findById(userId: string, ruleId: string): Promise<RecurringRuleEntity>;
  list(userId: string, status?: string): Promise<RecurringRuleEntity[]>;
  /**
   * 调度器 tick 时调用 · 处理单条 due 规则
   * 事务内 · 补齐 loop · 幂等
   */
  processOneRule(rule: RecurringRuleEntity, now: Date, client: PoolClient): Promise<ProcessResult>;
}

export interface ProcessResult {
  generatedCount: number;
  generatedDates: Date[];
  skippedDates: Date[];
  newNextRunAt: Date;
  newStatus: 'active' | 'ended';
}

// ==============================================================================
// 工厂
// ==============================================================================

export function createRecurringService(deps: RecurringServiceDeps): RecurringService {
  const { entryService } = deps;

  // ------------ 内部辅助 ------------

  async function assertUserOwnsLedger(userId: string, ledgerId: string): Promise<void> {
    const ledger = await ledgerRepo.findById(ledgerId);
    if (!ledger) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: `ledger ${ledgerId} not found`,
        details: { ledger_id: ledgerId },
      });
    }
    const isMember = await familyMemberRepo.isActiveMember(userId, ledger.familyId);
    if (!isMember) {
      throw new AppError(ErrorCode.PERMISSION_DENIED, {
        message: 'user is not an active member of the ledger family',
        details: { ledger_id: ledgerId },
      });
    }
  }

  function toComputeShape(rule: {
    period: Period;
    timezone: string;
    startDate: string;
    executeHour: number;
    executeMinute: number;
    daysOfWeek: number[] | null;
    daysOfMonth: number[] | null;
    yearMonthDays: number[] | null;
  }): RecurringRuleForCompute {
    return {
      period: rule.period,
      timezone: rule.timezone,
      start_date: rule.startDate,
      execute_hour: rule.executeHour,
      execute_minute: rule.executeMinute,
      days_of_week: rule.daysOfWeek,
      days_of_month: rule.daysOfMonth,
      year_month_days: rule.yearMonthDays,
    };
  }

  function localDate(cursor: Date, tz: string): string {
    // Returns 'YYYY-MM-DD' in the rule's timezone for client_ref_id
    const dt = DateTime.fromJSDate(cursor, { zone: tz });
    if (!dt.isValid) {
      // 兜底：回退到 UTC 日期（tz 非法时验证阶段已 throw · 这里理论上不会到）
      return cursor.toISOString().slice(0, 10);
    }
    return dt.toISODate() ?? cursor.toISOString().slice(0, 10);
  }

  function makeClientRefId(ruleId: string, dayLocal: string): string {
    return `rec_${ruleId.replace(/-/g, '').slice(0, 8)}_${dayLocal}`;
  }

  // ------------ CRUD ------------

  async function create(
    userId: string,
    payload: CreateRecurringPayload,
  ): Promise<RecurringRuleEntity> {
    validateCreate(payload);
    await assertUserOwnsLedger(userId, payload.ledger_id);

    // 时区快照：优先请求体，缺失时从 users.timezone 拿
    let timezone = payload.timezone;
    if (!timezone) {
      const user = await userRepo.findById(userId);
      timezone = user?.timezone ?? 'Asia/Shanghai';
    }

    // 生成 id → assignBucketMinute → computeNextRunAt → INSERT
    const id = randomUUID();
    const { hour, minute } = assignBucketMinute(userId, id, payload.execute_bucket);

    const forCompute: RecurringRuleForCompute = {
      period: payload.period,
      timezone,
      start_date: payload.start_date,
      execute_hour: hour,
      execute_minute: minute,
      days_of_week: payload.days_of_week ?? null,
      days_of_month: payload.days_of_month ?? null,
      year_month_days: payload.year_month_days ?? null,
    };

    // 起点：start_date 00:00 in tz（严格 > 该时刻的下一个匹配日）
    // 使用 luxon 保证时区正确
    const fromStart = DateTime.fromISO(payload.start_date, { zone: timezone })
      .startOf('day')
      .minus({ minutes: 1 }) // 让 computeNextRunAt 内部 +1min 后回到 00:00
      .toJSDate();
    const nextRunAt = computeNextRunAt(forCompute, fromStart);

    // 检查 end_date 边界：若 next_run_at 已超 end_date → 直接拒绝创建
    if (payload.end_date != null) {
      const endBoundary = DateTime.fromISO(payload.end_date, { zone: timezone })
        .endOf('day')
        .toJSDate();
      if (nextRunAt > endBoundary) {
        throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
          message: 'no matching execution date within [start_date, end_date]',
          details: { start_date: payload.start_date, end_date: payload.end_date },
        });
      }
    }

    const entity = await recurringRepo.insertRule({
      id,
      ledgerId: payload.ledger_id,
      createdBy: userId,
      type: payload.type,
      amount: payload.amount,
      currency: payload.currency,
      categoryId: payload.category_id ?? null,
      accountId: payload.account_id ?? null,
      toAccountId: payload.to_account_id ?? null,
      note: payload.note ?? null,
      sharedType:
        payload.type === 'expense' ? payload.shared_type ?? null : null,
      period: payload.period,
      daysOfWeek: payload.days_of_week ?? null,
      daysOfMonth: payload.days_of_month ?? null,
      yearMonthDays: payload.year_month_days ?? null,
      executeBucket: payload.execute_bucket,
      executeHour: hour,
      executeMinute: minute,
      timezone,
      startDate: payload.start_date,
      endDate: payload.end_date ?? null,
      nextRunAt,
    });
    return entity;
  }

  async function update(
    userId: string,
    ruleId: string,
    payload: UpdateRecurringPayload,
    baseVersion: number,
  ): Promise<RecurringRuleEntity> {
    validateUpdate(payload);
    const existing = await findById(userId, ruleId);

    // 若 ledger 变更（不允许 · 不在 payload 里）· 若 timezone 变化则重算
    // 若 execute_bucket 变化 → 重算 hour/minute
    // 若 period / days_of_* / start_date / execute_bucket / timezone 任一变化 → 重算 next_run_at

    let hour = existing.executeHour;
    let minute = existing.executeMinute;
    if (payload.execute_bucket && payload.execute_bucket !== existing.executeBucket) {
      const r = assignBucketMinute(userId, ruleId, payload.execute_bucket);
      hour = r.hour;
      minute = r.minute;
    }

    const newTimezone = payload.timezone ?? existing.timezone;
    const newStartDate = payload.start_date ?? existing.startDate;
    const newPeriod = payload.period ?? existing.period;

    // 数组字段选择：如果 period 变更，用 payload 提供的新数组；如果 period 未变，则 payload 的新数组或旧值
    const newDow =
      payload.days_of_week !== undefined
        ? payload.days_of_week
        : existing.daysOfWeek;
    const newDom =
      payload.days_of_month !== undefined
        ? payload.days_of_month
        : existing.daysOfMonth;
    const newYmd =
      payload.year_month_days !== undefined
        ? payload.year_month_days
        : existing.yearMonthDays;

    // 是否需要重算 next_run_at
    const needsRecompute =
      payload.period !== undefined ||
      payload.days_of_week !== undefined ||
      payload.days_of_month !== undefined ||
      payload.year_month_days !== undefined ||
      payload.timezone !== undefined ||
      payload.start_date !== undefined ||
      payload.execute_bucket !== undefined;

    let nextRunAt: Date | undefined;
    if (needsRecompute) {
      const forCompute: RecurringRuleForCompute = {
        period: newPeriod,
        timezone: newTimezone,
        start_date: newStartDate,
        execute_hour: hour,
        execute_minute: minute,
        days_of_week: newDow,
        days_of_month: newDom,
        year_month_days: newYmd,
      };
      // 若 start_date 是未来 → 从 start_date 起算；否则从 now 起算
      const nowMs = Date.now();
      const startMs = DateTime.fromISO(newStartDate, { zone: newTimezone })
        .startOf('day')
        .toMillis();
      const from = startMs > nowMs ? new Date(startMs - 60_000) : new Date(nowMs);
      nextRunAt = computeNextRunAt(forCompute, from);
    }

    const input: UpdateRecurringRuleInput = {};
    if (payload.amount !== undefined) input.amount = payload.amount;
    if (payload.category_id !== undefined) input.categoryId = payload.category_id;
    if (payload.account_id !== undefined) input.accountId = payload.account_id;
    if (payload.to_account_id !== undefined)
      input.toAccountId = payload.to_account_id;
    if (payload.note !== undefined) input.note = payload.note;
    if (payload.shared_type !== undefined) input.sharedType = payload.shared_type;
    if (payload.type !== undefined) input.type = payload.type;
    if (payload.period !== undefined) input.period = payload.period;
    if (payload.days_of_week !== undefined) input.daysOfWeek = payload.days_of_week;
    if (payload.days_of_month !== undefined)
      input.daysOfMonth = payload.days_of_month;
    if (payload.year_month_days !== undefined)
      input.yearMonthDays = payload.year_month_days;
    if (payload.execute_bucket !== undefined) {
      input.executeBucket = payload.execute_bucket;
      input.executeHour = hour;
      input.executeMinute = minute;
    }
    if (payload.timezone !== undefined) input.timezone = payload.timezone;
    if (payload.start_date !== undefined) input.startDate = payload.start_date;
    if (payload.end_date !== undefined) input.endDate = payload.end_date;
    if (nextRunAt !== undefined) input.nextRunAt = nextRunAt;

    const updated = await recurringRepo.updateRuleByVersion(
      ruleId,
      userId,
      input,
      baseVersion,
    );
    if (!updated) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, {
        message: 'recurring rule version conflict',
        details: { rule_id: ruleId, base_version: baseVersion },
      });
    }
    return updated;
  }

  async function pause(userId: string, ruleId: string): Promise<RecurringRuleEntity> {
    const existing = await findById(userId, ruleId);
    if (existing.status === 'ended') {
      throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
        message: 'cannot pause an ended rule',
        details: { rule_id: ruleId, status: existing.status },
      });
    }
    const updated = await recurringRepo.updateStatus(ruleId, 'paused');
    if (!updated) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: `rule ${ruleId} not found`,
        details: { rule_id: ruleId },
      });
    }
    return updated;
  }

  async function resume(userId: string, ruleId: string): Promise<RecurringRuleEntity> {
    const existing = await findById(userId, ruleId);
    if (existing.status === 'ended') {
      throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
        message: 'cannot resume an ended rule',
        details: { rule_id: ruleId },
      });
    }
    // resume 时重算 next_run_at（从当前时刻起算 · 不补跑历史）
    const forCompute = toComputeShape(existing);
    const nextRunAt = computeNextRunAt(forCompute, new Date());

    // 若已过 end_date → 拒绝
    if (existing.endDate != null) {
      const endBoundary = DateTime.fromISO(existing.endDate, {
        zone: existing.timezone,
      })
        .endOf('day')
        .toJSDate();
      if (nextRunAt > endBoundary) {
        throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
          message: 'next execution would exceed end_date',
          details: { rule_id: ruleId, end_date: existing.endDate },
        });
      }
    }
    const updated = await recurringRepo.updateStatus(ruleId, 'active', {
      nextRunAt,
      consecutiveFailures: 0,
    });
    if (!updated) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: `rule ${ruleId} not found`,
        details: { rule_id: ruleId },
      });
    }
    return updated;
  }

  async function copy(userId: string, ruleId: string): Promise<RecurringRuleEntity> {
    const existing = await findById(userId, ruleId);
    const payload: CreateRecurringPayload = {
      ledger_id: existing.ledgerId,
      type: existing.type,
      amount: existing.amount,
      currency: existing.currency,
      category_id: existing.categoryId,
      account_id: existing.accountId,
      to_account_id: existing.toAccountId,
      note: existing.note,
      shared_type: existing.sharedType,
      period: existing.period,
      days_of_week: existing.daysOfWeek,
      days_of_month: existing.daysOfMonth,
      year_month_days: existing.yearMonthDays,
      execute_bucket: existing.executeBucket,
      timezone: existing.timezone,
      // 复制规则：start_date 用今天，避免"复制出来的规则立刻要补跑历史"
      start_date: DateTime.now().setZone(existing.timezone).toISODate() ?? existing.startDate,
      end_date: null, // 复制不带 end_date · 让用户自己填
    };
    return create(userId, payload);
  }

  async function softDelete(
    userId: string,
    ruleId: string,
    baseVersion: number,
  ): Promise<void> {
    const existing = await findById(userId, ruleId);
    const ok = await recurringRepo.softDelete(ruleId, userId, baseVersion);
    if (!ok) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, {
        message: 'recurring rule version conflict',
        details: { rule_id: ruleId, base_version: baseVersion, current_version: existing.version },
      });
    }
  }

  async function findById(
    userId: string,
    ruleId: string,
  ): Promise<RecurringRuleEntity> {
    const rule = await recurringRepo.findByIdForUser(ruleId, userId);
    if (!rule) {
      throw new AppError(ErrorCode.NOT_FOUND, {
        message: `recurring rule ${ruleId} not found`,
        details: { rule_id: ruleId },
      });
    }
    return rule;
  }

  async function list(userId: string, status?: string): Promise<RecurringRuleEntity[]> {
    const normStatus =
      status && ['active', 'paused', 'ended', 'auto_paused', 'all'].includes(status)
        ? (status as 'active' | 'paused' | 'ended' | 'auto_paused' | 'all')
        : 'all';
    return recurringRepo.listByUser(userId, { status: normStatus });
  }

  // ------------ scheduler tick 单条规则处理（tech-spec §3.4）------------

  async function processOneRule(
    rule: RecurringRuleEntity,
    now: Date,
    client: PoolClient,
  ): Promise<ProcessResult> {
    const forCompute = toComputeShape(rule);

    let cursor = rule.nextRunAt;
    const generated: Date[] = [];
    const skipped: Date[] = [];
    const nowMs = now.getTime();

    // 补齐 loop
    for (let iter = 0; iter < MAX_BACKFILL_ITER; iter++) {
      if (cursor.getTime() > nowMs) break;

      const delta = nowMs - cursor.getTime();
      if (delta > BACKFILL_WINDOW_MS) {
        // 超窗 · skip 单个日子
        skipped.push(cursor);
        cursor = computeNextRunAt(forCompute, cursor);
        continue;
      }

      // 在窗内 · 生成 entry
      const dayLocal = localDate(cursor, rule.timezone);
      const clientRefId = makeClientRefId(rule.id, dayLocal);

      const result = await entryService.createWithIdempotency(
        rule.createdBy,
        {
          ledger_id: rule.ledgerId,
          amount: rule.amount,
          currency: rule.currency,
          type: rule.type,
          category_id: rule.categoryId,
          account_id: rule.accountId,
          to_account_id: rule.toAccountId,
          note: rule.note,
          occurred_at: cursor.toISOString(),
          shared_type: rule.sharedType,
          client_ref_id: clientRefId,
        },
        clientRefId,
        { sourceRecurringId: rule.id },
      );
      if (result.status === 'ok' || result.status === 'conflict') {
        // ok = 新生成 · conflict = 之前已生成过（幂等） · 都视为已完成
        generated.push(cursor);
      } else {
        // rejected · 例如分类被删且无兜底 · 视为业务错误，让调用方决定
        throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
          message: `entry creation rejected for rule ${rule.id}: ${result.error.message}`,
          details: { rule_id: rule.id, error: result.error },
        });
      }

      cursor = computeNextRunAt(forCompute, cursor);
    }

    // 计算最终状态与 next_run_at
    let newStatus: 'active' | 'ended' = 'active';
    let newNextRunAt = cursor;
    if (rule.endDate != null) {
      const endBoundary = DateTime.fromISO(rule.endDate, { zone: rule.timezone })
        .endOf('day')
        .toJSDate();
      if (cursor > endBoundary) {
        newStatus = 'ended';
      }
    }

    const lastRunStatus = skipped.length > 0 ? 'ok_with_skipped' : 'ok';
    await client.query(
      `UPDATE recurring_rules
          SET next_run_at = $1,
              last_run_at = $2,
              last_run_status = $3,
              consecutive_failures = 0,
              status = $4,
              version = version + 1,
              change_seq = nextval('entries_change_seq')
        WHERE id = $5 AND deleted_at IS NULL`,
      [newNextRunAt, now, lastRunStatus, newStatus, rule.id],
    );

    return {
      generatedCount: generated.length,
      generatedDates: generated,
      skippedDates: skipped,
      newNextRunAt,
      newStatus,
    };
  }

  return {
    create,
    update,
    pause,
    resume,
    copy,
    softDelete,
    findById,
    list,
    processOneRule,
  };
}
