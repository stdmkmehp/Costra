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
//   - 不阻塞主流程：异常仅 logger.warn，不影响首屏跳转、登录跳转
//   - 仅当月：年度数据切换概率低，省一次请求；用户切到年度时再走原 loading 路径
//   - 仅 active family：N>1 账本时切账本会自然触发新预热，不浪费流量
//
// 调用时机：
//   1. app.ts bootstrap 完成后已登录（覆盖：冷启动已登录）
//   2. pages/login/index.ts loginFlow 成功后（覆盖：刚登录 reLaunch 前）

import { getActiveFamilyId } from './family';
import { getMonthlyStatistics } from './statisticsApi';
import { getFamilySummary, getFamilyMembers, primeMembersCache } from './familyApi';
import { getUserOverview } from './userOverviewApi';
import { eventBus, EventNames } from './eventBus';
import { logger } from '../utils/logger';
import { markPerf, markPerfError } from './perf';
import { buildMonthlyView } from '../pages/statistics/viewModels';
import type { MonthlyView } from '../pages/statistics/types';

interface PrefetchedMonthlyView {
  familyId: string;
  month: string;
  view: MonthlyView;
  generatedAt: number;
}

/**
 * 首屏未结算时的兜底等待时长。
 * LEDGER_DISPLAY_READY（成功/失败都会发）通常在数百毫秒内到达；
 * 但仍存在「首屏页根本不是 ledger」「极端异常路径连失败信号都没发」等情况，
 * 这种时候若一直挂在事件上等待，非首屏预热会被永久阻塞。
 * 因此加一个 3s 兜底定时器：超时仍未收到结算信号则直接放行预热。
 */
const PREFETCH_FALLBACK_DELAY_MS = 3000;

let homePrefetchScheduled = false;
let homePrefetchStarted = false;
let ledgerReadyHandler: (() => void) | null = null;
let prefetchFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let prefetchedMonthlyView: PrefetchedMonthlyView | null = null;

/** YYYY-MM（与统计/家庭页 currentMonth 计算逻辑一致） */
function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function consumePrefetchedMonthlyView(familyId: string, month: string): MonthlyView | null {
  if (!prefetchedMonthlyView) return null;
  if (prefetchedMonthlyView.familyId !== familyId || prefetchedMonthlyView.month !== month) return null;
  const view = prefetchedMonthlyView.view;
  prefetchedMonthlyView = null;
  markPerf('prefetch.monthly-view.consume', { familyId, month });
  return view;
}

export function scheduleHomeDataPrefetchAfterLedgerReady(source: 'app-bootstrap' | 'login-success' = 'app-bootstrap'): void {
  if (homePrefetchScheduled || homePrefetchStarted) {
    markPerf('prefetch.schedule.skip', { source, reason: homePrefetchStarted ? 'started' : 'scheduled' });
    return;
  }
  homePrefetchScheduled = true;
  markPerf('prefetch.schedule.after-ledger', { source });

  /**
   * 统一放行入口：无论由 LEDGER_DISPLAY_READY 事件触发，还是 3s 兜底定时器触发，
   * 都收口到这里。内部先清理事件订阅与兜底定时器，再做幂等放行，
   * 保证「事件 / 超时」二者先到先触发、且预热最多只启动一次。
   */
  const release = (reason: 'ledger-ready' | 'fallback-timeout'): void => {
    if (ledgerReadyHandler) {
      eventBus.off(EventNames.LEDGER_DISPLAY_READY, ledgerReadyHandler);
      ledgerReadyHandler = null;
    }
    if (prefetchFallbackTimer) {
      clearTimeout(prefetchFallbackTimer);
      prefetchFallbackTimer = null;
    }
    if (!homePrefetchScheduled) return; // 已被另一路径放行 · 幂等保护
    homePrefetchScheduled = false;
    if (homePrefetchStarted) return;
    homePrefetchStarted = true;
    markPerf('prefetch.schedule.release', { source, reason });
    void prefetchHomeData().finally(() => {
      homePrefetchStarted = false;
    });
  };

  // 首选触发源：明细页首屏结算信号（_emitLedgerDisplayReady 成功/失败都会发）
  ledgerReadyHandler = () => release('ledger-ready');
  eventBus.on(EventNames.LEDGER_DISPLAY_READY, ledgerReadyHandler);

  // 兜底触发源：超时仍未收到结算信号 → 直接放行，避免非首屏预热永久挂起
  prefetchFallbackTimer = setTimeout(() => {
    prefetchFallbackTimer = null;
    release('fallback-timeout');
  }, PREFETCH_FALLBACK_DELAY_MS);
}

