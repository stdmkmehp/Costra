// services/family.ts · 卡号: COSTRA-165 / COSTRA-220
// Refs: ADR-0007 §3.1/§5.2/§6.2 · sync-protocol.md §3 §7（family_id 鉴权语义）
// 复用：services/storage.ts envelope 范式（COSTRA-125 async）
// COSTRA-220: 扩展 FamilyContext 增加 family_kind + ledger_name · 支持明细页真实数据显示
// migration 0011: 加入服务端偏好持久化（PUT/GET /users/me/preference）
//   策略：本地 storage 优先（无网络延迟）+ 服务端兜底（storage 清除后恢复）
//         写偏好时本地 + 服务端双写（服务端 fire-and-forget · 失败不影响主流程）

import { getItem, setItem, removeItem } from './storage';
import { request } from './request';
import { getFamilies as requestCachedFamilies } from './familyApi';
import { eventBus, EventNames, type ActiveFamilyChangedPayload } from './eventBus';
import { logger } from '../utils/logger';

/** family_kind 枚举（与 server 0007 migration family_kind ENUM 对齐 · ADR-0007 §5.7.2） */
export type FamilyKind = 'personal' | 'shared';

export interface FamilyContext {
  family_id: string;
  ledger_id: string;
  /** 家庭类型（COSTRA-220: 替代 !== 'solo' 硬编码判断） */
  family_kind?: FamilyKind;
  /** 账本名称（COSTRA-220: 替代 '我的账本' 硬编码） */
  ledger_name?: string;
  /** 服务端偏好 revision（用于防旧请求覆盖） */
  preference_revision?: number;
  /** 服务端偏好更新时间 */
  preference_updated_at?: string | null;
}

const FAMILY_CONTEXT_KEY = '__costra_family_context_v1';
const PENDING_PREFERENCE_KEY = '__costra_pending_preference_v1';
// 旧 key 一次性清理（防陈旧值干扰 · 实测手册曾让 Human 手动 setStorage 此 key）
const LEGACY_FAMILY_ID_KEY = '__costra_family_id_v1';

let lastPreferenceRevision = 0;

function syncGlobalActiveLedgerId(ledgerId: string | undefined): void {
  try {
    const app = getApp<{ globalData?: { activeLedgerId?: string } }>();
    if (app?.globalData) {
      app.globalData.activeLedgerId = ledgerId;
    }
  } catch {
    // 单测 / 非小程序环境下忽略 globalData 同步
  }
}

/** ACTIVE_FAMILY_CHANGED 事件来源（与 eventBus.ts 对齐） */
export type ActiveFamilySwitchSource = ActiveFamilyChangedPayload['source'];

/**
 * 设置 active family + ledger（登录成功 / family 切换均调）
 * 对应 ADR-0007 §5.2 storage 主源
 *
 * 2026-06-08：写完 storage 后广播 ACTIVE_FAMILY_CHANGED 事件，
 * 让常驻 Tab 页（如 statistics 页 reShow 短路路径）能即时响应账本切换。
 *
 * @param ctx     新的 active family context
 * @param source  触发来源（用于订阅方区分行为；不传默认 'other'）
 */
export async function setActiveFamily(
  ctx: FamilyContext,
  source: ActiveFamilySwitchSource = 'other',
): Promise<void> {
  const prev = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  await setItem<FamilyContext>(FAMILY_CONTEXT_KEY, ctx);
  // 一次性迁移：清旧 key（如存在）防止 syncScheduler 走旧分支
  await removeItem(LEGACY_FAMILY_ID_KEY);
  syncGlobalActiveLedgerId(ctx.ledger_id);

  // 仅在 family_id 或 ledger_id 真正变化时广播，避免无意义刷新
  if (!prev || prev.family_id !== ctx.family_id || prev.ledger_id !== ctx.ledger_id) {
    const payload: ActiveFamilyChangedPayload = {
      family_id: ctx.family_id,
      ledger_id: ctx.ledger_id,
      family_kind: ctx.family_kind || 'personal',
      ledger_name: ctx.ledger_name || '个人账本',
      source,
    };
    eventBus.emit(EventNames.ACTIVE_FAMILY_CHANGED, payload);
  }
}

/**
 * 取 active family_id · 解析顺序：
 *   1. storage FAMILY_CONTEXT_KEY（用户上次选择）
 *   2. null（caller 兜底用 login resp default_family_id）
 * 注意：本函数不做 fallback 创建逻辑（R1 简化 · R2 加 family 列表后增强）
 */
