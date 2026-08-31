/**
 * Costra · Server · 流水业务编排层
 *
 * 卡号：COSTRA-104 / COSTRA-4xx · 事实源：server/api/openapi.yaml §entries-create/list + sync-protocol.md §2
 *
 * 职责：
 *   - createWithIdempotency：active 成员校验 + 防重（ledger_id+client_ref_id UNIQUE 约束）
 *     + 写 entries + 同事务累加 ledgers.balance_cents（COSTRA-4xx 资产）
 *   - updateWithVersion：乐观锁 update（WHERE version = baseVersion）
 *     + 同事务回退旧贡献 + 叠加新贡献（资产重锚谓词双重判定）
 *   - softDelete：软删 + 乐观锁 + 资产旧贡献回退
 *   - list：游标分页（updated_at DESC, id DESC 复合 cursor）
 *   - findById：含 ledger/权限校验
 *
 * ⚠️ 加锁顺序不变量（三条写路径必须一致，否则并发 create 与 update/delete 会死锁）：
 *     family_members 行 → entries 行 → ledgers 行
 *   - create：lockActiveMember → insertEntry → applyBalanceDelta
 *   - update / softDelete：lockActiveMemberByLedger → findByIdForUpdate → applyBalanceSwap / applyBalanceDelta
 *   成员行锁不只是权限校验，它还把「授权」与「写入」放进同一事务，
 *   堵住「校验通过 → 成员并发退出 → 仍然写入」的 TOCTOU。
 *
 * 资产累加规则（COSTRA-4xx · 见 asset-and-budget-spec.md §4）：
 *   - income→ balance += amount
 *   - expense → balance -= amount
 *   - transfer → balance 不变（delta = 0，跳过 UPDATE）
 *   - 幂等保障：同事务 + 唯一约束（create）/乐观锁（update/softDelete）
 *   - update/softDelete 时先 FOR UPDATE 读旧值，再无条件回退旧贡献 + 叠加新贡献
 *
 * 依赖注入：所有依赖通过工厂函数 createEntryService(deps) 注入。
 */

import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/ErrorCode.js';
import { withTx } from '../db/pool.js';
import * as entryRepo from '../repositories/entryRepo.js';
import type { EntryEntity } from '../repositories/entryRepo.js';
import * as ledgerRepo from '../repositories/ledgerRepo.js';
import * as familyMemberRepo from '../repositories/familyMemberRepo.js';
import * as categoryRepo from '../repositories/categoryRepo.js';

/**
 * 依赖注入接口
 * 默认使用真实 repo · 单测可注入 mock
 */
