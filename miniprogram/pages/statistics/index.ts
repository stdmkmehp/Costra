// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-264 · review 修复 + 二指手势后统计页左边距异常修复
// 设计源: design/ui/design_spec.md §6.4 + design/ui/interaction_flow.md §5
// 配套后端: COSTRA-260（统计 API user_id 参数）· 公共组件: trend-line-chart（COSTRA-230）
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts toYuan）
// Refs: COSTRA-264

import { getSafeAreaMetrics } from '../../utils/safeArea';
import {
  getActiveFamilyId,
  getActiveLedgerId,
  getActiveLedgerName,
  getActiveFamilyKind,
  setActiveFamily,
  savePreferenceAsync,
} from '../../services/family';
import { triggerOnPageShow, syncOnce } from '../../services/syncScheduler';
import { eventBus, EventNames, type SyncDonePayload } from '../../services/eventBus';
import { hasValidSession } from '../../services/auth';
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
} from './formatters';
import {
  L1_VISIBLE,
  L2_VISIBLE,
  L3_VISIBLE,
  emptyMonthlyView,
  emptyYearlyView,
  getInitialSwiperHeightPx,
  buildL1Display,
} from './viewModels';
import { makeAllTab, buildMemberTabs } from './memberHelpers';

interface AppWithBootstrap { bootstrapPromise: Promise<void> }

// ─── Page ─────────────────────────────────────────────────────────────────────

