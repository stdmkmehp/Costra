// services/localReset.ts · 本地数据全量重置（logout 流程使用）
//
// 目标：logout 后本地回到「删除小程序重装」的干净状态，修复换账号串数据 / 本地错乱无自救入口。
//
// 两层清理：
//   1. 存储层：wx.clearStorage 全量清空，仅保留设备指纹（DEVICE_FP_KEY），
//      并由 storage.ts 在同一操作内重写版本号（保证 ensureVersion 不变式）。
//      覆盖 db 实体/索引、watermark、outbox、recurring、family-context 及全部持久化缓存——
//      必须全量清而非逐 key 删：数据错乱场景下不能假设「我们知道所有 key」。
//   2. 内存层：各 service 的模块级缓存。wx.reLaunch 不重置 JS 运行时，
//      模块单例存活，必须显式清，否则重新登录后命中上一位用户的陈旧数据。

import { clearAllForReset } from './storage';
import { __test__ as dbInternal } from './db';
import { clearBudgetCache } from './budgetApi';
import { clearLedgerBalanceCache } from './ledgerBalanceApi';
import { clearStatisticsCache } from './statisticsApi';
import { clearFamilyCaches } from './familyApi';
import { invalidateUserOverview } from './userOverviewApi';
import { invalidateAnnouncementCache } from './announcementApi';
import { clearTipCatalogCache } from './tipApi';
import { logger } from '../utils/logger';

/**
 * 全量清理本地数据（存储 + 内存缓存）。
 * 调用时序约束：必须在 clearToken() 之后、wx.reLaunch 之前调用（auth.logout 编排）。
 */
export async function resetLocalData(): Promise<void> {
  // 内存缓存：同步操作不会失败，逐个调用（新增缓存模块时在此登记）
  clearBudgetCache();
  clearLedgerBalanceCache();
  clearStatisticsCache();
  clearFamilyCaches();
  invalidateUserOverview();
  invalidateAnnouncementCache();
  // tips 商品目录模块级镜像（tech-spec v1.2 §7.5 · 持久化部分由下方 clearAllForReset 全量清）
  clearTipCatalogCache();
  // L13 §4.5 纪律 3：R5 月索引写队列是跨账号存活的模块级内存态，logout 必须显式清，
  //   否则上一账号未排空的索引写任务链残留到新会话。
  //   （epoch 记录存 storage，由下方 clearAllForReset 全量清空，无需在此登记。）
  dbInternal.resetIndexQueue();

  // 存储层：全量清空，仅保留设备指纹 + 重写版本号
  try {
    await clearAllForReset();
  } catch (err) {
    // 吞错：logout 语义上必须成功；残留数据由下次 ensureVersion / 全量 pull 兜底
    logger.warn('localReset', 'clearAllForReset failed', err);
  }
}
