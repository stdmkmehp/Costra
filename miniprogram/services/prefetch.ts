// services/prefetch.ts · 首屏数据预热（COSTRA-261 性能优化）
//
// 目的：消除登录后第一次切到统计/协作 Tab 的"白屏 → loading → 网络往返 → 渲染"等待感。
//
// 策略：
//   - 在 bootstrap 完成且已登录、或登录成功后，并行预热当月数据
//   - 复用现有 SWR 缓存层（statisticsApi 的 _monthlyCache、familyApi 的 _summaryCache）
//   - 之后用户进入统计/协作页时，getCachedMonthly()/getCachedSummary() 立即命中
//   - 页面 SWR 流程下走 cache-first，立即渲染；后台再异步校准（通常无视觉跳变）
//
// 设计原则：
//   - fire-and-forget：调用方不应等待，全部静默失败
//   - 不阻塞主流程：异常仅 console.warn，不影响首屏跳转、登录跳转
//   - 仅当月：年度数据切换概率低，省一次请求；用户切到年度时再走原 loading 路径
//   - 仅 active family：N>1 账本时切账本会自然触发新预热，不浪费流量
//
// 调用时机：
//   1. app.ts bootstrap 完成后已登录（覆盖：冷启动已登录）
//   2. pages/login/index.ts loginFlow 成功后（覆盖：刚登录 reLaunch 前）

import { getActiveFamilyId } from './family';
import { getMonthlyStatistics } from './statisticsApi';
import { getFamilySummary } from './familyApi';

/** YYYY-MM（与统计/家庭页 currentMonth 计算逻辑一致） */
function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 预热首屏数据：当月统计 + 当月家庭汇总。
 * 并行触发，全部静默失败；不阻塞调用方。
 *
 * 调用方应包成 `void prefetchHomeData()`，无需 await。
 */
export async function prefetchHomeData(): Promise<void> {
  try {
    const familyId = await getActiveFamilyId();
    if (!familyId) return;
    const month = getCurrentMonthValue();

    // 并行触发，独立失败：任一接口出错不影响另一个
    void getMonthlyStatistics(familyId, month).catch((err) => {
      console.warn('[prefetch] monthly statistics failed', err);
    });
    void getFamilySummary(familyId, { month }).catch((err) => {
      console.warn('[prefetch] family summary failed', err);
    });
  } catch (err) {
    // getActiveFamilyId() 自身出错（storage 异常等）· 静默
    console.warn('[prefetch] home data skipped', err);
  }
}
