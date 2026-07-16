// pages/ledger/index.ts · 明细页（首屏 Tab1）
// 卡号: COSTRA-203 / COSTRA-214 / COSTRA-220 · 明细首屏巨大月支出+日期分组吸顶流水列表+左滑删除+账本切换+统一安全区+真实数据对接
// 设计源: design/ui/design_spec.md §6.2 + design/ui/interaction_flow.md §4
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）

import Decimal from '../../utils/vendor/decimal';
import { toYuan, parseClipboardToAmount } from '../../utils/money';
import { getSafeAreaMetrics, rpxToPx } from '../../utils/safeArea';
import { listMonthEntries, deleteEntry, updateEntryFields, putEntry, getEntry, type Entry, type MonthEntriesResult } from '../../services/db';
import { fetchMonthEntries } from '../../services/entriesApi';
import {
  isLedgerMonthRemoteEmptyConfirmed,
  markLedgerMonthRemoteEmptyConfirmed,
  clearLedgerMonthRemoteEmptyConfirmed,
} from '../../services/ledgerRemoteState';
import { newClientRefId } from '../../utils/id';
import { scheduleDeferredLoading, type DeferredLoadingHandle } from '../../utils/deferredLoading';
import { shanghaiDateKeyFromIso } from '../../utils/shanghaiDate';
import {
  getActiveLedgerId,
  getActiveFamilyId,
  getActiveFamilyKind,
  getActiveLedgerName,
  fallbackToPersonalFamily,
} from '../../services/family';
import { enqueue, hasPendingEntryOp } from '../../services/outbox';
import { getToken, hasValidSession } from '../../services/auth';
import { eventBus, EventNames, type SyncDonePayload, type ActiveFamilyChangedPayload, type ProfileUpdatedPayload, type LedgerDisplayReadyPayload } from '../../services/eventBus';
import { triggerOnPageShow } from '../../services/syncScheduler';
import { markPerf, markPerfError, setPerfContext } from '../../services/perf';
import { pickRandomSlogan } from '../../config/slogans';
import { getFamilies, getFamilyMembers } from '../../services/familyApi';
import {
  getCategories,
  getCategoryIconById,
  getCategoryNameById,
} from '../../services/categoryService';
import { loadCategoriesSync, refreshCategoryDataAsync } from '../../components/expense-overlay/categories';
import {
  INITIAL_CALC_STATE, inputDigit, inputDot,
  inputOperator, inputBackspace, pressEquals,
  pressClear, inputPaste,
  type CalcState,
} from '../../utils/calc';
import { buildAppShareContent, buildTimelineShareContent } from '../../utils/share';

// ─── 类型 ────────────────────────────────────────────────────────────────────────

/** 日期分组 */
interface DateGroup {
  /** 日期 key：YYYY-MM-DD */
  dateKey: string;
  /** 显示文字：6月1日 周日 */
  dateLabel: string;
  /** 当日支出总额（cents） */
  dayExpense: number;
  /** 当日收入总额（cents） */
  dayIncome: number;
  /** 当日条目 */
  entries: DisplayEntry[];
  /** 格式化后的日期汇总文字 */
  daySummary: string;
}

/** 展示用条目 */
interface DisplayEntry {
  client_ref_id: string;
  /** 分类名 / 备注 */
  label: string;
  /** 分类图标（单字母/符号） */
  icon: string;
  /** 金额展示文字 */
  amountText: string;
  /** expense / income / transfer · transfer 不计入月度收支 */
  type: 'expense' | 'income' | 'transfer';
  /** 是否有备注（备注替换分类名） */
  hasNote: boolean;
  /** 成员头像 URL（多人账本时） */
  avatarUrl: string;
  /** 成员昵称首字（头像加载失败时的 fallback） */
  memberInitial: string;
  /** 是否为公共支出（仅公共显示角标） */
  isShared: boolean;
  /** 滑动偏移量（左滑删除，rpx） */
  translateX: number;
  /** 左滑样式：仅在偏移量 > 0 时生成 transform，避免静止行创建合成层 */
  translateStyle: string;
}

/** 流水类型筛选状态（原 COSTRA-220 MVP 升级为多维筛选面板 · 现覆盖支出/收入/转移） */
type EntryTypeFilter = 'all' | 'personal' | 'shared' | 'income' | 'transfer';

/** 筛选按钮上流水类型的短标签（'all' 不展示） */
const ENTRY_TYPE_LABELS: Record<EntryTypeFilter, string> = {
  all: '',
  personal: '个人',
  shared: '公共',
  income: '收入',
  transfer: '转移',
};

interface FilterMemberItem {
  user_id: string;
  nickname: string;
  avatar_url: string;
  initial: string;
  selected: boolean;
}

type LedgerLoadingState =
  | 'bootstrapping'
  | 'validating-ledger'
  | 'loading-cache'
  | 'loading-remote'
  | 'ready-partial'
  | 'ready-full'
  | 'empty-confirmed'
  | 'failed';

// ─── 辅助函数 ────────────────────────────────────────────────────────────────────

/** 格式化金额为 -¥X,XXX.XX（带千分位 + 负号暗示支出） */
function formatAmountDisplay(cents: number): string {
  const yuanStr = toYuan(Math.abs(cents));
  const parts = yuanStr.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `-¥${intPart}.${parts[1]}`;
}

