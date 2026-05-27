// services/family.spec.ts · family-context service 单测
// 卡号: COSTRA-165 · Refs: dispatch §2.1 E 项 T1~T6
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveFamily, getActiveFamilyId, getActiveLedgerId, clearActiveFamily } from './family';
import type { FamilyContext } from './family';

// 模拟 storage.ts envelope 行为（与 auth.spec.ts 同范式）
const storageMap = new Map<string, unknown>();
vi.mock('./storage', () => ({
  setItem: vi.fn(async (key: string, data: unknown) => {
    storageMap.set(key, { v: 1, t: Date.now(), d: data });
  }),
  getItem: vi.fn(async (key: string) => {
    if (!storageMap.has(key)) return null;
    const env = storageMap.get(key);
    if (!env || typeof env !== 'object') return null;
    return (env as { d: unknown }).d;
  }),
  removeItem: vi.fn(async (key: string) => {
    storageMap.delete(key);
  }),
}));

const FAMILY_CONTEXT_KEY = '__costra_family_context_v1';
const LEGACY_FAMILY_ID_KEY = '__costra_family_id_v1';

const testCtx: FamilyContext = {
  family_id: 'f-001',
  ledger_id: 'l-001',
};

describe('services/family · family-context core', () => {
  beforeEach(() => {
    storageMap.clear();
  });

  // T1: setActiveFamily + getActiveFamilyId
  it('T1: setActiveFamily + getActiveFamilyId 写入后能读出', async () => {
    await setActiveFamily(testCtx);
    const familyId = await getActiveFamilyId();
    expect(familyId).toBe('f-001');
  });

  // T2: setActiveFamily + getActiveLedgerId
  it('T2: setActiveFamily + getActiveLedgerId 同 family_id 一致 ledger_id', async () => {
    await setActiveFamily(testCtx);
    const ledgerId = await getActiveLedgerId();
    expect(ledgerId).toBe('l-001');
  });

  // T3: setActiveFamily 时一次性清理旧 key
  it('T3: setActiveFamily 清理 LEGACY_FAMILY_ID_KEY', async () => {
    // 先写旧 key（模拟历史数据残留）
    storageMap.set(LEGACY_FAMILY_ID_KEY, { v: 1, t: Date.now(), d: 'old-family-id' });
    expect(storageMap.has(LEGACY_FAMILY_ID_KEY)).toBe(true);

    await setActiveFamily(testCtx);

    // 旧 key 应被清除
    expect(storageMap.has(LEGACY_FAMILY_ID_KEY)).toBe(false);
    // 新 key 应存在
    const familyId = await getActiveFamilyId();
    expect(familyId).toBe('f-001');
  });

  // T4: getActiveFamilyId 无 storage 返 null
  it('T4: getActiveFamilyId 无 storage 返 null', async () => {
    const familyId = await getActiveFamilyId();
    expect(familyId).toBeNull();
  });

  // T5: clearActiveFamily 后再读
  it('T5: clearActiveFamily 后 family/ledger 都返 null', async () => {
    await setActiveFamily(testCtx);
    expect(await getActiveFamilyId()).toBe('f-001');

    await clearActiveFamily();

    expect(await getActiveFamilyId()).toBeNull();
    expect(await getActiveLedgerId()).toBeNull();
  });

  // T6: storage envelope 一致性
  it('T6: storage envelope 一致性（与 storage.ts L48-56 范式对齐）', async () => {
    await setActiveFamily(testCtx);

    // 直接检查 storageMap 中的 envelope 结构
    const envelope = storageMap.get(FAMILY_CONTEXT_KEY) as { v: number; t: number; d: FamilyContext };
    expect(envelope).toBeDefined();
    expect(envelope.v).toBe(1);
    expect(typeof envelope.t).toBe('number');
    expect(envelope.d).toEqual({ family_id: 'f-001', ledger_id: 'l-001' });
  });
});
