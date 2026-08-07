// services/recurringApi.ts · 定时记账 CRUD API 封装
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// 契约事实源：server/src/routes/recurring.ts · docs/design/recurring-entry-tech-spec.md §5
// Refs: COSTRA-5xx

import { request } from './request';

// ─── 类型定义（对齐 server RecurringRuleEntity → ruleToResponse 输出）────────

export type RecurringPeriod =
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'workday';

export type RecurringBucket = 'dawn' | 'morning' | 'afternoon' | 'night';

export type RecurringStatus = 'active' | 'paused' | 'ended' | 'auto_paused';

export interface RecurringRule {
  id: string;
  ledger_id: string;
  created_by: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number; // 分
  currency: string;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  note: string | null;
  shared_type: 'personal' | 'shared' | null;
  period: RecurringPeriod;
  period_interval: number;
  days_of_week: number[] | null;
  days_of_month: number[] | null;
  year_month_days: number[] | null;
  execute_bucket: RecurringBucket;
  execute_hour: number;
  execute_minute: number;
  timezone: string;
  start_date: string;
  end_date: string | null;
  status: RecurringStatus;
  next_run_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CreateRecurringPayload {
  ledger_id: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency?: string;
  category_id?: string | null;
  account_id?: string | null;
  to_account_id?: string | null;
  note?: string | null;
  shared_type?: 'personal' | 'shared' | null;
  period: RecurringPeriod;
  period_interval?: number;
  days_of_week?: number[] | null;
  days_of_month?: number[] | null;
  year_month_days?: number[] | null;
  execute_bucket: RecurringBucket;
  timezone: string;
  start_date: string;
  end_date?: string | null;
}

export interface UpdateRecurringPayload {
  version: number;
  type?: 'income' | 'expense' | 'transfer';
  amount?: number;
  category_id?: string | null;
  account_id?: string | null;
  to_account_id?: string | null;
  note?: string | null;
  shared_type?: 'personal' | 'shared' | null;
  period?: RecurringPeriod;
  period_interval?: number;
  days_of_week?: number[] | null;
  days_of_month?: number[] | null;
  year_month_days?: number[] | null;
  execute_bucket?: RecurringBucket;
  timezone?: string;
  start_date?: string;
  end_date?: string | null;
}

// ─── API 封装（8 endpoint）──────────────────────────────────────────────────

/** GET /recurring-entries · 列出当前用户创建的定时 */
export async function listRecurringRules(
  status?: RecurringStatus | 'all',
): Promise<RecurringRule[]> {
  const res = await request<{ items: RecurringRule[] }>({
    method: 'GET',
    path: '/recurring-entries',
    query: status ? { status } : undefined,
  });
  return res.items;
}

/** GET /recurring-entries/:id · 详情 */
export async function getRecurringRule(id: string): Promise<RecurringRule> {
  return request<RecurringRule>({
    method: 'GET',
    path: `/recurring-entries/${id}`,
  });
}

/** POST /recurring-entries · 新建定时 */
export async function createRecurringRule(
  payload: CreateRecurringPayload,
  options?: { idempotencyKey?: string },
): Promise<RecurringRule> {
  return request<RecurringRule>({
    method: 'POST',
    path: '/recurring-entries',
    body: payload,
    idempotencyKey: options?.idempotencyKey,
  });
}

/**
 * PATCH /recurring-entries/:id · 编辑（乐观锁）
 * 注意：wx.request 不支持 PATCH · 由 request.ts 统一降级为 POST + X-HTTP-Method-Override
 */
export async function updateRecurringRule(
  id: string,
  payload: UpdateRecurringPayload,
  options?: { idempotencyKey?: string },
): Promise<RecurringRule> {
  return request<RecurringRule>({
    method: 'PATCH',
    path: `/recurring-entries/${id}`,
    body: payload,
    idempotencyKey: options?.idempotencyKey,
  });
}

/** POST /recurring-entries/:id/pause · 手动禁用 */
export async function pauseRecurringRule(
  id: string,
  options?: { idempotencyKey?: string },
): Promise<RecurringRule> {
  return request<RecurringRule>({
    method: 'POST',
    path: `/recurring-entries/${id}/pause`,
    idempotencyKey: options?.idempotencyKey,
  });
}

/** POST /recurring-entries/:id/resume · 手动启用 + 重算 next_run_at */
export async function resumeRecurringRule(
  id: string,
  options?: { idempotencyKey?: string },
): Promise<RecurringRule> {
  return request<RecurringRule>({
    method: 'POST',
    path: `/recurring-entries/${id}/resume`,
    idempotencyKey: options?.idempotencyKey,
  });
}

/** POST /recurring-entries/:id/copy · 复制规则 */
export async function copyRecurringRule(
  id: string,
  options?: { idempotencyKey?: string },
): Promise<RecurringRule> {
  return request<RecurringRule>({
    method: 'POST',
    path: `/recurring-entries/${id}/copy`,
    idempotencyKey: options?.idempotencyKey,
  });
}

/** DELETE /recurring-entries/:id?version=N · 软删 */
export async function deleteRecurringRule(
  id: string,
  version: number,
  options?: { idempotencyKey?: string },
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/recurring-entries/${id}`,
    query: { version },
    idempotencyKey: options?.idempotencyKey,
  });
}
