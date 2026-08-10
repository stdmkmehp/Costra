/**
 * Costra · Server · 流水业务编排层
 *
 * 卡号：COSTRA-104 / COSTRA-4xx · 事实源：server/api/openapi.yaml §entries-create/list + sync-protocol.md §2
 *
 * 职责：
 *   - createWithIdempotency：写 entries + 防重（ledger_id+client_ref_id UNIQUE 约束）
 *     + 同事务累加 ledgers.balance_cents（COSTRA-4xx 资产）
 *   - updateWithVersion：乐观锁 update（WHERE version = baseVersion）
 *     + 同事务回退旧贡献 + 叠加新贡献（资产重锚谓词双重判定）
 *   - softDelete：软删 + 乐观锁 + 资产旧贡献回退
 *   - list：游标分页（updated_at DESC, id DESC 复合 cursor）
 *   - findById：含 ledger/权限校验
 *
 * 资产累加规则（COSTRA-4xx · 见 asset-and-budget-spec.md §4）：
 *   - income  → balance += amount
 *   - expense → balance -= amount
 *   - transfer → balance 不变（delta = 0，跳过 UPDATE）
 *   - 幂等谓词：仅当 new_change_seq > balance_baseline_seq 才叠加
 *   - update/softDelete 时先 FOR UPDATE 读旧 seq，再用 old_seq / new_seq 独立判
 *
 * 依赖注入：所有依赖通过工厂函数 createEntryService(deps) 注入。
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { withTx } from '../db/pool.js';
import * as entryRepo from '../repositories/entryRepo.js';
import type { EntryEntity } from '../repositories/entryRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyRepo from '../repositories/familyRepo.js';
import * as categoryRepo from '../repositories/categoryRepo.js';

/**
 * 依赖注入接口（COSTRA-217 R1.x：新增 ledgerRepo/familyRepo 查询能力）
 * 默认使用真实 repo · 单测可注入 mock
 */
export interface EntryServiceDeps {
  findLedgerById?: (ledgerId: string) => Promise<{ familyId: string } | null>;
  findFamilyById?: (familyId: string) => Promise<{ kind: string } | null>;
}

export interface EntryService {
  createWithIdempotency(userId: string, payload: CreateEntryPayload, clientRefId?: string, opts?: CreateEntryOpts): Promise<EntryResult>;
  updateWithVersion(userId: string, entryId: string, payload: UpdateEntryPayload, baseVersion: number): Promise<EntryResult>;
  softDelete(userId: string, entryId: string, baseVersion: number): Promise<EntryResult>;
  list(userId: string, filter: ListEntryFilter, cursor: string | null, limit: number): Promise<EntryListResult>;
  findById(userId: string, entryId: string): Promise<EntryEntity>;
}

/**
 * T2 · createWithIdempotency 可选参数
 * 目前用于定时调度器透传 sourceRecurringId 及事务 client
 * 客户端 API 走 route 直接调用时不传这个 opts
 */
export interface CreateEntryOpts {
  /** 来源定时规则 id · 走 entries.source_recurring_id */
  sourceRecurringId?: string;
  /**
   * 事务运行时 client · 若传入，findByLedgerAndClientRefId 与 insertEntry 都在此事务内。
   * 用于定时调度器把 rule 水位更新与 entry insert 串在同一事务，避免 crash 半态。
   *
   * ⚠️ COSTRA-4xx：若传入，资产累加也必须复用此 client（同事务保证一致性）；
   *   若不传，service 内部用 withTx 开新事务。
   */
  client?: import('pg').PoolClient;
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
  /** COSTRA-217 B2: 公共/个人支出标记 · 仅 expense 有值 */
  shared_type?: 'personal' | 'shared' | null;
}

