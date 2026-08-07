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
import * as familyRepo from '../repositories/familyRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as userRepo from '../repositories/userRepo.js';
import {
  assignBucketMinute,
  computeNextRunAt,
  BUCKET_WINDOWS,
  BACKFILL_WINDOW_MS,
  MAX_BACKFILL_ITER,
  type RecurringRuleForCompute,
  type WorkdayData,
} from './recurringSchedule.js';
import { getAllWorkdayData } from './workdayProvider.js';
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
  /** 周期间隔倍数（如每3周=3）· 默认1 */
  period_interval?: number;
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
  /** 周期间隔倍数（如每3周=3）· 默认1 */
  period_interval?: number;
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
  'monthly',
  'yearly',
  'workday',
  'daily',
];
const BUCKETS: readonly ExecuteBucket[] = ['dawn', 'morning', 'afternoon', 'night'];

/**
 * 单用户定时记账规则上限（含启用 / 禁用 / 已到期 / 自动停用 · 不含软删）。
 * 事实源：用户需求 2026-08-06。
 */
const MAX_RULES_PER_USER = 32;

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

  if (!PERIODS.includes(p.period)) invalid('invalid period','period');
  if (p.period_interval !== undefined) {
    if (!Number.isInteger(p.period_interval) || p.period_interval < 1)
      invalid('period_interval must be a positive integer', 'period_interval');
    if (p.period === 'yearly' && p.period_interval > 1)
      invalid('period_interval > 1 is not supported for yearly', 'period_interval');
    if (p.period === 'workday' && p.period_interval > 1)
      invalid('period_interval > 1 is not supported for workday', 'period_interval');
  }
  if (!BUCKETS.includes(p.execute_bucket))
    invalid('invalid execute_bucket', 'execute_bucket');

  // period 与三个数组字段互斥
  const isWeekly = p.period === 'weekly';
  const isMonthly = p.period === 'monthly';
  const isYearly = p.period === 'yearly';
  const isWorkday = p.period === 'workday';
  const isDaily = p.period === 'daily';

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

  if (isWorkday) {
    if (p.days_of_week != null || p.days_of_month != null || p.year_month_days != null)
      invalid('days_of_week/days_of_month/year_month_days must be null for workday');
  }

  if (isDaily) {
    if (p.days_of_week != null || p.days_of_month != null || p.year_month_days != null)
      invalid('days_of_week/days_of_month/year_month_days must be null for daily');
  }

  if (!isValidDate(p.start_date))
    invalid('start_date must be YYYY-MM-DD', 'start_date');
  if (p.end_date != null) {
    if (!isValidDate(p.end_date))
      invalid('end_date must be YYYY-MM-DD or null', 'end_date');
    if (p.end_date < p.start_date)
      invalid('end_date must not be earlier than start_date', 'end_date');
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
  newStatus: 'active' | 'ended' | 'auto_paused';
  /**
   * 当 newStatus === 'auto_paused' 时，说明本轮 tick 检测到运行前置条件失效
   * （账本被删 / 家庭被解散 / 用户已退出家庭），未生成任何 entry。
   * 值对应写入 recurring_rules.last_run_status，供列表页显示原因。
   */
  autoPausedReason?:
    | 'failed_ledger_deleted'
    | 'failed_family_deleted'
    | 'failed_user_left_family';
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

  /**
   * 单用户规则上限校验：创建 / 复制前 count，达到 MAX_RULES_PER_USER 即拒绝。
   * 计数含所有未软删规则（active / paused / ended / auto_paused）。
   */
  async function assertUnderRuleLimit(userId: string): Promise<void> {
    const count = await recurringRepo.countByUser(userId);
    if (count >= MAX_RULES_PER_USER) {
      throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
        message: `recurring rule limit reached (max ${MAX_RULES_PER_USER} per user)`,
        details: { current: count, limit: MAX_RULES_PER_USER },
      });
    }
  }

  /**
   * 获取所有已缓存的 workday 节假日数据（供 workday 周期计算）。
   * 计算时按 cursor.year 动态查找；某年缺失则降级周一~周五。
   */
  function resolveWorkdayData(): WorkdayData[] {
    return getAllWorkdayData();
  }

  function toComputeShape(rule: {
    period: Period;
    periodInterval: number;
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
      period_interval: rule.periodInterval,
      timezone: rule.timezone,
      start_date: rule.startDate,
      execute_hour: rule.executeHour,
      execute_minute: rule.executeMinute,
      days_of_week: rule.daysOfWeek,
      days_of_month: rule.daysOfMonth,
      year_month_days: rule.yearMonthDays,
      workday_data: resolveWorkdayData(),
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
    await assertUnderRuleLimit(userId);

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
      period_interval: payload.period_interval ?? 1,
      timezone,
      start_date: payload.start_date,
      execute_hour: hour,
      execute_minute: minute,
      days_of_week: payload.days_of_week ?? null,
      days_of_month: payload.days_of_month ?? null,
      year_month_days: payload.year_month_days ?? null,
      workday_data: resolveWorkdayData(),
    };

    // 起点：start_date 00:00 in tz（严格 > 该时刻的下一个匹配日）
    // 使用 luxon 保证时区正确
    const fromStart = DateTime.fromISO(payload.start_date, { zone: timezone })
      .startOf('day')
      .minus({ minutes: 1 }) // 让 computeNextRunAt 内部 +1min 后回到 00:00
      .toJSDate();
    let nextRunAt = computeNextRunAt(forCompute, fromStart);

    // 产品规格 §4.4：起始日 = 今天且今日恰好是被勾中的日 →
    //   判断整个 bucket 窗口与当前时刻的关系：
    //   (1) 当前时刻 < 窗口起点 → 今天会触发（窗口还没开始，hash 落点必然在未来）
    //   (2) 当前时刻 >= 窗口起点 → 跳过今天（hash 落点可能在当前时刻之前或之后，行为不确定）
    //   这样保证用户在创建时就能确定今天会不会触发，不依赖 hash 随机落点。
    //
    // ⚠️ 仅当 start_date 就是今天时才进入此分支：
    //   - start_date 在未来 → nextRunAt 必然 > now，但本分支的逻辑（看「今天的 bucket 窗口」）
    //     与未来起始日无关，强行走会把 nextRunAt 错误地拉回到「从今天起算的下一个匹配日」，
    //     违反「起始日在未来时从起始日起算」的语义。
    //   - nextRunAt 已过（start_date 在过去且首个匹配日也过去）→ 走 else 分支从 now 重算。
    const now = new Date();
    const nowZ = DateTime.fromJSDate(now, { zone: timezone });
    const startDateZ = DateTime.fromISO(payload.start_date, { zone: timezone }).startOf('day');
    const isStartToday = nowZ.hasSame(startDateZ, 'day');
    if (isStartToday && nextRunAt > now) {
      // nextRunAt 在未来 → 还需要确认它是否落在今天的 bucket 窗口内且窗口已开始
      const window = BUCKET_WINDOWS[payload.execute_bucket];
      // bucket 窗口起点（今天 window.startHour:00 in tz）
      const windowStartToday = nowZ.set({ hour: window.startHour, minute: 0, second: 0, millisecond: 0 });
      if (nowZ >= windowStartToday) {
        // 当前时刻已进入或超过 bucket 窗口起点 → 跳过今天。
        // from 设为今天窗口结束时刻（endHour:00 in tz），确保 hash 落点
        // （严格在 [startHour*60+30, endHour*60-30) 内）必然 < from，
        // computeNextRunAt 内部 cursor 推进到今天 hash 落点时 cursor <= from →
        // 推进到下一天，从而保证今天不触发，与 hash 落点无关。
        const windowEndToday = nowZ.set({ hour: window.endHour, minute: 0, second: 0, millisecond: 0 });
        nextRunAt = computeNextRunAt(forCompute, windowEndToday.toJSDate());
      }
    } else if (nextRunAt <= now) {
      // nextRunAt 已过 → 从当前时刻重算下一个匹配日
      nextRunAt = computeNextRunAt(forCompute, now);
    }

    // 检查 end_date 边界：若 next_run_at 已超 end_date 闭区间 → 直接置 'ended'
    // 语义对齐 update 路径（line ~625）与 product-spec §4.4「结束日到期置 ended，不再执行」、
    // tech-spec §7.2「若返回值 > end_date at 23:59:59 in timezone：由 caller 决定置 status='ended'」。
    // 历史 bug：此处置 throw 让「end_date == start_date 且首个匹配日 > end_date」的合法组合
    // （如 weekly + 周六 + start=end=今天周四）无法创建，与同 commit (e9a0555) 放宽的 validateCreate
    // 「end_date >= start_date」语义自相矛盾。
    // 结束状态收敛：区分「真正到期」与「窗口内已无有效执行点」。
    //   - now > endBoundary            → ended + last_run_status='ended_by_end_date'
    //   - 未到期但 nextRunAt 已越过     → 仍置 ended，但 last_run_status='lapsed_in_window'
    //     （创建即告知用户"结束日前已无执行点"，避免"还没到期却已禁用"的困惑）。
    //     status 置 ended 让列表页将其归入"已禁用"分组并展示"已失效"而非"已到期"。
    let initialStatus: 'active' | 'ended' = 'active';
    let initialLastRunStatus: string | null = null;
    if (payload.end_date != null) {
      const endBoundary = DateTime.fromISO(payload.end_date, { zone: timezone })
        .endOf('day')
        .toJSDate();
      if (nextRunAt > endBoundary) {
        initialStatus = 'ended';
        initialLastRunStatus = isLapsedInWindow(payload.end_date, timezone, nextRunAt, now)
          ? 'lapsed_in_window'
          : 'ended_by_end_date';
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
      periodInterval: payload.period_interval ??1,
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
      status: initialStatus,
      lastRunStatus: initialLastRunStatus,
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

    // 部分 PATCH 也必须通过与 create 相同的完整校验：把 patch 合并到 existing 上，
    // 再跑一次 validateCreate。这能拦到诸如「保留 period=yearly，但把 year_month_days 改为 null」
    // 或「切 period 到 weekly 但没传 days_of_week」的非法组合。
    const merged: CreateRecurringPayload = {
    ledger_id: existing.ledgerId,
      type: payload.type ?? existing.type,
      amount: payload.amount ?? existing.amount,
      currency: existing.currency,
      category_id: payload.category_id !== undefined ? payload.category_id : existing.categoryId,
      account_id: payload.account_id !== undefined ? payload.account_id : existing.accountId,
      to_account_id: payload.to_account_id !== undefined ? payload.to_account_id : existing.toAccountId,
      note: payload.note !== undefined ? payload.note : existing.note,
  shared_type: payload.shared_type !== undefined ? payload.shared_type : existing.sharedType,
      period: payload.period ?? existing.period,
      period_interval: payload.period_interval ?? existing.periodInterval,
      days_of_week: payload.days_of_week !== undefined ? payload.days_of_week : existing.daysOfWeek,
      days_of_month: payload.days_of_month !== undefined ? payload.days_of_month : existing.daysOfMonth,
    year_month_days: payload.year_month_days !== undefined ? payload.year_month_days : existing.yearMonthDays,
      execute_bucket: payload.execute_bucket ?? existing.executeBucket,
    timezone: payload.timezone ?? existing.timezone,
      start_date: payload.start_date ?? existing.startDate,
      end_date: payload.end_date !== undefined ? payload.end_date : existing.endDate,
    };
    validateCreate(merged);

    // update 函数入口统一取 now，供重算 next_run_at 与 end_date 收敛共用，
    // 避免 new Date() 在多处分散调用（影响一致性 & 未来注入时钟做测试）。
    const now = new Date();

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
    const newPeriodInterval = payload.period_interval ?? existing.periodInterval;

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
      payload.period_interval !== undefined ||
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
        period_interval: newPeriodInterval,
        timezone: newTimezone,
        start_date: newStartDate,
        execute_hour: hour,
        execute_minute: minute,
        days_of_week: newDow,
        days_of_month: newDom,
        year_month_days: newYmd,
        workday_data: resolveWorkdayData(),
      };
      // 若 start_date 是未来 → 从 start_date 起算；否则从 now 起算
      const nowMs = now.getTime();
      const startMs = DateTime.fromISO(newStartDate, { zone: newTimezone })
        .startOf('day')
        .toMillis();
      const from = startMs > nowMs ? new Date(startMs - 60_000) : now;
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
    if (payload.period_interval !== undefined) input.periodInterval = payload.period_interval;
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

    // end_date 收敛：合并后的 end_date 若使规则永远无法再次执行，做状态归位。
    // 判定基准为 cursor = 合并后的 next_run_at：
    //   - cursor > end_boundary → 统一置 'ended'，再用 isLapsedInWindow 区分 lastRunStatus：
    //     · now <= end_boundary → 'lapsed_in_window'（窗口内已无有效执行点）
    //     · now > end_boundary  → 'ended_by_end_date'（真正到期）
    //   这样避免「结束日还没到、规则却显示已到期」的困惑，统一与 create 路径对齐。
    const effectiveEndDate = payload.end_date !== undefined ? payload.end_date : existing.endDate;
    const effectiveTimezone = payload.timezone !== undefined ? payload.timezone : existing.timezone;
    if (effectiveEndDate) {
      const endBoundary = DateTime.fromISO(effectiveEndDate, { zone: effectiveTimezone })
        .endOf('day')
        .toJSDate();
      const cursor = nextRunAt ?? existing.nextRunAt;
      if (cursor > endBoundary && existing.status === 'active') {
        input.status = 'ended';
        input.lastRunStatus = isLapsedInWindow(effectiveEndDate, effectiveTimezone, cursor, now)
          ? 'lapsed_in_window'
          : 'ended_by_end_date';
      }
    }

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
    // 若上一次执行发现账本失效 / 用户已退出家庭 / 家庭已解散被自动停用，
    // 恢复时必须重新验证前置条件；否则用户点"启用"会立刻在下一 tick 再次 auto_paused。
    await assertUserOwnsLedger(userId, existing.ledgerId);
    // resume 时重算 next_run_at（从当前时刻起算 · 不补跑历史）
    const forCompute = toComputeShape(existing);
    const now = new Date();
    const nextRunAt = computeNextRunAt(forCompute, now);

    // 若已过 end_date → 拒绝（ended 规则同样适用）
    if (existing.endDate != null) {
      const endBoundary = DateTime.fromISO(existing.endDate, {
        zone: existing.timezone,
      })
        .endOf('day')
        .toJSDate();
      if (nextRunAt > endBoundary) {
        // 结束日尚未到，但重算后的下一次执行已越过结束边界 → 窗口内已无有效执行点
        const message = now <= endBoundary
          ? '结束日期前无有效执行日，请延后结束日期'
          : '该规则已到期，请先修改结束日期再启用';
        throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
          message,
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
      period_interval: existing.periodInterval,
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

  /**
   * 运行前置校验：目标账本、家庭、成员身份是否仍然有效。
   *
   * 触发时机：`processOneRule` 事务开头，尚未生成任何 entry。
   * 任一失效即返回原因字符串（写入 last_run_status），由 processOneRule
   * 将规则置为 auto_paused，本轮不生成 entry；下轮 tick 因 status != 'active'
   * 自然被过滤掉，用户在列表页看到「已自动停用」及具体原因。
   *
   * 为什么不走 3 次失败递增：
   *   - 结构性失效（账本/家庭/成员）在下一个 tick 只会得到相同结果
   *   - 重试没有价值，反而放大 audit / metric 噪音
   *   - 与 tech-spec §7 边界表格保持一致
   */
  async function assertRuleContextValid(
    rule: RecurringRuleEntity,
    client: PoolClient,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
      reason:
  | 'failed_ledger_deleted'
          | 'failed_family_deleted'
          | 'failed_user_left_family';
    }
  > {
    // 结构性失效检测在同一事务 client 上读取，保证读取到最新（含 deleted_at）状态。
    // 各 repo 的 client 参数为结构化 Runner，PoolClient 兼容其 .query 签名，
    // 通过 as unknown 局部规避类型形参差异。
    const runner = client as unknown as Parameters<typeof ledgerRepo.findById>[1];
    const ledger = await ledgerRepo.findById(rule.ledgerId, runner);
    if (!ledger) return { ok: false, reason: 'failed_ledger_deleted' };

    const family = await familyRepo.findById(
      ledger.familyId,
      client as unknown as Parameters<typeof familyRepo.findById>[1],
    );
    if (!family) return { ok: false, reason: 'failed_family_deleted' };

const isMember = await familyMemberRepo.isActiveMember(
      rule.createdBy,
      family.id,
      client as unknown as Parameters<typeof familyMemberRepo.isActiveMember>[2],
    );
if (!isMember) return { ok: false, reason: 'failed_user_left_family' };

    return { ok: true };
  }

  /**
   * 判断规则是否处于"结束期窗口内已无有效执行点"状态。
   *
   * 语义：规则尚未真正到期（now <= end_date 当日 24:00），但下一次执行时点
   * （next_run_at）已经越过 end_date。此时规则在结束期内再也不会有有效执行日，
   * 继续跑只会空转。区别于 `ended`：
   *   - ended：now 已过 end_date，生命周期真实结束；
   *   - lapsed_in_window：end_date 未到，但从"还能不能执行"角度已经失效。
   *
   * 纯函数，供 create / update / processOneRule（写 last_run_status）与
   * resume（拒绝提示）共用。nextRunAt 由调用方显式传入，因不同路径
   * 各自计算（create/update 用待落库的 next_run_at，processOneRule 用
   * 推进后的 cursor，resume 用重算后的 next_run_at）。
   */
  function isLapsedInWindow(
    endDate: string | null,
    timezone: string,
    nextRunAt: Date,
    now: Date,
  ): boolean {
    if (endDate == null) return false;
    const endBoundary = DateTime.fromISO(endDate, { zone: timezone })
      .endOf('day')
      .toJSDate();
    // next_run_at 已越过结束边界，且当前时刻尚未越过 → 窗口内已无有效执行点
    return nextRunAt > endBoundary && now <= endBoundary;
  }

  async function processOneRule(
    rule: RecurringRuleEntity,
    now: Date,
    client: PoolClient,
  ): Promise<ProcessResult> {
    // ── 运行前置校验：结构性失效 → 直接 auto_paused ─────────────────────
    const ctx = await assertRuleContextValid(rule, client);
    if (!ctx.ok) {
      await client.query(
        `UPDATE recurring_rules
     SET status = 'auto_paused',
       last_run_at = $1,
     last_run_status = $2,
consecutive_failures = 0,
    version = version + 1,
     change_seq = nextval('entries_change_seq')
      WHERE id = $3 AND deleted_at IS NULL`,
        [now, ctx.reason, rule.id],
      );
      return {
        generatedCount: 0,
    generatedDates: [],
        skippedDates: [],
        newNextRunAt: rule.nextRunAt,
        newStatus: 'auto_paused',
        autoPausedReason: ctx.reason,
      };
    }

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
        { sourceRecurringId: rule.id, client }, // T2 · 事务串联
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
    let lastRunStatus = skipped.length > 0 ? 'ok_with_skipped' : 'ok';
    if (rule.endDate != null) {
      const endBoundary = DateTime.fromISO(rule.endDate, { zone: rule.timezone })
        .endOf('day')
        .toJSDate();
      if (cursor > endBoundary) {
        // 结束日已过或窗口内已无有效执行点 → 结束。
        // last_run_status 区分「真正到期」与「未到期但已无有效执行点」，
        // 供列表页展示"已到期" / "已失效"。
        newStatus = 'ended';
        lastRunStatus = isLapsedInWindow(rule.endDate, rule.timezone, cursor, now)
          ? 'lapsed_in_window'
          : 'ended_by_end_date';
      }
    }
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
