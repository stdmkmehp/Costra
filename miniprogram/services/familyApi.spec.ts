// services/familyApi.spec.ts · familyApi 短缓存与 in-flight 合并
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFamilies,
  getFamilyMembers,
  createFamily,
  drillDownFamilyL1Entries,
  invalidateFamilyCache,
  invalidateFamiliesCache,
  invalidateFamilyMembersCache,
  __test__,
} from './familyApi';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('./request', () => ({
  request: requestMock,
}));

const family = {
  id: 'family-1',
  name: '家庭账本',
  kind: 'shared' as const,
  owner_id: 'user-1',
  ledger_id: 'ledger-1',
  ledger_name: '家庭账本',
  member_count: 2,
  created_at: '2026-06-09T00:00:00.000Z',
  version: 1,
};

const member = {
  user_id: 'user-1',
  nickname: '成员',
  avatar_url: null,
  role: 'owner' as const,
  status: 'active' as const,
  color_slot: 0,
  joined_at: '2026-06-09T00:00:00.000Z',
  left_at: null,
  personal_expense: 0,
  paid_contribution: 0,
  expense_count: 0,
};

describe('services/familyApi · M1 短缓存与 in-flight 合并', () => {
  beforeEach(() => {
    requestMock.mockReset();
    __test__.resetCaches();
  });

  it('getFamilies 命中短缓存，避免重复请求', async () => {
    requestMock.mockResolvedValueOnce([family]);

    const first = await getFamilies();
    const second = await getFamilies();

    expect(first.families).toEqual([family]);
    expect(second.families).toEqual([family]);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('getFamilies 并发请求复用同一个 in-flight', async () => {
    requestMock.mockResolvedValueOnce([family]);

    const [first, second] = await Promise.all([getFamilies(), getFamilies()]);

    expect(first.families).toEqual([family]);
    expect(second.families).toEqual([family]);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateFamiliesCache 后重新请求', async () => {
    requestMock.mockResolvedValueOnce([family]);
    await getFamilies();
    invalidateFamiliesCache();
    requestMock.mockResolvedValueOnce([{ ...family, id: 'family-2' }]);

    const next = await getFamilies();

    expect(next.families[0].id).toBe('family-2');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('getFamilyMembers 按 familyId 缓存并合并并发', async () => {
    requestMock.mockResolvedValueOnce([member]);

    const [first, second] = await Promise.all([
      getFamilyMembers('family-1'),
      getFamilyMembers('family-1'),
    ]);
    const third = await getFamilyMembers('family-1');

    expect(first).toEqual([member]);
    expect(second).toEqual([member]);
    expect(third).toEqual([member]);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateFamilyMembersCache 可按 familyId 清理', async () => {
    requestMock.mockResolvedValueOnce([member]);
    await getFamilyMembers('family-1');
    invalidateFamilyMembersCache('family-1');
    requestMock.mockResolvedValueOnce([{ ...member, user_id: 'user-2' }]);

    const next = await getFamilyMembers('family-1');

    expect(next[0].user_id).toBe('user-2');
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('createFamily 成功后失效 families 缓存', async () => {
    requestMock.mockResolvedValueOnce([family]);
    await getFamilies();
    requestMock.mockResolvedValueOnce({ ...family, id: 'family-new' });
    await createFamily('新家庭');
    requestMock.mockResolvedValueOnce([{ ...family, id: 'family-new' }]);

    const next = await getFamilies();

    expect(next.families[0].id).toBe('family-new');
    expect(requestMock).toHaveBeenCalledTimes(3);
  });
});

describe('services/familyApi · drillDownFamilyL1Entries 缓存与 key（COSTRA-305）', () => {
  const drillResp = {
    l1_category_id: 'cat-1',
    l1_category_name: '餐饮',
    l1_amount: 8000,
    items: [],
    total_count: 0,
    has_more: false,
  };

  beforeEach(() => {
    requestMock.mockReset();
    __test__.resetCaches();
  });

  it('shared 下钻：query 不含 user_id，相同 key 命中缓存只请求一次', async () => {
    requestMock.mockResolvedValue(drillResp);
    const a = await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'shared' });
    const b = await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'shared' });

    expect(a).toEqual(drillResp);
    expect(b).toEqual(drillResp);
    expect(requestMock).toHaveBeenCalledTimes(1);
    const arg = requestMock.mock.calls[0][0];
    expect(arg.path).toBe('/families/family-1/summary/drill-down');
    expect(arg.query.l1_category_id).toBe('cat-1');
    expect(arg.query.shared_type).toBe('shared');
    expect(arg.query.month).toBe('2026-06');
    expect(arg.query.user_id).toBeUndefined();
  });

  it('personal 下钻：query 携带 user_id', async () => {
    requestMock.mockResolvedValue(drillResp);
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'personal', userId: 'user-2' });
    const arg = requestMock.mock.calls[0][0];
    expect(arg.query.shared_type).toBe('personal');
    expect(arg.query.user_id).toBe('user-2');
  });

  it('month/year/sharedType/userId/limit 变更不误命中缓存', async () => {
    requestMock.mockResolvedValue(drillResp);
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'shared' });
    await drillDownFamilyL1Entries('family-1', { month: '2026-07' }, 'cat-1', { sharedType: 'shared' });
    await drillDownFamilyL1Entries('family-1', { year: '2026' }, 'cat-1', { sharedType: 'shared' });
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'personal', userId: 'u2' });
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'shared', limit: 5 });
    expect(requestMock).toHaveBeenCalledTimes(5);
  });

  it('invalidateFamilyCache 同时清理 drill-down 缓存', async () => {
    requestMock.mockResolvedValue(drillResp);
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'shared' });
    invalidateFamilyCache('family-1');
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'shared' });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('LRU：命中即 touch，淘汰最久未使用项而非最早插入项', async () => {
    requestMock.mockResolvedValue(drillResp);
    // 填满 20 个不同 key（MAX_CACHE_SIZE=20）
    for (let i = 0; i < 20; i++) {
      await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, `cat-${i}`, { sharedType: 'shared' });
    }
    expect(requestMock).toHaveBeenCalledTimes(20);

    // 访问最早插入的 cat-0 → 命中缓存并被 touch 到末尾（不新增请求）
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-0', { sharedType: 'shared' });
    expect(requestMock).toHaveBeenCalledTimes(20);

    // 新增第 21 个 → 淘汰最久未使用（应为 cat-1，而非被 touch 的 cat-0）
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-20', { sharedType: 'shared' });
    expect(requestMock).toHaveBeenCalledTimes(21);

    // cat-0 仍在缓存（命中，不新增）
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-0', { sharedType: 'shared' });
    expect(requestMock).toHaveBeenCalledTimes(21);

    // cat-1 已被淘汰（未命中，新增请求）
    await drillDownFamilyL1Entries('family-1', { month: '2026-06' }, 'cat-1', { sharedType: 'shared' });
    expect(requestMock).toHaveBeenCalledTimes(22);
  });
});