export async function getActiveFamilyId(): Promise<string | null> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  return ctx?.family_id ?? null;
}

/**
 * 取 active ledger_id（与 family_id 同生命周期 · 同来源）
 */
export async function getActiveLedgerId(): Promise<string | null> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  return ctx?.ledger_id ?? null;
}

/**
 * 清除 active context（logout 时调）
 * 注意：不清除偏好（偏好独立于登录态，重新登录后可恢复）
 */
export async function clearActiveFamily(source: ActiveFamilySwitchSource = 'other'): Promise<void> {
  await removeItem(FAMILY_CONTEXT_KEY);
  await removeItem(LEGACY_FAMILY_ID_KEY);
  syncGlobalActiveLedgerId(undefined);
  eventBus.emit(EventNames.ACTIVE_FAMILY_CHANGED, {
    family_id: '',
    ledger_id: '',
    family_kind: 'personal',
    ledger_name: '个人账本',
    source,
  });
}

/**
 * 取 active family_kind（COSTRA-220: 替代 !== 'solo' 硬编码判断）
 * 降级返回 null（caller 自行处理）
 */
export async function getActiveFamilyKind(): Promise<FamilyKind | null> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  return ctx?.family_kind ?? null;
}

/**
 * 取 active ledger_name（COSTRA-220: 替代 '我的账本' 硬编码）
 * 仅明确 personal 时降级返回“个人账本”；unknown/partial context 返回空串。
 */
export async function getActiveLedgerName(): Promise<string> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  if (ctx?.ledger_name) return ctx.ledger_name;
  return ctx?.family_kind === 'personal' ? '个人账本' : '';
}

export async function getActiveFamilyContext(): Promise<FamilyContext | null> {
  return await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
}

function isCompleteFamilyContext(ctx: FamilyContext | null | undefined): ctx is FamilyContext & { family_kind: FamilyKind; ledger_name: string } {
  return !!ctx?.family_id && !!ctx.ledger_id && !!ctx.family_kind && !!ctx.ledger_name;
}

function nextPreferenceRevision(): number {
  const now = Date.now();
  lastPreferenceRevision = Math.max(lastPreferenceRevision + 1, now);
  return lastPreferenceRevision;
}

// ─── 偏好持久化（migration 0011 + revision 保护）──────────────────────────────

/** 服务端偏好响应结构（GET /users/me/preference） */
interface ServerPreference {
  preferred_family_id: string | null;
  preferred_ledger_id:  string | null;
  preferred_family_kind?: FamilyKind | null;
  preferred_ledger_name?: string | null;
  preferred_revision?: number;
  preferred_updated_at?: string | null;
}

interface PendingPreference {
  family_id: string;
  ledger_id: string;
  family_kind?: FamilyKind;
  ledger_name?: string;
  client_revision: number;
  source: ActiveFamilySwitchSource;
  retry_count: number;
  last_error_code?: string;
  updated_at: number;
}

async function requestFamilies(): Promise<{ id: string; kind: FamilyKind; name: string; ledger_id: string; ledger_name: string }[]> {
  const resp = await requestCachedFamilies();
  return resp.families;
}

function isNonRetryablePreferenceError(apiErr: { code?: string; status?: number }): boolean {
  return !!apiErr.status && apiErr.status >= 400 && apiErr.status < 500 && apiErr.code !== 'CLIENT_NETWORK_ERROR';
}

async function setPendingPreferenceIfNewer(next: PendingPreference): Promise<void> {
  const previous = await getItem<PendingPreference>(PENDING_PREFERENCE_KEY);
  if (previous && previous.client_revision > next.client_revision) {
    logger.warn('family', 'skip stale pending preference', {
      previousRevision: previous.client_revision,
      nextRevision: next.client_revision,
    });
    return;
  }
  await setItem<PendingPreference>(PENDING_PREFERENCE_KEY, next);
}

async function removePendingPreferenceUpToRevision(revision: number): Promise<void> {
  const pending = await getItem<PendingPreference>(PENDING_PREFERENCE_KEY);
  if (pending && pending.client_revision <= revision) {
    await removeItem(PENDING_PREFERENCE_KEY);
  }
}

async function savePreference(ctx: FamilyContext & { family_kind: FamilyKind; ledger_name: string }, source: ActiveFamilySwitchSource, revision: number): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: '/users/me/preference',
    body: {
      preferred_family_id: ctx.family_id,
      preferred_ledger_id: ctx.ledger_id,
      client_revision: revision,
    },
  });
  await removePendingPreferenceUpToRevision(revision);
  logger.info('family', 'preference saved', { source, familyKind: ctx.family_kind });
}

