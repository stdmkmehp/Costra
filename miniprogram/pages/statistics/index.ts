// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-303 · 消费 pendingStatisticsAction（协作页 L1 跳转后的统计页联动）
// 设计源: docs/design/family-page-tech-spec.md §4.2 / §4.6 / §5.2
// 配套后端: COSTRA-260（统计 API user_id 参数）· 公共组件: trend-line-chart（COSTRA-230）
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts toYuan）
// 前置: COSTRA-302（协作页写入 pendingStatisticsAction）· COSTRA-264（拆分 + swiper height）
// Refs: COSTRA-303

import { getSafeAreaMetrics } from '../../utils/safeArea';
import { scheduleDeferredLoading, type DeferredLoadingHandle } from '../../utils/deferredLoading';
import {
  getActiveFamilyId,
  getActiveLedgerId,
  getActiveLedgerName,
  getActiveFamilyKind,
  switchActiveFamily,
  fallbackToPersonalFamily,
} from '../../services/family';
import { triggerOnPageShow, syncOnce } from '../../services/syncScheduler';
import { eventBus, EventNames, type SyncDonePayload, type ActiveFamilyChangedPayload, type ProfileUpdatedPayload } from '../../services/eventBus';
import { hasValidSession, getToken } from '../../services/auth';
import { logger } from '../../utils/logger';
import { getFamilies, getFamilyMembers, type FamilyItem } from '../../services/familyApi';
import {
  getMonthlyStatistics,
  getYearlyStatistics,
  drillDownLevel2,
  drillDownLevel3,
  getCachedMonthly,
  getCachedYearly,
  invalidateStatisticsCache,
  type MonthlyStatistics,
  type YearlyStatistics,
  type DrillDownLevel2Response,
  type DrillDownLevel3Response,
  type DrillDownEntryItem,
} from '../../services/statisticsApi';
import type {
  MemberKey,
  MemberTabItem,
  MonthlyView,
  YearlyView,
  SummaryGridItem,
  L1Display,
  L2Display,
  L3Display,
  MonthRow,
} from './types';
import {
  fmtYuan,
  fmtRatio,
  getCurrentMonthValue,
  getCurrentYearValue,
  formatMonthDisplay,
  formatYearDisplay,
  prevMonth,
  nextMonth,
  prevYear,
  nextYear,
  formatEntryDate,
  formatEntryTime,
  buildEmptyTitleYear,
} from './formatters';
import { pickRandomSlogan } from '../../config/slogans';
import { consumePrefetchedMonthlyView } from '../../services/prefetch';
import {
  L1_VISIBLE,
  L2_VISIBLE,
  L3_VISIBLE,
  emptyMonthlyView,
  emptyYearlyView,
  getInitialSwiperHeightPx,
  buildL1Display,
  buildMonthlyView,
  buildYearlyTrendChartMeta,
} from './viewModels';
import { makeAllTab, buildMemberTabs } from './memberHelpers';
import type { PendingStatisticsAction } from '../family/index';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
  globalData: {
    pendingStatisticsAction?: PendingStatisticsAction | null;
  };
}

