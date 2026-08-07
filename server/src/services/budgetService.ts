/**
 * Costra · Server · 预算 service
 *
 * 卡号：COSTRA-4xx · 事实源：docs/design/asset-and-budget-spec.md §4.3 §4.4
 *
 * 职责：
 *   - getBudget：读取 (ledger_id, month) 的预算 + 当月已支出 + 剩余
 *   - upsertBudget：创建或修改预算（乐观锁）
 *
 * 已支出算法：
 *   spent = SUM(amount) WHERE ledger_id AND type='expense'
 *           AND deleted_at IS NULL AND occurred_at ∈ [monthStart, monthEnd)
 *   month 区间按 Asia/Shanghai 时区切分（与 familySummaryService.parseMonthRange 同）
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { getPool } from '../db/pool.js';
import * as budgetRepo from '../repositories/budgetRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';

/**
 * 解析 month=YYYY-MM 为 UTC 区间 [rangeStart, rangeEnd)
 * 固定时区 Asia/Shanghai (+08:00)
 * 与 familySummaryService.parseMonthRange 同构
 */
function parseMonthRange(month: string): { rangeStartUtc: string; rangeEndUtc: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const startShanghai = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
  const startUtc = new Date(startShanghai.getTime() - 8 * 60 * 60 * 1000);
  const endShanghai = new Date(Date.UTC(year, mon, 1, 0, 0, 0));
  const endUtc = new Date(endShanghai.getTime() - 8 * 60 * 60 * 1000);
  return { rangeStartUtc: startUtc.toISOString(), rangeEndUtc: endUtc.toISOString() };
}

/** 校验 month 格式 YYYY-MM */
function validateMonth(month: string): void {
  const re = /^(\d{4})-(\d{2})$/;
  const m = re.exec(month);
  if (!m) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month must be YYYY-MM format',
      details: { field: 'month', value: month },
    });
  }
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'month must be between 01 and 12',
      details: { field: 'month', value: month },
    });
  }
}

/**
 * 权限守门：校验用户是 ledger 所属 family 的 active 成员。
 */
async function assertLedgerMembership(userId: string, ledgerId: string): Promise<void> {
  const ledger = await ledgerRepo.findById(ledgerId);
  if (!ledger) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'ledger not found',
      details: { ledger_id: ledgerId },
    });
  }
  const family = await familyRepo.findById(ledger.familyId);
  if (!family) {
    throw new AppError(ErrorCode.NOT_FOUND, { message: 'family not found' });
  }
  const isActive = await familyMemberRepo.isActiveMember(userId, ledger.familyId);
  if (!isActive) {
    throw new AppError(ErrorCode.PERMISSION_DENIED, {
      message: 'user is not an active member of this family',
      details: { family_id: ledger.familyId },
    });
  }
}

/**
 * 计算当月已支出（expense + 未软删 + occurred_at 在月内）
 */
