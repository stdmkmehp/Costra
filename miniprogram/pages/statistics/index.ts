// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-261 · 成员维度横滑切换主体改造
// 设计源: design/ui/design_spec.md §6.4 + design/ui/interaction_flow.md §5
// 配套后端: COSTRA-260（统计 API user_id 参数）· 公共组件: trend-line-chart（COSTRA-230）
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts toYuan）

import { toYuan } from '../../utils/money';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { getMemberColorBySlot } from '../../utils/memberColor';
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
import { hasValidSession, getToken } from '../../services/auth';
import { getFamilies, getFamilyMembers, type FamilyItem, type FamilyMember } from '../../services/familyApi';
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
  type StatCategoryRankItem,
  type DrillDownLevel2Response,
  type DrillDownLevel3Response,
  type DrillDownEntryItem,
} from '../../services/statisticsApi';

interface AppWithBootstrap { bootstrapPromise: Promise<void> }

// ─── 类型 ────────────────────────────────────────────────────────────────────

type MemberKey = string; // 'all' | userId

interface SummaryGridItem {
  label: string;
  value: string;
}

interface MonthRow {
  month: number;
  label: string;
  expense: string;
  income: string;
  balance: string;
  isEmpty: boolean;
}

interface L1Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;        // 已格式化
  amountCents: number;
  ratio_bps: number;
  expanded: boolean;
  loadingL2: boolean;
  l2Items: L2Display[];
  l2HasMore: boolean;
  l2MoreCount: number;
}

interface L2Display {
  category_id: string;
  category_name: string;
  icon: string;
  amount: string;
  amountCents: number;
  ratio_bps: number;
  expanded: boolean;
  loadingL3: boolean;
  l3Items: L3Display[];
  l3HasMore: boolean;
  l3MoreCount: number;
}

interface L3Display {
  entry_id: string;
  amount: string;
  note: string;
  dateLabel: string;
  timeLabel: string;
  shared: boolean;
  nickname: string;
  avatarUrl: string;
  initial: string;
}

interface MemberTabItem {
  key: MemberKey;          // 'all' 或 userId
  type: 'all' | 'member';
  label: string;           // '全部' / nickname
  avatarUrl: string;
  initial: string;         // 头像兜底首字
  color: string;           // 来自 getMemberColorBySlot
  status: 'active' | 'left';
}

interface MonthlyView {
  totalExpense: string;
  totalIncome: string;
  totalBalance: string;
  trend: number[];
  summary: SummaryGridItem[];
  l1: L1Display[];
  l1HasMore: boolean;
  l1MoreCount: number;
  isEmpty: boolean;
  loading: boolean;
  loaded: boolean;
}

interface YearlyView {
  totalExpense: string;
  totalIncome: string;
  totalBalance: string;
  trend: number[];
  summary: SummaryGridItem[];
  months: MonthRow[];
  l1: L1Display[];
  l1HasMore: boolean;
  l1MoreCount: number;
  isEmpty: boolean;
  loading: boolean;
  loaded: boolean;
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/** cents → 元（带千分位） */
function fmtAmount(cents: number): string {
  const yuanStr = toYuan(Math.abs(cents));
  const parts = yuanStr.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intPart}.${parts[1]}`;
}

/** cents → ¥X,XXX.XX（含负号） */
function fmtYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}¥${fmtAmount(cents)}`;
}

function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getCurrentYearValue(): string {
  return `${new Date().getFullYear()}`;
}

function formatMonthDisplay(value: string): string {
  const parts = value.split('-');
  return `${parts[0]}年${parseInt(parts[1], 10)}月`;
}

function formatYearDisplay(value: string): string {
  return `${value}年`;
}

