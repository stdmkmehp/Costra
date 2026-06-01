// services/family.ts · 卡号: COSTRA-165 / COSTRA-220
// Refs: ADR-0007 §3.1/§5.2/§6.2 · sync-protocol.md §3 §7（family_id 鉴权语义）
// 复用：services/storage.ts envelope 范式（COSTRA-125 async）
// COSTRA-220: 扩展 FamilyContext 增加 family_kind + ledger_name · 支持明细页真实数据显示

import { getItem, setItem, removeItem } from './storage';

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
 * 降级返回 '我的账本'
 */
export async function getActiveLedgerName(): Promise<string> {
  const ctx = await getItem<FamilyContext>(FAMILY_CONTEXT_KEY);
  return ctx?.ledger_name || '我的账本';
}