async function queuePendingPreference(
  ctx: FamilyContext & { family_kind: FamilyKind; ledger_name: string },
  source: ActiveFamilySwitchSource,
  revision: number,
  err: unknown,
): Promise<void> {
  const apiErr = err as { code?: string; status?: number };
  if (isNonRetryablePreferenceError(apiErr)) {
    logger.warn('family', 'preference save rejected, skip retry', { source, code: apiErr.code, status: apiErr.status });
    return;
  }
  const previous = await getItem<PendingPreference>(PENDING_PREFERENCE_KEY);
  await setPendingPreferenceIfNewer({
    family_id: ctx.family_id,
    ledger_id: ctx.ledger_id,
    family_kind: ctx.family_kind,
    ledger_name: ctx.ledger_name,
    client_revision: revision,
    source,
    retry_count: previous?.client_revision === revision ? previous.retry_count + 1 : 0,
    last_error_code: apiErr.code,
    updated_at: Date.now(),
  });
  logger.warn('family', 'preference save queued', { source, code: apiErr.code, status: apiErr.status });
}

/**
 * 保存用户账本偏好（兼容旧调用方）。
 * 网络失败时写 pending preference，后续由 flushPendingPreference 重试。
 */
export function savePreferenceAsync(
  familyId: string,
  ledgerId: string,
  source: ActiveFamilySwitchSource = 'other',
): void {
  void (async () => {
    const active = await getActiveFamilyContext();
    const revision = nextPreferenceRevision();
    if (!isCompleteFamilyContext(active) || active.family_id !== familyId || active.ledger_id !== ledgerId) {
      try {
        await request<void>({
          method: 'PUT',
          path: '/users/me/preference',
          body: {
            preferred_family_id: familyId,
            preferred_ledger_id: ledgerId,
            client_revision: revision,
          },
        });
        await removePendingPreferenceUpToRevision(revision);
      } catch (e) {
        const apiErr = e as { code?: string; status?: number };
        if (isNonRetryablePreferenceError(apiErr)) {
          logger.warn('family', 'preference save rejected with ids only, skip retry', { source, code: apiErr.code, status: apiErr.status });
          return;
        }
        const previous = await getItem<PendingPreference>(PENDING_PREFERENCE_KEY);
        await setPendingPreferenceIfNewer({
          family_id: familyId,
          ledger_id: ledgerId,
          client_revision: revision,
          source,
          retry_count: previous?.client_revision === revision ? previous.retry_count + 1 : 0,
          last_error_code: apiErr.code,
          updated_at: Date.now(),
        });
        logger.warn('family', 'preference save queued with ids only', { source, code: apiErr.code, status: apiErr.status });
      }
      return;
    }
    const ctx = active;
    try {
      await savePreference(ctx, source, revision);
    } catch (e) {
      await queuePendingPreference(ctx, source, revision, e);
    }
  })();
}

/** 统一切换 active family + ledger：写本地完整 context，并可靠保存服务端 preference。 */
export async function switchActiveFamily(
  ctx: FamilyContext & { family_kind: FamilyKind; ledger_name: string },
  source: ActiveFamilySwitchSource = 'other',
): Promise<FamilyContext> {
  const revision = nextPreferenceRevision();
  const nextCtx: FamilyContext = { ...ctx, preference_revision: revision };
  await setActiveFamily(nextCtx, source);
  syncGlobalActiveLedgerId(ctx.ledger_id);
  void savePreference(ctx, source, revision).catch((e) => queuePendingPreference(ctx, source, revision, e));
  return nextCtx;
}

export async function flushPendingPreference(): Promise<void> {
  const pending = await getItem<PendingPreference>(PENDING_PREFERENCE_KEY);
  if (!pending) return;
  try {
    if (pending.family_kind && pending.ledger_name) {
      await savePreference({
        family_id: pending.family_id,
        ledger_id: pending.ledger_id,
        family_kind: pending.family_kind,
        ledger_name: pending.ledger_name,
      }, pending.source, pending.client_revision);
    } else {
      await request<void>({
        method: 'PUT',
        path: '/users/me/preference',
        body: {
          preferred_family_id: pending.family_id,
          preferred_ledger_id: pending.ledger_id,
          client_revision: pending.client_revision,
        },
      });
      await removePendingPreferenceUpToRevision(pending.client_revision);
    }
    logger.info('family', 'pending preference flushed', { source: pending.source });
  } catch (e) {
    const apiErr = e as { code?: string; status?: number };
    if (isNonRetryablePreferenceError(apiErr)) {
      logger.warn('family', 'pending preference rejected, drop retry', { source: pending.source, code: apiErr.code, status: apiErr.status });
      await removePendingPreferenceUpToRevision(pending.client_revision);
      return;
    }
    await setPendingPreferenceIfNewer({
      ...pending,
      retry_count: pending.retry_count + 1,
      last_error_code: apiErr.code,
      updated_at: Date.now(),
    });
  }
}

