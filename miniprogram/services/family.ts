// services/family.ts · 卡号: COSTRA-165 / COSTRA-220
// Refs: ADR-0007 §3.1/§5.2/§6.2 · sync-protocol.md §3 §7（family_id 鉴权语义）
// 复用：services/storage.ts envelope 范式（COSTRA-125 async）
// COSTRA-220: 扩展 FamilyContext 增加 family_kind + ledger_name · 支持明细页真实数据显示
// migration 0011: 加入服务端偏好持久化（PUT/GET /users/me/preference）
//   策略：本地 storage 优先（无网络延迟）+ 服务端兜底（storage 清除后恢复）
//         写偏好时本地 + 服务端双写（服务端 fire-and-forget · 失败不影响主流程）

import { getItem, setItem, removeItem } from './storage';
import { request } from './request';

/** family_kind 枚举（与 server 0007 migration family_kind ENUM 对齐 · ADR-0007 §5.7.2） */
export type FamilyKind = 'personal' | 'shared';

export interface FamilyContext {
  family_id: string;
  ledger_id: string;
  /** 家庭类型（COSTRA-220: 替代 !== 'solo' 硬编码判断） */
  family_kind?: FamilyKind;
  /** 账本名称（COSTRA-220: 替代 '我的账本' 硬编码） */
  ledger_name?: string;
}

const FAMILY_CONTEXT_KEY = '__costra_family_context_v1';
// 旧 key 一次性清理（防陈旧值干扰 · 实测手册曾让 Human 手动 setStorage 此 key）
const LEGACY_FAMILY_ID_KEY = '__costra_family_id_v1';

/**
 * 设置 active family + ledger（登录成功 / family 切换均调）
 * 对应 ADR-0007 §5.2 storage 主源
 */
export async function setActiveFamily(ctx: FamilyContext): Promise<void> {
  await setItem<FamilyContext>(FAMILY_CONTEXT_KEY, ctx);
  // 一次性迁移：清旧 key（如存在）防止 syncScheduler 走旧分支
  await removeItem(LEGACY_FAMILY_ID_KEY);
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
export async function clearActiveFamily(): Promise<void> {
  await removeItem(FAMILY_CONTEXT_KEY);
  await removeItem(LEGACY_FAMILY_ID_KEY);
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
 * 降级返回 '个人账本'
 */
export async function getActiveLedgerName(): Promise<string> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  return ctx?.ledger_name || '个人账本';
}

// ─── 偏好持久化（migration 0011）──────────────────────────────────────────────

/** 服务端偏好响应结构（GET /users/me/preference） */
interface ServerPreference {
  preferred_family_id: string | null;
  preferred_ledger_id:  string | null;
}

/**
 * 保存用户账本偏好：
 *   1. 立即更新本地 storage（setActiveFamily 已完成 · 此处追加服务端同步）
 *   2. fire-and-forget 写服务端（网络失败不影响本地体验）
 *
 * 调用时机：用户主动切换账本（ledger 页 / family 页切换）
 */
export function savePreferenceAsync(familyId: string, ledgerId: string): void {
  void request<void>({
    method: 'PUT',
    path: '/users/me/preference',
    body: {
      preferred_family_id: familyId,
      preferred_ledger_id: ledgerId,
    },
  }).catch((e) => {
    // fire-and-forget · 网络失败静默 warn，不阻断 UI
    console.warn('[family] savePreference server sync failed', e);
  });
}

/**
 * 从服务端拉取偏好并还原本地 context。
 *
 * 调用时机：本地 storage 中无 active family context 时（storage 被清除 / 首次安装）
 *
 * 双层策略：
 *   - 本地有值 → 调用方直接用本地，不调此函数
 *   - 本地无值 → 调此函数从服务端恢复，写入本地 storage，再用
 *
 * 返回 null 表示服务端也无偏好（真正的首次登录 / 偏好未设置）
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

    // 拉 families 列表补全 family_kind + ledger_name（避免显示"我的账本"兜底）
    let family_kind: FamilyKind | undefined;
    let ledger_name: string | undefined;
    try {
      const resp = await request<{ id: string; kind: FamilyKind; name: string; ledger_id: string; ledger_name: string }[]>({
        method: 'GET',
        path: '/families',
      });
      const matched = Array.isArray(resp)
        ? resp.find((f) => f.id === pref.preferred_family_id)
        : null;
      if (matched) {
        family_kind = matched.kind;
        ledger_name = matched.ledger_name || matched.name;
      }
    } catch {
      // 补全失败不影响主流程，kind/name 由页面层 _doLoadPage 修正
    }

    const ctx: FamilyContext = {
      family_id: pref.preferred_family_id,
      ledger_id:  pref.preferred_ledger_id,
      family_kind,
      ledger_name,
    };
    await setActiveFamily(ctx);
    return ctx;
  } catch (e) {
    console.warn('[family] fetchAndRestorePreference failed', e);
    return null;
  }
}