/**
 * 预热首屏数据：当月统计 + 当月家庭汇总。
 * 并行触发，全部静默失败；不阻塞调用方。
 *
 * 调用方应包成 `void prefetchHomeData()`，无需 await。
 */
export async function prefetchHomeData(): Promise<void> {
  markPerf('prefetch.after-ledger.start');
  try {
    const familyId = await getActiveFamilyId();
    if (!familyId) {
      markPerf('prefetch.after-ledger.done', { skipped: 'no-family' });
      return;
    }
    const month = getCurrentMonthValue();

    // 并行触发，独立失败：任一接口出错不影响另一个
    // 显式传 topN（与各页面调用对齐，避免缓存命中后字段缺失或排行截断不一致）：
    //   - statistics: topN=50 与 viewModels.L1_VISIBLE 对齐（routes 上限 50）
    //   - family-summary: topN=20 与 family 页 L1_VISIBLE 对齐（routes 上限 20）
    const monthlyTask = getMonthlyStatistics(familyId, month, { topN: 50 }).then((stats) => {
      prefetchedMonthlyView = {
        familyId,
        month,
        // 收入分类排行迭代：buildMonthlyView 新增 prevIncomeList 参数（此处首次构建，空数组）
        view: buildMonthlyView(stats, [], [], month, ''),
        generatedAt: Date.now(),
      };
      markPerf('prefetch.monthly-view.ready', { familyId, month });
    }).catch((err) => {
      logger.warn('prefetch', 'monthly statistics failed', err);
    });
    const summaryTask = getFamilySummary(familyId, { month }, { topN: 20 }).then((summary) => {
      // 复用 summary 返回的 members 数组预热成员缓存，明细页 onShow 时直接命中
      if (summary.members && summary.members.length > 0) {
        primeMembersCache(familyId, summary.members);
      }
    }).catch((err) => {
      logger.warn('prefetch', 'family summary failed', err);
    });
    // 独立预取成员列表（summary 不含 left 成员的完整字段时作为补充）
    const membersTask = getFamilyMembers(familyId).catch((err) => {
      logger.warn('prefetch', 'family members failed', err);
    });
    const overviewTask = getUserOverview().catch((err) => {
      logger.warn('prefetch', 'user overview failed', err);
    });
    await Promise.allSettled([monthlyTask, summaryTask, membersTask, overviewTask]);
    markPerf('prefetch.after-ledger.done', { familyId, month });
  } catch (err) {
    // getActiveFamilyId() 自身出错（storage 异常等）· 静默
    markPerfError('prefetch.after-ledger.failed', err);
    logger.warn('prefetch', 'home data skipped', err);
  }
}

// ─── testing-only 重置 ───────────────────────────────────────────────────────

export const __test__ = {
  reset(): void {
    if (ledgerReadyHandler) {
      eventBus.off(EventNames.LEDGER_DISPLAY_READY, ledgerReadyHandler);
      ledgerReadyHandler = null;
    }
    if (prefetchFallbackTimer) {
      clearTimeout(prefetchFallbackTimer);
      prefetchFallbackTimer = null;
    }
    homePrefetchScheduled = false;
    homePrefetchStarted = false;
    prefetchedMonthlyView = null;
  },
  getScheduled(): boolean {
    return homePrefetchScheduled;
  },
};