Page({
  data: {
    // 首屏保护
    ready: false,
    statusBarHeight: 0,
    navBarHeight: 44,

    // 账本
    ledgerName: '个人账本',
    familyKind: 'personal' as 'personal' | 'shared',

    // 时间维度
    dimension: 'monthly' as 'monthly' | 'yearly',
    currentMonth: getCurrentMonthValue(),
    currentYear: getCurrentYearValue(),
    monthDisplay: '',
    yearDisplay: '',

    // 加载状态（全局，仅用于首屏 skeleton / 无成员条的单人账本）
    loading: true,

    // 成员维度
    memberTabs: [] as MemberTabItem[],
    memberTabIndex: 0,
    memberScrollIntoView: '',
    currentMemberKey: 'all' as MemberKey,

    // swiper auto-height adapter（COSTRA-263）
    memberSwiperHeightPx: getInitialSwiperHeightPx(),
    memberSwiperDuration: 240,

    // 按成员索引的视图数据
    monthlyByMember: {} as Record<MemberKey, MonthlyView>,
    yearlyByMember: {} as Record<MemberKey, YearlyView>,

    // 顶层空态（仅在当前选中成员维度判定）
    isEmpty: false,
  },

  // 内部状态
  _familyId: '' as string,
  _ledgerId: '' as string,
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,
  _entrySavedHandler: null as (() => void) | null,
  _entryUpdatedHandler: null as (() => void) | null,
  _loadingPromise: null as Promise<void> | null,

  // swiper auto-height adapter 实例字段（COSTRA-263）
  _paneHeights: [] as number[],
  _measureSeq: 0,
  _pendingMeasure: false,
  _pendingMeasureRetry: false,
  _isTapSwitchingMember: false,

  // 页面滚动位置策略
  _pageScrollTop: 0,
  _memberAnchorTopPx: 0,

  // ─── 生命周期 ──────────────────────────────────────────────────────────────

  onLoad() {
    const m = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: m.statusBarHeight,
      navBarHeight: m.navBarHeight,
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
      this.setData({ ready: true, loading: true });
      (this.getTabBar?.() as { markActive?: (idx: number) => void } | undefined)?.markActive?.(1);
      triggerOnPageShow('statistics');
      await this._loadContext();
      await this._loadData();
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
    this.setData({
      ledgerName: ledgerName || '个人账本',
      familyKind: familyKind || 'personal',
    });

    // 构建 memberTabs
    if (familyKind === 'shared' && this._familyId) {
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
    this.setData({ loading: false });
    // 首次加载完成后测量成员条 anchor 位置（用于滚动位置策略）
    this._measureMemberAnchor();
  },

  /** 获取当前选中的 memberKey */
  _getCurrentMemberKey(): MemberKey {
    return this.data.currentMemberKey || 'all';
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

    const viewInit = this.data.monthlyByMember[memberKey] || emptyMonthlyView();
    viewInit.loading = true;
    this.setData({ [`monthlyByMember.${memberKey}`]: viewInit });

    const cached = getCachedMonthly(this._familyId, month, userId);
    if (cached) {
      this._buildMonthlyDisplay(cached, memberKey);
    }

    try {
      const fresh = await getMonthlyStatistics(this._familyId, month, { userId });
      this._buildMonthlyDisplay(fresh, memberKey);
    } catch (err) {
      console.error('[statistics] loadMonthly failed', err);
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
      const fresh = await getYearlyStatistics(this._familyId, year, { userId });
      this._buildYearlyDisplay(fresh, memberKey);
    } catch (err) {
      console.error('[statistics] loadYearly failed', err);
      this.setData({
        [`yearlyByMember.${memberKey}.loading`]: false,
        [`yearlyByMember.${memberKey}.loaded`]: true,
      });
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  // ─── 月度展示构建 ──────────────────────────────────────────────────────────

  _buildMonthlyDisplay(s: MonthlyStatistics, memberKey: MemberKey) {
    const { totals, daily_trend, extremes, category_ranks } = s;

    const summary: SummaryGridItem[] = [
      { label: '日均支出', value: fmtYuan(extremes.avg_daily_expense) },
      { label: '最大单笔', value: fmtYuan(extremes.max_single_expense) },
      { label: '单日最高', value: fmtYuan(extremes.max_day_expense) },
      { label: '记账笔数', value: `${totals.entry_count}` },
    ];

    const prevList = this.data.monthlyByMember[memberKey]?.l1 ?? [];
    const l1: L1Display[] = category_ranks
      .slice(0, L1_VISIBLE)
      .map((c) => buildL1Display(c, prevList));

    const viewData: MonthlyView = {
      totalExpense: fmtYuan(totals.expense),
      totalIncome: fmtYuan(totals.income),
      totalBalance: fmtYuan(totals.balance),
      trend: daily_trend.map((d) => d.expense),
      summary,
      l1,
      l1HasMore: category_ranks.length > L1_VISIBLE,
      l1MoreCount: Math.max(0, category_ranks.length - L1_VISIBLE),
      isEmpty: totals.expense === 0 && totals.income === 0,
      loading: false,
      loaded: true,
    };

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

    const viewData: YearlyView = {
      totalExpense: fmtYuan(totals.expense),
      totalIncome: fmtYuan(totals.income),
      totalBalance: fmtYuan(totals.balance),
      trend: monthly_trend.map((m) => m.expense),
      summary,
      months,
      l1,
      l1HasMore: category_ranks.length > L1_VISIBLE,
      l1MoreCount: Math.max(0, category_ranks.length - L1_VISIBLE),
      isEmpty: totals.expense === 0 && totals.income === 0,
      loading: false,
      loaded: true,
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
    });
  },

  // ─── SYNC_DONE / ENTRY_SAVED / ENTRY_UPDATED 响应式刷新 ─────────────────────

  async _onSyncDone() {
    if (!this._familyId) return;
    if (this._loadingPromise) return;
    invalidateStatisticsCache(this._familyId);
    this._invalidateCurrentDimViews();
    await this._loadData();
  },

  _invalidateCurrentDimViews() {
    const byMemberKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const byMember = this.data[byMemberKey] as Record<MemberKey, MonthlyView | YearlyView>;
    const update: Record<string, unknown> = {};
    for (const mk of Object.keys(byMember)) {
      if (byMember[mk]) {
        update[`${byMemberKey}.${mk}.loaded`] = false;
      }
    }
    if (Object.keys(update).length > 0) {
      this.setData(update);
    }
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

  /**
   * Scope 变更（切月份 / 切年份）场景：全清当前维度所有成员视图。
   * 同时重置 swiper 高度状态（COSTRA-264 P1 修复：_paneHeights 随 scope 重置）
   */
  _clearCurrentDimViews() {
    if (this.data.dimension === 'monthly') {
      this.setData({ monthlyByMember: {} });
    } else {
      this.setData({ yearlyByMember: {} });
    }
    this._resetMemberSwiperHeightState('clearDimViews');
  },

  onSwitchDimension(e: WechatMiniprogram.TouchEvent) {
    const dim = (e.currentTarget.dataset as Record<string, string>).dim as 'monthly' | 'yearly';
    if (dim === this.data.dimension) return;
    this._resetMemberSwiperHeightState('switchDim');
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
    this.setData({
      dimension: 'monthly',
      currentMonth: monthValue,
      monthDisplay: formatMonthDisplay(monthValue),
      monthlyByMember: {},
    });
    void this._loadData();
  },

  // ─── 交互：成员 Tab 点击（duration=0 直接跳，不播放横跨多页动画） ──────────

  onTapMemberTab(e: WechatMiniprogram.TouchEvent) {
    const idx = parseInt((e.currentTarget.dataset as Record<string, string>).index, 10);
    if (Number.isNaN(idx) || idx === this.data.memberTabIndex) return;
    const tab = this.data.memberTabs[idx];
    if (!tab) return;

    // COSTRA-264 P1-1 修复：切到目标前确保目标 view 有 loading 占位
    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const targetView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][tab.key];
    const setUpdate: Record<string, unknown> = {};
    if (!targetView || !targetView.loaded) {
      const emptyView = this.data.dimension === 'monthly' ? emptyMonthlyView() : emptyYearlyView();
      emptyView.loading = true;
      setUpdate[`${dimKey}.${tab.key}`] = emptyView;
    }

    // 扩高到 max(current, target)
    this._expandSwiperHeightForIndexes([this.data.memberTabIndex, idx]);

    // 标记为 tap 切换（duration=0 直接跳）
    this._isTapSwitchingMember = true;
    Object.assign(setUpdate, {
      memberSwiperDuration: 0,
      memberTabIndex: idx,
      currentMemberKey: tab.key,
      memberScrollIntoView: `mtab-${idx}`,
    });
    this.setData(setUpdate, () => {
      void this._ensureMemberLoaded(tab.key);
      this._scheduleMeasureCurrentPane('tap');
      this._handleMemberPageScrollPosition('tap');
      // 恢复 duration
      setTimeout(() => {
        this._isTapSwitchingMember = false;
        this.setData({ memberSwiperDuration: 240 });
      }, 50);
    });
  },

  // ─── 交互：swiper 手势事件（COSTRA-263） ──────────────────────────────────

  /** 手势拖动开始：邻域高度保护 */
  onMemberSwiperTouchStart() {
    const cur = this.data.memberTabIndex;
    this._expandSwiperHeightForIndexes([cur - 1, cur, cur + 1]);
  },

  /** swiper change：手势滑动完成切换 */
  onMemberSwiperChange(e: WechatMiniprogram.SwiperChange) {
    const idx = e.detail.current;
    if (idx === this.data.memberTabIndex) return;
    if (this._isTapSwitchingMember) return;
    const tab = this.data.memberTabs[idx];
    if (!tab) return;
    this.setData({
      memberTabIndex: idx,
      currentMemberKey: tab.key,
      memberScrollIntoView: `mtab-${idx}`,
    }, () => {
      void this._ensureMemberLoaded(tab.key);
      this._handleMemberPageScrollPosition('swipe');
    });
  },

  /** swiper animationfinish：收缩到目标真实高度 */
  onMemberSwiperAnimationFinish(e: WechatMiniprogram.SwiperAnimationFinish) {
    const idx = e.detail.current;
    this._measurePaneHeightByIndex(idx, { applyIfCurrent: true, retry: true });
  },

  // ─── 页面滚动位置追踪（COSTRA-263） ─────────────────────────────────────────

  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    this._pageScrollTop = e.scrollTop;
  },

  /** 切成员时的页面滚动位置策略（COSTRA-264 P2 修复：扣除 fixed nav 高度） */
  _handleMemberPageScrollPosition(_trigger: 'tap' | 'swipe') {
    if (this.data.familyKind !== 'shared' || this.data.memberTabs.length <= 1) return;
    const navOffset = this.data.statusBarHeight + this.data.navBarHeight + 8;
    const threshold = this._memberAnchorTopPx + 120;
    if (this._pageScrollTop > threshold && this._memberAnchorTopPx > 0) {
      const targetTop = Math.max(0, this._memberAnchorTopPx - navOffset);
      wx.pageScrollTo({
        scrollTop: targetTop,
        duration: 180,
      });
    }
  },

  /** 测量成员条 anchor 位置（COSTRA-264 P2 修复：不要求 rect.top > 0） */
  _measureMemberAnchor() {
    this.createSelectorQuery()
      .select('.member-strip')
      .boundingClientRect((rect) => {
        if (rect) {
          this._memberAnchorTopPx = rect.top + this._pageScrollTop;
        } else {
          // selector 未命中时 retry 一次（50ms）
          setTimeout(() => {
            this.createSelectorQuery()
              .select('.member-strip')
              .boundingClientRect((retryRect) => {
                if (retryRect) {
                  this._memberAnchorTopPx = retryRect.top + this._pageScrollTop;
                }
              })
              .exec();
          }, 50);
        }
      })
      .exec();
  },

  // ─── 交互：L1 一级分类展开 ─────────────────────────────────────────────────

  async onTapL1(e: WechatMiniprogram.TouchEvent) {
    const dataset = e.currentTarget.dataset as Record<string, string>;
    const id = dataset.id;
    const memberKey = dataset.memberkey || this._getCurrentMemberKey();
    if (!id) return;

    const dimKey = this.data.dimension === 'monthly' ? 'monthlyByMember' : 'yearlyByMember';
    const view = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
    if (!view) return;
    const list = [...view.l1];
    const idx = list.findIndex((l) => l.category_id === id);
    if (idx < 0) return;
    const item = list[idx];

    if (item.expanded) {
      list[idx] = { ...item, expanded: false };
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list }, () => {
        this._scheduleMeasureCurrentPane('l1-collapse');
      });
      return;
    }

    if (item.l2Items.length > 0) {
      list[idx] = { ...item, expanded: true };
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list }, () => {
        this._scheduleMeasureCurrentPane('l1-expand-cached');
      });
      return;
    }
    list[idx] = { ...item, expanded: true, loadingL2: true };
    this.setData({ [`${dimKey}.${memberKey}.l1`]: list });

    try {
      const scope = this.data.dimension === 'monthly'
        ? { month: this.data.currentMonth }
        : { year: this.data.currentYear };
      const userId = memberKey === 'all' ? undefined : memberKey;
      const res: DrillDownLevel2Response = await drillDownLevel2(
        this._familyId, scope, id, { limit: L2_VISIBLE + 1, userId },
      );
      const l2Items: L2Display[] = res.items.slice(0, L2_VISIBLE).map((c) => ({
        category_id: c.category_id || '',
        category_name: c.category_name,
        icon: c.icon,
        amount: fmtYuan(c.amount),
        amountCents: c.amount,
        ratio_bps: c.ratio_bps,
        expanded: false,
        loadingL3: false,
        l3Items: [],
        l3HasMore: false,
        l3MoreCount: 0,
      }));
      const hasMore = res.total_count > L2_VISIBLE;
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) return;
      const listLatest = [...latestView.l1];
      const idxLatest = listLatest.findIndex((l) => l.category_id === id);
      if (idxLatest >= 0) {
        listLatest[idxLatest] = {
          ...listLatest[idxLatest],
          loadingL2: false,
          l2Items,
          l2HasMore: hasMore,
          l2MoreCount: Math.max(0, res.total_count - L2_VISIBLE),
        };
        this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest }, () => {
          this._scheduleMeasureCurrentPane('l1-l2-loaded');
        });
      }
    } catch (err) {
      console.error('[statistics] drillDown L2 failed', err);
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) return;
      const listLatest = [...latestView.l1];
      const idxLatest = listLatest.findIndex((l) => l.category_id === id);
      if (idxLatest >= 0) {
        listLatest[idxLatest] = { ...listLatest[idxLatest], loadingL2: false };
        this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest }, () => {
          this._scheduleMeasureCurrentPane('l1-l2-error');
        });
      }
      wx.showToast({ title: '加载失败', icon: 'none' });
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
    const list = [...view.l1];
    const l1Idx = list.findIndex((l) => l.category_id === l1Id);
    if (l1Idx < 0) return;
    const l1 = { ...list[l1Idx], l2Items: [...list[l1Idx].l2Items] };
    const l2Idx = l1.l2Items.findIndex((l) => l.category_id === l2Id);
    if (l2Idx < 0) return;
    const l2 = l1.l2Items[l2Idx];

    if (l2.expanded) {
      l1.l2Items[l2Idx] = { ...l2, expanded: false };
      list[l1Idx] = l1;
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list }, () => {
        this._scheduleMeasureCurrentPane('l2-collapse');
      });
      return;
    }
    if (l2.l3Items.length > 0) {
      l1.l2Items[l2Idx] = { ...l2, expanded: true };
      list[l1Idx] = l1;
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list }, () => {
        this._scheduleMeasureCurrentPane('l2-expand-cached');
      });
      return;
    }

    l1.l2Items[l2Idx] = { ...l2, expanded: true, loadingL3: true };
    list[l1Idx] = l1;
    this.setData({ [`${dimKey}.${memberKey}.l1`]: list });

    try {
      const scope = this.data.dimension === 'monthly'
        ? { month: this.data.currentMonth }
        : { year: this.data.currentYear };
      const userId = memberKey === 'all' ? undefined : memberKey;
      const res: DrillDownLevel3Response = await drillDownLevel3(
        this._familyId, scope, l2Id, { limit: L3_VISIBLE, userId },
      );
      const l3Items: L3Display[] = res.items.map((it: DrillDownEntryItem) => ({
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
      if (!latestView) return;
      const listLatest = [...latestView.l1];
      const l1IdxLatest = listLatest.findIndex((l) => l.category_id === l1Id);
      if (l1IdxLatest >= 0) {
        const l1Latest = { ...listLatest[l1IdxLatest], l2Items: [...listLatest[l1IdxLatest].l2Items] };
        const l2IdxLatest = l1Latest.l2Items.findIndex((l) => l.category_id === l2Id);
        if (l2IdxLatest >= 0) {
          l1Latest.l2Items[l2IdxLatest] = {
            ...l1Latest.l2Items[l2IdxLatest],
            loadingL3: false,
            l3Items,
            l3HasMore: res.has_more,
            l3MoreCount: Math.max(0, res.total_count - res.items.length),
          };
          listLatest[l1IdxLatest] = l1Latest;
          this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest }, () => {
            this._scheduleMeasureCurrentPane('l2-l3-loaded');
          });
        }
      }
    } catch (err) {
      console.error('[statistics] drillDown L3 failed', err);
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) return;
      const listLatest = [...latestView.l1];
      const l1IdxLatest = listLatest.findIndex((l) => l.category_id === l1Id);
      if (l1IdxLatest >= 0) {
        const l1Latest = { ...listLatest[l1IdxLatest], l2Items: [...listLatest[l1IdxLatest].l2Items] };
        const l2IdxLatest = l1Latest.l2Items.findIndex((l) => l.category_id === l2Id);
        if (l2IdxLatest >= 0) {
          l1Latest.l2Items[l2IdxLatest] = { ...l1Latest.l2Items[l2IdxLatest], loadingL3: false };
          listLatest[l1IdxLatest] = l1Latest;
          this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest }, () => {
            this._scheduleMeasureCurrentPane('l2-l3-error');
          });
        }
      }
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // ─── swiper auto-height adapter（COSTRA-263 + COSTRA-264 P1 重置方法） ─────

  /**
   * 统一重置 swiper 高度状态（COSTRA-264 P1 修复）
   * 调用场景：切账本/成员列表重建、切月/年 scope、切维度、点击年度月份行
   */
  _resetMemberSwiperHeightState(_reason?: string) {
    this._paneHeights = [];
    this._pendingMeasure = false;
    this._pendingMeasureRetry = false;
    this._measureSeq++;
    this._memberAnchorTopPx = 0;
    this.setData({ memberSwiperHeightPx: getInitialSwiperHeightPx() });
  },

  /** 调度测量当前 pane 高度（合并同 tick 多次调用） */
  _scheduleMeasureCurrentPane(reason?: string) {
    if (this._pendingMeasure) return;
    this._pendingMeasure = true;
    setTimeout(() => {
      this._pendingMeasure = false;
      this._measureCurrentPaneHeight(reason);
    }, 30);
  },

  /** 测量当前 pane 高度并应用 */
  _measureCurrentPaneHeight(reason?: string) {
    const idx = this.data.memberTabIndex;
    this._measurePaneHeightByIndex(idx, { applyIfCurrent: true, retry: true, reason });
  },

  /** 测量指定 index 的 pane 高度 */
  _measurePaneHeightByIndex(
    idx: number,
    options?: { applyIfCurrent?: boolean; retry?: boolean; reason?: string },
  ) {
    const seq = ++this._measureSeq;
    this.createSelectorQuery()
      .select(`#mpane-${idx} .member-pane-inner`)
      .boundingClientRect((rect) => {
        if (seq !== this._measureSeq) return;
        if (rect && rect.height > 0) {
          this._paneHeights[idx] = rect.height;
          if (options?.applyIfCurrent && idx === this.data.memberTabIndex) {
            this.setData({ memberSwiperHeightPx: rect.height });
          }
        } else if (options?.retry && !this._pendingMeasureRetry) {
          this._pendingMeasureRetry = true;
          setTimeout(() => {
            this._pendingMeasureRetry = false;
            this._measurePaneHeightByIndex(idx, {
              applyIfCurrent: options.applyIfCurrent,
              retry: false,
              reason: options.reason ? `${options.reason}-retry` : 'retry',
            });
          }, 50);
        }
      })
      .exec();
  },

  /** 获取已知 pane 高度（未测过返回当前 swiper 高度） */
  _getKnownPaneHeight(idx: number): number {
    return this._paneHeights[idx] || this.data.memberSwiperHeightPx;
  },

  /** 扩展 swiper 高度到指定 indexes 中的最大值（仅向上扩，不缩） */
  _expandSwiperHeightForIndexes(indexes: number[]) {
    const len = this.data.memberTabs.length;
    let maxH = this.data.memberSwiperHeightPx;
    for (const i of indexes) {
      if (i < 0 || i >= len) continue;
      const h = this._getKnownPaneHeight(i);
      if (h > maxH) maxH = h;
    }
    if (maxH > this.data.memberSwiperHeightPx) {
      this.setData({ memberSwiperHeightPx: maxH });
    }
  },

  // ─── 交互：账本切换 ────────────────────────────────────────────────────────

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
          await setActiveFamily({
            family_id: selected.id,
            ledger_id: selected.ledger_id,
            family_kind: selected.kind,
            ledger_name: selected.name,
          });
          savePreferenceAsync(selected.id, selected.ledger_id);
          this._familyId = selected.id;
          this._ledgerId = selected.ledger_id;
          // 切账本 → 清空所有数据 + 重置 swiper 高度 + 重新加载上下文（含成员列表）
          this._resetMemberSwiperHeightState('ledgerSwitch');
          this.setData({
            ledgerName: selected.name,
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