function prevMonth(value: string): string {
  const [y, m] = value.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function nextMonth(value: string): string {
  const [y, m] = value.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

function prevYear(v: string): string { return `${parseInt(v, 10) - 1}`; }
function nextYear(v: string): string { return `${parseInt(v, 10) + 1}`; }

/** ISO UTC → 6月3日 (Asia/Shanghai) */
function formatEntryDate(isoUtc: string): string {
  const utc = new Date(isoUtc);
  const sh = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  return `${sh.getUTCMonth() + 1}月${sh.getUTCDate()}日`;
}

/** ISO UTC → 14:30 (Asia/Shanghai · 24 小时制) */
function formatEntryTime(isoUtc: string): string {
  const utc = new Date(isoUtc);
  const sh = new Date(utc.getTime() + 8 * 60 * 60 * 1000);
  return `${String(sh.getUTCHours()).padStart(2, '0')}:${String(sh.getUTCMinutes()).padStart(2, '0')}`;
}

/** L1 排行长列表省略：保留前 N 项 */
const L1_VISIBLE = 6;
const L2_VISIBLE = 6;
const L3_VISIBLE = 10;

/** 初始 MonthlyView */
function emptyMonthlyView(): MonthlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], summary: [], l1: [], l1HasMore: false, l1MoreCount: 0,
    isEmpty: false, loading: false, loaded: false,
  };
}

