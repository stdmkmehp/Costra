// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-225 · 统计页月度视角实装
// 设计源: design/ui/design_spec.md §6.4 + design/ui/interaction_flow.md §5
// 配套后端: COSTRA-224（statistics API）· 公共组件: trend-line-chart（COSTRA-230）
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts toYuan）

import { toYuan } from '../../utils/money';
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
import { getFamilies, type FamilyItem } from '../../services/familyApi';
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
  /** L2 子分类排行（展开后填充） */
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
  amount: string;          // 已格式化
  note: string;
  dateLabel: string;       // 6月3日
  timeLabel: string;       // 14:30（24 小时制）
  shared: boolean;
  nickname: string;
  avatarUrl: string;
  initial: string;
}

interface MemberTabItem {
  key: string;       // 'all' | userId
  label: string;
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

    // 加载状态
    loading: true,

    // 月度数据（rendered）
    monthlyTotalExpense: '¥0.00',
    monthlyTotalIncome: '¥0.00',
    monthlyTotalBalance: '¥0.00',
    monthlyTrend: [] as number[],     // 传给 trend-line-chart
    monthlySummary: [] as SummaryGridItem[],
    monthlyL1: [] as L1Display[],
    monthlyL1HasMore: false,
    monthlyL1MoreCount: 0,

    // 年度数据
    yearlyTotalExpense: '¥0.00',
    yearlyTotalIncome: '¥0.00',
    yearlyTotalBalance: '¥0.00',
    yearlyTrend: [] as number[],
    yearlySummary: [] as SummaryGridItem[],
    yearlyMonths: [] as MonthRow[],
    yearlyL1: [] as L1Display[],
    yearlyL1HasMore: false,
    yearlyL1MoreCount: 0,

    // 成员 swiper 框架（COSTRA-229 框架预留 · 当前仅展示「全部」）
    memberTabs: [{ key: 'all', label: '全部' }] as MemberTabItem[],
    memberTabIndex: 0,

