// services/familyApi.spec.ts · familyApi 短缓存与 in-flight 合并
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getFamilies,
  getFamilyMembers,
  createFamily,
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
  role: 'owner' as const,
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