/** 初始 YearlyView */
function emptyYearlyView(): YearlyView {
  return {
    totalExpense: '¥0.00', totalIncome: '¥0.00', totalBalance: '¥0.00',
    trend: [], summary: [], months: [], l1: [], l1HasMore: false, l1MoreCount: 0,
    isEmpty: false, loading: false, loaded: false,
  };
}

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
    dataScrollIntoView: '',

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
  _windowWidthPx: 375,
  _lastScrollHandledIdx: -1,

  // ─── 生命周期 ──────────────────────────────────────────────────────────────

  onLoad() {
    const m = getSafeAreaMetrics();
    this._windowWidthPx = wx.getWindowInfo().windowWidth;
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
        const tabs = this._buildMemberTabs(members);
        this.setData({
          memberTabs: tabs,
          memberTabIndex: 0,
          memberScrollIntoView: 'mtab-0',
          dataScrollIntoView: 'mpane-0',
        });
      } catch {
        // 拉成员失败 → 降级为仅"全部"
        this.setData({
          memberTabs: [this._makeAllTab()],
          memberTabIndex: 0,
        });
      }
    } else {
      // 单人账本：只有"全部"
      this.setData({
        memberTabs: [this._makeAllTab()],
        memberTabIndex: 0,
      });
    }
  },

  /** 构造"全部"tab 项 */
  _makeAllTab(): MemberTabItem {
    return {
      key: 'all', type: 'all', label: '全部',
      avatarUrl: '', initial: '', color: '#1c1b1a', status: 'active',
    };
  },

  /**
   * 按 D5 排序规则构造 memberTabs：
   * [全部] → 自己（优先） → active 成员（color_slot 升序） → left 成员（left_at 升序）
   */
  _buildMemberTabs(members: FamilyMember[]): MemberTabItem[] {
    const currentUserId = getToken()?.raw?.user?.id || '';

    const active = members.filter((m) => m.status === 'active');
    const left = members.filter((m) => m.status === 'left');

    // active 排序：自己优先 → color_slot 升序
    active.sort((a, b) => {
      if (a.user_id === currentUserId) return -1;
      if (b.user_id === currentUserId) return 1;
      return (a.color_slot ?? 99) - (b.color_slot ?? 99);
    });

    // left 排序：left_at 升序
    left.sort((a, b) => {
      const ta = a.left_at ? new Date(a.left_at).getTime() : 0;
      const tb = b.left_at ? new Date(b.left_at).getTime() : 0;
      return ta - tb;
    });

    const tabs: MemberTabItem[] = [this._makeAllTab()];

    for (const m of [...active, ...left]) {
      tabs.push({
        key: m.user_id,
        type: 'member',
        label: m.nickname || '未知',
        avatarUrl: m.avatar_url || '',
        initial: (m.nickname || '?')[0],
        color: getMemberColorBySlot(m.color_slot),
        status: m.status,
      });
    }

    return tabs;
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
  },

  /** 获取当前选中的 memberKey */
  _getCurrentMemberKey(): MemberKey {
    const tabs = this.data.memberTabs;
    const idx = this.data.memberTabIndex;
    if (!tabs.length) return 'all';
    return tabs[idx]?.key ?? 'all';
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

    // 标记 loading
    const viewInit = this.data.monthlyByMember[memberKey] || emptyMonthlyView();
    viewInit.loading = true;
    this.setData({ [`monthlyByMember.${memberKey}`]: viewInit });

    // SWR：先用缓存渲染
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

    // 保留旧展开态
    const prevList = this.data.monthlyByMember[memberKey]?.l1 ?? [];
    const l1: L1Display[] = category_ranks
      .slice(0, L1_VISIBLE)
      .map((c) => this._buildL1Display(c, prevList));

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
    // 更新顶层 isEmpty（仅当前选中 member 驱动）
    if (memberKey === this._getCurrentMemberKey()) {
      update.isEmpty = viewData.isEmpty;
      update.loading = false;
    }
    this.setData(update);
  },

  _buildL1Display(c: StatCategoryRankItem, prevList: L1Display[]): L1Display {
    const id = c.category_id || '';
    const prev = prevList.find((p) => p.category_id === id);
    return {
      category_id: id,
      category_name: c.category_name,
      icon: c.icon,
      amount: fmtYuan(c.amount),
      amountCents: c.amount,
      ratio_bps: c.ratio_bps,
      expanded: prev?.expanded ?? false,
      loadingL2: false,
      l2Items: prev?.l2Items ?? [],
      l2HasMore: prev?.l2HasMore ?? false,
      l2MoreCount: prev?.l2MoreCount ?? 0,
    };
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
      .map((c) => this._buildL1Display(c, prevList));

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
    this.setData(update);
  },

  // ─── SYNC_DONE 响应式刷新 ──────────────────────────────────────────────────

  async _onSyncDone() {
    if (!this._familyId) return;
    if (this._loadingPromise) return;
    invalidateStatisticsCache(this._familyId);
    // 当前选中成员的展开态收起（数据失效 · 避免显示陈旧 L2/L3）
    this._collapseCurrentMemberL1();
    // 标记当前选中成员为未 loaded（强制重拉）
    const mk = this._getCurrentMemberKey();
    if (this.data.dimension === 'monthly') {
      this.setData({ [`monthlyByMember.${mk}.loaded`]: false });
    } else {
      this.setData({ [`yearlyByMember.${mk}.loaded`]: false });
    }
    await this._loadData();
  },

  /**
   * 收起当前选中成员（当前维度）的所有 L1 展开态。
   */
  _collapseCurrentMemberL1() {
    const mk = this._getCurrentMemberKey();
    if (this.data.dimension === 'monthly') {
      const view = this.data.monthlyByMember[mk];
      if (view && view.l1.length > 0) {
        this.setData({
          [`monthlyByMember.${mk}.l1`]: view.l1.map((l1) => ({
            ...l1, expanded: false, l2Items: [], l2HasMore: false, l2MoreCount: 0,
          })),
        });
      }
    } else {
      const view = this.data.yearlyByMember[mk];
      if (view && view.l1.length > 0) {
        this.setData({
          [`yearlyByMember.${mk}.l1`]: view.l1.map((l1) => ({
            ...l1, expanded: false, l2Items: [], l2HasMore: false, l2MoreCount: 0,
          })),
        });
      }
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
    // 切月/年 → 清空所有成员的当前维度视图（scope 变了，旧数据不适用）
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

  /** 切月/切年后清空当前维度所有成员的视图（byMember 全清） */
  _clearCurrentDimViews() {
    if (this.data.dimension === 'monthly') {
      this.setData({ monthlyByMember: {} });
    } else {
      this.setData({ yearlyByMember: {} });
    }
  },

  onSwitchDimension(e: WechatMiniprogram.TouchEvent) {
    const dim = (e.currentTarget.dataset as Record<string, string>).dim as 'monthly' | 'yearly';
    if (dim === this.data.dimension) return;
    this.setData({ dimension: dim });
    // 切维度后确保当前选中成员有数据
    void this._ensureMemberLoaded(this._getCurrentMemberKey());
  },

  // ─── 交互：年度月度行点击 → 切回月度 ─────────────────────────────────────

  onTapYearlyMonth(e: WechatMiniprogram.TouchEvent) {
    const month = (e.currentTarget.dataset as Record<string, number>).month as number;
    if (!month) return;
    const monthValue = `${this.data.currentYear}-${String(month).padStart(2, '0')}`;
    this.setData({
      dimension: 'monthly',
      currentMonth: monthValue,
      monthDisplay: formatMonthDisplay(monthValue),
      monthlyByMember: {},  // scope 变了，清月度视图
    });
    void this._loadData();
  },

  // ─── 交互：成员 Tab 点击 ────────────────────────────────────────────────────

  onTapMemberTab(e: WechatMiniprogram.TouchEvent) {
    const idx = parseInt((e.currentTarget.dataset as Record<string, string>).index, 10);
    if (Number.isNaN(idx) || idx === this.data.memberTabIndex) return;
    this.setData({
      memberTabIndex: idx,
      dataScrollIntoView: `mpane-${idx}`,
      memberScrollIntoView: `mtab-${idx}`,
    });
    this._lastScrollHandledIdx = idx;
    const mk = this.data.memberTabs[idx]?.key ?? 'all';
    void this._ensureMemberLoaded(mk);
  },

  // ─── 交互：数据区横向 scroll 节流（多人账本） ────────────────────────────────

  onPagesScroll(e: WechatMiniprogram.ScrollViewScroll) {
    const scrollLeft = e.detail.scrollLeft;
    const paneIdx = Math.round(scrollLeft / this._windowWidthPx);
    // 防抖：idx 没变则不 setData
    if (paneIdx === this._lastScrollHandledIdx) return;
    if (paneIdx < 0 || paneIdx >= this.data.memberTabs.length) return;
    this._lastScrollHandledIdx = paneIdx;
    this.setData({
      memberTabIndex: paneIdx,
      memberScrollIntoView: `mtab-${paneIdx}`,
    });
    const mk = this.data.memberTabs[paneIdx]?.key ?? 'all';
    void this._ensureMemberLoaded(mk);
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
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list });
      return;
    }

    if (item.l2Items.length > 0) {
      list[idx] = { ...item, expanded: true };
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list });
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
      // 重新读取 list（防止异步期间 setData 导致 stale）
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
        this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest });
      }
    } catch (err) {
      console.error('[statistics] drillDown L2 failed', err);
      const latestView = (this.data as unknown as Record<string, Record<string, MonthlyView | YearlyView>>)[dimKey][memberKey];
      if (!latestView) return;
      const listLatest = [...latestView.l1];
      const idxLatest = listLatest.findIndex((l) => l.category_id === id);
      if (idxLatest >= 0) {
        listLatest[idxLatest] = { ...listLatest[idxLatest], loadingL2: false };
        this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest });
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
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list });
      return;
    }
    if (l2.l3Items.length > 0) {
      l1.l2Items[l2Idx] = { ...l2, expanded: true };
      list[l1Idx] = l1;
      this.setData({ [`${dimKey}.${memberKey}.l1`]: list });
      return;
    }

    // 拉 L3
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
          this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest });
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
          this.setData({ [`${dimKey}.${memberKey}.l1`]: listLatest });
        }
      }
      wx.showToast({ title: '加载失败', icon: 'none' });
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
          // 切账本 → 清空所有数据 + 重新加载上下文（含成员列表）
          this.setData({
            ledgerName: selected.name,
            familyKind: selected.kind,
            monthlyByMember: {},
            yearlyByMember: {},
            memberTabIndex: 0,
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
