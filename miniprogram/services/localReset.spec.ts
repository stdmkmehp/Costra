// services/localReset.spec.ts · logout 本地全量重置编排单测
// 验证点：
//   1. 全部模块内存缓存清理函数被调用（新增缓存模块漏登记时可被发现）
//   2. 存储层全量重置（clearAllForReset）被调用
//   3. 存储层失败时吞错不 throw（logout 语义必须成功）
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./storage', () => ({ clearAllForReset: vi.fn(async () => undefined) }));
vi.mock('./budgetApi', () => ({ clearBudgetCache: vi.fn() }));
vi.mock('./ledgerBalanceApi', () => ({ clearLedgerBalanceCache: vi.fn() }));
vi.mock('./statisticsApi', () => ({ clearStatisticsCache: vi.fn() }));
vi.mock('./familyApi', () => ({ clearFamilyCaches: vi.fn() }));
vi.mock('./userOverviewApi', () => ({ invalidateUserOverview: vi.fn() }));
vi.mock('./announcementApi', () => ({ invalidateAnnouncementCache: vi.fn() }));

import { resetLocalData } from './localReset';
import { clearAllForReset } from './storage';
import { clearBudgetCache } from './budgetApi';
import { clearLedgerBalanceCache } from './ledgerBalanceApi';
import { clearStatisticsCache } from './statisticsApi';
import { clearFamilyCaches } from './familyApi';
import { invalidateUserOverview } from './userOverviewApi';
import { invalidateAnnouncementCache } from './announcementApi';

describe('services/localReset · resetLocalData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('清空全部模块内存缓存 + 调用存储层全量重置', async () => {
    await resetLocalData();

    expect(clearBudgetCache).toHaveBeenCalledTimes(1);
    expect(clearLedgerBalanceCache).toHaveBeenCalledTimes(1);
    expect(clearStatisticsCache).toHaveBeenCalledTimes(1);
    expect(clearFamilyCaches).toHaveBeenCalledTimes(1);
    expect(invalidateUserOverview).toHaveBeenCalledTimes(1);
    expect(invalidateAnnouncementCache).toHaveBeenCalledTimes(1);
    expect(clearAllForReset).toHaveBeenCalledTimes(1);
  });

  it('存储层重置失败时吞错不 throw（logout 语义必须成功）', async () => {
    vi.mocked(clearAllForReset).mockRejectedValueOnce(new Error('wx.clearStorage failed'));
    await expect(resetLocalData()).resolves.toBeUndefined();
  });
});
