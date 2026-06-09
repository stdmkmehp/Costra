// services/family.spec.ts · family-context service 单测
// 卡号: COSTRA-165 / COSTRA-220 · Refs: dispatch §2.1 E 项 T1~T6 + T7~T9
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveFamily, getActiveFamilyId, getActiveLedgerId, clearActiveFamily, getActiveFamilyKind, getActiveLedgerName, fetchAndRestorePreference, switchActiveFamily, flushPendingPreference } from './family';
import { __test__ as familyApiTest } from './familyApi';
import type { FamilyContext } from './family';

const requestMock = vi.hoisted(() => vi.fn());

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

vi.mock('./request', () => ({
  request: requestMock,
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
    requestMock.mockReset();
    familyApiTest.resetCaches();
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

  // T7: getActiveFamilyKind 返回写入的 kind（COSTRA-220）
  it('T7: getActiveFamilyKind 返回写入的 family_kind', async () => {
    await setActiveFamily({ family_id: 'f-002', ledger_id: 'l-002', family_kind: 'shared', ledger_name: '家庭账本' });
    const kind = await getActiveFamilyKind();
    expect(kind).toBe('shared');
  });

  // T8: getActiveFamilyKind 无 kind 返 null（COSTRA-220 降级）
  it('T8: getActiveFamilyKind 无 kind 字段返 null（降级）', async () => {
    await setActiveFamily(testCtx); // 不含 family_kind
    const kind = await getActiveFamilyKind();
    expect(kind).toBeNull();
  });

  // T9: getActiveLedgerName 返回真实名称 + unknown 不误降级为个人账本
  it('T9: getActiveLedgerName 返回真实名称 + unknown 不误降级为个人账本', async () => {
    await setActiveFamily({ family_id: 'f-003', ledger_id: 'l-003', ledger_name: '日常账本' });
    const name = await getActiveLedgerName();
    expect(name).toBe('日常账本');

    // 无 family_kind / ledger_name → unknown，页面应显示加载中而不是个人账本
    await setActiveFamily(testCtx);
    const fallback = await getActiveLedgerName();
    expect(fallback).toBe('');

    await setActiveFamily({ ...testCtx, family_kind: 'personal' });
    expect(await getActiveLedgerName()).toBe('个人账本');
  });

  // T10: getActiveFamilyKind/LedgerName 无 storage 返降级值
  it('T10: getActiveFamilyKind/LedgerName 无 storage 返降级值', async () => {
    const kind = await getActiveFamilyKind();
    expect(kind).toBeNull();

    const name = await getActiveLedgerName();
    expect(name).toBe('');
  });

  it('T11: fetchAndRestorePreference 补全失败时不落盘半残 context', async () => {
    requestMock
      .mockResolvedValueOnce({
        preferred_family_id: 'f-shared',
        preferred_ledger_id: 'l-shared',
      })
      .mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'CLIENT_NETWORK_ERROR', status: 0 }));

    const restored = await fetchAndRestorePreference();

    expect(restored).toBeNull();
    expect(await getActiveFamilyId()).toBeNull();
    expect(await getActiveLedgerId()).toBeNull();
  });

  it('T12: fetchAndRestorePreference 收到完整服务端 context 时落盘', async () => {
    requestMock.mockResolvedValueOnce({
      preferred_family_id: 'f-shared',
      preferred_ledger_id: 'l-shared',
      preferred_family_kind: 'shared',
      preferred_ledger_name: '家庭账本',
      preferred_revision: 123,
      preferred_updated_at: '2026-06-09T00:00:00.000Z',
    });

    const restored = await fetchAndRestorePreference();

    expect(restored).toMatchObject({
      family_id: 'f-shared',
      ledger_id: 'l-shared',
      family_kind: 'shared',
      ledger_name: '家庭账本',
      preference_revision: 123,
    });
    expect(await getActiveLedgerName()).toBe('家庭账本');
  });

  it('T13: switchActiveFamily 服务端保存失败时写 pending preference', async () => {
    requestMock.mockRejectedValue(Object.assign(new Error('network'), { code: 'CLIENT_NETWORK_ERROR', status: 0 }));

    await switchActiveFamily({
      family_id: 'f-shared',
      ledger_id: 'l-shared',
      family_kind: 'shared',
      ledger_name: '家庭账本',
    }, 'ledger-switch');

    await vi.waitFor(() => {
      const pending = storageMap.get('__costra_pending_preference_v1') as { d?: { family_id: string; ledger_id: string } } | undefined;
      expect(pending?.d).toMatchObject({ family_id: 'f-shared', ledger_id: 'l-shared' });
    });
  });

  it('T14: pending preference 旧失败回调不能覆盖新选择', async () => {
    let rejectOld!: (reason?: unknown) => void;
    requestMock
      .mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject; }))
      .mockRejectedValueOnce(Object.assign(new Error('new network'), { code: 'CLIENT_NETWORK_ERROR', status: 0 }));

    await switchActiveFamily({
      family_id: 'f-old',
      ledger_id: 'l-old',
      family_kind: 'shared',
      ledger_name: '旧账本',
    }, 'ledger-switch');
    await switchActiveFamily({
      family_id: 'f-new',
      ledger_id: 'l-new',
      family_kind: 'shared',
      ledger_name: '新账本',
    }, 'ledger-switch');

    await vi.waitFor(() => {
      const pending = storageMap.get('__costra_pending_preference_v1') as { d?: { family_id: string; ledger_id: string; client_revision: number } } | undefined;
      expect(pending?.d).toMatchObject({ family_id: 'f-new', ledger_id: 'l-new' });
    });
    const newerRevision = (storageMap.get('__costra_pending_preference_v1') as { d: { client_revision: number } }).d.client_revision;

    rejectOld(Object.assign(new Error('old network'), { code: 'CLIENT_NETWORK_ERROR', status: 0 }));

    await vi.waitFor(() => {
      const pending = storageMap.get('__costra_pending_preference_v1') as { d?: { family_id: string; ledger_id: string; client_revision: number } } | undefined;
      expect(pending?.d).toMatchObject({ family_id: 'f-new', ledger_id: 'l-new', client_revision: newerRevision });
    });
  });

  it('T15: flush 旧 pending 成功时不能删除并发产生的新 pending', async () => {
    let resolveFlush!: () => void;
    storageMap.set('__costra_pending_preference_v1', {
      v: 1,
      t: Date.now(),
      d: {
        family_id: 'f-old',
        ledger_id: 'l-old',
        client_revision: 1,
        source: 'ledger-switch',
        retry_count: 0,
        updated_at: Date.now(),
      },
    });
    requestMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFlush = resolve; }));

    const flushing = flushPendingPreference();
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    storageMap.set('__costra_pending_preference_v1', {
      v: 1,
      t: Date.now(),
      d: {
        family_id: 'f-new',
        ledger_id: 'l-new',
        client_revision: 2,
        source: 'ledger-switch',
        retry_count: 0,
        updated_at: Date.now(),
      },
    });
    resolveFlush();
    await flushing;

    const pending = storageMap.get('__costra_pending_preference_v1') as { d?: { family_id: string; ledger_id: string; client_revision: number } } | undefined;
    expect(pending?.d).toMatchObject({ family_id: 'f-new', ledger_id: 'l-new', client_revision: 2 });
  });
});