Page({
  data: {
    ready: false,
    statusBarHeight: 0,
    navBarHeight: 44,
    ledgerName: '个人账本',
    familyKind: 'personal' as 'personal' | 'shared',
    dimension: 'monthly' as 'monthly' | 'yearly',
    currentMonth: getCurrentMonthValue(),
    currentYear: getCurrentYearValue(),
    monthDisplay: '',
    yearDisplay: '',
    loading: true,
    memberTabs: [] as MemberTabItem[],
    memberTabIndex: 0,
    memberScrollIntoView: '',
    currentMemberKey: 'all' as MemberKey,
    memberSwiperHeightPx: getInitialSwiperHeightPx(),
    memberSwiperDuration: 240,
    memberPaneScrollTops: {} as Record<string, number>,
    monthlyByMember: {} as Record<MemberKey, MonthlyView>,
    yearlyByMember: {} as Record<MemberKey, YearlyView>,
    isEmpty: false,
  },

  _familyId: '' as string,
  _ledgerId: '' as string,
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,
  _entrySavedHandler: null as (() => void) | null,
  _entryUpdatedHandler: null as (() => void) | null,
  _activeFamilyChangedHandler: null as ((payload?: unknown) => void) | null,
  _profileUpdatedHandler: null as ((payload?: unknown) => void) | null,
  _loadingPromise: null as Promise<void> | null,

  _initialized: false,
  _memberPaneScrollTops: {} as Record<string, number>,
  _lastPaneScrollSetDataAt: 0,

  /**
   * Deferred-loading 句柄表（key = `${memberKey}::${l1Id}` 或 `${memberKey}::${l1Id}::${l2Id}`）。
   * "点击下钻 → loading 文案" 不立即写入，等 LOADING_DELAY_MS 仍未拿到数据再显示。
   * 数据到达 / 错误 / 用户主动收起 / 视图失效 / onUnload 任意路径都必须 cancel，
   * 并据 handle.fired 决定是否需要写回 loading:false（未 fired 则全程不写 loading 字段）。
   */
  _deferredLoadingHandles: {} as Record<string, DeferredLoadingHandle>,

  // ─── 生命周期 ──────────────────────────────────────────────────────────────

  onLoad() {
    const m = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: m.statusBarHeight,
      navBarHeight: m.navBarHeight,
      memberSwiperHeightPx: Math.max(320, m.windowHeight - m.navBarTotalHeight - 110),
      monthDisplay: formatMonthDisplay(this.data.currentMonth),
      yearDisplay: formatYearDisplay(this.data.currentYear),
    });

    // SYNC_DONE 订阅 · 失效缓存 + 重拉
    const syncHandler = (payload?: unknown) => {
      const p = payload as SyncDonePayload | undefined;
      if (!p) return;
      if (p.pulled <= 0 && p.pushed <= 0) return;
      void this._onSyncDone();
    };
    this._syncDoneHandler = syncHandler;
    eventBus.on(EventNames.SYNC_DONE, syncHandler);

    // 记账保存后即时刷新
    const savedHandler = () => { void this._onSyncDone(); };
    this._entrySavedHandler = savedHandler;
    eventBus.on(EventNames.ENTRY_SAVED, savedHandler);

    // 条目编辑保存后即时刷新
    const updatedHandler = () => { void this._onSyncDone(); };
    this._entryUpdatedHandler = updatedHandler;
    eventBus.on(EventNames.ENTRY_UPDATED, updatedHandler);

    // ★ 2026-06-08：订阅 ACTIVE_FAMILY_CHANGED · 跨 Tab 同步切账本
    // 设计意图：让常驻 Tab 页（_initialized=true reShow 短路路径）也能即时响应
    // 自身 onTapLedgerName 已就地刷新到目标 family/ledger，事件到达时 ID 比对会自然 noop。
    const activeFamilyChangedHandler = (payload?: unknown) => {
      const p = payload as ActiveFamilyChangedPayload | undefined;
      if (!p) return;
      void this._onActiveFamilyChanged(p);
    };
    this._activeFamilyChangedHandler = activeFamilyChangedHandler;
    eventBus.on(EventNames.ACTIVE_FAMILY_CHANGED, activeFamilyChangedHandler);

    // 画像变更后即时刷新 memberTabs 中当前用户的头像和昵称
    const profileUpdatedHandler = (payload?: unknown) => {
      const p = payload as ProfileUpdatedPayload | undefined;
      if (!p) return;
      const currentUserId = getToken()?.raw?.user?.id || '';
      if (!currentUserId) return;
      const tabs = this.data.memberTabs;
      const idx = tabs.findIndex((t) => t.key === currentUserId);
      if (idx >= 0) {
        const updated = [...tabs];
        updated[idx] = { ...updated[idx], avatarUrl: p.avatarUrl || '', label: p.nickname || updated[idx].label };
        this.setData({ memberTabs: updated });
      }
    };
    this._profileUpdatedHandler = profileUpdatedHandler;
    eventBus.on(EventNames.PROFILE_UPDATED, profileUpdatedHandler);

    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
      }
    });
  },

  onShow() {
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(async () => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      (this.getTabBar?.() as { markActive?: (idx: number) => void } | undefined)?.markActive?.(1);
      triggerOnPageShow('statistics');

      // ★ COSTRA-303：读取 pending action（首次/再次都读，协作页可能在已初始化后写入）
      const hasPending = !!app.globalData.pendingStatisticsAction;

      // 再次切回 Tab：DOM 已存在，不再 setData(loading) / 不重建 memberTabs / 不重置 swiper 高度，
      // WebView 持有原 scroll 位置，用户看到的就是离开时的画面。
      // 数据新鲜度由 SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED 事件链路兜底。
      if (this._initialized) {
        if (hasPending) {
          // 有 pending：必须重建数据状态（dim/month/member 可能都变了）
          await this._consumePendingAction();
          this._scheduleMeasureCurrentPane('reShow-pending-consumed');
        } else {
          // 无 pending：保留现有"不重建 DOM"路径
          this._scheduleMeasureCurrentPane('reShow');
        }
        return;
      }

      this._initialized = true;
      this.setData({ ready: true, loading: true });
      await this._loadContext();
      const consumedPrefetch = this._consumePrefetchedMonthlyView();
      await this._loadData();
      if (consumedPrefetch) {
        void this._refreshMonthlyForMember('all');
      }

      // ★ 首次进入也消费 pending（用户从协作页 L1 跳进来时统计页可能首次初始化）
      if (hasPending) {
        await this._consumePendingAction();
      }
    });
  },

  onUnload() {
    if (this._syncDoneHandler) {
      eventBus.off(EventNames.SYNC_DONE, this._syncDoneHandler);
      this._syncDoneHandler = null;
    }
    if (this._entrySavedHandler) {
      eventBus.off(EventNames.ENTRY_SAVED, this._entrySavedHandler);
      this._entrySavedHandler = null;
    }
    if (this._entryUpdatedHandler) {
      eventBus.off(EventNames.ENTRY_UPDATED, this._entryUpdatedHandler);
      this._entryUpdatedHandler = null;
    }
    if (this._activeFamilyChangedHandler) {
      eventBus.off(EventNames.ACTIVE_FAMILY_CHANGED, this._activeFamilyChangedHandler);
      this._activeFamilyChangedHandler = null;
    }
    if (this._profileUpdatedHandler) {
      eventBus.off(EventNames.PROFILE_UPDATED, this._profileUpdatedHandler);
      this._profileUpdatedHandler = null;
    }
    // INV-2：onUnload 路径必须 cancel 所有 in-flight deferred handle，避免 page 销毁后 setData 报错
    this._cancelAllDeferredLoadingHandles();
  },

  // ─── Deferred loading 工具方法 ──────────────────────────────────────────

  /**
   * 启动一次按 key 隔离的 deferred loading。
   * 若同 key 已有 in-flight handle，先 cancel 它（INV-1：同节点同时只允许一个 timer）。
   */
  _startDeferredLoading(key: string, onFire: () => void): void {
    const existing = this._deferredLoadingHandles[key];
    if (existing) existing.cancel();
    this._deferredLoadingHandles[key] = scheduleDeferredLoading(onFire);
  },

  /**
   * 取消并消费一个 deferred loading handle。
   * @returns 该 handle 是否已经 fire 过（决定 settle 时是否需要写 loading:false）。
   *          若 key 上没有 handle，返回 false。
   */
  _consumeDeferredLoading(key: string): boolean {
    const handle = this._deferredLoadingHandles[key];
    if (!handle) return false;
    handle.cancel();
    const fired = handle.fired;
    delete this._deferredLoadingHandles[key];
    return fired;
  },

  /** 取消所有 in-flight deferred loading handle（onUnload / 视图全清场景使用） */
  _cancelAllDeferredLoadingHandles(): void {
    for (const key in this._deferredLoadingHandles) {
      this._deferredLoadingHandles[key].cancel();
    }
    this._deferredLoadingHandles = {};
  },

  // ─── 数据加载 ──────────────────────────────────────────────────────────────

  async _loadContext() {
    const [familyId, ledgerId, ledgerName, familyKind] = await Promise.all([
      getActiveFamilyId(),
      getActiveLedgerId(),
      getActiveLedgerName(),
      getActiveFamilyKind(),
    ]);
    this._familyId = familyId || '';
    this._ledgerId = ledgerId || '';
    let effectiveFamilyKind = familyKind;
    let displayLedgerName = ledgerName || (familyKind === 'personal' ? '个人账本' : '账本待同步');

    if (familyKind === 'shared' && familyId) {
      try {
        const { families } = await getFamilies();
        const matched = families.find((f) => f.id === familyId && f.ledger_id === ledgerId);
        if (!matched) {
          const fallback = await fallbackToPersonalFamily('ledger-switch');
          if (fallback) {
            this._familyId = fallback.family_id;
            this._ledgerId = fallback.ledger_id;
            effectiveFamilyKind = fallback.family_kind || 'personal';
            displayLedgerName = fallback.ledger_name || '个人账本';
          }
          wx.showToast({ title: '你已不在该账本中', icon: 'none' });
        } else {
          displayLedgerName = matched.ledger_name || matched.name || displayLedgerName;
        }
      } catch {
        displayLedgerName = ledgerName ? `${ledgerName}（离线）` : '协作账本（离线）';
      }
    }

    this.setData({
      ledgerName: displayLedgerName,
      familyKind: effectiveFamilyKind || 'personal',
    });

    // 构建 memberTabs
    if (effectiveFamilyKind === 'shared' && this._familyId) {
      try {
        const members = await getFamilyMembers(this._familyId);
        const tabs = buildMemberTabs(members);
        this.setData({
          memberTabs: tabs,
          memberTabIndex: 0,
          currentMemberKey: tabs[0]?.key ?? 'all',
          memberScrollIntoView: 'mtab-0',
        });
      } catch {
        this.setData({
          memberTabs: [makeAllTab()],
          memberTabIndex: 0,
          currentMemberKey: 'all',
        });
      }
    } else {
      this.setData({
        memberTabs: [makeAllTab()],
        memberTabIndex: 0,
        currentMemberKey: 'all',
      });
    }

    // 成员列表重建后重置 swiper 高度状态（COSTRA-264 P1 修复）
    this._resetMemberSwiperHeightState('loadContext');
  },

  async _loadData() {
    if (this._loadingPromise) return this._loadingPromise;
    this._loadingPromise = this._doLoadData();
    try { await this._loadingPromise; }
    finally { this._loadingPromise = null; }
  },

  async _doLoadData() {
    if (!this._familyId) {
      this.setData({ loading: false, isEmpty: true });
      return;
    }
    const memberKey = this._getCurrentMemberKey();
    await this._ensureMemberLoaded(memberKey);
    this.setData({ loading: false }, () => { this._settleSwiperHeight('loadData'); });
  },

  /** 获取当前选中的 memberKey */
  _getCurrentMemberKey(): MemberKey {
    return this.data.currentMemberKey || 'all';
  },

  _monthlyViewSignature(view: MonthlyView): string {
    return JSON.stringify({
      totalExpense: view.totalExpense,
      totalIncome: view.totalIncome,
      totalBalance: view.totalBalance,
      trend: view.trend,
      chartMeta: view.chartMeta,
      summary: view.summary,
      l1: view.l1.map((item) => ({
        category_id: item.category_id,
        amountCents: item.amountCents,
        ratio_bps: item.ratio_bps,
      })),
      isEmpty: view.isEmpty,
    });
  },

  _consumePrefetchedMonthlyView(): boolean {
    const view = consumePrefetchedMonthlyView(this._familyId, this.data.currentMonth);
    if (!view) return false;
    const memberKey: MemberKey = 'all';
    this.setData({
      [`monthlyByMember.${memberKey}`]: view,
      currentMemberKey: memberKey,
      isEmpty: view.isEmpty,
      loading: false,
    }, () => {
      this._scheduleMeasureCurrentPane('prefetchedMonthly');
    });
    return true;
  },

  async _refreshMonthlyForMember(memberKey: MemberKey) {
    const month = this.data.currentMonth;
    const userId = memberKey === 'all' ? undefined : memberKey;
    try {
      const fresh = await getMonthlyStatistics(this._familyId, month, { userId, topN: L1_VISIBLE });
      this._buildMonthlyDisplay(fresh, memberKey);
    } catch (err) {
      logger.warn('statistics', 'refreshMonthly failed', err);
    }
  },

  /** 懒加载：如果该成员在当前维度还没 loaded 过则拉数据 */
  async _ensureMemberLoaded(memberKey: MemberKey) {
    if (this.data.dimension === 'monthly') {
      const view = this.data.monthlyByMember[memberKey];
      if (view && view.loaded) return;
      await this._loadMonthlyForMember(memberKey);
    } else {
      const view = this.data.yearlyByMember[memberKey];
      if (view && view.loaded) return;
      await this._loadYearlyForMember(memberKey);
    }
  },

  async _loadMonthlyForMember(memberKey: MemberKey) {
    const month = this.data.currentMonth;
    const userId = memberKey === 'all' ? undefined : memberKey;

    const cached = getCachedMonthly(this._familyId, month, userId);
    if (cached) {
      this._buildMonthlyDisplay(cached, memberKey);
      void this._refreshMonthlyForMember(memberKey);
      return;
    }

    const viewInit = this.data.monthlyByMember[memberKey] || emptyMonthlyView();
    viewInit.loading = true;
    this.setData({ [`monthlyByMember.${memberKey}`]: viewInit });

    try {
      const fresh = await getMonthlyStatistics(this._familyId, month, { userId, topN: L1_VISIBLE });
      this._buildMonthlyDisplay(fresh, memberKey);
    } catch (err) {
      logger.error('statistics', 'loadMonthly failed', err);
      this.setData({
        [`monthlyByMember.${memberKey}.loading`]: false,
        [`monthlyByMember.${memberKey}.loaded`]: true,
      });
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  async _loadYearlyForMember(memberKey: MemberKey) {
    const year = this.data.currentYear;
    const userId = memberKey === 'all' ? undefined : memberKey;

    const viewInit = this.data.yearlyByMember[memberKey] || emptyYearlyView();
    viewInit.loading = true;
    this.setData({ [`yearlyByMember.${memberKey}`]: viewInit });

    const cached = getCachedYearly(this._familyId, year, userId);
    if (cached) {
      this._buildYearlyDisplay(cached, memberKey);
    }

    try {
      const fresh = await getYearlyStatistics(this._familyId, year, { userId, topN: L1_VISIBLE });
      this._buildYearlyDisplay(fresh, memberKey);
    } catch (err) {
      logger.error('statistics', 'loadYearly failed', err);
      this.setData({
        [`yearlyByMember.${memberKey}.loading`]: false,
        [`yearlyByMember.${memberKey}.loaded`]: true,
      });
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  // ─── 月度展示构建 ──────────────────────────────────────────────────────────

  _buildMonthlyDisplay(s: MonthlyStatistics, memberKey: MemberKey) {
    const prevView = this.data.monthlyByMember[memberKey];
    const prevList = prevView?.l1 ?? [];
    const viewData = buildMonthlyView(
      s,
      prevList,
      this.data.currentMonth,
      pickRandomSlogan(),
    );

    if (prevView && this._monthlyViewSignature(prevView) === this._monthlyViewSignature(viewData)) {
      const update: Record<string, unknown> = {};
      if (prevView.loading) update[`monthlyByMember.${memberKey}.loading`] = false;
      if (!prevView.loaded) update[`monthlyByMember.${memberKey}.loaded`] = true;
      if (memberKey === this._getCurrentMemberKey() && this.data.loading) update.loading = false;
      if (Object.keys(update).length > 0) this.setData(update);
      return;
    }

    const update: Record<string, unknown> = {
      [`monthlyByMember.${memberKey}`]: viewData,
    };
    if (memberKey === this._getCurrentMemberKey()) {
      update.isEmpty = viewData.isEmpty;
      update.loading = false;
    }
    this.setData(update, () => {
      if (memberKey === this._getCurrentMemberKey()) {
        this._scheduleMeasureCurrentPane('buildMonthly');
      }
      // 2026-06-08：buildL1Display 已把脏 L1 的 l2Items 清空且保留 expanded，
      // 此时对 expanded 节点 fire-and-forget 重拉 L2/L3 子树，做到"金额+下钻"全链路同步。
      this._refreshExpandedSubtreesIfNeeded(memberKey);
    });
  },

  // ─── 年度展示构建 ──────────────────────────────────────────────────────────

  _buildYearlyDisplay(s: YearlyStatistics, memberKey: MemberKey) {
    const { totals, monthly_trend, extremes, category_ranks } = s;

    const summary: SummaryGridItem[] = [
      { label: '月均支出', value: fmtYuan(extremes.avg_monthly_expense) },
      { label: '年度最大单笔', value: fmtYuan(extremes.max_single_expense) },
      { label: '单月最高', value: extremes.max_month_label
        ? `${fmtYuan(extremes.max_month_expense)} · ${extremes.max_month_label}`
        : fmtYuan(extremes.max_month_expense) },
      { label: '全年最贵分类', value: extremes.top_category_name
        ? `${extremes.top_category_name} · ${fmtYuan(extremes.top_category_amount)}`
        : '—' },
    ];

    const months: MonthRow[] = monthly_trend.map((mt) => ({
      month: mt.month,
      label: `${mt.month}月`,
      expense: fmtYuan(mt.expense),
      income: fmtYuan(mt.income),
      balance: fmtYuan(mt.balance),
      isEmpty: mt.expense === 0 && mt.income === 0,
    }));

    const prevList = this.data.yearlyByMember[memberKey]?.l1 ?? [];
    const l1: L1Display[] = category_ranks
      .slice(0, L1_VISIBLE)
      .map((c) => buildL1Display(c, prevList));

    const isEmpty = totals.expense === 0 && totals.income === 0;
    const viewData: YearlyView = {
      totalExpense: fmtYuan(totals.expense),
      totalIncome: fmtYuan(totals.income),
      totalBalance: fmtYuan(totals.balance),
      trend: monthly_trend.map((m) => m.expense),
      chartMeta: buildYearlyTrendChartMeta(this.data.currentYear, monthly_trend),
      summary,
      months,
      l1,
      isEmpty,
      loading: false,
      loaded: true,
      emptyTitle: buildEmptyTitleYear(this.data.currentYear),
      emptyHint: isEmpty ? pickRandomSlogan() : '',
    };

    const update: Record<string, unknown> = {
      [`yearlyByMember.${memberKey}`]: viewData,
    };
    if (memberKey === this._getCurrentMemberKey()) {
      update.isEmpty = viewData.isEmpty;
      update.loading = false;
    }
    this.setData(update, () => {
      if (memberKey === this._getCurrentMemberKey()) {
        this._scheduleMeasureCurrentPane('buildYearly');
      }
      // 2026-06-08：年度同月度逻辑（见 _buildMonthlyDisplay 注释）
      this._refreshExpandedSubtreesIfNeeded(memberKey);
    });
  },

  // ─── SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED 响应式刷新 ─────────────────────

  async _onSyncDone() {
    if (!this._familyId) return;
    if (this._loadingPromise) return;
    invalidateStatisticsCache(this._familyId);
    this._invalidateAllDimViews();
    await this._loadData();
  },

  /**
   * ACTIVE_FAMILY_CHANGED（非自身触发）响应处理
   * 设计意图：等价于 onTapLedgerName 的本地切换路径，但触发方在外部。
   * 仅在页面已初始化时执行（_initialized=false 时 onShow 会自然走完整路径）。
   */
  async _onActiveFamilyChanged(payload: ActiveFamilyChangedPayload) {
    if (!this._initialized) return;
    if (this._familyId === payload.family_id && this._ledgerId === payload.ledger_id) return;

    // 释放旧家庭统计缓存（避免跨家庭 key 占用 + 与切月/切账本路径行为对齐）
    if (this._familyId) invalidateStatisticsCache(this._familyId);

    this._familyId = payload.family_id;
    this._ledgerId = payload.ledger_id;
    this._resetMemberSwiperHeightState('activeFamilyChanged');
    this._clearMemberScrollMemory();
    // INV-2：切账本后旧 family 的 in-flight deferred handle 已无意义，全部 cancel
    this._cancelAllDeferredLoadingHandles();
    this.setData({
      ledgerName: payload.ledger_name,
      familyKind: payload.family_kind,
      monthlyByMember: {},
      yearlyByMember: {},
      memberTabIndex: 0,
      currentMemberKey: 'all',
      loading: true,
    });
    await this._loadContext();
    await this._loadData();
  },

  /**
   * 失效**两个维度**所有成员视图（数据变更场景：SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED）。
   *
   * 2026-06-30 跨维度失效：一笔记录天然同时影响其所在月份的月度数据与所在年份的年度数据，
   *   因此数据变更必须同时失效 monthlyByMember 与 yearlyByMember，而非仅当前维度。
   *   - 当前维度：标 loaded=false 后由紧随其后的 _loadData() 立即重拉。
   *   - 另一维度：标 loaded=false，等用户切过去时由 _ensureMemberLoaded 自然重拉。
   *   （区别于 _clearCurrentDimViews：切月/切年是 scope 变更，只影响当前维度，故只清当前维度。）
   *
   * 2026-06-08 子树脏标记机制：
   *   - view.loaded=false：触发 _ensureMemberLoaded 重拉 L1。
   *   - 每个 L1 节点 subtreeStale=true：buildL1Display 合并时清空 l2Items 让自动重拉。
   *   - 每个嵌套 L2 节点 subtreeStale=true：onTapL2 在 stale 时强制重拉 L3。
   * 不清空 view 本身（保留 expanded 等用户展开态体验）。
   */
  _invalidateAllDimViews() {
    const update: Record<string, unknown> = {};
    for (const byMemberKey of ['monthlyByMember', 'yearlyByMember'] as const) {
      const byMember = this.data[byMemberKey] as Record<MemberKey, MonthlyView | YearlyView>;
      for (const mk of Object.keys(byMember)) {
        const view = byMember[mk];
        if (!view) continue;
        update[`${byMemberKey}.${mk}.loaded`] = false;
        // 标记 L1 子树及嵌套 L2 子树为 stale（保留 expanded · 仅清数据）
        const stalifiedL1 = view.l1.map<L1Display>((l1) => ({
          ...l1,
          subtreeStale: true,
          l2Items: l1.l2Items.map<L2Display>((l2) => ({ ...l2, subtreeStale: true })),
        }));
        update[`${byMemberKey}.${mk}.l1`] = stalifiedL1;
      }
    }
    if (Object.keys(update).length > 0) {
      this.setData(update);
    }
    // INV-2：视图失效后所有 in-flight deferred handle 都已无意义。
    // 接下来 _refreshExpandedSubtreesIfNeeded 会重新发起 _loadL2/_loadL3 并各自启动新 handle。
    this._cancelAllDeferredLoadingHandles();
  },

  // ─── 交互：时间维度 ────────────────────────────────────────────────────────

  onPrevTime() {
    if (this.data.dimension === 'monthly') {
      const prev = prevMonth(this.data.currentMonth);
      this.setData({ currentMonth: prev, monthDisplay: formatMonthDisplay(prev) });
    } else {
      const prev = prevYear(this.data.currentYear);
      this.setData({ currentYear: prev, yearDisplay: formatYearDisplay(prev) });
    }
    this._clearCurrentDimViews();
    void this._loadData();
  },

  onNextTime() {
    if (this.data.dimension === 'monthly') {
      const nxt = nextMonth(this.data.currentMonth);
      this.setData({ currentMonth: nxt, monthDisplay: formatMonthDisplay(nxt) });
    } else {
      const nxt = nextYear(this.data.currentYear);
      this.setData({ currentYear: nxt, yearDisplay: formatYearDisplay(nxt) });
    }
    this._clearCurrentDimViews();
    void this._loadData();
  },

  onMonthChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    this.setData({ currentMonth: value, monthDisplay: formatMonthDisplay(value) });
    this._clearCurrentDimViews();
    void this._loadData();
  },

  onYearChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    const y = value.split('-')[0] || value;
    this.setData({ currentYear: y, yearDisplay: formatYearDisplay(y) });
    this._clearCurrentDimViews();
    void this._loadData();
  },

  /** Scope 变更（切月份 / 切年份）场景：全清当前维度所有成员视图与成员内滚动位置。 */
  _clearCurrentDimViews() {
    if (this.data.dimension === 'monthly') {
      this.setData({ monthlyByMember: {} });
    } else {
      this.setData({ yearlyByMember: {} });
    }
    this._resetMemberSwiperHeightState('clearDimViews');
    this._clearMemberScrollMemory();
    // INV-2：scope 变更后旧维度的 deferred handle 不再有效，全部 cancel。
    this._cancelAllDeferredLoadingHandles();
  },

  onSwitchDimension(e: WechatMiniprogram.TouchEvent) {
    const dim = (e.currentTarget.dataset as Record<string, string>).dim as 'monthly' | 'yearly';
    if (dim === this.data.dimension) return;
    this._resetMemberSwiperHeightState('switchDim');
    this._clearMemberScrollMemory();
    this.setData({ dimension: dim }, () => {
      this._scheduleMeasureCurrentPane('switchDim');
    });
    void this._ensureMemberLoaded(this._getCurrentMemberKey());
  },

  // ─── 交互：年度月度行点击 → 切回月度 ─────────────────────────────────────

  onTapYearlyMonth(e: WechatMiniprogram.TouchEvent) {
    const month = (e.currentTarget.dataset as Record<string, number>).month as number;
    if (!month) return;
    const monthValue = `${this.data.currentYear}-${String(month).padStart(2, '0')}`;
    this._resetMemberSwiperHeightState('tapYearlyMonth');
    this._clearMemberScrollMemory();
    this.setData({
      dimension: 'monthly',
      currentMonth: monthValue,
      monthDisplay: formatMonthDisplay(monthValue),
      monthlyByMember: {},
    });
    void this._loadData();
  },

  // ─── 交互：成员切换 + 成员内滚动 ───────────────────────────────────────────

  onTapMemberTab(e: WechatMiniprogram.TouchEvent) {
    const idx = parseInt((e.currentTarget.dataset as Record<string, string>).index, 10);
    if (Number.isNaN(idx) || idx === this.data.memberTabIndex) return;
    const tab = this.data.memberTabs[idx];
    if (!tab) return;
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const targetView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][tab.key];
    const update: Record<string, unknown> = { memberSwiperDuration: 0, memberTabIndex: idx, currentMemberKey: tab.key, memberScrollIntoView: `mtab-${idx}` };
    if (!targetView || !targetView.loaded) {
      const emptyView = this.data.dimension === 'monthly' ? emptyMonthlyView() : emptyYearlyView();
      emptyView.loading = true;
      update[`${dimKey}.${tab.key}`] = emptyView;
    }
    this.setData(update, () => {
      void this._ensureMemberLoaded(tab.key);
      setTimeout(() => this.setData({ memberSwiperDuration: 240 }), 50);
    });
  },

  onMemberSwiperChange(e: WechatMiniprogram.SwiperChange) {
    const idx = e.detail.current;
    if (idx === this.data.memberTabIndex) return;
    const tab = this.data.memberTabs[idx];
    if (!tab) return;
    this.setData({ memberTabIndex: idx, currentMemberKey: tab.key, memberScrollIntoView: `mtab-${idx}` }, () => {
      void this._ensureMemberLoaded(tab.key);
    });
  },

  _buildMemberSwitchUpdate(idx: number, memberKey: MemberKey, tap: boolean): Record<string, unknown> {
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const targetView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
    const update: Record<string, unknown> = {
      memberTabIndex: idx,
      currentMemberKey: memberKey,
      memberScrollIntoView: `mtab-${idx}`,
      [`memberPaneScrollTops.${memberKey}`]: this._memberPaneScrollTops[memberKey] || 0,
    };
    if (tap) update.memberSwiperDuration = 0;
    if (!targetView || !targetView.loaded) {
      const emptyView = this.data.dimension === 'monthly' ? emptyMonthlyView() : emptyYearlyView();
      emptyView.loading = true;
      update[`${dimKey}.${memberKey}`] = emptyView;
    }
    return update;
  },

  onMemberPaneScroll(e: WechatMiniprogram.ScrollViewScroll) {
    const memberKey = (e.currentTarget.dataset as Record<string, string>).memberkey;
    if (!memberKey) return;
    this._memberPaneScrollTops[memberKey] = e.detail.scrollTop || 0;
  },

  _clearMemberScrollMemory() {
    this._memberPaneScrollTops = {};
    this.setData({ memberPaneScrollTops: {} });
  },

  // ─── 交互：L1 一级分类展开 ─────────────────────────────────────────────────

  async onTapL1(e: WechatMiniprogram.TouchEvent) {
    const dataset = e.currentTarget.dataset as Record<string, string>;
    const id = dataset.id;
    const memberKey = dataset.memberkey || this._getCurrentMemberKey();
    if (!id) return;
    await this._handleL1Tap(memberKey, id);
  },

  /**
   * L1 展开/收起核心逻辑（程序可调）。
   * @param silent 为 true 时 catch 块不弹 toast（程序触发场景避免无意义提示）
   */
  async _handleL1Tap(memberKey: string, l1Id: string, silent: boolean = false) {
    if (!l1Id || !memberKey) return;

    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const view = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
    if (!view) return;
    const idx = view.l1.findIndex((l) => l.category_id === l1Id);
    if (idx < 0) return;
    const item = view.l1[idx];
    // A1：仅写最小数据路径，避免整列 read-modify-write 引发并发覆盖 / 整表重渲染吞点击
    const base = `${dimKey}.${memberKey}.l1[${idx}]`;
    const deferredKey = `${memberKey}::${l1Id}`;

    if (item.expanded) {
      // 收起：cancel 任何 in-flight deferred handle（INV-2），同时清 loadingL2 兜底既有显示
      const wasFired = this._consumeDeferredLoading(deferredKey);
      const update: Record<string, unknown> = { [`${base}.expanded`]: false };
      // 仅当 loading 已经显示或可能显示过时才写 false（未 fire 的 deferred 路径下省一次 setData）
      if (wasFired || item.loadingL2) update[`${base}.loadingL2`] = false;
      this.setData(update, () => {
        this._scheduleMeasureCurrentPane('l1-collapse');
      });
      return;
    }

    // 2026-06-08：脏标记下绕过缓存早返回，强制重拉
    const cacheUsable = item.l2Items.length > 0 && !item.subtreeStale;
    if (cacheUsable) {
      this.setData({ [`${base}.expanded`]: true }, () => {
        this._scheduleMeasureCurrentPane('l1-expand-cached');
      });
      return;
    }

    // ─── deferred loading 路径 ───
    // 立即写 expanded:true（用户操作必须立即反馈）+ subtreeStale:false，但**不写 loadingL2**。
    // 启动 LOADING_DELAY_MS 定时器：到点未 settle 才显示"加载中..."。
    // 数据先到则 cancel handle 让 loading 永不出现（COSTRA-304 防闪）。
    this.setData({
      [`${base}.expanded`]: true,
      [`${base}.subtreeStale`]: false,
    });

    this._startDeferredLoading(deferredKey, () => {
      // INV-3 自校验：fire 时检查节点仍存在 + expanded 仍为 true（用户没收起）+ 仍未拿到数据
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) return;
      const idxLatest = latestView.l1.findIndex((l) => l.category_id === l1Id);
      if (idxLatest < 0) return;
      const l1Latest = latestView.l1[idxLatest];
      if (!l1Latest.expanded) return;          // 用户已收起
      if (l1Latest.l2Items.length > 0 && !l1Latest.subtreeStale) return; // 数据已到达
      this.setData({ [`${dimKey}.${memberKey}.l1[${idxLatest}].loadingL2`]: true });
    });

    // B：ensureExpanded=true · 数据到达时幂等兜底展开
    await this._loadL2Data(memberKey, l1Id, silent, true);
  },

  /**
   * 拉取并写入 L2 子分类数据（不切换 expanded）。
   * 复用方：
   *   - _handleL1Tap 展开分支
   *   - _refreshExpandedSubtreesIfNeeded 数据变更后重拉 expanded 子树
   */
  async _loadL2Data(memberKey: string, l1Id: string, silent: boolean = false, ensureExpanded: boolean = false): Promise<void> {
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const deferredKey = `${memberKey}::${l1Id}`;
    try {
      const scope = this.data.dimension === 'monthly'
        ? { month: this.data.currentMonth }
        : { year: this.data.currentYear };
      const userId = memberKey === 'all' ? undefined : memberKey;
      const res: DrillDownLevel2Response = await drillDownLevel2(
        this._familyId, scope, l1Id, { limit: L2_VISIBLE + 1, userId },
      );
      // 前端切片成最多 L2_VISIBLE 项 + has_more 探测：limit 多查 1 条用于判断溢出。
      const overflow = res.items.length > L2_VISIBLE;
      const visibleItems = overflow ? res.items.slice(0, L2_VISIBLE) : res.items;
      const l2Items: L2Display[] = visibleItems.map((c) => ({
        category_id: c.category_id || '',
        category_name: c.category_name,
        icon: c.icon,
        amount: fmtYuan(c.amount),
        amountCents: c.amount,
        ratio_bps: c.ratio_bps,
        ratioText: fmtRatio(c.ratio_bps),
        expanded: false,
        loadingL3: false,
        l3Items: [],
        l3HasMore: false,
      }));
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) {
        this._consumeDeferredLoading(deferredKey);
        return;
      }
      const idxLatest = latestView.l1.findIndex((l) => l.category_id === l1Id);
      if (idxLatest < 0) {
        this._consumeDeferredLoading(deferredKey);
        return;
      }
      const l1Latest = latestView.l1[idxLatest];
      // 保留旧 L2 节点的 expanded + l3 数据（按 category_id 合并）：
      // 数据变更场景下用户已展开的 L2 不应被收起，l3Items 借助 subtreeStale 走 onTapL2 重拉。
      const prevL2Map = new Map<string, L2Display>();
      for (const oldL2 of l1Latest.l2Items) {
        if (oldL2.category_id) prevL2Map.set(oldL2.category_id, oldL2);
      }
      const mergedL2: L2Display[] = l2Items.map((freshL2) => {
        const prev = prevL2Map.get(freshL2.category_id);
        if (!prev) return freshL2;
        // 继承用户展开态 + L3 数据（脏标记由 _invalidateAllDimViews 写在 prev 上）
        return {
          ...freshL2,
          expanded: prev.expanded,
          l3Items: prev.l3Items,
          l3HasMore: prev.l3HasMore,
          subtreeStale: prev.subtreeStale,
        };
      });
      // COSTRA-304：cancel deferred handle，按 fired 决定是否需要写 loadingL2:false
      const loadingWasShown = this._consumeDeferredLoading(deferredKey);
      // A1：仅写本 L1 节点的子树字段，不触碰兄弟节点（杜绝并发整列覆盖）
      const base = `${dimKey}.${memberKey}.l1[${idxLatest}]`;
      const update: Record<string, unknown> = {
        [`${base}.l2Items`]: mergedL2,
        [`${base}.l2HasMore`]: overflow,
        [`${base}.subtreeStale`]: false,
      };
      // 仅当 loading 已实际显示过（fired），或当前节点 loadingL2 已为 true（被其他路径触发），才写回 false
      if (loadingWasShown || l1Latest.loadingL2) update[`${base}.loadingL2`] = false;
      // B：兜底展开。判据从 `loadingL2 仍为 true` 改为 `expanded 仍为 true`：
      // deferred 路径下 loadingL2 在快路径中**始终为 false**，但 expanded 仍是"用户没主动收起"的可靠信号。
      if (ensureExpanded && l1Latest.expanded) update[`${base}.expanded`] = true;
      this.setData(update, () => {
        this._scheduleMeasureCurrentPane('l1-l2-loaded');
      });

      // L3 链路：对 expanded 且 stale（或空）的 L2 节点级联重拉
      for (const l2 of mergedL2) {
        if (l2.expanded && l2.category_id && (l2.subtreeStale || l2.l3Items.length === 0)) {
          void this._loadL3Data(memberKey, l1Id, l2.category_id, true);
        }
      }
    } catch (err) {
      logger.error('statistics', 'drillDown L2 failed', err);
      // INV-2：错误路径也必须 cancel deferred handle，避免 LOADING_DELAY_MS 后才闪一下加载中再消失
      const loadingWasShown = this._consumeDeferredLoading(deferredKey);
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (latestView) {
        const idxLatest = latestView.l1.findIndex((l) => l.category_id === l1Id);
        if (idxLatest >= 0) {
          // 仅当 loading 实际显示过或字段已被外部翻起时才写 false（省一次无效 setData）
          if (loadingWasShown || latestView.l1[idxLatest].loadingL2) {
            this.setData({ [`${dimKey}.${memberKey}.l1[${idxLatest}].loadingL2`]: false }, () => {
              this._scheduleMeasureCurrentPane('l1-l2-error');
            });
          }
        }
      }
      if (!silent) {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    }
  },

  // ─── 交互：L2 二级分类展开 → L3 单笔明细 ─────────────────────────────────

  async onTapL2(e: WechatMiniprogram.TouchEvent) {
    const dataset = e.currentTarget.dataset as Record<string, string>;
    const l1Id = dataset.l1id;
    const l2Id = dataset.id;
    const memberKey = dataset.memberkey || this._getCurrentMemberKey();
    if (!l1Id || !l2Id) return;

    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const view = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
    if (!view) return;
    const l1Idx = view.l1.findIndex((l) => l.category_id === l1Id);
    if (l1Idx < 0) return;
    const l2Idx = view.l1[l1Idx].l2Items.findIndex((l) => l.category_id === l2Id);
    if (l2Idx < 0) return;
    const l2 = view.l1[l1Idx].l2Items[l2Idx];
    // A1：仅写最小数据路径
    const base = `${dimKey}.${memberKey}.l1[${l1Idx}].l2Items[${l2Idx}]`;
    const deferredKey = `${memberKey}::${l1Id}::${l2Id}`;

    if (l2.expanded) {
      // 收起：cancel deferred handle（INV-2），同时清 loadingL3 兜底既有显示
      const wasFired = this._consumeDeferredLoading(deferredKey);
      const update: Record<string, unknown> = { [`${base}.expanded`]: false };
      if (wasFired || l2.loadingL3) update[`${base}.loadingL3`] = false;
      this.setData(update, () => {
        this._scheduleMeasureCurrentPane('l2-collapse');
      });
      return;
    }
    // 2026-06-08：脏标记下绕过缓存早返回，强制重拉 L3
    const l3CacheUsable = l2.l3Items.length > 0 && !l2.subtreeStale;
    if (l3CacheUsable) {
      this.setData({ [`${base}.expanded`]: true }, () => {
        this._scheduleMeasureCurrentPane('l2-expand-cached');
      });
      return;
    }

    // ─── deferred loading 路径 ───
    // 立即写 expanded:true（用户操作必须立即反馈）+ subtreeStale:false，但**不写 loadingL3**。
    this.setData({
      [`${base}.expanded`]: true,
      [`${base}.subtreeStale`]: false,
    });

    this._startDeferredLoading(deferredKey, () => {
      // INV-3 自校验：节点仍存在 + expanded 仍为 true + 数据仍未到达
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) return;
      const l1IdxLatest = latestView.l1.findIndex((l) => l.category_id === l1Id);
      if (l1IdxLatest < 0) return;
      const l2IdxLatest = latestView.l1[l1IdxLatest].l2Items.findIndex((l) => l.category_id === l2Id);
      if (l2IdxLatest < 0) return;
      const l2Latest = latestView.l1[l1IdxLatest].l2Items[l2IdxLatest];
      if (!l2Latest.expanded) return;
      if (l2Latest.l3Items.length > 0 && !l2Latest.subtreeStale) return;
      this.setData({ [`${dimKey}.${memberKey}.l1[${l1IdxLatest}].l2Items[${l2IdxLatest}].loadingL3`]: true });
    });

    // B：ensureExpanded=true · 数据到达时幂等兜底展开
    await this._loadL3Data(memberKey, l1Id, l2Id, false, true);
  },

  /**
   * 拉取并写入 L3 单笔明细数据（不切换 expanded）。
   * 复用方：
   *   - onTapL2 展开分支
   *   - _loadL2Data 中 L2 重拉后级联触发
   *   - _refreshExpandedSubtreesIfNeeded 数据变更后重拉 expanded L2 子树
   */
  async _loadL3Data(memberKey: string, l1Id: string, l2Id: string, silent: boolean = false, ensureExpanded: boolean = false): Promise<void> {
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const deferredKey = `${memberKey}::${l1Id}::${l2Id}`;
    try {
      const scope = this.data.dimension === 'monthly'
        ? { month: this.data.currentMonth }
        : { year: this.data.currentYear };
      const userId = memberKey === 'all' ? undefined : memberKey;
      const res: DrillDownLevel3Response = await drillDownLevel3(
        this._familyId, scope, l2Id, { limit: L3_VISIBLE + 1, userId },
      );
      // 前端切片成最多 L3_VISIBLE 项 + has_more 探测：limit 多查 1 条用于判断溢出。
      const overflow = res.items.length > L3_VISIBLE;
      const visibleItems = overflow ? res.items.slice(0, L3_VISIBLE) : res.items;
      const l3Items: L3Display[] = visibleItems.map((it: DrillDownEntryItem) => ({
        entry_id: it.entry_id,
        amount: fmtYuan(it.amount),
        note: it.note || '',
        dateLabel: formatEntryDate(it.occurred_at),
        timeLabel: formatEntryTime(it.occurred_at),
        shared: it.shared_type === 'shared',
        nickname: it.nickname || '',
        avatarUrl: it.avatar_url || '',
        initial: (it.nickname || '?')[0],
      }));
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) {
        this._consumeDeferredLoading(deferredKey);
        return;
      }
      const l1IdxLatest = latestView.l1.findIndex((l) => l.category_id === l1Id);
      if (l1IdxLatest < 0) {
        this._consumeDeferredLoading(deferredKey);
        return;
      }
      const l2IdxLatest = latestView.l1[l1IdxLatest].l2Items.findIndex((l) => l.category_id === l2Id);
      if (l2IdxLatest < 0) {
        this._consumeDeferredLoading(deferredKey);
        return;
      }
      const l2Latest = latestView.l1[l1IdxLatest].l2Items[l2IdxLatest];
      // COSTRA-304：cancel deferred handle，按 fired 决定是否需要写 loadingL3:false
      const loadingWasShown = this._consumeDeferredLoading(deferredKey);
      // A1：仅写本 L2 节点字段
      const base = `${dimKey}.${memberKey}.l1[${l1IdxLatest}].l2Items[${l2IdxLatest}]`;
      const update: Record<string, unknown> = {
        [`${base}.l3Items`]: l3Items,
        [`${base}.l3HasMore`]: overflow,
        [`${base}.subtreeStale`]: false,
      };
      if (loadingWasShown || l2Latest.loadingL3) update[`${base}.loadingL3`] = false;
      // B：兜底展开。判据从 `loadingL3 仍为 true` 改为 `expanded 仍为 true`：
      // deferred 路径下 loadingL3 在快路径中始终为 false，但 expanded 仍是"用户没主动收起"的可靠信号。
      if (ensureExpanded && l2Latest.expanded) update[`${base}.expanded`] = true;
      this.setData(update, () => {
        this._scheduleMeasureCurrentPane('l2-l3-loaded');
      });
    } catch (err) {
      logger.error('statistics', 'drillDown L3 failed', err);
      const loadingWasShown = this._consumeDeferredLoading(deferredKey);
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (latestView) {
        const l1IdxLatest = latestView.l1.findIndex((l) => l.category_id === l1Id);
        if (l1IdxLatest >= 0) {
          const l2IdxLatest = latestView.l1[l1IdxLatest].l2Items.findIndex((l) => l.category_id === l2Id);
          if (l2IdxLatest >= 0) {
            if (loadingWasShown || latestView.l1[l1IdxLatest].l2Items[l2IdxLatest].loadingL3) {
              this.setData({ [`${dimKey}.${memberKey}.l1[${l1IdxLatest}].l2Items[${l2IdxLatest}].loadingL3`]: false }, () => {
                this._scheduleMeasureCurrentPane('l2-l3-error');
              });
            }
          }
        }
      }
      if (!silent) {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    }
  },

  /**
   * 2026-06-08：数据变更（SYNC_DONE/ENTRY_SAVED/ENTRY_UPDATED）后，
   *   _buildMonthlyDisplay/_buildYearlyDisplay 已通过 buildL1Display 把脏 L1 的 l2Items 清空，
   *   此时对 expanded 节点 fire-and-forget 重拉 L2，使下钻数据立即同步。
   *   L3 由 _loadL2Data 内部级联触发。
   * 仅刷新当前 currentMemberKey 对应的 view（其他成员等切到时由 _ensureMemberLoaded 走完整路径）。
   */
  _refreshExpandedSubtreesIfNeeded(memberKey: MemberKey): void {
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const view = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
    if (!view) return;
    for (const l1 of view.l1) {
      if (!l1.expanded || !l1.category_id) continue;
      const needsRefresh = l1.subtreeStale || l1.l2Items.length === 0;
      if (needsRefresh) {
        void this._loadL2Data(memberKey, l1.category_id, true);
      }
    }
  },

  // ─── P1：触摸预取（touchstart 即 fire-and-forget 预热 _drillCache）─────────
  // 手指按下到 tap 触发约有 100~200ms，足够把 drill-down 请求发出去；
  // tap 真正执行 _loadL2Data/_loadL3Data 时多半已命中 _drillCache，几乎零等待。
  // 仅预取"用户正要点"的节点，不产生无效请求；已有可用缓存时直接跳过。

  onTouchStartL1(e: WechatMiniprogram.TouchEvent) {
    if (!this._familyId) return;
    const dataset = e.currentTarget.dataset as Record<string, string>;
    const id = dataset.id;
    if (!id) return;
    const memberKey = dataset.memberkey || this._getCurrentMemberKey();
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const view = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
    const item = view?.l1.find((l) => l.category_id === id);
    if (item && item.l2Items.length > 0 && !item.subtreeStale) return; // 已有可用缓存
    const scope = this.data.dimension === 'monthly'
      ? { month: this.data.currentMonth }
      : { year: this.data.currentYear };
    const userId = memberKey === 'all' ? undefined : memberKey;
    void drillDownLevel2(this._familyId, scope, id, { limit: L2_VISIBLE + 1, userId }).catch(() => { /* 预取失败静默，tap 时正常重试 */ });
  },

  onTouchStartL2(e: WechatMiniprogram.TouchEvent) {
    if (!this._familyId) return;
    const dataset = e.currentTarget.dataset as Record<string, string>;
    const l1Id = dataset.l1id;
    const l2Id = dataset.id;
    if (!l2Id) return;
    const memberKey = dataset.memberkey || this._getCurrentMemberKey();
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const view = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
    const l1 = l1Id ? view?.l1.find((l) => l.category_id === l1Id) : undefined;
    const l2 = l1?.l2Items.find((l) => l.category_id === l2Id);
    if (l2 && l2.l3Items.length > 0 && !l2.subtreeStale) return; // 已有可用缓存
    const scope = this.data.dimension === 'monthly'
      ? { month: this.data.currentMonth }
      : { year: this.data.currentYear };
    const userId = memberKey === 'all' ? undefined : memberKey;
    void drillDownLevel3(this._familyId, scope, l2Id, { limit: L3_VISIBLE + 1, userId }).catch(() => { /* 预取失败静默，tap 时正常重试 */ });
  },

  // ─── 固定数据视口高度（控制区固定，pane 内部滚动）───────────────────────

  _resetMemberSwiperHeightState(_reason?: string) {
    this._scheduleMeasureCurrentPane(_reason || 'reset');
  },

  _scheduleMeasureCurrentPane(_reason?: string) {
    setTimeout(() => this._measureMemberSwiperViewport(), 30);
  },

  _settleSwiperHeight(reason: string) {
    this._scheduleMeasureCurrentPane(reason);
  },

  _measureMemberSwiperViewport() {
    const m = getSafeAreaMetrics();
    this.createSelectorQuery()
      .select('.time-bar').boundingClientRect()
      .select('.member-strip').boundingClientRect()
      .exec((res) => {
        const timeRect = res[0] as WechatMiniprogram.BoundingClientRectCallbackResult | null;
        const stripRect = res[1] as WechatMiniprogram.BoundingClientRectCallbackResult | null;
        const h = Math.max(320, m.windowHeight - m.navBarTotalHeight - (timeRect?.height || 0) - (stripRect?.height || 0));
        if (Math.abs(h - this.data.memberSwiperHeightPx) > 1) this.setData({ memberSwiperHeightPx: h });
      });
  },

  // ─── COSTRA-303：消费 pendingStatisticsAction ─────────────────────────────

  async _consumePendingAction(): Promise<void> {
    const app = getApp<AppWithBootstrap>();
    const action = app.globalData.pendingStatisticsAction;
    if (!action) return;
    app.globalData.pendingStatisticsAction = null; // 立即清空，防重入

    // 1. 切维度（只在 dimension 不一致时切，避免无意义触发 _clearCurrentDimViews）
    if (action.dimension !== this.data.dimension) {
      this.setData({ dimension: action.dimension });
      this._clearCurrentDimViews();
    }

    // 2. 切月/年（与 dimension 匹配，只在不一致时改）
    if (action.dimension === 'monthly' && action.month && action.month !== this.data.currentMonth) {
      this.setData({
        currentMonth: action.month,
        monthDisplay: formatMonthDisplay(action.month),
      });
      this._clearCurrentDimViews();
    }
    if (action.dimension === 'yearly' && action.year && action.year !== this.data.currentYear) {
      this.setData({
        currentYear: action.year,
        yearDisplay: formatYearDisplay(action.year),
      });
      this._clearCurrentDimViews();
    }

    // 3. 切成员 tab（只在不一致时切）
    const idx = this.data.memberTabs.findIndex(t => t.key === action.memberKey);
    if (idx >= 0 && idx !== this.data.memberTabIndex) {
      const update = this._buildMemberSwitchUpdate(idx, action.memberKey as MemberKey, true);
      update.memberSwiperDuration = 0; // 程序触发：禁动画直接切
      this.setData(update);
    } else if (idx < 0) {
      // 目标 memberKey 不存在（家庭成员变化）→ 降级到 'all'
      const allIdx = this.data.memberTabs.findIndex(t => t.key === 'all');
      if (allIdx >= 0 && allIdx !== this.data.memberTabIndex) {
        const update = this._buildMemberSwitchUpdate(allIdx, 'all', true);
        update.memberSwiperDuration = 0;
        this.setData(update);
      }
    }

    // 4. 拉数据（_loadData 判断当前 currentMemberKey 走对应分支）
    await this._loadData();

    // 5. 自动展开 L1（数据已落 byMember 后再展）
    if (action.expandL1Id) {
      const finalMemberKey = this._getCurrentMemberKey();
      await this._handleL1Tap(finalMemberKey, action.expandL1Id, true);
    }
  },

  // ─── 交互：账本切换 ──────────────────────────────────────────────────────────

  async onTapLedgerName() {
    try {
      const { families } = await getFamilies();
      if (!families || families.length <= 1) {
        wx.showToast({ title: '当前只有一个账本', icon: 'none' });
        return;
      }
      const items = families.map((f: FamilyItem) => {
        const suffix = f.kind === 'personal' ? '（个人）' : `（${f.member_count}人）`;
        return f.name + suffix;
      });
      wx.showActionSheet({
        itemList: items,
        success: async (res) => {
          const selected = families[res.tapIndex];
          if (selected.ledger_id === this._ledgerId) return;
          // 释放旧家庭统计缓存（与 _onActiveFamilyChanged 行为对齐 · 防长期占用）
          if (this._familyId) invalidateStatisticsCache(this._familyId);
          await switchActiveFamily({
            family_id: selected.id,
            ledger_id: selected.ledger_id,
            family_kind: selected.kind,
            ledger_name: selected.ledger_name || selected.name,
          }, 'ledger-switch');
          this._familyId = selected.id;
          this._ledgerId = selected.ledger_id;
          // 切账本 → 清空所有数据 + 重置 swiper 高度 + 重新加载上下文（含成员列表）
          this._resetMemberSwiperHeightState('ledgerSwitch');
          this._clearMemberScrollMemory();
          // INV-2：切账本后旧 family 的 in-flight deferred handle 已无意义，全部 cancel
          this._cancelAllDeferredLoadingHandles();
          this.setData({
            ledgerName: selected.ledger_name || selected.name,
            familyKind: selected.kind,
            monthlyByMember: {},
            yearlyByMember: {},
            memberTabIndex: 0,
            currentMemberKey: 'all',
          });
          void syncOnce('ledger-switch');
          await this._loadContext();
          await this._loadData();
        },
      });
    } catch {
      wx.showToast({ title: '获取账本列表失败', icon: 'none' });
    }
  },

  /** 阻止穿透 */
  noop() {},
});
