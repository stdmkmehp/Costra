// services/budgetApi.ts · 月度预算 API + 本地缓存
// 卡号：COSTRA-4xx · 事实源：docs/design/asset-and-budget-spec.md §5
//
// 职责：
//   - getBudget：GET /budgets?ledger_id=X&month=YYYY-MM
//   - upsertBudget：PUT /budgets（创建或修改）
//   - 本地缓存 + 5min TTL
//
// 客户端不做"已支出"聚合（服务端权威）；客户端只缓存 amount / version。
// spent_cents 每次拉新值（其实明细页本地已有 monthExpense 可直接算 remain，节省一次 RTT）。

import { request } from './request';
import { getItem, setItem } from './storage';
import { logger } from '../utils/logger';

export interface Budget {
  id: string;
  ledger_id: string;
  month: string;
  amount_cents: number;
  spent_cents: number;
  remain_cents: number;
  currency: string;
  version: number;
}

const MEMORY_CACHE = new Map<string, Budget>(); // key: `${ledgerId}:${month}`
const TTL_MS = 5 * 60 * 1000;

function cacheKey(ledgerId: string, month: string): string {
  return `budget:${ledgerId}:${month}`;
}

function memKey(ledgerId: string, month: string): string {
  return `${ledgerId}:${month}`;
}

/** 从内存读缓存（不发起网络请求） */
export function getCachedBudget(ledgerId: string, month: string): Budget | null {
  return MEMORY_CACHE.get(memKey(ledgerId, month)) ?? null;
}

/** 从 storage 读缓存 */
export async function getCachedBudgetFromStorage(ledgerId: string, month: string): Promise<Budget | null> {
  const mem = MEMORY_CACHE.get(memKey(ledgerId, month));
  if (mem) return mem;
  const stored = await getItem<Budget>(cacheKey(ledgerId, month));
  if (stored) {
    MEMORY_CACHE.set(memKey(ledgerId, month), stored);
    return stored;
  }
  return null;
}

/**
 * 拉取月度预算。
 *
 * 契约：未设置预算返 200 + JSON null（不是 404 —— 404 只表示 ledger 不存在等真异常）。
 *
 * 失败处理：
 *   - 未设置（resp 为 null）：清空缓存，返回 null（UI 据此显示"未设置"）
 *   - 请求异常：静默返回 null，UI 降级显示上次缓存或 '--'
 */
export async function fetchBudget(ledgerId: string, month: string): Promise<Budget | null> {
  try {
    const resp = await request<Budget | null>({
      method: 'GET',
      path: '/budgets',
      query: { ledger_id: ledgerId, month },
    });
    if (!resp) {
      MEMORY_CACHE.delete(memKey(ledgerId, month));
      return null;
    }
    await applyBudget(resp);
    return resp;
  } catch (err) {
    logger.warn('budgetApi', 'fetchBudget failed', err);
    return null;
  }
}

/**
 * 创建或修改预算。
 *
 * - version=null：创建（若已存在则服务端用 latest 做 base 转 update）
 * - version=N：修改，乐观锁失败 → 抛 ApiError(409)，UI 弹冲突弹窗
 */
export async function upsertBudget(
  ledgerId: string,
  month: string,
  amountCents: number,
  version: number | null,
): Promise<Budget> {
  const resp = await request<Budget>({
    method: 'PUT',
    path: '/budgets',
    body: {
      ledger_id: ledgerId,
      month,
      amount_cents: amountCents,
      version,
    },
  });
  await applyBudget(resp);
  return resp;
}

/** 内部统一写入：内存 + storage */
async function applyBudget(budget: Budget): Promise<void> {
  MEMORY_CACHE.set(memKey(budget.ledger_id, budget.month), budget);
  await setItem(cacheKey(budget.ledger_id, budget.month), budget);
}

/** 清除缓存（logout 时调） */
export function clearBudgetCache(): void {
  MEMORY_CACHE.clear();
}

/**
 * 客户端乐观更新 spent_cents（明细页记账后立即扣减 remain）。
 * sync 完成后会被服务端权威值覆盖。
 */
export function optimisticUpdateSpent(ledgerId: string, month: string, deltaCents: number): void {
  const cached = MEMORY_CACHE.get(memKey(ledgerId, month));
  if (!cached) return;
  cached.spent_cents += deltaCents;
  cached.remain_cents = cached.amount_cents - cached.spent_cents;
  // 仅更新内存 · 不写 storage（等 sync 拉权威值）
}

/** 判断缓存是否仍新鲜 */
export function isBudgetCacheFresh(budget: Budget): boolean {
  // Budget 不带 fetched_at 字段 · 用版本号判断是否权威，外部按需拉新
  return true;
}