async function computeMonthSpent(ledgerId: string, month: string): Promise<number> {
  const { rangeStartUtc, rangeEndUtc } = parseMonthRange(month);
  const pool = getPool();
  const res = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS spent
       FROM entries
      WHERE ledger_id = $1
        AND type = 'expense'
        AND deleted_at IS NULL
        AND occurred_at >= $2
        AND occurred_at < $3`,
    [ledgerId, rangeStartUtc, rangeEndUtc],
  );
  const row = res.rows[0] as { spent: string | number } | undefined;
  return Number(row?.spent ?? 0);
}

export interface BudgetResult {
  id: string;
  ledger_id: string;
  month: string;
  amount_cents: number;
  spent_cents: number;
  remain_cents: number;
  currency: string;
  version: number;
}

/**
 * GET /budgets?ledger_id=X&month=YYYY-MM
 *
 * 预算跟随账本走：
 *   1. 先查当月预算 (ledger_id, month) 精确匹配
 *   2. 当月未设置 → 回退取该账本 month <= 查询月 的最近一条预算，
 *      继承其 amount_cents 作为当前月预算上限
 *   3. 该账本从未设过任何预算 → 404（客户端据此展示"未设置"）
 *
 * spent_cents 始终按查询月实际支出计算（不受回退影响）。
 */
export async function getBudget(
  userId: string,
  input: { ledgerId: string; month: string },
): Promise<BudgetResult> {
  validateMonth(input.month);
  await assertLedgerMembership(userId, input.ledgerId);

  // 1) 精确匹配当月
  let budget = await budgetRepo.findByLedgerAndMonth(input.ledgerId, input.month);

  // 2) 当月未设置 → 回退取该账本最近一次设定的预算
  if (!budget) {
    budget = await budgetRepo.findLatestBeforeOrEqual(input.ledgerId, input.month);
  }

  // 3) 从未设过任何预算 → 404
  if (!budget) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'budget not set for this ledger',
      details: { ledger_id: input.ledgerId, month: input.month },
    });
  }

  const spent = await computeMonthSpent(input.ledgerId, input.month);

  return {
    id: budget.id,
    ledger_id: budget.ledgerId,
    month: input.month,
    amount_cents: budget.amountCents,
    spent_cents: spent,
    remain_cents: budget.amountCents - spent,
    currency: budget.currency,
    version: budget.version,
  };
}

/**
 * PUT /budgets（创建或修改）
 *
 * 策略：
 *   - body 含 version → 走 update 路径（乐观锁）
 *   - body 无 version → 走 create 路径（若已存在 → 转 update 走 latest）
 *
 * 客户端 outbox 调用约定：
 *   - 首次设置：version=null，server 创建
 *   - 修改：version=当前最新（来自上次 GET），server 乐观锁 update
 */
export async function upsertBudget(
  userId: string,
  input: {
    ledgerId: string;
    month: string;
    amountCents: number;
    version: number | null;
  },
): Promise<BudgetResult> {
  validateMonth(input.month);
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, {
      message: 'amount_cents must be positive integer',
      details: { field: 'amount_cents', value: input.amountCents },
    });
  }
  await assertLedgerMembership(userId, input.ledgerId);

  // 找现有预算
  const existing = await budgetRepo.findByLedgerAndMonth(input.ledgerId, input.month);

  if (existing) {
    // 走 update 路径
    const baseVersion = input.version ?? existing.version;

    const updated = await budgetRepo.updateAmountByVersion({
      budgetId: existing.id,
      amountCents: input.amountCents,
      updatedBy: userId,
      baseVersion,
    });

    if (!updated) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, {
        message: 'budget version conflict',
        details: {
          current_version: existing.version,
          current_amount_cents: existing.amountCents,
        },
      });
    }

    const spent = await computeMonthSpent(input.ledgerId, input.month);
    return {
      id: updated.id,
      ledger_id: updated.ledgerId,
      month: updated.month,
      amount_cents: updated.amountCents,
      spent_cents: spent,
      remain_cents: updated.amountCents - spent,
      currency: updated.currency,
      version: updated.version,
    };
  }

  // 走 create 路径
  const created = await budgetRepo.insertBudget({
    ledgerId: input.ledgerId,
    month: input.month,
    amountCents: input.amountCents,
    updatedBy: userId,
  });

  const spent = await computeMonthSpent(input.ledgerId, input.month);
  return {
    id: created.id,
    ledger_id: created.ledgerId,
    month: created.month,
    amount_cents: created.amountCents,
    spent_cents: spent,
    remain_cents: created.amountCents - spent,
    currency: created.currency,
    version: created.version,
  };
}

/**
 * DELETE /budgets（软删预算 · 暂未在路由暴露，留 FU）
 */
export async function deleteBudget(
  userId: string,
  input: { ledgerId: string; month: string; version: number },
): Promise<void> {
  validateMonth(input.month);
  await assertLedgerMembership(userId, input.ledgerId);

  const existing = await budgetRepo.findByLedgerAndMonth(input.ledgerId, input.month);
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, {
      message: 'budget not set for this month',
      details: { ledger_id: input.ledgerId, month: input.month },
    });
  }

  const deleted = await budgetRepo.softDelete({
    budgetId: existing.id,
    baseVersion: input.version,
  });
  if (!deleted) {
    throw new AppError(ErrorCode.VERSION_CONFLICT, {
      message: 'budget version conflict',
      details: { current_version: existing.version },
    });
  }
}