export interface EntryServiceDeps {
  /**
   * 一次往返取回 canonical ledger id + 所属 family 的 kind。
   * 返回 null = 账本不存在或所属家庭已解散（调用方统一按 NOT_FOUND 处理）。
   */
  findLedgerWithFamily?: (
    ledgerId: string,
    client?: import('pg').PoolClient,
  ) => Promise<{ id: string; familyId: string; kind: string } | null>;
  /**
   * active 成员校验。client 存在时走 `FOR UPDATE`，把授权与写操作锁在同一事务内。
   */
  isActiveFamilyMember?: (userId: string, familyId: string, client?: import('pg').PoolClient) => Promise<boolean>;
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
  const findLedgerWithFamily = deps.findLedgerWithFamily
    ?? (async (id: string, client?: import('pg').PoolClient) => ledgerRepo.findWithFamilyById(id, client));
  const isActiveFamilyMember = deps.isActiveFamilyMember
    ?? (async (userId: string, familyId: string, client?: import('pg').PoolClient) => (
      client
        ? familyMemberRepo.lockActiveMember(userId, familyId, client)
        : familyMemberRepo.isActiveMember(userId, familyId)
    ));

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
   *
   * 不接事务 client：categories 是引用数据，运行时只软删（历史上唯一一次硬删在
   * migration 0004），不参与写事务的一致性要求。放在事务外可缩短持锁时长。
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
   *   1) 事务外：分类降级解析（引用数据，不参与写一致性）
   *   2) 事务内：一次往返取 canonical ledger + family kind，再 FOR UPDATE 锁 active membership
   *   3) 同事务：防重 check + INSERT entries + UPDATE ledgers.balance_cents
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

    // 分类降级解析放在事务外：categories 只软删，不参与本事务的写一致性，
    // 移出后事务内最多少 3 次往返。
    const resolvedCategory = await resolveCategoryId(payload.category_id, payload.type);
    if ('error' in resolvedCategory) {
      return { status: 'rejected', error: resolvedCategory.error };
    }

    const txClient = opts?.client;
    const runInTx = async <T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> => {
      if (txClient) return fn(txClient);
      return withTx(fn);
    };

    type CreateOutcome =
      | { kind: 'created'; entry: EntryEntity }
      | { kind: 'result'; result: EntryResult };

    // 账本不存在与非成员统一 NOT_FOUND：不通过写接口泄露其他家庭账本的存在性
    const notFound = (): EntryResult => ({
      status: 'rejected',
      error: { code: ErrorCode.NOT_FOUND, message: 'ledger not found' },
    });

    try {
      const outcome = await runInTx<CreateOutcome>(async (client) => {
        const ledger = await findLedgerWithFamily(payload.ledger_id, client);
        if (!ledger) return { kind: 'result', result: notFound() };

        // 事务内 FOR UPDATE 锁住该成员的 membership 行：授权与后续写入处于同一事务，
        // 堵住「校验通过 → 成员并发退出 → 仍然写入」的 TOCTOU。
        // 只锁 (family_id, user_id) 这一行，不同成员之间不互斥。
        if (!await isActiveFamilyMember(userId, ledger.familyId, client)) {
          return { kind: 'result', result: notFound() };
        }

        // 所有后续查询和写入使用数据库返回的 canonical UUID。
        const ledgerId = ledger.id;
        if (clientRefId) {
          const existing = await entryRepo.findByLedgerAndClientRefId(ledgerId, clientRefId, client);
          if (existing) {
            return {
              kind: 'result',
              result: { status: 'conflict', serverVersion: existing.version },
            };
          }
        }

        // family kind 与 entry shared_type 同二值（personal/shared）· kind 创建后不可变，
        // 故直接取用；ENUM 若未来扩展，下面的守门会拦住而不是静默写入错误值。
        let sharedType: 'personal' | 'shared' | null = payload.shared_type ?? null;
        if (payload.type === 'expense' && sharedType === null) {
          const familyKind = ledger.kind;
          if (familyKind !== 'personal' && familyKind !== 'shared') {
            return {
              kind: 'result',
              result: {
                status: 'rejected',
                error: {
                  code: ErrorCode.BUSINESS_RULE_VIOLATION,
                  message: 'cannot determine default shared_type: family kind unknown',
                },
              },
            };
          }
          sharedType = familyKind;
        }

        const inserted = await entryRepo.insertEntry(
          {
            ledgerId,
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
            sharedType,
            sourceRecurringId: opts?.sourceRecurringId ?? null,
          },
          client,
        );

        const delta = computeBalanceDelta(payload.type, payload.amount);
        await ledgerRepo.applyBalanceDelta(
          { ledgerId, delta, newSeq: inserted.changeSeq },
          client,
        );

        return { kind: 'created', entry: inserted };
      });

      if (outcome.kind === 'result') return outcome.result;
      return { status: 'ok', serverId: outcome.entry.id, serverVersion: outcome.entry.version };
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
      // 0) 先锁成员行，再锁 entry 行，最后更新 ledgers —— 与 create 路径的加锁顺序
      //    （family_members → entries → ledgers）保持一致，否则并发 create/update 可能死锁。
      //    事务外的 findById 守门与本事务开启之间仍有缝隙，成员可能在此期间退出。
      if (!await familyMemberRepo.lockActiveMemberByLedger(userId, existing.ledgerId, client)) {
        return null;
      }

      // 1) 事务内 FOR UPDATE 读旧值（entries 行锁 · spec §4.2 明文要求）
      //    防御 sync-push 批处理 / 定时补偿等未来路径绕过 entries.version 乐观锁时读到脏 old 值
      const locked = await entryRepo.findByIdForUpdate(
        entryId,
        client as unknown as Parameters<typeof entryRepo.findByIdForUpdate>[1],
      );
      if (!locked) return null;
      const oldAmount = locked.amount;
      const oldType = locked.type;

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

      // 旧贡献回退 + 新贡献叠加：无条件执行（不依赖 seq 与 baseline 大小关系）。
      // 幂等安全由 entry 级乐观锁（version = baseVersion）保障：
      // 同一条流水不会被 updateWithVersion 两次命中。
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

  async function softDelete(
    userId: string,
    entryId: string,
    baseVersion: number,
  ): Promise<EntryResult> {
    // 先做权限校验（读entry + JOIN family_members · 只做守门，不读 old值）
    // 同时带出 ledgerId，供事务内按账本锁成员行
    const existing = await findById(userId, entryId);

    // ─── 事务包装（COSTRA-4xx · spec §4.2 softDelete 分支）───────────
    // 事务内：
    //   1) SELECT FOR UPDATE entries →拿 old_amount / old_type / old_seq（行锁）
    //   2) UPDATE entries SET deleted_at + 乐观锁 → 拿到 newSeq
    //   3) UPDATE ledgers.balance_cents：旧贡献回退
    //      - 仅当 old_seq > baseline 才回退（防止回退已重锚前的老流水）
    const deleted = await withTx(async (client) => {
      // 0) 与 create 同加锁顺序先锁成员行（family_members → entries → ledgers）
      if (!await familyMemberRepo.lockActiveMemberByLedger(userId, existing.ledgerId, client)) {
        return null;
      }

      // 1) 事务内 FOR UPDATE 读旧值（spec §4.2 明文要求）
      const locked = await entryRepo.findByIdForUpdate(
        entryId,
        client as unknown as Parameters<typeof entryRepo.findByIdForUpdate>[1],
      );
      if (!locked) return null;
      const oldAmount = locked.amount;
      const oldType = locked.type;

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

      // 旧贡献回退：无条件执行（不依赖 seq 与 baseline 大小关系）。
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
