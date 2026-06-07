// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-303 · 消费 pendingStatisticsAction（协作页 L1 跳转后的统计页联动）
// 设计源: docs/design/family-page-tech-spec.md §4.2 / §4.6 / §5.2
// 配套后端: COSTRA-260（统计 API user_id 参数）· 公共组件: trend-line-chart（COSTRA-230）
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts toYuan）
// 前置: COSTRA-302（协作页写入 pendingStatisticsAction）· COSTRA-264（拆分 + swiper height）
// Refs: COSTRA-303

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
  _loadingPromise: null as Promise<void> | null,

  _initialized: false,
  _memberPaneScrollTops: {} as Record<string, number>,
  _lastPaneScrollSetDataAt: 0,

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
      await this._loadData();

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
    this.setData({ loading: false }, () => { this._settleSwiperHeight('loadData'); });
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

  /** Scope 变更（切月份 / 切年份）场景：全清当前维度所有成员视图与成员内滚动位置。 */
  _clearCurrentDimViews() {
    if (this.data.dimension === 'monthly') {
      this.setData({ monthlyByMember: {} });
    } else {
      this.setData({ yearlyByMember: {} });
    }
    this._resetMemberSwiperHeightState('clearDimViews');
    this._clearMemberScrollMemory();
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
    const list = [...view.l1];
    const idx = list.findIndex((l) => l.category_id === l1Id);
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
        this._familyId, scope, l1Id, { limit: L2_VISIBLE + 1, userId },
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
      const idxLatest = listLatest.findIndex((l) => l.category_id === l1Id);
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
      const idxLatest = listLatest.findIndex((l) => l.category_id === l1Id);
      if (idxLatest >= 0) {
        listLatest[idxLatest] = { ...listLatest[idxLatest], loadingL2: false };
        this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest }, () => {
          this._scheduleMeasureCurrentPane('l1-l2-error');
        });
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
          this._clearMemberScrollMemory();
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