/** 格式化金额（不含¥，带千分位） */
function formatAmountShort(cents: number): string {
  const yuanStr = toYuan(Math.abs(cents));
  const parts = yuanStr.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${intPart}.${parts[1]}`;
}

/** 格式化条目金额文字（migration 0004：transfer 类无 +/- 前缀，不计收支） */
function formatEntryAmount(cents: number, type: 'expense' | 'income' | 'transfer'): string {
  const prefix = type === 'income' ? '+' : '';
  return `${prefix}¥${formatAmountShort(cents)}`;
}

/** 构建日期汇总文字 */
function buildDaySummary(dayExpense: number, dayIncome: number): string {
  const parts: string[] = [];
  if (dayExpense > 0) {
    parts.push(`支出 ¥${formatAmountShort(dayExpense)}`);
  }
  if (dayIncome > 0) {
    parts.push(`收入 ¥${formatAmountShort(dayIncome)}`);
  }
  return parts.join(' / ');
}

/** ISO 8601 UTC → Asia/Shanghai 日期 key YYYY-MM-DD */
function toDateKey(isoStr: string): string {
  return shanghaiDateKeyFromIso(isoStr);
}

/** 获取中文星期 */
function getWeekDay(dateKey: string): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const d = new Date(dateKey + 'T00:00:00');
  return days[d.getDay()];
}

/** 格式化日期标签：6月1日 周日 */
function formatDateLabel(dateKey: string): string {
  const parts = dateKey.split('-');
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  return `${month}月${day}日 ${getWeekDay(dateKey)}`;
}

/** 获取分类图标首字（COSTRA-219: 改为 categoryService 查找 · 降级显示 '?'） */
function getCategoryIcon(categoryId: string | null): string {
  return getCategoryIconById(categoryId);
}

/** 获取分类名（COSTRA-219: 改为 categoryService 查找 · 降级显示 '未分类'） */
function getCategoryName(categoryId: string | null): string {
  return getCategoryNameById(categoryId);
}

/** 当前月份 → picker 值 */
function getCurrentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** picker 值 → 显示文字 */
function formatMonthDisplay(value: string): string {
  const parts = value.split('-');
  return `${parts[0]}年${parseInt(parts[1], 10)}月`;
}

/** 当前月份是否为本机当前自然月 */
function isCurrentMonth(value: string): boolean {
  return value === getCurrentMonthValue();
}

/** 空态标题：当前月简洁展示，历史/未来月份带时间提醒 */
function buildEmptyTitle(monthValue: string): string {
  return isCurrentMonth(monthValue) ? '暂无记录' : `${formatMonthDisplay(monthValue)} 暂无记录`;
}

const LEDGER_RECENT_ENTRY_LIMIT = 50;
const SWIPE_SCROLL_IDLE_GRACE_MS = 220;

// ─── Page ─────────────────────────────────────────────────────────────────────────

Page({
  data: {
    // ─── 首屏保护 ───
    /** bootstrap 完成且已登录后才设为 true · 防止冷启动页面框架闪现 */
    ready: false,

    // ─── 导航栏 ───
    statusBarHeight: 0,
    navBarHeight: 44,
    navBarTotalHeight: 0,
    ledgerName: '个人账本',

    // ─── 头部汇总 ───
    currentMonth: getCurrentMonthValue(),
    monthDisplay: '',
    totalExpense: '¥0.00',
    totalExpenseCents: 0,
    totalIncomeCents: 0,
    totalBalance: '',
    showMemberFilter: false,
    memberFilterText: '全部',
    filterActive: false,
    filterPanelVisible: false,
    filterMembers: [] as FilterMemberItem[],
    filterEntryType: 'all' as EntryTypeFilter,

    // ─── 列表 ───
    dateGroups: [] as DateGroup[],
    isEmpty: true,
    emptyTitle: buildEmptyTitle(getCurrentMonthValue()),
    emptyHint: '',
    ledgerLoadingState: 'bootstrapping' as LedgerLoadingState,
    ledgerLoadingText: '正在准备账本…',
    ledgerLoadError: '',
    ledgerSkeletonRows: [1, 2, 3, 4],
    /** 流水列表底部留白：固定 TabBar 空间 + 底部视觉安全区 */
    entryListBottomPadding: 0,

    // ─── 左滑 ───
    swipingRefId: '',

    // ─── COSTRA-227: 编辑状态 ───
    editCategoryVisible: false,
    editTier1Categories: [] as { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[],
    editDedupedSubCategories: [] as { id: string; name: string; icon: string }[],
    editExpandedTier1Id: null as string | null,
    editExpandedChildren: [] as { id: string; name: string; icon: string }[],
    editSelectedTier1Id: '',
    editSelectedTier2Id: '',
    editDimmedTier1Ids: [] as string[],
    editingNoteRefId: '',
    editNoteValue: '',
    /** 正在编辑（金额/备注/分类）的流水 client_ref_id · 复用长按暖光高亮提醒用户当前编辑对象 */
    editActiveRefId: '',
    editAmountVisible: false,
    editAmountDisplay: '0',
    editAmountCalc: { ...INITIAL_CALC_STATE } as CalcState,
    editAmountShowShared: false,
    editAmountSharedType: 'personal' as 'personal' | 'shared',
    editAmountDate: '',
    editAmountDateText: '今天',
    editCategoryType: 'expense' as 'expense' | 'income' | 'transfer',
    /** 分类编辑只允许在原 entry.type 内改分类，避免 category.type 与 entry.type 不一致 */
    editCategoryLockedType: 'expense' as 'expense' | 'income' | 'transfer',
    /** COSTRA-228 / migration 0004: swiper current 绑定（0=支出 / 1=收入 / 2=转移） */
    editCategoryTypeIndex: 0,
    /** COSTRA-228: swiper 切换动画时长 */
    editCategorySwiperDuration: 240,
    editCategoryList: [] as { id: string; icon: string; name: string }[],
    editSelectedCategoryId: '',
    // COSTRA-228 / migration 0004: 三 pane 数据（手势横滑期间各 pane 都已渲染）
    editExpenseTier1Categories: [] as { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[],
    editIncomeTier1Categories: [] as { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[],
    editTransferTier1Categories: [] as { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[],
    editExpenseDedupedSubCategories: [] as { id: string; name: string; icon: string }[],
    editIncomeDedupedSubCategories: [] as { id: string; name: string; icon: string }[],
    editTransferDedupedSubCategories: [] as { id: string; name: string; icon: string }[],

    // ─── 列表滚动位置（COSTRA-220: 月份切换后滚动到顶部） ───
    listScrollTop: 0,

    // ─── 长按上下文菜单 ───
    ctxMenuVisible: false,
    /** 菜单卡片左上角定位（px） */
    ctxMenuTop: 0,
    ctxMenuLeft: 0,
    /** 当前被长按操作的流水（用于目标行暖光弱提醒） */
    ctxActiveRefId: '',
  },

  // 内部状态
  _ledgerId: '' as string,
  _familyId: '' as string,
  _allEntries: [] as Entry[],
  _touchStartX: 0 as number,
  _touchStartY: 0 as number,
  _touchRefId: '' as string,
  _swipeStarted: false as boolean,
  /** 当前手势已锁定为横向左滑；锁定期间 scroll 事件不能复位左滑，避免滚动惯性与横滑互相打架 */
  _horizontalSwipeActive: false as boolean,
  /** 横滑结束后等待 scroll-view 惯性滚动完全静止；期间 scroll 事件不复位左滑 */
  _swipeScrollSettling: false as boolean,
  _swipeScrollIdleTimer: null as ReturnType<typeof setTimeout> | null,
  _lastSwipeEndAt: 0 as number,
  _shouldRefreshEmptyHintOnNextEmpty: false as boolean,
  /** 分类编辑面板横滑手势起点（用于识别横滑并弹「不能跨类型」弱提示） */
  _editCatTouchX: 0 as number,
  _editCatTouchY: 0 as number,
  /** 「不能跨类型修改分类」弱提示节流时间戳（防连滑/连点刷屏） */
  _lastTypeLockToastAt: 0 as number,
  /** 流水类型筛选状态 */
  _filterEntryType: 'all' as EntryTypeFilter,
  /** 成员筛选：选中的 user_id 集合（空 = 全选） */
  _filterSelectedMemberIds: [] as string[],
  /** 当前用户 ID（COSTRA-220: 从 auth token 获取 · 用于成员筛选） */
  _currentUserId: '' as string,
  /** 成员映射（user_id → nickname/avatar · 协作账本时构建） */
  _memberMap: {} as Record<string, { nickname: string; avatarUrl: string }>,
  /** eventBus 订阅 handler（COSTRA-220: 防内存泄漏） */
  _entrySavedHandler: null as (() => void) | null,
  /** eventBus 订阅 handler（COSTRA-227: 编辑保存刷新） */
  _entryUpdatedHandler: null as (() => void) | null,
  /** eventBus 订阅 handler（sync-refresh: SYNC_DONE 后即时刷新） */
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,
  /** eventBus 订阅 handler（分类预热完成 · 触发条目展示重渲，避免 fallback UUID 不匹配的"未分类"残留） */
  _categoriesLoadedHandler: null as (() => void) | null,
  /** eventBus 订阅 handler（2026-06-08: 跨页面账本切换响应） */
  _activeFamilyChangedHandler: null as ((payload?: unknown) => void) | null,
  /** eventBus 订阅 handler（画像变更后即时刷新 _memberMap 中当前用户头像） */
  _profileUpdatedHandler: null as ((payload?: unknown) => void) | null,
  /**
   * 当前已渲染 entries 的签名（sync-refresh: 签名 diff 跳过无效 setData，避免列表跳动）
   * 仅拼接影响视觉的字段（不含 version/updated_at —— 服务端版本变化但视觉不变时无需重渲）：
   * client_ref_id|occurred_at|amount|type|category_id|note|deleted_at|shared_type|created_by
   */
  _entriesSignature: '' as string,
  /** 当前已渲染内容所属账本，用于切回时保留旧画面但避免账本切换误展示 */
  _renderedLedgerId: '' as string,
  /** 当前已渲染内容所属月份 */
  _renderedMonth: '' as string,
  /** 首次首屏完成事件是否已发出 */
  _displayReadyEmitted: false as boolean,
  /** 本地读取阶段 loading-cache 的延迟显示句柄，避免快路径闪转圈 */
  _ledgerLoadingDeferredHandle: null as DeferredLoadingHandle | null,
  /** COSTRA-227: 当前正在编辑的条目 client_ref_id */
  _editingRefId: '' as string,

  /** 长按上下文菜单：目标流水 client_ref_id */
  _ctxRefId: '' as string,
  /** 复制流水进行中的源 refId（防重复触发生成多条副本） */
  _copyingRefId: '' as string,
  /** 上下文菜单是否打开（打开期间屏蔽列表滑动，防误触发左滑） */
  _contextMenuOpen: false as boolean,
  /** 窗口可视区宽高（px，onLoad 记一次，用于菜单定位防溢出） */
  _winW: 0 as number,
  _winH: 0 as number,

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  _refreshSafeAreaLayout(force = false) {
    // COSTRA-214: 使用统一安全区服务替代直接调用 wx.getWindowInfo()
    const { statusBarHeight, navBarHeight, navBarTotalHeight, windowWidth, windowHeight, visualSafeAreaBottom } = getSafeAreaMetrics({ force });
    // 长按上下文菜单定位需要可视区宽高（px），复用统一安全区服务的窗口指标
    this._winW = windowWidth;
    this._winH = windowHeight;
    this.setData({
      statusBarHeight,
      navBarHeight,
      navBarTotalHeight,
      entryListBottomPadding: Math.round(rpxToPx(120, windowWidth) + visualSafeAreaBottom),
    });
  },

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    this._refreshSafeAreaLayout();
    this.setData({
      monthDisplay: formatMonthDisplay(this.data.currentMonth),
      emptyHint: pickRandomSlogan(),
    });

    // COSTRA-220: 获取当前 userId（bootstrap 完成后才有 token）
    interface AppWithBootstrap { bootstrapPromise: Promise<void> }
    void getApp<AppWithBootstrap>().bootstrapPromise.then(() => {
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      const token = getToken();
      if (token?.raw?.user?.id) {
        this._currentUserId = token.raw.user.id;
        // 预填当前用户到 memberMap（协作账本条目头像不必等 getFamilyMembers 返回）
        const u = token.raw.user;
        if (!this._memberMap[u.id]) {
          this._memberMap[u.id] = {
            nickname: u.nickname || '我',
            avatarUrl: u.avatar_url || '',
          };
        }
      }
    });

    // COSTRA-220: 订阅 ENTRY_SAVED 事件 → 响应式刷新明细页
    const handler = () => { this._onEntrySaved(); };
    this._entrySavedHandler = handler;
    eventBus.on(EventNames.ENTRY_SAVED, handler);

    // COSTRA-227: 订阅 ENTRY_UPDATED 事件 → 编辑保存后刷新明细页
    const updatedHandler = () => { this._onEntryUpdated(); };
    this._entryUpdatedHandler = updatedHandler;
    eventBus.on(EventNames.ENTRY_UPDATED, updatedHandler);

    // sync-refresh: 订阅 SYNC_DONE 事件 → sync 完成后即时刷新明细页（仅在 pulled > 0 时）
    const syncDoneHandler = (payload?: unknown) => {
      const p = payload as SyncDonePayload | undefined;
      // ledger 只关心 pulled（本地 storage 数据可能已变）；pushed 仅是本机数据上行，不影响明细页展示
      if (!p || p.pulled <= 0) return;
      void this._refreshIfChanged();
    };
    this._syncDoneHandler = syncDoneHandler;
    eventBus.on(EventNames.SYNC_DONE, syncDoneHandler);

    // 2026-06-05: 订阅 CATEGORIES_LOADED 事件 → 分类预热完成后重渲展示
    // 解决"清理数据/弱网首启时 fallback UUID 不匹配真实条目 category_id，导致全部显示'未分类'"问题
    const categoriesLoadedHandler = () => {
      if (this._allEntries.length > 0) {
        this._buildDisplay();
      }
    };
    this._categoriesLoadedHandler = categoriesLoadedHandler;
    eventBus.on(EventNames.CATEGORIES_LOADED, categoriesLoadedHandler);

    // 2026-06-08: 订阅 ACTIVE_FAMILY_CHANGED · 跨页面账本切换响应
    // 自身 onTapLedgerName 已就地刷新到目标 ledger_id，事件到达时 ID 比对自然 noop。
    const activeFamilyChangedHandler = (payload?: unknown) => {
      const p = payload as ActiveFamilyChangedPayload | undefined;
      if (!p) return;
      if (this._ledgerId === p.ledger_id) return;
      void this._onActiveFamilyChanged();
    };
    this._activeFamilyChangedHandler = activeFamilyChangedHandler;
    eventBus.on(EventNames.ACTIVE_FAMILY_CHANGED, activeFamilyChangedHandler);

    // 画像变更后即时刷新 _memberMap 中当前用户头像（不必等 onShow 重拉 getFamilyMembers）
    const profileUpdatedHandler = (payload?: unknown) => {
      const p = payload as ProfileUpdatedPayload | undefined;
      if (!p || !this._currentUserId) return;
      if (this._memberMap[this._currentUserId]) {
        this._memberMap[this._currentUserId].avatarUrl = p.avatarUrl || '';
        this._memberMap[this._currentUserId].nickname = p.nickname || '我';
        // 重渲列表（条目头像来自 _memberMap）
        if (this._allEntries.length > 0) {
          this._buildDisplay();
        }
      }
    };
    this._profileUpdatedHandler = profileUpdatedHandler;
    eventBus.on(EventNames.PROFILE_UPDATED, profileUpdatedHandler);
  },

  async onShow() {
    // COSTRA-127 范式：onShow 加 bootstrapPromise gate · 主防线
    // - 未登录：reLaunch 到 login，不加载任何数据（防止冷启动时先闪明细页内容）
    // - 已登录：设 ready=true 解锁渲染，再正常加载数据
    // ready gate：bootstrap 完成且已登录才设 true，保证 WXML 在这之前完全空白，
    //   彻底消除冷启动"先闪明细框架再跳登录"的问题
    const app = getApp<{ bootstrapPromise: Promise<void> }>();
    await app.bootstrapPromise;
    if (!hasValidSession()) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.setData({ ready: true });
    // tabbar 自治 hidden（由 _unlocked + _panelOpen 合成）· 此处仅同步 selected 并解锁
    (this.getTabBar?.() as { markActive?: (idx: number) => void } | undefined)?.markActive?.(0);
    try {
      await this._loadContext();
      await this._loadEntries();
      // sync-refresh: 与其他 tab 页（statistics/family/mine）保持一致 · 切回明细页时触发同步（debounce 5s 内防重）
      triggerOnPageShow('ledger');
    } catch (err) {
      markPerfError('ledger.load.failed', err);
      this._setLedgerLoadingState('failed', '流水加载失败，请稍后重试', err instanceof Error ? err.message : String(err));
      // 首屏以失败态结算 · 释放后台预热，避免失败阻塞非首屏预热
      this._emitLedgerDisplayFailed();
    }
  },

  onResize() {
    this._refreshSafeAreaLayout(true);
  },

  onUnload() {
    // COSTRA-220: 取消订阅 ENTRY_SAVED 事件（防内存泄漏）
    if (this._entrySavedHandler) {
      eventBus.off(EventNames.ENTRY_SAVED, this._entrySavedHandler);
      this._entrySavedHandler = null;
    }
    // COSTRA-227: 取消订阅 ENTRY_UPDATED 事件
    if (this._entryUpdatedHandler) {
      eventBus.off(EventNames.ENTRY_UPDATED, this._entryUpdatedHandler);
      this._entryUpdatedHandler = null;
    }
    // sync-refresh: 取消订阅 SYNC_DONE 事件
    if (this._syncDoneHandler) {
      eventBus.off(EventNames.SYNC_DONE, this._syncDoneHandler);
      this._syncDoneHandler = null;
    }
    // 2026-06-05: 取消订阅 CATEGORIES_LOADED 事件
    if (this._categoriesLoadedHandler) {
      eventBus.off(EventNames.CATEGORIES_LOADED, this._categoriesLoadedHandler);
      this._categoriesLoadedHandler = null;
    }
    // 2026-06-08: 取消订阅 ACTIVE_FAMILY_CHANGED
    if (this._activeFamilyChangedHandler) {
      eventBus.off(EventNames.ACTIVE_FAMILY_CHANGED, this._activeFamilyChangedHandler);
      this._activeFamilyChangedHandler = null;
    }
    // 画像变更：取消订阅 PROFILE_UPDATED
    if (this._profileUpdatedHandler) {
      eventBus.off(EventNames.PROFILE_UPDATED, this._profileUpdatedHandler);
      this._profileUpdatedHandler = null;
    }
    this._cancelDeferredLedgerLoading();
    this._endSwipeScrollSettling();
  },

  // ─── 数据加载 ────────────────────────────────────────────────────────────────

  _setLedgerLoadingState(state: LedgerLoadingState, text?: string, error?: string) {
    const fallbackText: Record<LedgerLoadingState, string> = {
      'bootstrapping': '正在准备账本…',
      'validating-ledger': '正在验证账本…',
      'loading-cache': '正在读取本地流水…',
      'loading-remote': '正在同步最近流水…',
      'ready-partial': '统计更新中…',
      'ready-full': '',
      'empty-confirmed': '',
      'failed': '流水加载失败，请稍后重试',
    };
    this.setData({
      ledgerLoadingState: state,
      ledgerLoadingText: text ?? fallbackText[state],
      ledgerLoadError: error || '',
    });
    markPerf('ledger.loading-state', { state });
  },

  _deferLedgerLoadingState(state: LedgerLoadingState, text?: string) {
    this._cancelDeferredLedgerLoading();
    this._ledgerLoadingDeferredHandle = scheduleDeferredLoading(() => {
      this._setLedgerLoadingState(state, text);
    });
  },

  _cancelDeferredLedgerLoading() {
    if (!this._ledgerLoadingDeferredHandle) return;
    this._ledgerLoadingDeferredHandle.cancel();
    this._ledgerLoadingDeferredHandle = null;
  },

  async _loadContext() {
    markPerf('ledger.context.start');
    // 仅在无可复用渲染内容时才进「验证账本」骨架态。
    // 此刻 _ledgerId 仍是切换前的值：热刷新（同账本切回）判真 → 跳过骨架，列表原地保留；
    // 切账本场景此处判真跳过，过渡由后续 _loadEntries 的 loading-cache 冷加载骨架承载。
    if (!this._hasRenderableContent()) {
      this._deferLedgerLoadingState('validating-ledger');
    }
    const [ledgerId, familyId, familyKind, ledgerName] = await Promise.all([
      getActiveLedgerId(),
      getActiveFamilyId(),
      getActiveFamilyKind(),
      getActiveLedgerName(),
    ]);
    this._ledgerId = ledgerId || '';
    this._familyId = familyId || '';

    // COSTRA-220: 用 family_kind 替代 !== 'solo' 硬编码判断
    const isMultiMember = familyKind === 'shared';
    setPerfContext({
      ledger: familyKind || 'unknown',
      activeContext: ledgerId && familyId ? 'present' : 'missing',
    });
    // 账本名直接用本地持久化的名称直出，不再于关键路径同步 getFamilies（无网会卡到超时）。
    const displayLedgerName = ledgerName
      || (familyKind === 'personal' ? '个人账本' : familyKind === 'shared' ? '协作账本' : '账本待同步');

    this.setData({
      showMemberFilter: isMultiMember,
      // 仅明确 personal 时 fallback 为“个人账本”；unknown/partial context 不再误显示个人账本。
      ledgerName: displayLedgerName,
    });

    // 协作账本成员资格校验移出关键路径，后台 fire-and-forget：
    // 仍是成员则以服务端名称纠正；被移出才回退个人账本 + 重载（属低频操作，允许加载过渡）；
    // 无网/超时/上下文已变则静默忽略，保留当前已展示内容，绝不清空界面。
    if (isMultiMember && familyId) {
      void this._validateFamilyMembership(familyId, this._ledgerId);
    }

    // 切换到非共享账本时重置筛选（个人账本无成员/性质筛选维度）
    if (!isMultiMember) {
      this._resetFiltersForNonShared();
    }

    // 协作账本: 加载成员映射（用于条目行头像展示）
    if (isMultiMember && familyId) {
      void this._loadMemberMap(familyId);
    } else {
      this._memberMap = {};
    }

    // COSTRA-219: 预加载分类数据到内存缓存（供 getCategoryIconById/getCategoryNameById 查找）
    // 2026-06-05: fire-and-forget，不阻塞明细页渲染。
    // categoryService 内部命中 storage 缓存会立即 warmUpMemoryCache，否则走网络后再 warmUp；
    // 全部失败时由 fallback 兜底（getCategoryIconById/getCategoryNameById 内部已处理）。
    // 完成后由 CATEGORIES_LOADED 事件统一触发条目展示重渲（订阅在 onLoad 注册）。
    if (familyId) {
      void getCategories(familyId).catch(() => { /* 静默：fallback 兜底 */ });
    }
    this._cancelDeferredLedgerLoading();
    markPerf('ledger.context.done', {
      ledger: familyKind || 'unknown',
      shared: isMultiMember,
      hasLedgerId: !!this._ledgerId,
      hasFamilyId: !!this._familyId,
    });
  },

  /**
   * 重置筛选维度到「全部」（切换 / 回退到非共享账本时调用）。
   * 个人账本不存在成员与公共/个人性质筛选，必须清空旧协作账本残留的筛选条件，
   * 否则 _buildDisplay 会用旧筛选过滤个人账本流水，导致列表 / 汇总错误为空或不全。
   */
  _resetFiltersForNonShared() {
    this._filterEntryType = 'all';
    this._filterSelectedMemberIds = [];
    this.setData({
      filterEntryType: 'all',
      filterMembers: [],
      filterActive: false,
      filterPanelVisible: false,
      memberFilterText: '全部',
    });
  },

  /** 加载成员映射（协作账本条目行头像用） */
  async _loadMemberMap(familyId: string) {
    try {
      const members = await getFamilyMembers(familyId);
      const map: Record<string, { nickname: string; avatarUrl: string }> = {};
      const filterMembers: FilterMemberItem[] = [];
      for (const m of members) {
        map[m.user_id] = {
          nickname: m.nickname || '成员',
          avatarUrl: m.avatar_url || '',
        };
        // 筛选面板仅展示 active 成员
        if (m.status === 'active') {
          filterMembers.push({
            user_id: m.user_id,
            nickname: m.nickname || '成员',
            avatar_url: m.avatar_url || '',
            initial: (m.nickname || '成员')[0],
            selected: this._filterSelectedMemberIds.length === 0
              || this._filterSelectedMemberIds.includes(m.user_id),
          });
        }
      }
      // 合并：保留 bootstrap 预填的当前用户信息，避免极端情况下覆盖丢失
      this._memberMap = { ...this._memberMap, ...map };
      this.setData({ filterMembers });
      // 成员信息到位后重新渲染（此时条目可能已渲染但头像为空）
      if (this._allEntries.length > 0) {
        this._buildDisplay();
      }
    } catch {
      // 网络失败时静默，条目行不显示头像即可
    }
  },

  /**
   * 后台静默校验协作账本成员资格（已移出关键路径，不阻塞渲染）。
   * - 仍是成员：以服务端权威名称纠正本地账本名（必要时）。
   * - 明确被移出：回退个人账本并重载流水（带 toast）。
   * - 无网/超时/上下文已变/回退异常：静默忽略，保留本地已展示内容，绝不清空界面。
   */
  async _validateFamilyMembership(familyId: string, ledgerId: string) {
    try {
      const { families } = await getFamilies();
      // 校验期间用户已切换上下文（账本或 family 任一变化）→ 放弃，避免回退到过期账本
      if (this._familyId !== familyId || this._ledgerId !== ledgerId) return;
      const matched = families.find((f) => f.id === familyId && f.ledger_id === ledgerId);
      if (matched) {
        const name = matched.ledger_name || matched.name;
        if (name && name !== this.data.ledgerName) {
          this.setData({ ledgerName: name });
        }
        markPerf('ledger.context.validate', { result: 'member' });
        return;
      }
      // 明确被移出 → 回退个人账本
      const fallback = await fallbackToPersonalFamily('family-switch');
      if (this._familyId !== familyId || this._ledgerId !== ledgerId) return;
      wx.showToast({ title: '你已不在该账本中', icon: 'none' });
      if (fallback) {
        this._familyId = fallback.family_id;
        this._ledgerId = fallback.ledger_id;
        // 回退到个人账本：隐藏成员入口 + 清空协作账本残留的筛选与成员映射，
        // 否则 _loadEntries 重载后 _buildDisplay 会用旧协作筛选过滤个人流水。
        this._memberMap = {};
        this._resetFiltersForNonShared();
        this.setData({ showMemberFilter: false, ledgerName: fallback.ledger_name || '个人账本' });
        setPerfContext({ ledger: fallback.family_kind || 'personal', activeContext: 'fallback-personal' });
        markPerf('ledger.context.validate', { result: 'fallback-personal' });
        // 回退到新账本 → 重新加载流水（不同账本，自动走冷加载路径）
        await this._loadEntries();
      } else {
        markPerf('ledger.context.validate', { result: 'family-missing-no-fallback' });
      }
    } catch {
      // 无网/超时/回退异常：静默保留本地已展示内容（绝不清空界面），仅记录埋点便于排查。
      markPerf('ledger.context.validate', { result: 'ignored-error' });
    }
  },

  /**
   * 是否已有可复用的渲染内容（区分冷加载 vs 热刷新的唯一判定）。
   * 真：当前已渲染内容属于同一账本（指定月份时同月），可在屏保留并静默校验/更新。
   *     —— 空月份(empty-confirmed)同样视为「已结算可保留」，避免热刷新时空态闪骨架。
   * 假：首屏未渲染 / 切换了账本 / 切换了月份 —— 允许走加载过渡（骨架）。
   */
  _hasRenderableContent(targetMonth?: string): boolean {
    if (!this._renderedLedgerId || this._renderedLedgerId !== this._ledgerId) return false;
    if (targetMonth && this._renderedMonth !== targetMonth) return false;
    return true;
  },

  async _loadEntries(monthValue?: string) {
    const targetMonth = monthValue || this.data.currentMonth;
    markPerf('ledger.entries.start', { month: targetMonth, hasLedgerId: !!this._ledgerId });
    if (!this._ledgerId) {
      this._allEntries = [];
      this._entriesSignature = '';
      this._renderedLedgerId = '';
      this._renderedMonth = '';
      this.setData({
        dateGroups: [],
        isEmpty: true,
        emptyTitle: buildEmptyTitle(targetMonth),
        emptyHint: this.data.emptyHint || pickRandomSlogan(),
        totalExpense: '¥0.00',
        totalBalance: '',
        totalExpenseCents: 0,
        totalIncomeCents: 0,
      });
      this._setLedgerLoadingState('failed', '账本还没准备好，请稍后重试');
      markPerf('ledger.entries.done', { skipped: 'no-ledger' });
      // 首屏无可用账本同样视为「已结算」· 释放后台预热
      this._emitLedgerDisplayFailed();
      return;
    }

    // 热刷新：已有可复用的当前账本+月份渲染内容 → 全量本地读 + 签名 diff 静默更新。
    // 不进骨架、不走 ready-partial 两段式：无变化则一帧不动，有变化则原地替换。
    if (this._hasRenderableContent(targetMonth)) {
      await this._reloadCurrentMonthSilently(targetMonth);
      return;
    }

    // 冷加载：无可复用内容（首屏 / 切账本 / 切月 / 被踢出回退）→ 先读本地。
    // loading-cache 采用 deferred 显示：本地快路径直接渲染，不让转圈闪一下。
    const ledgerId = this._ledgerId;
    this._deferLedgerLoadingState('loading-cache');
    const recentResult = await listMonthEntries({
      ledger_id: ledgerId,
      month: targetMonth,
      limit: LEDGER_RECENT_ENTRY_LIMIT,
    });
    this._cancelDeferredLedgerLoading();

    // await 期间上下文（账本 / 月份）已变 → 放弃落地，交由新触发的加载接管，避免旧结果覆盖新画面。
    // 切月（onPrevMonth/onNextMonth/onMonthChange 不 await）与切账本并发时由此守护防错配。
    if (this._ledgerId !== ledgerId || this.data.currentMonth !== targetMonth) {
      markPerf('ledger.entries.skip', { reason: 'context-changed', month: targetMonth });
      return;
    }

    // 本地完整为空时，必须区分「远端已确认空」与「远端尚未确认」。
    // 未确认前不能直接展示 empty-confirmed，否则删除小程序/清缓存后会误导用户以为流水消失。
    if (recentResult.complete && recentResult.entries.length === 0) {
      const remoteEmptyConfirmed = await isLedgerMonthRemoteEmptyConfirmed(ledgerId, targetMonth);
      if (this._ledgerId !== ledgerId || this.data.currentMonth !== targetMonth) {
        markPerf('ledger.entries.skip', { reason: 'context-changed-after-empty-check', month: targetMonth });
        return;
      }
      if (!remoteEmptyConfirmed) {
        this._allEntries = [];
        this._entriesSignature = '';
        this._setLedgerLoadingState('loading-remote');
        await this._hydrateRemoteMonthEntries(targetMonth, ledgerId);
        return;
      }
    }

    if (recentResult.entries.length > 0) {
      await clearLedgerMonthRemoteEmptyConfirmed(ledgerId, targetMonth);
    }

    this._allEntries = recentResult.entries;
    setPerfContext({
      entryCache: recentResult.source,
      dataState: recentResult.complete
        ? (recentResult.entries.length > 0 ? 'full' : 'empty')
        : 'partial',
    });
    // sync-refresh: 维护签名 · 后续 SYNC_DONE 触发的 _refreshIfChanged 据此判断是否真的有变化
    this._entriesSignature = this._computeEntriesSignature(this._allEntries);
    this._buildDisplay(targetMonth);
    if (recentResult.complete) {
      this._setLedgerLoadingState(this._allEntries.length > 0 ? 'ready-full' : 'empty-confirmed');
    } else {
      this.setData({
        totalExpense: '统计更新中',
        totalBalance: `已先展示最近 ${this._allEntries.length} 条流水`,
      });
      this._setLedgerLoadingState('ready-partial', '整月统计更新中…');
      void this._loadFullMonthEntries(targetMonth, ledgerId, recentResult);
    }
    markPerf('ledger.entries.done', {
      month: targetMonth,
      count: this._allEntries.length,
      totalIndexed: recentResult.totalIndexed,
      source: recentResult.source,
      complete: recentResult.complete,
      limit: LEDGER_RECENT_ENTRY_LIMIT,
    });
    markPerf('ledger.display.done', {
      month: targetMonth,
      count: this._allEntries.length,
      empty: this._allEntries.length === 0,
      partial: !recentResult.complete,
    });
    this._emitLedgerDisplayReady(targetMonth, this._allEntries.length);
  },

  async _putRemoteEntryIfSafe(entry: Entry): Promise<boolean> {
    const local = await getEntry(entry.client_ref_id);
    const hasPending = await hasPendingEntryOp(entry.client_ref_id);
    if (hasPending) {
      markPerf('ledger.entries.remote.skip-entry', { reason: 'pending-op', ref: entry.client_ref_id });
      return false;
    }
    if (local?.deleted_at) {
      const localVer = local.version ?? 0;
      const remoteVer = entry.version ?? 0;
      if (localVer >= remoteVer) {
        markPerf('ledger.entries.remote.skip-entry', { reason: 'local-deleted-newer-or-equal', ref: entry.client_ref_id });
        return false;
      }
    }
    if (local && !local.deleted_at) {
      const localVer = local.version ?? 0;
      const remoteVer = entry.version ?? 0;
      if (localVer > remoteVer) {
        markPerf('ledger.entries.remote.skip-entry', { reason: 'local-newer', ref: entry.client_ref_id });
        return false;
      }
    }
    await putEntry(entry);
    return true;
  },

  async _hydrateRemoteMonthEntries(monthValue: string, ledgerId: string) {
    markPerf('ledger.entries.remote.start', { month: monthValue, ledgerId });
    try {
      let cursor: string | null = null;
      let remoteCount = 0;
      let writtenCount = 0;
      let hasMore = false;
      do {
        const remoteResult = await fetchMonthEntries({
          ledgerId,
          month: monthValue,
          limit: 100,
          cursor,
        });
        if (this._ledgerId !== ledgerId || this.data.currentMonth !== monthValue) {
          markPerf('ledger.entries.remote.skip', { reason: 'context-changed', month: monthValue });
          return;
        }
        remoteCount += remoteResult.entries.length;
        for (const entry of remoteResult.entries) {
          if (await this._putRemoteEntryIfSafe(entry)) {
            writtenCount += 1;
          }
        }
        cursor = remoteResult.nextCursor;
        hasMore = !!cursor;
      } while (cursor);

      if (remoteCount === 0 && !hasMore) {
        await markLedgerMonthRemoteEmptyConfirmed(ledgerId, monthValue);
      } else if (writtenCount > 0) {
        await clearLedgerMonthRemoteEmptyConfirmed(ledgerId, monthValue);
      }

      const fullResult = await listMonthEntries({ ledger_id: ledgerId, month: monthValue });
      if (this._ledgerId !== ledgerId || this.data.currentMonth !== monthValue) {
        markPerf('ledger.entries.remote.skip', { reason: 'context-changed-after-write', month: monthValue });
        return;
      }

      if (fullResult.entries.length > 0) {
        await clearLedgerMonthRemoteEmptyConfirmed(ledgerId, monthValue);
      }
      this._allEntries = fullResult.entries;
      this._entriesSignature = this._computeEntriesSignature(this._allEntries);
      this._buildDisplay(monthValue);
      setPerfContext({
        entryCache: fullResult.source,
        dataState: fullResult.entries.length > 0 ? 'full' : 'empty',
      });

      this._setLedgerLoadingState(fullResult.entries.length > 0 ? 'ready-full' : 'empty-confirmed');

      markPerf('ledger.entries.remote.done', {
        month: monthValue,
        remoteCount,
        writtenCount,
        localCount: fullResult.entries.length,
        hasMore,
      });
      markPerf('ledger.display.done', {
        source: 'remote-hydrate',
        month: monthValue,
        count: fullResult.entries.length,
        empty: fullResult.entries.length === 0,
        partial: hasMore,
      });
      this._emitLedgerDisplayReady(monthValue, fullResult.entries.length);
    } catch (err) {
      if (this._ledgerId !== ledgerId || this.data.currentMonth !== monthValue) return;
      markPerfError('ledger.entries.remote.failed', err, { month: monthValue });
      this._setLedgerLoadingState('failed', '流水同步失败，请稍后重试', err instanceof Error ? err.message : String(err));
      this._emitLedgerDisplayFailed();
    }
  },

  async _loadFullMonthEntries(monthValue: string, ledgerId: string, recentResult?: MonthEntriesResult) {
    markPerf('ledger.entries.full.start', { month: monthValue, ledgerId, recentCount: recentResult?.entries.length ?? 0 });
    try {
      const fullResult = await listMonthEntries({ ledger_id: ledgerId, month: monthValue });
      if (this._ledgerId !== ledgerId || this.data.currentMonth !== monthValue) {
        markPerf('ledger.entries.full.skip', { reason: 'context-changed', month: monthValue });
        return;
      }
      if (fullResult.entries.length > 0) {
        await clearLedgerMonthRemoteEmptyConfirmed(ledgerId, monthValue);
      }
      const nextSig = this._computeEntriesSignature(fullResult.entries);
      this._setLedgerLoadingState(fullResult.entries.length > 0 ? 'ready-full' : 'empty-confirmed');
      if (nextSig === this._entriesSignature) {
        markPerf('ledger.entries.full.done', {
          month: monthValue,
          count: fullResult.entries.length,
          unchanged: true,
          source: fullResult.source,
        });
        return;
      }
      this._allEntries = fullResult.entries;
      this._entriesSignature = nextSig;
      this._buildDisplay(monthValue);
      setPerfContext({
        entryCache: fullResult.source,
        dataState: fullResult.entries.length > 0 ? 'full' : 'empty',
      });
      markPerf('ledger.display.done', {
        source: 'full-month',
        month: monthValue,
        count: fullResult.entries.length,
        empty: fullResult.entries.length === 0,
      });
      markPerf('ledger.entries.full.done', {
        month: monthValue,
        count: fullResult.entries.length,
        source: fullResult.source,
      });
    } catch (err) {
      markPerfError('ledger.entries.full.failed', err, { month: monthValue });
    }
  },

  /**
   * 热刷新静默重载：保持当前列表在屏，全量本地读取后按签名 diff 决定是否重渲。
   * - 不进骨架态、不走 ready-partial（partial 仅冷加载首屏求快保留）。
   * - 签名无变化：一帧不动（仅在残留非 ready 态时纠正结算态）。
   * - 签名变化：原地 _buildDisplay 替换 + 结算为 ready-full / empty-confirmed。
   * - await 期间上下文（账本/月份）变更：放弃，交由新触发的加载接管。
   * 纯本地读取，与网络解耦：无网亦可静默完成，不阻塞、不闪烁。
   */
  async _reloadCurrentMonthSilently(targetMonth: string) {
    const ledgerId = this._ledgerId;
    markPerf('ledger.entries.start', { month: targetMonth, mode: 'silent-hot-reload' });
    const fullResult = await listMonthEntries({ ledger_id: ledgerId, month: targetMonth });
    if (this._ledgerId !== ledgerId || this.data.currentMonth !== targetMonth) {
      markPerf('ledger.entries.silent.skip', { reason: 'context-changed', month: targetMonth });
      return;
    }
    if (fullResult.entries.length > 0) {
      await clearLedgerMonthRemoteEmptyConfirmed(ledgerId, targetMonth);
    }
    if (this._ledgerId !== ledgerId || this.data.currentMonth !== targetMonth) return;
    const nextSig = this._computeEntriesSignature(fullResult.entries);
    const settledState: LedgerLoadingState = fullResult.entries.length > 0 ? 'ready-full' : 'empty-confirmed';
    if (nextSig === this._entriesSignature) {
      // 数据无变化：一帧不动；仅当残留非结算态（如上次停在 ready-partial）时纠正。
      if (this.data.ledgerLoadingState !== settledState) {
        this._setLedgerLoadingState(settledState);
      }
      this._emitLedgerDisplayReady(targetMonth, fullResult.entries.length);
      markPerf('ledger.entries.done', { month: targetMonth, mode: 'silent-hot-reload', unchanged: true, count: fullResult.entries.length });
      return;
    }
    this._allEntries = fullResult.entries;
    this._entriesSignature = nextSig;
    setPerfContext({
      entryCache: fullResult.source,
      dataState: fullResult.entries.length > 0 ? 'full' : 'empty',
    });
    this._buildDisplay(targetMonth);
    this._setLedgerLoadingState(settledState);
    this._emitLedgerDisplayReady(targetMonth, fullResult.entries.length);
    markPerf('ledger.entries.done', { month: targetMonth, mode: 'silent-hot-reload', unchanged: false, count: fullResult.entries.length });
    markPerf('ledger.display.done', { source: 'silent-hot-reload', month: targetMonth, count: fullResult.entries.length, empty: fullResult.entries.length === 0 });
  },

  /**
   * sync-refresh: 计算 entries 列表签名
   * 选取会影响视觉的字段拼接 · 整体变化哪怕一处也会改变签名
   * 复杂度 O(n)，单月几十~几百条 entry 实测 < 1ms
   */
  _computeEntriesSignature(entries: Entry[]): string {
    return entries
      .map(e => [
        e.client_ref_id,
        e.occurred_at,
        e.amount,
        e.type,
        e.category_id ?? '',
        e.note ?? '',
        e.deleted_at ?? '',
        e.shared_type ?? '',
        e.created_by ?? '',
      ].join('|'))
      .join(';');
  },

  /**
   * sync-refresh: SYNC_DONE 后调用 · 若签名变化则重建并 setData，否则跳过避免列表跳动
   * 注意：仅刷新当前展示月份；不动用 _shouldRefreshEmptyHintOnNextEmpty 等内部状态
   *
   * 账本切换路径无需特殊处理：onTapLedgerName 切账本时会调 _loadEntries 直接重建签名；
   * 之后若 SYNC_DONE 到达，_refreshIfChanged 用最新 _ledgerId 查询新账本数据，与最新签名比对，
   * 行为正确（无残留旧账本数据风险）。
   */
  async _refreshIfChanged() {
    if (!this._ledgerId) return;
    const ledgerId = this._ledgerId;
    const targetMonth = this.data.currentMonth;
    const fullResult = await listMonthEntries({ ledger_id: ledgerId, month: targetMonth });
    if (fullResult.entries.length > 0) {
      await clearLedgerMonthRemoteEmptyConfirmed(ledgerId, targetMonth);
    }
    if (this._ledgerId !== ledgerId || this.data.currentMonth !== targetMonth) return;
    const nextSig = this._computeEntriesSignature(fullResult.entries);
    if (nextSig === this._entriesSignature) return;
    this._allEntries = fullResult.entries;
    this._entriesSignature = nextSig;
    this._buildDisplay(targetMonth);
    this._setLedgerLoadingState(fullResult.entries.length > 0 ? 'ready-full' : 'empty-confirmed');
    markPerf('ledger.display.done', {
      source: 'sync-refresh',
      month: targetMonth,
      count: fullResult.entries.length,
      empty: fullResult.entries.length === 0,
    });
    this._emitLedgerDisplayReady(targetMonth, fullResult.entries.length);
  },

  /** 从 _allEntries 构建 dateGroups + 汇总 */
  _buildDisplay(monthValue?: string) {
    const targetMonth = monthValue || this.data.currentMonth;

    // 筛选：流水类型 + 成员多选
    let entries = this._allEntries;

    // 流水类型过滤（单选 · 支出细分公共/个人，另含收入/转移）
    switch (this._filterEntryType) {
      case 'personal':
        entries = entries.filter(e => e.type === 'expense' && e.shared_type !== 'shared');
        break;
      case 'shared':
        entries = entries.filter(e => e.type === 'expense' && e.shared_type === 'shared');
        break;
      case 'income':
        entries = entries.filter(e => e.type === 'income');
        break;
      case 'transfer':
        entries = entries.filter(e => e.type === 'transfer');
        break;
      // 'all' → 不过滤
    }

    // 成员过滤（仅当有选择且非全选时过滤）
    const allMembers = this.data.filterMembers as FilterMemberItem[];
    const selectedIds = this._filterSelectedMemberIds;
    if (selectedIds.length > 0 && selectedIds.length < allMembers.length) {
      entries = entries.filter(e => e.created_by && selectedIds.includes(e.created_by));
    }

    // 按日期分组
    const groupMap = new Map<string, Entry[]>();
    for (const e of entries) {
      const dk = toDateKey(e.occurred_at);
      if (!groupMap.has(dk)) {
        groupMap.set(dk, []);
      }
      groupMap.get(dk)!.push(e);
    }

    // 日期倒序
    const sortedKeys = [...groupMap.keys()].sort((a, b) => b.localeCompare(a));

    // decimal.js 精算汇总
    let totalExpenseCents = new Decimal(0);
    let totalIncomeCents = new Decimal(0);

    const dateGroups: DateGroup[] = sortedKeys.map(dk => {
      const groupEntries = groupMap.get(dk)!;
      let dayExpense = new Decimal(0);
      let dayIncome = new Decimal(0);

      const displayEntries: DisplayEntry[] = groupEntries.map(e => {
        const amt = new Decimal(e.amount);
        // migration 0004：transfer 不计入日/月收支汇总，仅条目可见
        if (e.type === 'expense') {
          dayExpense = dayExpense.plus(amt);
          totalExpenseCents = totalExpenseCents.plus(amt);
        } else if (e.type === 'income') {
          dayIncome = dayIncome.plus(amt);
          totalIncomeCents = totalIncomeCents.plus(amt);
        }

        const hasNote = !!e.note && e.note.trim().length > 0;
        const member = e.created_by ? this._memberMap[e.created_by] : null;
        // 协作账本: 头像 fallback · 即使 memberMap 未加载完也展示首字
        const showMember = this.data.showMemberFilter;
        let avatarUrl = '';
        let memberInitial = '';
        if (showMember && member) {
          avatarUrl = member.avatarUrl;
          memberInitial = member.nickname?.[0] || '?';
        } else if (showMember && e.created_by) {
          // memberMap 尚未就绪时给一个通用占位
          memberInitial = '?';
        }
        return {
          client_ref_id: e.client_ref_id,
          label: hasNote ? e.note : getCategoryName(e.category_id),
          icon: getCategoryIcon(e.category_id),
          amountText: formatEntryAmount(e.amount, e.type),
          type: e.type,
          hasNote,
          avatarUrl,
          memberInitial,
          isShared: e.shared_type === 'shared',
          translateX: 0,
          translateStyle: '',
        };
      });

      const dayExpNum = dayExpense.toNumber();
      const dayIncNum = dayIncome.toNumber();

      return {
        dateKey: dk,
        dateLabel: formatDateLabel(dk),
        dayExpense: dayExpNum,
        dayIncome: dayIncNum,
        entries: displayEntries,
        daySummary: buildDaySummary(dayExpNum, dayIncNum),
      };
    });

    const balanceCents = totalIncomeCents.minus(totalExpenseCents);
    const balanceStr = balanceCents.isNeg()
      ? `-¥${formatAmountShort(balanceCents.abs().toNumber())}`
      : `¥${formatAmountShort(balanceCents.toNumber())}`;

    const isEmpty = dateGroups.length === 0;
    const emptyHint = isEmpty && this._shouldRefreshEmptyHintOnNextEmpty
      ? pickRandomSlogan(this.data.emptyHint)
      : this.data.emptyHint || pickRandomSlogan();

    this.setData({
      dateGroups,
      isEmpty,
      emptyTitle: buildEmptyTitle(targetMonth),
      emptyHint,
      totalExpense: formatAmountDisplay(totalExpenseCents.toNumber()),
      totalExpenseCents: totalExpenseCents.toNumber(),
      totalIncomeCents: totalIncomeCents.toNumber(),
      totalBalance: `收入 ¥${formatAmountShort(totalIncomeCents.toNumber())} · 结余 ${balanceStr}`,
    });
    this._renderedLedgerId = this._ledgerId;
    this._renderedMonth = targetMonth;
    this._shouldRefreshEmptyHintOnNextEmpty = false;
  },

  _emitLedgerDisplayReady(month: string, entryCount: number) {
    this._emitLedgerDisplaySettled(month, entryCount, false);
  },

  /**
   * 首屏「已结算」信号 · 成功/失败都发，且全程只发一次。
   * 这是非首屏预热（services/prefetch.ts）的放行点：无论首屏渲染成功还是加载失败，
   * 都必须释放预热调度，避免失败态把后台预热永久阻塞。
   * failed=true 时 ledger_id/family_id/entry_count 不保证可信，订阅方仅据此放行即可。
   */
  _emitLedgerDisplaySettled(month: string, entryCount: number, failed: boolean) {
    if (this._displayReadyEmitted) return;
    this._displayReadyEmitted = true;
    const payload: LedgerDisplayReadyPayload = {
      ledger_id: this._ledgerId,
      family_id: this._familyId,
      month,
      entry_count: entryCount,
      empty: entryCount === 0,
      failed,
    };
    eventBus.emit(EventNames.LEDGER_DISPLAY_READY, payload);
    markPerf('ledger.display-ready.emit', { month, count: entryCount, empty: entryCount === 0, failed });
  },

  /** 首屏以失败态结算 · 当前展示月份、计数置 0、failed=true（仅用于放行预热） */
  _emitLedgerDisplayFailed() {
    this._emitLedgerDisplaySettled(this.data.currentMonth, 0, true);
  },

  async onRetryLedgerLoad() {
    markPerf('ledger.retry-load');
    try {
      await this._loadContext();
      await this._loadEntries();
    } catch (err) {
      markPerfError('ledger.retry-load.failed', err);
      this._setLedgerLoadingState('failed', '流水加载失败，请稍后重试', err instanceof Error ? err.message : String(err));
      // 重试仍失败也要结算 · 释放后台预热（_emitLedgerDisplaySettled 幂等，首次已发则 noop）
      this._emitLedgerDisplayFailed();
    }
  },

  // ─── 交互：账本切换 ──────────────────────────────────────────────────────────
  // 账本切换入口由 <ledger-switcher> 组件承载（顶部导航栏锚定下拉气泡）。
  // 组件内部调 switchActiveFamily 广播 ACTIVE_FAMILY_CHANGED，本页由 _onActiveFamilyChanged 响应重载。

  // ─── 交互：月份选择 ──────────────────────────────────────────────────────────

  onPrevMonth() {
    const [y, m] = this.data.currentMonth.split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    this._shouldRefreshEmptyHintOnNextEmpty = true;
    this.setData({ currentMonth: prev, monthDisplay: formatMonthDisplay(prev) });
    this._loadEntries(prev);
    this._scrollTopToTop();
  },

  onNextMonth() {
    const [y, m] = this.data.currentMonth.split('-').map(Number);
    const nxt = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    this._shouldRefreshEmptyHintOnNextEmpty = true;
    this.setData({ currentMonth: nxt, monthDisplay: formatMonthDisplay(nxt) });
    this._loadEntries(nxt);
    this._scrollTopToTop();
  },

  onMonthChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    this._shouldRefreshEmptyHintOnNextEmpty = true;
    this.setData({
      currentMonth: value,
      monthDisplay: formatMonthDisplay(value),
    });
    this._loadEntries(value);
    // COSTRA-220: 月份切换后滚动到顶部
    this._scrollTopToTop();
  },

  // ─── 交互：成员筛选 ──────────────────────────────────────────────────────────

  onTapMemberFilter() {
    // 切换筛选面板显示/隐藏
    const visible = !this.data.filterPanelVisible;
    this.setData({ filterPanelVisible: visible });
  },

  /** 筛选面板：流水类型变更 */
  onFilterEntryTypeChange(e: WechatMiniprogram.CustomEvent<{ entryType: EntryTypeFilter }>) {
    const { entryType } = e.detail;
    this._filterEntryType = entryType;
    this.setData({ filterEntryType: entryType });
    this._updateFilterState();
    this._buildDisplay();
  },

  /** 筛选面板：成员 toggle */
  onFilterMemberToggle(e: WechatMiniprogram.CustomEvent<{ userId: string }>) {
    const { userId } = e.detail;
    const filterMembers = [...this.data.filterMembers] as FilterMemberItem[];
    const idx = filterMembers.findIndex(m => m.user_id === userId);
    if (idx < 0) return;
    filterMembers[idx] = { ...filterMembers[idx], selected: !filterMembers[idx].selected };
    this._filterSelectedMemberIds = filterMembers.filter(m => m.selected).map(m => m.user_id);
    this.setData({ filterMembers });
    this._updateFilterState();
    this._buildDisplay();
  },

  /** 筛选面板：全选/取消全选 */
  onFilterSelectAll(e: WechatMiniprogram.CustomEvent<{ selectAll: boolean }>) {
    const { selectAll } = e.detail;
    const filterMembers = this.data.filterMembers.map((m: FilterMemberItem) => ({
      ...m,
      selected: selectAll,
    }));
    this._filterSelectedMemberIds = selectAll
      ? filterMembers.map((m: FilterMemberItem) => m.user_id)
      : [];
    this.setData({ filterMembers });
    this._updateFilterState();
    this._buildDisplay();
  },

  /** 筛选面板：关闭 */
  onFilterPanelClose() {
    // 关闭时若无成员选中 → 自动全选
    const hasSelected = this.data.filterMembers.some((m: FilterMemberItem) => m.selected);
    if (!hasSelected) {
      const filterMembers = this.data.filterMembers.map((m: FilterMemberItem) => ({
        ...m,
        selected: true,
      }));
      this._filterSelectedMemberIds = filterMembers.map((m: FilterMemberItem) => m.user_id);
      this.setData({ filterMembers });
    }
    this.setData({ filterPanelVisible: false });
    this._updateFilterState();
    this._buildDisplay();
  },

  /** 更新筛选按钮文字和激活态 */
  _updateFilterState() {
    const allMembers = this.data.filterMembers as FilterMemberItem[];
    const selectedCount = allMembers.filter(m => m.selected).length;
    const isAllMembers = selectedCount === 0 || selectedCount === allMembers.length;
    const isAllType = this._filterEntryType === 'all';
    const filterActive = !isAllMembers || !isAllType;

    let memberFilterText = '全部';
    if (filterActive) {
      const parts: string[] = [];
      if (!isAllType) {
        parts.push(ENTRY_TYPE_LABELS[this._filterEntryType]);
      }
      if (!isAllMembers) {
        parts.push(`${selectedCount}人`);
      }
      memberFilterText = parts.length > 0 ? parts.join(' · ') : '筛选中';
    }

    this.setData({ filterActive, memberFilterText });
  },

  // ─── eventBus 响应式刷新（COSTRA-220）─────────────────────────────────────────

  async _onEntrySaved() {
    // 记账保存成功后刷新明细页数据
    await this._loadEntries();
  },

  // ─── COSTRA-227: 编辑保存后响应式刷新 ─────────────────────────────────────────

  async _onEntryUpdated() {
    await this._loadEntries();
  },

  // ─── 2026-06-08: 跨页面账本切换响应 ──────────────────────────────────────────

  async _onActiveFamilyChanged() {
    // 重新读 context（family/ledger/kind/name 全部重置）+ 重拉 entries
    // 等价于明细页 onShow 的 _loadContext + _loadEntries 路径
    await this._loadContext();
    await this._loadEntries();
  },

  // ─── UX 增强（COSTRA-220）────────────────────────────────────────────────────

  /** 滚动列表到顶部（月份切换后） */
  _scrollTopToTop() {
    // 小程序 scroll-view 不响应同值赋值 · 先设 1 再 nextTick 设 0
    this.setData({ listScrollTop: 1 });
    setTimeout(() => {
      this.setData({ listScrollTop: 0 });
    }, 50);
  },

  // ─── 交互：左滑删除 ──────────────────────────────────────────────────────────

  onTapPage() {
    // 备注编辑中点任意编辑框外区域 = 保存本次编辑并收键盘，吞掉本次点击（不穿透打开面板）
    if (this._consumeNoteEditingIfActive()) return;
    if (!this.data.swipingRefId) return;
    if (Date.now() - this._lastSwipeEndAt < 180) return;
    this._resetAllSwipe();
  },

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    const refId = e.currentTarget.dataset.refid;
    this._touchStartX = e.touches[0].clientX;
    this._touchStartY = e.touches[0].clientY;
    this._touchRefId = refId;
    this._swipeStarted = false;
    this._horizontalSwipeActive = false;
  },

  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    // 上下文菜单打开期间屏蔽滑动，避免长按后误触发左滑
    if (this._contextMenuOpen) return;
    const deltaX = e.touches[0].clientX - this._touchStartX;
    const deltaY = e.touches[0].clientY - this._touchStartY;

    if (!this._swipeStarted && Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (Math.abs(deltaX) < 10) return;

    this._swipeStarted = true;
    this._horizontalSwipeActive = true;

    const refId = e.currentTarget.dataset.refid;
    if (refId !== this.data.swipingRefId && this.data.swipingRefId) {
      this._resetSwipe(this.data.swipingRefId);
    }

    const maxOffset = 160;
    let offset = -deltaX * 2;
    if (offset < 0) offset = 0;
    if (offset > maxOffset) offset = maxOffset;

    this._updateEntryTranslate(refId, offset);
    this.setData({ swipingRefId: refId });
  },

  onTouchEnd() {
    const wasSwipe = this._swipeStarted || this._horizontalSwipeActive;
    this._swipeStarted = false;
    this._horizontalSwipeActive = false;
    if (!wasSwipe) return;

    const now = Date.now();
    this._beginSwipeScrollSettling();

    const refId = this._touchRefId;
    if (!refId) return;

    const entry = this._findDisplayEntry(refId);
    if (entry && entry.translateX > 80) {
      this._updateEntryTranslate(refId, 160);
    } else {
      this._updateEntryTranslate(refId, 0);
      if (this.data.swipingRefId === refId) {
        this.setData({ swipingRefId: '' });
      }
    }
    this._lastSwipeEndAt = now;
    this._touchRefId = '';
  },

  onTouchCancel() {
    const refId = this._touchRefId;
    const wasSwipe = this._swipeStarted || this._horizontalSwipeActive;
    this._swipeStarted = false;
    this._horizontalSwipeActive = false;
    this._endSwipeScrollSettling();
    this._touchRefId = '';
    if (!wasSwipe || !refId) return;

    this._updateEntryTranslate(refId, 0);
    if (this.data.swipingRefId === refId) {
      this.setData({ swipingRefId: '' });
    }
  },

  _resetSwipe(refId: string) {
    this._updateEntryTranslate(refId, 0);
  },

  _beginSwipeScrollSettling() {
    this._swipeScrollSettling = true;
    if (this._swipeScrollIdleTimer) {
      clearTimeout(this._swipeScrollIdleTimer);
    }
    this._swipeScrollIdleTimer = setTimeout(() => {
      this._swipeScrollSettling = false;
      this._swipeScrollIdleTimer = null;
    }, SWIPE_SCROLL_IDLE_GRACE_MS);
  },

  _endSwipeScrollSettling() {
    this._swipeScrollSettling = false;
    if (this._swipeScrollIdleTimer) {
      clearTimeout(this._swipeScrollIdleTimer);
      this._swipeScrollIdleTimer = null;
    }
  },

  _resetAllSwipe() {
    const { dateGroups } = this.data;
    let changed = false;
    for (const g of dateGroups) {
      for (const e of g.entries) {
        if (e.translateX !== 0 || e.translateStyle) {
          e.translateX = 0;
          e.translateStyle = '';
          changed = true;
        }
      }
    }
    if (changed) {
      this.setData({ dateGroups, swipingRefId: '' });
    }
  },

  _updateEntryTranslate(refId: string, offset: number) {
    const { dateGroups } = this.data;
    for (const g of dateGroups) {
      for (const e of g.entries) {
        if (e.client_ref_id === refId) {
          e.translateX = offset;
          e.translateStyle = offset > 0 ? `transform: translateX(-${offset}rpx);` : '';
          this.setData({ dateGroups });
          return;
        }
      }
    }
  },

  _findDisplayEntry(refId: string): DisplayEntry | null {
    for (const g of this.data.dateGroups) {
      for (const e of g.entries) {
        if (e.client_ref_id === refId) return e;
      }
    }
    return null;
  },

  /** COSTRA-227: 从原始 entries 查找完整 Entry 对象（用于编辑） */
  _findRawEntry(refId: string): Entry | null {
    return this._allEntries.find(e => e.client_ref_id === refId) || null;
  },

  // ─── 长按上下文菜单 ───────────────────────────────────────────────────────

  /** 长按流水 → 在触点附近原地弹出上下文菜单 */
  onEntryLongPress(e: WechatMiniprogram.TouchEvent) {
    // 备注编辑中：本次操作先保存编辑，不再弹长按菜单（点编辑框外 = 保存）
    if (this._consumeNoteEditingIfActive()) return;
    const refId = (e.currentTarget.dataset as Record<string, string>).refid;
    if (!refId) return;

    // 若有流水处于左滑展开态，先复位，避免菜单与左滑并存
    if (this.data.swipingRefId) {
      this._resetAllSwipe();
    }

    const winW = this._winW || 375;
    const winH = this._winH || 667;
    // 菜单尺寸估算（rpx → px）：须与 index.wxss .ctx-menu 保持同步
    // （宽 300rpx，高约 5×96rpx item + 上下 padding 8rpx + 删除项 margin 6rpx）
    const rpxToPx = winW / 750;
    const menuW = 300 * rpxToPx;
    const menuH = 510 * rpxToPx;
    const margin = 12;

    const touchX = this._touchStartX;
    const touchY = this._touchStartY;

    // 左右：居中于触点，边界收拢防溢出
    let left = touchX - menuW / 2;
    if (left < margin) left = margin;
    if (left > winW - menuW - margin) left = winW - menuW - margin;

    // 上下：优先向下展开，下方空间不足则向上
    let top = touchY + menuH + margin <= winH ? touchY : touchY - menuH;
    const minTop = (this.data.statusBarHeight || 20) + 8;
    if (top < minTop) top = minTop;
    if (top > winH - menuH - margin) top = winH - menuH - margin;

    this._ctxRefId = refId;
    this._contextMenuOpen = true;
    wx.vibrateShort({ type: 'light' });
    this.setData({
      ctxMenuVisible: true,
      ctxMenuLeft: left,
      ctxMenuTop: top,
      ctxActiveRefId: refId,
    });
  },

  /** 关闭上下文菜单 */
  onCtxMenuClose() {
    if (!this.data.ctxMenuVisible) return;
    this._contextMenuOpen = false;
    this._ctxRefId = '';
    this.setData({ ctxMenuVisible: false, ctxActiveRefId: '' });
  },

  /** 菜单：复制流水 */
  onCtxCopy() {
    const refId = this._ctxRefId;
    this.onCtxMenuClose();
    void this._copyEntry(refId);
  },

  /** 菜单：修改备注 */
  onCtxNote() {
    const refId = this._ctxRefId;
    this.onCtxMenuClose();
    this._openEditNote(refId);
  },

  /** 菜单：修改金额 */
  onCtxAmount() {
    const refId = this._ctxRefId;
    this.onCtxMenuClose();
    this._openEditAmount(refId);
  },

  /** 菜单：修改分类 */
  onCtxCategory() {
    const refId = this._ctxRefId;
    this.onCtxMenuClose();
    this._openEditCategory(refId);
  },

  /** 菜单：删除流水（二次确认） */
  onCtxDelete() {
    const refId = this._ctxRefId;
    this.onCtxMenuClose();
    this._confirmDeleteEntry(refId);
  },

  /**
   * 复制流水（直接落库）：用源流水的金额/币种/类型/分类/备注/公私性质创建一条新流水，
   * occurred_at 记为「今天」、ledger_id 用当前账本、created_by 用当前用户、client_ref_id 新生成。
   * 用于地铁等固定金额支出的快速记账，走 putEntry + enqueue(create) + ENTRY_SAVED 链路，
   * 与手动记账保存后行为一致。
   */
  async _copyEntry(refId: string) {
    if (!refId) return;
    // 防重：同一流水复制进行中，忽略重复触发，避免生成多条副本
    if (this._copyingRefId === refId) return;
    const src = this._findRawEntry(refId);
    if (!src) return;

    this._copyingRefId = refId;
    const now = new Date().toISOString();
    const newEntry: Entry = {
      client_ref_id: newClientRefId(),
      ledger_id: this._ledgerId,
      amount: src.amount,
      currency: src.currency || 'CNY',
      type: src.type,
      category_id: src.category_id,
      note: src.note,
      occurred_at: now,
      created_at: now,
      updated_at: now,
      created_by: getToken()?.raw.user.id || null,
      shared_type: src.shared_type ?? null,
    };

    try {
      await putEntry(newEntry);
      await enqueue({
        op: 'create',
        entity: 'entry',
        client_ref_id: newEntry.client_ref_id,
        base_version: null,
        payload: { ...newEntry },
      });
      wx.vibrateShort({ type: 'medium' });
      // 复用响应式刷新链路（_onEntrySaved → _loadEntries）+ 统计页刷新
      eventBus.emit(EventNames.ENTRY_SAVED);
      // 历史月份浏览时新流水记入当月、当前列表不可见，故文案明示
      wx.showToast({ title: '已复制到今天', icon: 'success' });
    } catch {
      wx.showToast({ title: '复制失败，请重试', icon: 'none' });
    } finally {
      this._copyingRefId = '';
    }
  },

  onDeleteEntry(e: WechatMiniprogram.TouchEvent) {
    if (this._consumeNoteEditingIfActive()) return;
    this._confirmDeleteEntry(e.currentTarget.dataset.refid);
  },

  /** 删除流水二次确认（左滑删除 / 长按菜单共用） */
  _confirmDeleteEntry(refId: string) {
    if (!refId) return;

    wx.showModal({
      title: '',
      content: '确定删除这条记录吗？',
      confirmColor: '#FA5151',
      success: async (res) => {
        if (!res.confirm) {
          this._resetAllSwipe();
          return;
        }

        await deleteEntry(refId);
        await enqueue({
          op: 'delete',
          entity: 'entry',
          client_ref_id: refId,
          base_version: null,
          payload: {},
        });

        wx.vibrateShort({ type: 'medium' });

        this.setData({ swipingRefId: '' });
        this._allEntries = this._allEntries.filter(entry => entry.client_ref_id !== refId);
        this._buildDisplay();
      },
    });
  },

  // ─── COSTRA-227: 条目区域点击编辑 ────────────────────────────────────────────

  /**
   * 点击分类图标 → 全屏分类选择面板（和记账界面一致）。
   *
   * 设计原则（2026-06-05 重构）：永不 await 网络。
   * 同步用 loadCategoriesSync 立即打开，再后台 fire-and-forget 调 refreshCategoryDataAsync 增量刷新。
   */
  onTapEntryCategory(e: WechatMiniprogram.TouchEvent) {
    if (this._consumeNoteEditingIfActive()) return;
    if (this.data.swipingRefId) { this._resetAllSwipe(); return; }
    const refId = (e.currentTarget.dataset as Record<string, string>).refid;
    this._openEditCategory(refId);
  },

  /** 打开分类编辑面板（行内点击 / 长按菜单共用） */
  _openEditCategory(refId: string) {
    if (!refId) return;
    const entry = this._findRawEntry(refId);
    if (!entry) return;

    this._editingRefId = refId;

    const familyId = this._familyId;
    if (!familyId) return;

    // —— 阶段 1：同步加载分类（内存缓存 → fallback）——
    const categoryData = loadCategoriesSync(familyId);
    (this as unknown as Record<string, unknown>)._editCategoryData = categoryData;

    const entryType: 'expense' | 'income' | 'transfer' = entry.type || 'expense';
    const tier1 = entryType === 'expense'
      ? categoryData.expense
      : entryType === 'income'
        ? categoryData.income
        : categoryData.transfer;
    const deduped = entryType === 'expense'
      ? categoryData.expenseDedupedSubs
      : entryType === 'income'
        ? categoryData.incomeDedupedSubs
        : categoryData.transferDedupedSubs;

    // 找到当前选中的分类
    let selectedTier1Id = '';
    const selectedTier2Id = entry.category_id || '';
    if (selectedTier2Id) {
      for (const t of tier1) {
        if (t.children.some(c => c.id === selectedTier2Id)) {
          selectedTier1Id = t.id;
          break;
        }
      }
    }

    // COSTRA-227: 通知 tabbar 隐藏
    eventBus.emit(EventNames.HIDE_TAB_BAR);

    // —— 阶段 2：同步打开面板 ——
    this.setData({
      editCategoryVisible: true,
      editActiveRefId: refId,
      editCategoryType: entryType,
      editCategoryLockedType: entryType,
      editCategoryTypeIndex: entryType === 'transfer' ? 2 : entryType === 'income' ? 1 : 0,
      editCategorySwiperDuration: 0,
      // COSTRA-228: 三 pane 数据
      editExpenseTier1Categories: categoryData.expense,
      editIncomeTier1Categories: categoryData.income,
      editTransferTier1Categories: categoryData.transfer,
      editExpenseDedupedSubCategories: categoryData.expenseDedupedSubs,
      editIncomeDedupedSubCategories: categoryData.incomeDedupedSubs,
      editTransferDedupedSubCategories: categoryData.transferDedupedSubs,
      editTier1Categories: tier1,
      editDedupedSubCategories: deduped,
      editExpandedTier1Id: null,
      editExpandedChildren: [],
      editSelectedTier1Id: selectedTier1Id,
      editSelectedTier2Id: selectedTier2Id,
      editDimmedTier1Ids: [],
    });

    // COSTRA-228: 50ms 后恢复 swiper 动画时长
    setTimeout(() => {
      this.setData({ editCategorySwiperDuration: 240 });
    }, 50);

    // —— 阶段 3：后台 fire-and-forget 刷新（仅签名变化时增量更新列表，不动 selected*）——
    void this._refreshEditCategoriesAsync(familyId, categoryData.signature);
  },

  /**
   * 后台刷新分类编辑面板的分类列表。
   * 守护：面板关闭/正在保存/签名相等 → 跳过。不覆盖 selected*。
   */
  async _refreshEditCategoriesAsync(familyId: string, oldSignature: string) {
    let next: Awaited<ReturnType<typeof refreshCategoryDataAsync>>;
    try {
      next = await refreshCategoryDataAsync(familyId);
    } catch {
      return; // 静默
    }
    if (next.signature === oldSignature) return;
    if (!this.data.editCategoryVisible) {
      // 面板已关，仅更新实例属性
      (this as unknown as Record<string, unknown>)._editCategoryData = next;
      return;
    }
    (this as unknown as Record<string, unknown>)._editCategoryData = next;

    const editType = this.data.editCategoryType;
    const tier1 = editType === 'expense'
      ? next.expense
      : editType === 'income'
        ? next.income
        : next.transfer;
    const deduped = editType === 'expense'
      ? next.expenseDedupedSubs
      : editType === 'income'
        ? next.incomeDedupedSubs
        : next.transferDedupedSubs;

    // COSTRA-228: 三 pane 数据同时刷新
    this.setData({
      editExpenseTier1Categories: next.expense,
      editIncomeTier1Categories: next.income,
      editTransferTier1Categories: next.transfer,
      editExpenseDedupedSubCategories: next.expenseDedupedSubs,
      editIncomeDedupedSubCategories: next.incomeDedupedSubs,
      editTransferDedupedSubCategories: next.transferDedupedSubs,
      editTier1Categories: tier1,
      editDedupedSubCategories: deduped,
    });
  },

  /** 分类面板：点击一级分类 → 展开子分类 */
  onEditTapTier1(e: WechatMiniprogram.TouchEvent) {
    const tier1Id = (e.currentTarget.dataset as Record<string, string>).id;
    if (!tier1Id) return;

    const tier1 = this.data.editTier1Categories.find(c => c.id === tier1Id);
    if (!tier1) return;

    // 如果点击已展开的一级分类 → 收起
    if (this.data.editExpandedTier1Id === tier1Id) {
      this.setData({
        editExpandedTier1Id: null,
        editExpandedChildren: [],
        editDimmedTier1Ids: [],
      });
      return;
    }

    const dimmed = this.data.editTier1Categories
      .filter(c => c.id !== tier1Id)
      .map(c => c.id);

    this.setData({
      editExpandedTier1Id: tier1Id,
      editExpandedChildren: tier1.children,
      editSelectedTier1Id: tier1Id,
      editDimmedTier1Ids: dimmed,
    });
  },

  /** 分类面板：选中二级分类 → 保存并关闭 */
  async onEditTapSubCategory(e: WechatMiniprogram.TouchEvent) {
    const catId = (e.currentTarget.dataset as Record<string, string>).id;

    // SOP 步骤 1: 幂等 guard
    const refId = this._editingRefId;
    this._editingRefId = '';
    if (!catId || !refId) {
      this._closeEditCategory();
      return;
    }

    // SOP 步骤 2: 取内存对象
    const entry = this._findRawEntry(refId);
    if (!entry) {
      this._closeEditCategory();
      return;
    }

    // 分类编辑只允许在原 entry.type 内改分类；跨类型改账需独立产品能力承载。
    if (this.data.editCategoryType !== entry.type) {
      this._closeEditCategory();
      this._showTypeLockToast();
      return;
    }

    // SOP 步骤 3: 同等性 guard
    if (entry.category_id === catId) {
      this._closeEditCategory();
      return;
    }

    // SOP 步骤 4: 同步赋值内存
    const now = new Date().toISOString();
    entry.category_id = catId;
    entry.updated_at = now;

    // SOP 步骤 5: 关闭面板
    this._closeEditCategory();

    // SOP 步骤 6: 同步渲染
    this._buildDisplay();

    // SOP 步骤 7: await 持久化
    await updateEntryFields(entry.client_ref_id, { category_id: catId, updated_at: now });

    // SOP 步骤 8: await 入队
    await enqueue({
      op: 'update',
      entity: 'entry',
      client_ref_id: entry.client_ref_id,
      base_version: entry.version ?? null,
      payload: { category_id: catId },
    });
  },

  onCloseEditCategory() {
    this._closeEditCategory();
  },

  /** 关闭分类编辑面板（统一出口：隐藏面板 + 恢复 tabbar + 取消行内编辑高亮） */
  _closeEditCategory() {
    this.setData({ editCategoryVisible: false, editActiveRefId: '' });
    eventBus.emit(EventNames.SHOW_TAB_BAR);
  },

  /**
   * 「禁止修改流水类型」弱提示（统一出口 · 带 1.5s 节流防连滑/连点刷屏）。
   * icon:'none' 纯文字弱提醒 + 短时长，不打断操作。
   */
  _showTypeLockToast() {
    const now = Date.now();
    if (now - this._lastTypeLockToastAt < 1500) return;
    this._lastTypeLockToastAt = now;
    wx.showToast({ title: '禁止修改流水类型', icon: 'none', duration: 800 });
  },

  /** 分类面板：点击 tab 切换收支（修改分类锁定类型，点击其它类型仅弱提示不切换） */
  onEditCategoryTypeTab(e: WechatMiniprogram.TouchEvent) {
    const type = (e.currentTarget.dataset as Record<string, string>).type as 'expense' | 'income' | 'transfer';
    if (type !== this.data.editCategoryLockedType) {
      this._showTypeLockToast();
      return;
    }
    const targetIdx = type === 'transfer' ? 2 : type === 'income' ? 1 : 0;
    if (targetIdx === this.data.editCategoryTypeIndex) return;
    this.setData({ editCategoryTypeIndex: targetIdx });
  },

  /**
   * 分类面板：横滑手势起点记录。
   * swiper 保留 disable-touch（不真正翻页），但 touch 事件仍照常派发，
   * 借此识别用户的横滑意图并在 touchend 弹「禁止修改流水类型」弱提示。
   */
  onEditCategoryTouchStart(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches[0] || e.changedTouches[0];
    if (!t) return;
    this._editCatTouchX = t.clientX;
    this._editCatTouchY = t.clientY;
  },

  /**
   * 分类面板：横滑手势判定（需明确横扫才提示，尽量减少误触）。
   * 条件：横向位移 > 100px 且横向明显主导（dx > dy*1.5）；
   * 过滤掉点击微抖、斜滑、纵向滚动带出的横向分量。
   */
  onEditCategoryTouchEnd(e: WechatMiniprogram.TouchEvent) {
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - this._editCatTouchX);
    const dy = Math.abs(t.clientY - this._editCatTouchY);
    if (dx > 100 && dx > dy * 1.5) {
      this._showTypeLockToast();
    }
  },

  /** 分类面板：swiper 横滑切换回调（统一更新 editCategoryType + 分类列表） */
  onEditCategorySwiperChange(e: WechatMiniprogram.SwiperChange) {
    const idx = e.detail.current;
    const nextType: 'expense' | 'income' | 'transfer' =
      idx === 2 ? 'transfer' : idx === 1 ? 'income' : 'expense';
    if (nextType !== this.data.editCategoryLockedType) {
      const locked = this.data.editCategoryLockedType;
      this.setData({ editCategoryTypeIndex: locked === 'transfer' ? 2 : locked === 'income' ? 1 : 0 });
      return;
    }
    if (nextType === this.data.editCategoryType) return;
    this._switchEditCategoryType(nextType);
  },

  /** 分类面板：收支切换核心逻辑 */
  _switchEditCategoryType(type: 'expense' | 'income' | 'transfer') {
    const catData = (this as unknown as Record<string, unknown>)._editCategoryData as {
      expense: { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[];
      income: { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[];
      transfer: { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[];
      expenseDedupedSubs: { id: string; name: string; icon: string }[];
      incomeDedupedSubs: { id: string; name: string; icon: string }[];
      transferDedupedSubs: { id: string; name: string; icon: string }[];
    } | undefined;
    if (!catData) return;

    const tier1 = type === 'expense'
      ? catData.expense
      : type === 'income'
        ? catData.income
        : catData.transfer;
    const deduped = type === 'expense'
      ? catData.expenseDedupedSubs
      : type === 'income'
        ? catData.incomeDedupedSubs
        : catData.transferDedupedSubs;

    this.setData({
      editCategoryType: type,
      editCategoryTypeIndex: type === 'transfer' ? 2 : type === 'income' ? 1 : 0,
      editTier1Categories: tier1,
      editDedupedSubCategories: deduped,
      editExpandedTier1Id: null,
      editExpandedChildren: [],
      editSelectedTier1Id: '',
      editSelectedTier2Id: '',
      editDimmedTier1Ids: [],
    });
  },

  /** 点击文字区域 → 原地 inline 编辑备注 */
  onTapEntryNote(e: WechatMiniprogram.TouchEvent) {
    // 已在编辑其它/本条备注时，点备注区 = 保存当前编辑（需再次点击才进入新编辑）
    if (this._consumeNoteEditingIfActive()) return;
    if (this.data.swipingRefId) { this._resetAllSwipe(); return; }
    const refId = (e.currentTarget.dataset as Record<string, string>).refid;
    this._openEditNote(refId);
  },

  /** 打开备注编辑（行内点击 / 长按菜单共用） */
  _openEditNote(refId: string) {
    if (!refId) return;
    const entry = this._findRawEntry(refId);
    if (!entry) return;

    this._editingRefId = refId;
    this.setData({
      editingNoteRefId: refId,
      editActiveRefId: refId,
      editNoteValue: entry.note || '',
    });
  },

  /**
   * 若备注正处于编辑态：保存本次编辑并返回 true，调用方须立即 return 吞掉本次操作。
   * 用于「备注编辑中点编辑框外任意区域(空白 / 其他流水金额 / 分类等) = 保存并收键盘，
   * 但不触发该区域功能、不穿透打开金额/分类面板」。
   * 保存复用 onConfirmEditNote（幂等 + 同等性 guard + 落库入队）；
   * 点原生 input 内部不会冒泡为外层 tap，故正常编辑不受影响。
   */
  _consumeNoteEditingIfActive(): boolean {
    if (!this.data.editingNoteRefId) return false;
    void this.onConfirmEditNote();
    return true;
  },

  onEditNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ editNoteValue: e.detail.value });
  },

  /**
   * 保存备注 —— 由键盘「完成」键 (bindconfirm) 或「点编辑框外区域」(经 _consumeNoteEditingIfActive) 触发。
   * 刻意未绑定 bindblur：避免失焦抢先清空编辑态，导致伴随的点击穿透打开金额/分类面板；
   * 结束编辑一律由点击入口裁决保存。
   */
  async onConfirmEditNote(_e?: WechatMiniprogram.TouchEvent) {
    // SOP 步骤 1: 幂等 guard（首行清，任何二次触发立即 bail）
    const refId = this._editingRefId;
    this._editingRefId = '';
    if (!refId) {
      this.setData({ editingNoteRefId: '', editActiveRefId: '' });
      return;
    }

    // SOP 步骤 2: 取内存对象
    const entry = this._findRawEntry(refId);
    if (!entry) {
      this.setData({ editingNoteRefId: '', editActiveRefId: '' });
      return;
    }

    // SOP 步骤 3: 同等性 guard
    const newNote = this.data.editNoteValue.trim();
    const oldNote = (entry.note || '').trim();
    this.setData({ editingNoteRefId: '', editActiveRefId: '' });
    if (newNote === oldNote) return;

    // SOP 步骤 4: 同步赋值内存
    const now = new Date().toISOString();
    entry.note = newNote;
    entry.updated_at = now;

    // SOP 步骤 6: 同步渲染（用户无感）
    this._buildDisplay();

    // SOP 步骤 7: await 持久化
    await updateEntryFields(entry.client_ref_id, { note: newNote, updated_at: now });

    // SOP 步骤 8: await 入队
    await enqueue({
      op: 'update',
      entity: 'entry',
      client_ref_id: entry.client_ref_id,
      base_version: entry.version ?? null,
      payload: { note: newNote },
    });
  },

  /** 点击金额区域 → 底部半屏键盘面板 */
  onTapEntryAmount(e: WechatMiniprogram.TouchEvent) {
    if (this._consumeNoteEditingIfActive()) return;
    if (this.data.swipingRefId) { this._resetAllSwipe(); return; }
    const refId = (e.currentTarget.dataset as Record<string, string>).refid;
    this._openEditAmount(refId);
  },

  /** 打开金额编辑面板（行内点击 / 长按菜单共用） */
  _openEditAmount(refId: string) {
    if (!refId) return;
    const entry = this._findRawEntry(refId);
    if (!entry) return;

    this._editingRefId = refId;

    // 用 calc 状态机预填金额
    const yuanStr = entry.amount > 0 ? (entry.amount / 100).toString() : '0';
    const editCalc: CalcState = {
      ...INITIAL_CALC_STATE,
      display: yuanStr,
      accumulator: yuanStr,
      amountCents: entry.amount || 0,
      actionState: 'done',
    };

    // 日期
    const d = new Date(entry.occurred_at);
    const dateVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date();
    const todayVal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dateText = dateVal === todayVal ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`;

    const isMulti = this.data.showMemberFilter;
    const sharedType = entry.shared_type || 'personal';

    eventBus.emit(EventNames.HIDE_TAB_BAR);
    this.setData({
      editAmountVisible: true,
      editActiveRefId: refId,
      editAmountDisplay: editCalc.display,
      editAmountCalc: editCalc,
      editAmountShowShared: isMulti && entry.type === 'expense',
      editAmountSharedType: sharedType,
      editAmountDate: dateVal,
      editAmountDateText: dateText,
    });
  },

  onEditAmountKey(e: WechatMiniprogram.TouchEvent) {
    const key = (e.currentTarget.dataset as Record<string, string>).key;
    if (!key) return;

    if (key === 'done') {
      this._onEditAmountAction();
      return;
    }
    if (key === 'paste') {
      // 粘贴走 wx.getClipboardData 异步链路，单独走一支
      this._pasteFromClipboardToEditAmount();
      return;
    }

    let calc = this.data.editAmountCalc;

    switch (key) {
      case '0': case '1': case '2': case '3': case '4':
      case '5': case '6': case '7': case '8': case '9':
        calc = inputDigit(calc, key);
        break;
      case '.':
        calc = inputDot(calc);
        break;
      case '+':
        calc = inputOperator(calc, '+');
        break;
      case '-':
        calc = inputOperator(calc, '-');
        break;
      case '*':
        calc = inputOperator(calc, '*');
        break;
      case '/':
        calc = inputOperator(calc, '/');
        break;
      case 'clear':
        calc = pressClear(calc);
        break;
      case 'backspace':
        calc = inputBackspace(calc);
        break;
      default:
        return;
    }

    this.setData({ editAmountCalc: calc, editAmountDisplay: calc.display });
    // 2026-07-16 R2: 链式运算 / 溢出反馈 → 统一走 _reportEditAmountCalcError
    this._reportEditAmountCalcError(calc.error);
  },

  /**
   * 计算错误反馈（除零 / 溢出），力度 light + toast。与 expense-overlay 对齐。
   */
  _reportEditAmountCalcError(err: 'divzero' | 'overflow' | null) {
    if (!err) return;
    wx.vibrateShort({ type: 'light' });
    wx.showToast({
      title: err === 'divzero' ? '不能除以 0' : '金额超出上限',
      icon: 'none',
    });
  },

  /**
   * 编辑金额面板：粘贴键。语义与 expense-overlay._pasteFromClipboard 一致，
   * 只是 setData 的字段名是 editAmountCalc / editAmountDisplay。
   */
  _pasteFromClipboardToEditAmount() {
    wx.getClipboardData({
      success: (res) => {
        const yuanStr = parseClipboardToAmount(res.data || '');
        if (!yuanStr) {
          wx.showToast({ title: '剪贴板无有效金额', icon: 'none' });
          return;
        }
        const newCalc = inputPaste(this.data.editAmountCalc, yuanStr);
        this.setData({ editAmountCalc: newCalc, editAmountDisplay: newCalc.display });
        wx.vibrateShort({ type: 'light' });
      },
      fail: () => {
        wx.showToast({ title: '剪贴板读取失败', icon: 'none' });
      },
    });
  },

  _onEditAmountAction() {
    const calc = this.data.editAmountCalc;
    if (calc.actionState === 'equals') {
      const newCalc = pressEquals(calc);
      this.setData({ editAmountCalc: newCalc, editAmountDisplay: newCalc.display });
      this._reportEditAmountCalcError(newCalc.error);
    } else {
      this._confirmEditAmount();
    }
  },

  async _confirmEditAmount() {
    const calc = this.data.editAmountCalc;
    const cents = calc.amountCents;

    // SOP 步骤 1: 幂等 guard
    const refId = this._editingRefId;
    this._editingRefId = '';
    if (!refId) { this._closeEditAmount(); return; }

    // SOP 步骤 2: 取内存对象
    const entry = this._findRawEntry(refId);
    if (!entry) { this._closeEditAmount(); return; }

    if (cents <= 0) {
      this._editingRefId = refId; // 恢复，允许重新输入
      wx.showToast({ title: '金额须大于0', icon: 'none' });
      return;
    }

    // SOP 步骤 3: 收集变更 + 同等性 guard
    const changedFields: Record<string, unknown> = {};
    if (cents !== entry.amount) changedFields.amount = cents;

    // 日期变更
    const origDate = new Date(entry.occurred_at);
    const origDateKey = `${origDate.getFullYear()}-${String(origDate.getMonth() + 1).padStart(2, '0')}-${String(origDate.getDate()).padStart(2, '0')}`;
    if (this.data.editAmountDate !== origDateKey) {
      const current = new Date();
      const todayKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      changedFields.occurred_at = this.data.editAmountDate === todayKey
        ? current.toISOString()
        : `${this.data.editAmountDate}T12:00:00.000Z`;
    }

    // shared_type 变更
    if (this.data.editAmountShowShared) {
      const newShared = this.data.editAmountSharedType;
      if (newShared !== (entry.shared_type || 'personal')) {
        changedFields.shared_type = newShared;
      }
    }

    if (Object.keys(changedFields).length === 0) {
      this._closeEditAmount();
      return;
    }

    // SOP 步骤 4: 同步赋值内存（多字段逐一赋值）
    const now = new Date().toISOString();
    if (changedFields.amount) entry.amount = cents;
    if (changedFields.occurred_at) entry.occurred_at = changedFields.occurred_at as string;
    if (changedFields.shared_type) entry.shared_type = changedFields.shared_type as 'personal' | 'shared';
    entry.updated_at = now;

    // SOP 步骤 5: 关闭面板
    this._closeEditAmount();

    // SOP 步骤 6: 同步渲染
    this._buildDisplay();

    // SOP 步骤 7: await 持久化
    const localFields: Record<string, unknown> = { ...changedFields, updated_at: now };
    await updateEntryFields(entry.client_ref_id, localFields);

    // SOP 步骤 8: await 入队
    await enqueue({
      op: 'update',
      entity: 'entry',
      client_ref_id: entry.client_ref_id,
      base_version: entry.version ?? null,
      payload: changedFields,
    });
  },

  onCloseEditAmount() {
    this._closeEditAmount();
  },

  _closeEditAmount() {
    this.setData({ editAmountVisible: false, editActiveRefId: '' });
    eventBus.emit(EventNames.SHOW_TAB_BAR);
  },

  onEditAmountDateChange(e: WechatMiniprogram.PickerChange) {
    const val = e.detail.value as string;
    const today = new Date();
    const todayVal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const text = val === todayVal ? '今天' : `${parseInt(val.split('-')[1], 10)}/${parseInt(val.split('-')[2], 10)}`;
    this.setData({ editAmountDate: val, editAmountDateText: text });
  },

  onEditAmountToggleShared() {
    this.setData({
      editAmountSharedType: this.data.editAmountSharedType === 'shared' ? 'personal' : 'shared',
    });
  },

  /** 阻止弹窗穿透 */
  noop() {},

  onListScroll() {
    if (this._horizontalSwipeActive) return;
    if (this._swipeScrollSettling) {
      this._beginSwipeScrollSettling();
      return;
    }
    if (this.data.swipingRefId) {
      this._resetAllSwipe();
    }
  },

  // ─── 分享（推广型 · 内容来自 utils/share.ts） ───────────────────────────────

  onShareAppMessage() {
    return buildAppShareContent();
  },

  onShareTimeline() {
    return buildTimelineShareContent();
  },
});