async function completeContextFromFamilies(ctx: FamilyContext): Promise<FamilyContext | null> {
  const families = await requestFamilies();
  const matched = families.find((f) => f.id === ctx.family_id && f.ledger_id === ctx.ledger_id);
  if (!matched) return null;
  return {
    family_id: matched.id,
    ledger_id: matched.ledger_id,
    family_kind: matched.kind,
    ledger_name: matched.ledger_name || matched.name,
    preference_revision: ctx.preference_revision,
    preference_updated_at: ctx.preference_updated_at,
  };
}

/**
 * 从服务端拉取偏好并还原本地 context。
 * 不落盘缺少 family_kind/ledger_name 的半残 context，避免页面视觉误判为个人账本。
 */
export async function fetchAndRestorePreference(): Promise<FamilyContext | null> {
  try {
    const pref = await request<ServerPreference>({
      method: 'GET',
      path: '/users/me/preference',
    });
    if (!pref.preferred_family_id || !pref.preferred_ledger_id) {
      return null;
    }

    let ctx: FamilyContext | null = null;
    if (pref.preferred_family_kind && pref.preferred_ledger_name) {
      ctx = {
        family_id: pref.preferred_family_id,
        ledger_id: pref.preferred_ledger_id,
        family_kind: pref.preferred_family_kind,
        ledger_name: pref.preferred_ledger_name,
        preference_revision: pref.preferred_revision,
        preference_updated_at: pref.preferred_updated_at ?? null,
      };
    } else {
      ctx = await completeContextFromFamilies({
        family_id: pref.preferred_family_id,
        ledger_id: pref.preferred_ledger_id,
        preference_revision: pref.preferred_revision,
        preference_updated_at: pref.preferred_updated_at ?? null,
      });
    }

    if (!isCompleteFamilyContext(ctx)) {
      logger.warn('family', 'preference restore rejected partial context');
      return null;
    }

    await setActiveFamily(ctx, 'preference-restore');
    return ctx;
  } catch (e) {
    logger.warn('family', 'fetchAndRestorePreference failed', e);
    return null;
  }
}

/** 登录后合并本地 context 与服务端 preference：本地完整且仍有效时优先。 */
export async function restoreActiveFamilyAfterLogin(defaultCtx: FamilyContext & { family_kind: FamilyKind; ledger_name: string }): Promise<FamilyContext> {
  const local = await getActiveFamilyContext();
  if (isCompleteFamilyContext(local)) {
    try {
      const completed = await completeContextFromFamilies(local);
      if (completed) {
        await setActiveFamily(completed, 'preference-restore');
        savePreferenceAsync(completed.family_id, completed.ledger_id, 'preference-restore');
        return completed;
      }
      logger.warn('family', 'local active context invalid after login, fallback to server preference');
    } catch (e) {
      logger.warn('family', 'local active context validation failed, keep local as offline-unverified', e);
      await setActiveFamily(local, 'preference-restore');
      if (local.family_kind === 'personal') {
        savePreferenceAsync(local.family_id, local.ledger_id, 'preference-restore');
      }
      return local;
    }
  }

  const restored = await fetchAndRestorePreference();
  if (restored) return restored;

  await switchActiveFamily(defaultCtx, 'preference-restore');
  return defaultCtx;
}

/** 当前 active family 失效时安全回退到 personal family，并同步服务端 preference。 */
export async function fallbackToPersonalFamily(source: ActiveFamilySwitchSource = 'other'): Promise<FamilyContext | null> {
  try {
    const families = await requestFamilies();
    const personal = families.find((f) => f.kind === 'personal');
    if (!personal) {
      await clearActiveFamily(source);
      return null;
    }
    return await switchActiveFamily({
      family_id: personal.id,
      ledger_id: personal.ledger_id,
      family_kind: 'personal',
      ledger_name: personal.ledger_name || personal.name || '个人账本',
    }, source);
  } catch (e) {
    logger.warn('family', 'fallbackToPersonalFamily failed', e);
    await clearActiveFamily(source);
    return null;
  }
}
