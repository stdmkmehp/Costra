/**
 * Costra · Server · 流水业务编排层
 *
 * 卡号：COSTRA-104 · 事实源：server/api/openapi.yaml §entries-create/list + sync-protocol.md §2
 *
 * 职责：
 *   - createWithIdempotency：写 entries + 防重（ledger_id+client_ref_id UNIQUE 约束）
 *   - updateWithVersion：乐观锁 update（WHERE version = baseVersion）
 *   - softDelete：软删 + 乐观锁
 *   - list：游标分页（updated_at DESC, id DESC 复合 cursor）
 *   - findById：含 ledger/权限校验
 *
 * 依赖注入：所有依赖通过工厂函数 createEntryService(deps) 注入。
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import * as entryRepo from '../repositories/entryRepo.js';
import type { EntryEntity } from '../repositories/entryRepo.js';

export interface EntryServiceDeps {}

export interface EntryService {
  createWithIdempotency(userId: string, payload: CreateEntryPayload, clientRefId?: string): Promise<EntryResult>;
  updateWithVersion(userId: string, entryId: string, payload: UpdateEntryPayload, baseVersion: number): Promise<EntryResult>;
  softDelete(userId: string, entryId: string, baseVersion: number): Promise<EntryResult>;
  list(userId: string, filter: ListEntryFilter, cursor: string | null, limit: number): Promise<EntryListResult>;
  findById(userId: string, entryId: string): Promise<EntryEntity>;
}

export interface EntryListResult {
  entries: EntryView[];
  next_cursor: string | null;
}

// --- Payload 类型 ---

export interface CreateEntryPayload {
  ledger_id: string;
  amount: number;
  currency?: string;
  type: 'income' | 'expense' | 'transfer';
  category_id?: string | null;
  account_id?: string | null;
  to_account_id?: string | null;
  note?: string | null;
  occurred_at: string;
  client_ref_id?: string;
}

export interface UpdateEntryPayload {
  amount?: number;
  category_id?: string | null;
  account_id?: string | null;
  note?: string | null;
  occurred_at?: string;
}

export interface ListEntryFilter {
  ledger_id?: string;
  category_id?: string;
  type?: 'income' | 'expense' | 'transfer';
  from?: string;
  to?: string;
}

// --- Result 类型（与 sync/push results 对齐）---

export type EntryResult =
  | { status: 'ok'; serverId: string; serverVersion: number }
  | { status: 'conflict'; serverVersion: number }
  | { status: 'rejected'; error: { code: string; message: string } };

// --- Entry 视图（API 响应）---

export interface EntryView {
  id: string;
  ledger_id: string;
  amount: number;
  currency: string;
  type: string;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  note: string | null;
  occurred_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_ref_id: string | null;
}

function entityToView(e: EntryEntity): EntryView {
  return {
    id: e.id,
    ledger_id: e.ledgerId,
    amount: e.amount,
    currency: e.currency,
    type: e.type,
    category_id: e.categoryId,
    account_id: e.accountId,
    to_account_id: e.toAccountId,
    note: e.note,
    occurred_at: e.occurredAt.toISOString(),
    created_by: e.createdBy,
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
    deleted_at: e.deletedAt?.toISOString() ?? null,
    version: e.version,
    client_ref_id: e.clientRefId,
  };
}

// --- Payload 校验 ---

function validateCreatePayload(p: CreateEntryPayload): void {
  if (!p.ledger_id) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'ledger_id required', details: { field: 'ledger_id' } });
  }
  if (!p.amount || p.amount < 1) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'amount must be positive integer', details: { field: 'amount' } });
  }
  if (!p.type || !['income', 'expense', 'transfer'].includes(p.type)) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'type must be income|expense|transfer', details: { field: 'type' } });
  }
  if (!p.occurred_at) {
    throw new AppError(ErrorCode.INVALID_ARGUMENT, { message: 'occurred_at required', details: { field: 'occurred_at' } });
  }
}

// --- 工厂函数 ---

export function createEntryService(_deps: EntryServiceDeps = {}): EntryService {

  async function createWithIdempotency(
    userId: string,
    payload: CreateEntryPayload,
    clientRefId?: string,
  ): Promise<EntryResult> {
    validateCreatePayload(payload);

    // 防重：若 client_ref_id 存在，先查 ledger_id+client_ref_id 是否已有
    if (clientRefId) {
      const existing = await entryRepo.findByLedgerAndClientRefId(payload.ledger_id, clientRefId);
      if (existing) {
        return { status: 'conflict', serverVersion: existing.version };
      }
    }

    try {
      const entry = await entryRepo.insertEntry({
        ledgerId: payload.ledger_id,
        amount: payload.amount,
        currency: payload.currency,
        type: payload.type,
        categoryId: payload.category_id,
        accountId: payload.account_id,
        toAccountId: payload.to_account_id,
        note: payload.note,
        occurredAt: payload.occurred_at,
        createdBy: userId,
        clientRefId: clientRefId ?? null,
      });
      return { status: 'ok', serverId: entry.id, serverVersion: entry.version };
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? '';
      if (msg.includes('uq_entries_ledger_client_ref') || msg.includes('duplicate key')) {
        return { status: 'conflict', serverVersion: 0 };
      }
      throw err;
    }
  }

  async function updateWithVersion(
    userId: string,
    entryId: string,
    payload: UpdateEntryPayload,
    baseVersion: number,
  ): Promise<EntryResult> {
    await findById(userId, entryId);

    const repoInput: entryRepo.UpdateEntryInput = {};
    if (payload.amount !== undefined) repoInput.amount = payload.amount;
    if (payload.category_id !== undefined) repoInput.categoryId = payload.category_id;
    if (payload.account_id !== undefined) repoInput.accountId = payload.account_id;
    if (payload.note !== undefined) repoInput.note = payload.note;
    if (payload.occurred_at !== undefined) repoInput.occurredAt = payload.occurred_at;

    const updated = await entryRepo.updateEntryByVersion(entryId, repoInput, baseVersion);
    if (!updated) {
      const current = await entryRepo.findById(entryId);
      return { status: 'conflict', serverVersion: current?.version ?? 0 };
    }
    return { status: 'ok', serverId: entryId, serverVersion: updated.version };
  }

  async function softDelete(userId: string, entryId: string, baseVersion: number): Promise<EntryResult> {
    await findById(userId, entryId);
    const deleted = await entryRepo.softDeleteEntry(entryId, baseVersion);
    if (!deleted) {
      const current = await entryRepo.findById(entryId);
      return { status: 'conflict', serverVersion: current?.version ?? 0 };
    }
    return { status: 'ok', serverId: entryId, serverVersion: deleted.version };
  }

  async function list(
    userId: string,
    filter: ListEntryFilter,
    cursor: string | null,
    limit: number,
  ): Promise<EntryListResult> {
    const effectiveLimit = Math.min(Math.max(1, limit), 100);
    const repoFilter: entryRepo.EntryFilter = {
      ledgerId: filter.ledger_id,
      categoryId: filter.category_id,
      type: filter.type,
      from: filter.from,
      to: filter.to,
    };
    const { entries, nextCursor } = await entryRepo.findEntriesByLedger(repoFilter, cursor, effectiveLimit);
    return { entries: entries.map(entityToView), next_cursor: nextCursor };
  }

  async function findById(userId: string, entryId: string): Promise<EntryEntity> {
    const entry = await entryRepo.findById(entryId, userId);
    if (!entry) {
      throw new AppError(ErrorCode.NOT_FOUND, { message: `entry ${entryId} not found`, details: { entry_id: entryId } });
    }
    return entry;
  }

  return { createWithIdempotency, updateWithVersion, softDelete, list, findById };
}