export interface UpdateEntryPayload {
  amount?: number;
  category_id?: string | null;
  account_id?: string | null;
  note?: string | null;
  occurred_at?: string;
  /** COSTRA-217 B2: 公共/个人支出标记 · 仅 expense 可修改 */
  shared_type?: 'personal' | 'shared' | null;
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
  /** COSTRA-217 B2: 公共/个人支出标记 */
  shared_type: 'personal' | 'shared' | null;
  /** T4: 来源定时规则；手工流水为 null */
  source_recurring_id: string | null;
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
    shared_type: e.sharedType, // COSTRA-217 B2
    source_recurring_id: e.sourceRecurringId, // T4
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
  // COSTRA-217 B2: shared_type 校验
  if (p.shared_type != null && p.type !== 'expense') {
    throw new AppError(ErrorCode.BUSINESS_RULE_VIOLATION, {
      message: 'shared_type is only allowed for expense entries',
      details: { rule: 'shared_type_requires_expense', type: p.type, shared_type: p.shared_type },
    });
  }
}

// --- 资产 delta 辅助函数（COSTRA-4xx）---

/**
 * 根据流水类型与金额，算出对资产的 delta（单位分）。
 *   income  → +amount
 *   expense → -amount
 *   transfer → 0
 */
function computeBalanceDelta(type: 'income' | 'expense' | 'transfer', amount: number): number {
  switch (type) {
    case 'income': return amount;
    case 'expense': return -amount;
    case 'transfer': return 0;
  }
}

// --- 工厂函数 ---