    // 空态
    isEmpty: false,
  },

  // 内部状态
  _familyId: '' as string,
  _ledgerId: '' as string,
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,
  _entrySavedHandler: null as (() => void) | null,
  _entryUpdatedHandler: null as (() => void) | null,
  _loadingPromise: null as Promise<void> | null,

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

    // 多人账本：构建 memberTabs 框架（仅"全部"一档 · 数据 R1 不按成员拉）
    // COSTRA-229 后续扩展：从 getFamilyMembers 拉 active 成员填充 memberTabs，
    // 触发 swiper change 时按成员拉数据。
    if (familyKind === 'shared') {
      this.setData({
        memberTabs: [{ key: 'all', label: '全部' }],
        memberTabIndex: 0,
      });
    } else {
      this.setData({
        memberTabs: [{ key: 'all', label: '全部' }],
        memberTabIndex: 0,
      });
    }
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
    if (this.data.dimension === 'monthly') {
      await this._loadMonthly();
    } else {
      await this._loadYearly();
    }
  },

  async _loadMonthly() {
    const month = this.data.currentMonth;
    // SWR：先用缓存渲染
    const cached = getCachedMonthly(this._familyId, month);
    if (cached) {
      this._buildMonthlyDisplay(cached);
    } else {
      this.setData({ loading: true });
    }
    try {
      const fresh = await getMonthlyStatistics(this._familyId, month);
      this._buildMonthlyDisplay(fresh);
    } catch (err) {
      console.error('[statistics] loadMonthly failed', err);
      this.setData({ loading: false });
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  async _loadYearly() {
    const year = this.data.currentYear;
    const cached = getCachedYearly(this._familyId, year);
    if (cached) {
      this._buildYearlyDisplay(cached);
    } else {
      this.setData({ loading: true });
    }
    try {
      const fresh = await getYearlyStatistics(this._familyId, year);
      this._buildYearlyDisplay(fresh);
    } catch (err) {
      console.error('[statistics] loadYearly failed', err);
      this.setData({ loading: false });
      wx.showToast({ title: '数据加载失败', icon: 'none' });
    }
  },

  // ─── 月度展示构建 ──────────────────────────────────────────────────────────

  _buildMonthlyDisplay(s: MonthlyStatistics) {
    const { totals, daily_trend, extremes, category_ranks } = s;

    const summary: SummaryGridItem[] = [
      { label: '日均支出', value: fmtYuan(extremes.avg_daily_expense) },
      { label: '最大单笔', value: fmtYuan(extremes.max_single_expense) },
      { label: '单日最高', value: fmtYuan(extremes.max_day_expense) },
      { label: '记账笔数', value: `${totals.entry_count}` },
    ];

    // 保留旧展开态：切 Tab 回到统计页时，新数据进来不应把已展开的下钻列表关掉。
    // 参考家庭页 detailRows 的做法，用旧列表的 category_id 索引把展开相关字段（expanded
    // / l2Items / l2HasMore / l2MoreCount）合并到新 L1 上。
    // 月份/年份/维度切换、SYNC_DONE 等场景已在调用方主动清空展开态，此处的 merge 不会
    // 错误地把陈旧的 L2/L3 数据带到新场景下。
    const l1: L1Display[] = category_ranks
      .slice(0, L1_VISIBLE)
      .map((c) => this._buildL1Display(c, this.data.monthlyL1));

    this.setData({
      monthlyTotalExpense: fmtYuan(totals.expense),
      monthlyTotalIncome: fmtYuan(totals.income),
      monthlyTotalBalance: fmtYuan(totals.balance),
      monthlyTrend: daily_trend.map((d) => d.expense),
      monthlySummary: summary,
      monthlyL1: l1,
      monthlyL1HasMore: category_ranks.length > L1_VISIBLE,
      monthlyL1MoreCount: Math.max(0, category_ranks.length - L1_VISIBLE),
      loading: false,
      isEmpty: totals.expense === 0 && totals.income === 0,
    });
  },

  /**
   * 构建单个 L1 显示对象。
   *
   * 新数据（金额/排名/icon/name）一律来自 API 返回的 c；展开相关字段
   * （expanded / l2Items / l2HasMore / l2MoreCount）若旧列表存在同 category_id
   * 的项则沿用其值，从而在 onShow → SWR 重渲染时不丢失下钻状态。
   *
   * 旧 L1 列表为空（如初次加载）时，展开态默认为 false（与全新进入页面一致）。
   */
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

  _buildYearlyDisplay(s: YearlyStatistics) {
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

    const l1: L1Display[] = category_ranks
      .slice(0, L1_VISIBLE)
      .map((c) => this._buildL1Display(c, this.data.yearlyL1));

    this.setData({
      yearlyTotalExpense: fmtYuan(totals.expense),
      yearlyTotalIncome: fmtYuan(totals.income),
      yearlyTotalBalance: fmtYuan(totals.balance),
      yearlyTrend: monthly_trend.map((m) => m.expense),
      yearlySummary: summary,
      yearlyMonths: months,
      yearlyL1: l1,
      yearlyL1HasMore: category_ranks.length > L1_VISIBLE,
      yearlyL1MoreCount: Math.max(0, category_ranks.length - L1_VISIBLE),
      loading: false,
      isEmpty: totals.expense === 0 && totals.income === 0,
    });
  },

  // ─── SYNC_DONE 响应式刷新 ──────────────────────────────────────────────────

  async _onSyncDone() {
    if (!this._familyId) return;
    if (this._loadingPromise) return;
    invalidateStatisticsCache(this._familyId);
    // 收起所有展开（数据可能变 · 避免显示陈旧 L2/L3）
    this._collapseCurrentDimL1();
    await this._loadData();
  },

  /**
   * 收起当前维度（monthly/yearly）所有 L1 的展开态 + 清空已拉的 L2/L3。
   *
   * 调用场景（数据源已失效，旧下钻数据可能陈旧）：
   *  - SYNC_DONE：服务端数据被修改
   *  - 切月份 / 切年份：scope 变了，旧 L2/L3 不再适用
   *
   * 不调用场景（旧下钻数据仍有效，应保留以提升 UX）：
   *  - onShow → _loadData：切 Tab 回来，scope 未变（_buildMonthlyDisplay 内做 merge）
   *  - 切维度：另一维度自身的展开态用户切回时仍期望保留
   */
  _collapseCurrentDimL1() {
    if (this.data.dimension === 'monthly') {
      this.setData({
        monthlyL1: this.data.monthlyL1.map((l1) => ({
          ...l1, expanded: false, l2Items: [], l2HasMore: false, l2MoreCount: 0,
        })),
      });
    } else {
      this.setData({
        yearlyL1: this.data.yearlyL1.map((l1) => ({
          ...l1, expanded: false, l2Items: [], l2HasMore: false, l2MoreCount: 0,
        })),
      });
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
    this._collapseCurrentDimL1();
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
    this._collapseCurrentDimL1();
    void this._loadData();
  },

  onMonthChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    this.setData({ currentMonth: value, monthDisplay: formatMonthDisplay(value) });
    this._collapseCurrentDimL1();
    void this._loadData();
  },

  onYearChange(e: WechatMiniprogram.PickerChange) {
    // year picker 用 fields=year，detail.value 形如 "2026"
    const value = e.detail.value as string;
    // 微信 picker year mode 仅返回完整日期 yyyy-mm-dd 中的年部分，做兜底
    const y = value.split('-')[0] || value;
    this.setData({ currentYear: y, yearDisplay: formatYearDisplay(y) });
    this._collapseCurrentDimL1();
    void this._loadData();
  },

  onSwitchDimension(e: WechatMiniprogram.TouchEvent) {
    const dim = (e.currentTarget.dataset as Record<string, string>).dim as 'monthly' | 'yearly';
    if (dim === this.data.dimension) return;
    // 切维度只切 dimension · 不清任何展开态：用户在月度展开 A、切到年度查询、再切回月度时，
    // 仍期望看到 A 是展开的（与"切 Tab 不丢"的诉求一致）。
    this.setData({ dimension: dim });
    void this._loadData();
  },

  // ─── 交互：年度月度行点击 → 切回月度 ─────────────────────────────────────

  onTapYearlyMonth(e: WechatMiniprogram.TouchEvent) {
    const month = (e.currentTarget.dataset as Record<string, number>).month as number;
    if (!month) return;
    const monthValue = `${this.data.currentYear}-${String(month).padStart(2, '0')}`;
    // 改 dimension + currentMonth · 等价于"切到月度的某个具体月份"。
    // 月度 L1 的 scope 变了（旧 L2/L3 是另一个月的），主动清空展开态后再 _loadData。
    this.setData({
      dimension: 'monthly',
      currentMonth: monthValue,
      monthDisplay: formatMonthDisplay(monthValue),
    });
    this._collapseCurrentDimL1(); // 此时 dimension 已是 monthly · 清月度 L1
    void this._loadData();
  },

  // ─── 交互：L1 一级分类展开 ─────────────────────────────────────────────────

  async onTapL1(e: WechatMiniprogram.TouchEvent) {
    const id = (e.currentTarget.dataset as Record<string, string>).id;
    if (!id) return;
    const key = this.data.dimension === 'monthly' ? 'monthlyL1' : 'yearlyL1';
    const list = (this.data as unknown as Record<string, L1Display[]>)[key];
    const idx = list.findIndex((l) => l.category_id === id);
    if (idx < 0) return;
    const item = list[idx];

    if (item.expanded) {
      // 收起
      list[idx] = { ...item, expanded: false };
      this.setData({ [key]: list });
      return;
    }

    // 展开 · 已有 l2Items 则直接展示，否则拉
    if (item.l2Items.length > 0) {
      list[idx] = { ...item, expanded: true };
      this.setData({ [key]: list });
      return;
    }
    list[idx] = { ...item, expanded: true, loadingL2: true };
    this.setData({ [key]: list });

    try {
      const scope = this.data.dimension === 'monthly'
        ? { month: this.data.currentMonth }
        : { year: this.data.currentYear };
      const res: DrillDownLevel2Response = await drillDownLevel2(
        this._familyId, scope, id, { limit: L2_VISIBLE + 1 },  // 多取 1 判断 has_more 简洁性
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
      const listLatest = (this.data as unknown as Record<string, L1Display[]>)[key];
      const idxLatest = listLatest.findIndex((l) => l.category_id === id);
      if (idxLatest >= 0) {
        listLatest[idxLatest] = {
          ...listLatest[idxLatest],
          loadingL2: false,
          l2Items,
          l2HasMore: hasMore,
          l2MoreCount: Math.max(0, res.total_count - L2_VISIBLE),
        };
        this.setData({ [key]: listLatest });
      }
    } catch (err) {
      console.error('[statistics] drillDown L2 failed', err);
      const listLatest = (this.data as unknown as Record<string, L1Display[]>)[key];
      const idxLatest = listLatest.findIndex((l) => l.category_id === id);
      if (idxLatest >= 0) {
        listLatest[idxLatest] = { ...listLatest[idxLatest], loadingL2: false };
        this.setData({ [key]: listLatest });
      }
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // ─── 交互：L2 二级分类展开 → L3 单笔明细 ─────────────────────────────────

  async onTapL2(e: WechatMiniprogram.TouchEvent) {
    const dataset = e.currentTarget.dataset as Record<string, string>;
    const l1Id = dataset.l1id;
    const l2Id = dataset.id;
    if (!l1Id || !l2Id) return;

    const key = this.data.dimension === 'monthly' ? 'monthlyL1' : 'yearlyL1';
    const list = (this.data as unknown as Record<string, L1Display[]>)[key];
    const l1Idx = list.findIndex((l) => l.category_id === l1Id);
    if (l1Idx < 0) return;
    const l1 = list[l1Idx];
    const l2Idx = l1.l2Items.findIndex((l) => l.category_id === l2Id);
    if (l2Idx < 0) return;
    const l2 = l1.l2Items[l2Idx];

    if (l2.expanded) {
      l1.l2Items[l2Idx] = { ...l2, expanded: false };
      list[l1Idx] = { ...l1 };
      this.setData({ [key]: list });
      return;
    }
    if (l2.l3Items.length > 0) {
      l1.l2Items[l2Idx] = { ...l2, expanded: true };
      list[l1Idx] = { ...l1 };
      this.setData({ [key]: list });
      return;
    }

    // 拉 L3
    l1.l2Items[l2Idx] = { ...l2, expanded: true, loadingL3: true };
    list[l1Idx] = { ...l1 };
    this.setData({ [key]: list });

    try {
      const scope = this.data.dimension === 'monthly'
        ? { month: this.data.currentMonth }
        : { year: this.data.currentYear };
      const res: DrillDownLevel3Response = await drillDownLevel3(
        this._familyId, scope, l2Id, { limit: L3_VISIBLE },
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
      const listLatest = (this.data as unknown as Record<string, L1Display[]>)[key];
      const l1IdxLatest = listLatest.findIndex((l) => l.category_id === l1Id);
      if (l1IdxLatest >= 0) {
        const l1Latest = listLatest[l1IdxLatest];
        const l2IdxLatest = l1Latest.l2Items.findIndex((l) => l.category_id === l2Id);
        if (l2IdxLatest >= 0) {
          l1Latest.l2Items[l2IdxLatest] = {
            ...l1Latest.l2Items[l2IdxLatest],
            loadingL3: false,
            l3Items,
            l3HasMore: res.has_more,
            l3MoreCount: Math.max(0, res.total_count - res.items.length),
          };
          listLatest[l1IdxLatest] = { ...l1Latest };
          this.setData({ [key]: listLatest });
        }
      }
    } catch (err) {
      console.error('[statistics] drillDown L3 failed', err);
      const listLatest = (this.data as unknown as Record<string, L1Display[]>)[key];
      const l1IdxLatest = listLatest.findIndex((l) => l.category_id === l1Id);
      if (l1IdxLatest >= 0) {
        const l1Latest = listLatest[l1IdxLatest];
        const l2IdxLatest = l1Latest.l2Items.findIndex((l) => l.category_id === l2Id);
        if (l2IdxLatest >= 0) {
          l1Latest.l2Items[l2IdxLatest] = { ...l1Latest.l2Items[l2IdxLatest], loadingL3: false };
          listLatest[l1IdxLatest] = { ...l1Latest };
          this.setData({ [key]: listLatest });
        }
      }
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // ─── 交互：账本切换（与明细页/家庭页一致）─────────────────────────────────

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
          this.setData({
            ledgerName: selected.name,
            familyKind: selected.kind,
            // 切换账本后清空 L1 折叠态
            monthlyL1: [],
            yearlyL1: [],
          });
          // 主动同步 + 重拉
          void syncOnce('ledger-switch');
          await this._loadData();
        },
      });
    } catch {
      wx.showToast({ title: '获取账本列表失败', icon: 'none' });
    }
  },

  // ─── 交互：成员 tabs（COSTRA-229 框架预留 · 当前仅「全部」一档）─────────

  onTapMemberTab(e: WechatMiniprogram.TouchEvent) {
    const idx = parseInt((e.currentTarget.dataset as Record<string, string>).index, 10);
    if (Number.isNaN(idx) || idx === this.data.memberTabIndex) return;
    this.setData({ memberTabIndex: idx });
    // TODO(COSTRA-229): 按 memberTabs[idx].key 拉成员维度数据
  },

  /** 阻止穿透 */
  noop() {},
});