export function createEntryService(deps: EntryServiceDeps = {}): EntryService {
  const findLedgerById = deps.findLedgerById ?? (async (id: string) => ledgerRepo.findById(id));
  const findFamilyById = deps.findFamilyById ?? (async (id: string) => familyRepo.findById(id));

  /**
   * COSTRA-217 R1.x: expense 未传 shared_type 时，按 ledger→family kind 判定默认值
   *   - personal family → 'personal'
   *   - shared family   → 'shared'
   *   - 无法判定时返回 null（调用方必须抛标准错误且不写 DB）
   *
   * dispatch §2.B.3 硬约束：无法可靠判定 family kind 时，不得静默猜测
   */
  async function resolveDefaultSharedType(
    ledgerId: string,
  ): Promise<'personal' | 'shared' | null> {
    const ledger = await findLedgerById(ledgerId);
    if (!ledger) return null;

    const family = await findFamilyById(ledger.familyId);
    if (!family) return null;

    if (family.kind === 'personal') return 'personal';
    if (family.kind === 'shared') return 'shared';
    return null; // 未知 kind · 不猜测
  }

  /**
   * 解析 entry 写入时的 category_id（migration 0004 配套 · spec §5）
   *
   * 用户体验诉求：用户提交了一个旧 / 已删 / 已合并的 category_id，服务端应**静默降级**，
   * 而不是报错让用户重选（特别是离线 outbox 上传场景，用户不在记账面板）。
   *
   * 降级查找顺序：
   *   1. category_id 命中 categories 且未删除 → type 一致才使用；type 不一致直接拒绝
   *   2. 未命中 → 查 category_redirects[old_id] → 用 new_id（同样校验 type）
   *   3. 仍未命中（垃圾/未知 id）→ 同 entry type 的兜底默认子分类
   *
   * 入参 inputCategoryId 为 null/undefined 时直接返回 null（不强制分类）。
   */
  async function resolveCategoryId(
    inputCategoryId: string | null | undefined,
    entryType: 'income' | 'expense' | 'transfer',
  ): Promise<{ categoryId: string | null } | { error: { code: string; message: string } }> {
    if (!inputCategoryId) return { categoryId: null };

    // 1) 命中现有未删 category（categoryRepo.findById 已 WHERE deleted_at IS NULL）
    const direct = await categoryRepo.findById(inputCategoryId);
    if (direct) {
      if (direct.type !== entryType) {
        return {
          error: {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'category type must match entry type',
          },
        };
      }
      return { categoryId: direct.id };
    }

    // 2) 命中 redirect 表
    const redirect = await categoryRepo.findRedirect(inputCategoryId);
    if (redirect) {
      const redirected = await categoryRepo.findById(redirect.newId);
      if (redirected) {
        if (redirected.type !== entryType) {
          return {
            error: {
              code: 'BUSINESS_RULE_VIOLATION',
              message: 'redirected category type must match entry type',
            },
          };
        }
        return { categoryId: redirected.id };
      }
    }

    // 3) 同 type 兜底默认子，避免产生 entry.type 与 category.type 不一致的脏数据
    const fallback = await categoryRepo.findFallbackCategoryId(entryType);
    return { categoryId: fallback ?? null };
  }

  /**
   * createWithIdempotency：
   *   1) 防重 check（client_ref_id）
   *   2) resolveSharedType + resolveCategory
   *   3) 事务内：INSERT entries + UPDATE ledgers.balance_cents（delta + 幂等谓词）
   *
   * 事务策略：
   *   - opts.client 存在 → 复用 caller 事务（recurring scheduler 路径）
   *   - 否则 → service 内部 withTx 开新事务
   */
  async function createWithIdempotency(
    userId: string,
    payload: CreateEntryPayload,
    clientRefId?: string,
    opts?: CreateEntryOpts,
  ): Promise<EntryResult> {
    validateCreatePayload(payload);

    // 事务 client 由 caller（如定时调度器）注入；未传则走全局 pool（默认路径）。
    // 关键：findByLedgerAndClientRefId 与 insertEntry 走同一 client，
    // 保证 recurring tick 内 entry insert 与 rule 水位更新在同一事务下要么全成功要么全回滚。
    const txClient = opts?.client;

    // 防重：若 client_ref_id 存在，先查 ledger_id+client_ref_id 是否已有
    if (clientRefId) {
      const existing = await entryRepo.findByLedgerAndClientRefId(
        payload.ledger_id,
        clientRefId,
        txClient as unknown as Parameters<typeof entryRepo.findByLedgerAndClientRefId>[2],
      );
      if (existing) {
        return { status: 'conflict', serverVersion: existing.version };
      }
    }

    // COSTRA-217 R1.x: expense 未传 shared_type 时按 family kind 判定默认值
    let sharedType: 'personal' | 'shared' | null = payload.shared_type ?? null;
    if (payload.type === 'expense' && sharedType === null) {
      const resolved = await resolveDefaultSharedType(payload.ledger_id);
      if (resolved === null) {
        // 无法判定 family kind → 返回标准错误且不写 DB（dispatch §2.B.3）
        return {
          status: 'rejected',
          error: {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'cannot determine default shared_type: family kind unknown',
          },
        };
      }
      sharedType = resolved;
    }

    // 解析 category_id（spec §5：硬删后悬空 id 通过 redirect 表静默降级，不报错）
    const resolvedCategory = await resolveCategoryId(payload.category_id, payload.type);
    if ('error' in resolvedCategory) {
      return { status: 'rejected', error: resolvedCategory.error };
    }

    // ─── 事务包装（COSTRA-4xx）────────────────────────────────────────
    // 若 caller 注入 txClient，复用之；否则在本 service 内开新事务。
    // 关键：INSERT entries + UPDATE ledgers.balance_cents 必须在同一事务，
    //       保证"流水成功 ↔ 资产累加成功"原子性。
    const runInTx = async <T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> => {
      if (txClient) return fn(txClient);
      return withTx(fn);
    };

    try {
      const entry = await runInTx(async (client) => {
        const inserted = await entryRepo.insertEntry(
          {
            ledgerId: payload.ledger_id,
            amount: payload.amount,
            currency: payload.currency,
            type: payload.type,
            categoryId: resolvedCategory.categoryId,
            accountId: payload.account_id,
            toAccountId: payload.to_account_id,
            note: payload.note,
            occurredAt: payload.occurred_at,
            createdBy: userId,
            clientRefId: clientRefId ?? null,
            sharedType, // COSTRA-217 B2 + R1.x 默认规则
            sourceRecurringId: opts?.sourceRecurringId ?? null, // T2
          },
          client as unknown as Parameters<typeof entryRepo.insertEntry>[1],
        );

        // COSTRA-4xx：同事务累加 ledgers.balance_cents
        // delta = income: +amount / expense: -amount / transfer: 0
        // 幂等谓词：newSeq > balance_baseline_seq
        const delta = computeBalanceDelta(payload.type, payload.amount);
        await ledgerRepo.applyBalanceDelta(
          { ledgerId: payload.ledger_id, delta, newSeq: inserted.changeSeq },
          client as unknown as Parameters<typeof ledgerRepo.applyBalanceDelta>[1],
        );

        return inserted;
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
    const existing = await findById(userId, entryId);

    // COSTRA-217 R1.x review-tech P1-1: shared_type 仅允许 expense 类型修改
    // dispatch §2.B.5 硬约束：服务端返回标准错误，不得写入 DB 让 CHECK 拦截
    if (payload.shared_type !== undefined && existing.type !== 'expense') {
      return {
        status: 'rejected',
        error: {
          code: 'BUSINESS_RULE_VIOLATION',
          message: 'shared_type is only allowed for expense entries',
        },
      };
    }

    const repoInput: entryRepo.UpdateEntryInput = {};
    if (payload.amount !== undefined) repoInput.amount = payload.amount;
    if (payload.category_id !== undefined) {
      // spec §5：update 同样走降级，避免老客户端上传旧 category_id 失败
      const resolvedCategory = await resolveCategoryId(payload.category_id, existing.type);
      if ('error' in resolvedCategory) {
        return { status: 'rejected', error: resolvedCategory.error };
      }
      repoInput.categoryId = resolvedCategory.categoryId;
    }
    if (payload.account_id !== undefined) repoInput.accountId = payload.account_id;
    if (payload.note !== undefined) repoInput.note = payload.note;
    if (payload.occurred_at !== undefined) repoInput.occurredAt = payload.occurred_at;
    if (payload.shared_type !== undefined) repoInput.sharedType = payload.shared_type; // COSTRA-217 B2

    // ─── 事务包装（COSTRA-4xx · spec §4.2 update 分支）────────────────
    // 事务内：
    //   1) SELECT FOR UPDATE entries → 拿到 old_amount / old_type / old_seq（entries 行锁）
    //   2) UPDATE entries（乐观锁 WHERE version=baseVersion）→ 拿到 new_seq
    //   3) UPDATE ledgers.balance_cents：单条 SQL 双 delta swap
    //      - 旧贡献回退：仅当 old_seq > baseline
    //      - 新贡献叠加：仅当 new_seq > baseline
    //      - 单次 UPDATE 保证 balance_version 只 +1（一次业务动作 = 一次版本推进）
    const updated = await withTx(async (client) => {
      // 1) 事务内 FOR UPDATE 读旧值（entries 行锁 · spec §4.2 明文要求）
      //    防御 sync-push 批处理 / 定时补偿等未来路径绕过 entries.version 乐观锁时读到脏 old 值
      const locked = await entryRepo.findByIdForUpdate(
        entryId,
        client as unknown as Parameters<typeof entryRepo.findByIdForUpdate>[1],
      );
      if (!locked) return null;
      const oldAmount = locked.amount;
      const oldType = locked.type;
      const oldSeq = locked.changeSeq;

      // 2) UPDATE entries（乐观锁 · 拿到 newSeq / 新 amount / 新 type）
      const result = await entryRepo.updateEntryByVersion(
        entryId,
        repoInput,
        baseVersion,
        client as unknown as Parameters<typeof entryRepo.updateEntryByVersion>[3],
      );
      if (!result) return null;

      const newAmount = result.amount;
      const newType = result.type;
      const newSeq = result.changeSeq;

      // 3) 双 delta 独立判· 单条 UPDATE（applyBalanceSwap 内部含 short-circuit）
      //   oldDelta = "原来这条流水对资产的贡献"（要回退，传 swap 后转-oldDelta）
      //   newDelta = "新流水对资产的贡献"（要叠加）
      const oldDelta = computeBalanceDelta(oldType, oldAmount);
      const newDelta = computeBalanceDelta(newType, newAmount);

      // 旧贡献回退的谓词用 newSeq（本次操作分配的新 seq），而非 oldSeq。
      // newSeq 一定 > balance_baseline_seq → 旧贡献回退总是生效。
      // 这确保 rebase 后修改旧流水金额时，旧贡献也会正确回退，
      // 而不是被 baseline 谓词静默忽略。
      // 幂等安全由 entry 级乐观锁（version = baseVersion）保障。
      await ledgerRepo.applyBalanceSwap(
        {
          ledgerId: result.ledgerId,
          oldDelta,
          newDelta,
          oldSeq: newSeq,
          newSeq,
        },
        client as unknown as Parameters<typeof ledgerRepo.applyBalanceSwap>[1],
      );

      return result;
    });

    if (!updated) {
      const current = await entryRepo.findById(entryId);
      return { status: 'conflict', serverVersion: current?.version ?? 0 };
    }
    return { status: 'ok', serverId: entryId, serverVersion: updated.version };
  }

  async function softDelete(userId: string, entryId: string, baseVersion: number): Promise<EntryResult> {
    // 先做权限校验（读entry + JOIN family_members · 只做守门，不读 old值）
    await findById(userId, entryId);

    // ─── 事务包装（COSTRA-4xx · spec §4.2 softDelete 分支）───────────
    // 事务内：
    //   1) SELECT FOR UPDATE entries →拿 old_amount / old_type / old_seq（行锁）
    //   2) UPDATE entries SET deleted_at + 乐观锁 → 拿到 newSeq
    //   3) UPDATE ledgers.balance_cents：旧贡献回退
    //      - 仅当 old_seq > baseline 才回退（防止回退已重锚前的老流水）
    const deleted = await withTx(async (client) => {
      // 1) 事务内 FOR UPDATE 读旧值（spec §4.2 明文要求）
      const locked = await entryRepo.findByIdForUpdate(
        entryId,
        client as unknown as Parameters<typeof entryRepo.findByIdForUpdate>[1],
      );
      if (!locked) return null;
      const oldAmount = locked.amount;
      const oldType = locked.type;
      const oldSeq = locked.changeSeq;

      // 2) softDelete（乐观锁 ·拿新 changeSeq）
      const result = await entryRepo.softDeleteEntry(
        entryId,
        baseVersion,
        client as unknown as Parameters<typeof entryRepo.softDeleteEntry>[2],
      );
      if (!result) return null;

      // 3) 旧贡献回退 · 新贡献=0（deletion）
      const oldDelta = computeBalanceDelta(oldType, oldAmount);
      if (oldDelta === 0) return result; // transfer 类无影响

      // 用本次删除操作分配的 newSeq（result.changeSeq）来评估回退，而非 oldSeq。
      // newSeq 一定 > balance_baseline_seq → 旧贡献回退总是生效。
      // 这确保 rebase 后删除旧流水时资产也会正确回退，
      // 而不是被 baseline 谓词静默忽略。
      // 幂等安全由 entry 级乐观锁（version = baseVersion）保障，
      // 同一条流水不会被 softDelete 两次。
      await ledgerRepo.applyBalanceDelta(
        { ledgerId: result.ledgerId, delta: -oldDelta, newSeq: result.changeSeq },
        client as unknown as Parameters<typeof ledgerRepo.applyBalanceDelta>[1],
      );

      return result;
    });

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
      userId,
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
