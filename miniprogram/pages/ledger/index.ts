// pages/ledger/index.ts · 明细页（首屏 Tab1）
// 卡号: COSTRA-203 / COSTRA-214 / COSTRA-220 · 明细首屏巨大月支出+日期分组吸顶流水列表+左滑删除+账本切换+统一安全区+真实数据对接
// 设计源: design/ui/design_spec.md §6.2 + design/ui/interaction_flow.md §4
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）

import Decimal from '../../utils/vendor/decimal';
import { toYuan } from '../../utils/money';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { listMonthEntries, deleteEntry, updateEntryFields, type Entry, type MonthEntriesResult } from '../../services/db';
import {
  getActiveLedgerId,
  getActiveFamilyId,
  getActiveFamilyKind,
  getActiveLedgerName,
  switchActiveFamily,
  fallbackToPersonalFamily,
} from '../../services/family';
import { enqueue } from '../../services/outbox';
import { getToken, hasValidSession } from '../../services/auth';
import { eventBus, EventNames, type SyncDonePayload, type ActiveFamilyChangedPayload, type ProfileUpdatedPayload, type LedgerDisplayReadyPayload } from '../../services/eventBus';
import { triggerOnPageShow, syncOnce } from '../../services/syncScheduler';
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
  type CalcState,
} from '../../utils/calc';

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
  /** expense / income */
  type: 'expense' | 'income';
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
}

/** 成员筛选状态（原 COSTRA-220 MVP 升级为多维筛选面板） */
type ExpenseTypeFilter = 'all' | 'personal' | 'shared';

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

/** 格式化条目金额文字 */
function formatEntryAmount(cents: number, type: 'expense' | 'income'): string {
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

/** ISO 8601 → 日期 key YYYY-MM-DD */
function toDateKey(isoStr: string): string {
  return isoStr.slice(0, 10);
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
    filterExpenseType: 'all' as ExpenseTypeFilter,

    // ─── 列表 ───
    dateGroups: [] as DateGroup[],
    isEmpty: true,
    emptyTitle: buildEmptyTitle(getCurrentMonthValue()),
    emptyHint: '',
    ledgerLoadingState: 'bootstrapping' as LedgerLoadingState,
    ledgerLoadingText: '正在准备账本…',
    ledgerLoadError: '',
    ledgerSkeletonRows: [1, 2, 3, 4],

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
    editAmountVisible: false,
    editAmountDisplay: '0',
    editAmountCalc: { ...INITIAL_CALC_STATE } as CalcState,
    editAmountShowShared: false,
    editAmountSharedType: 'personal' as 'personal' | 'shared',
    editAmountDate: '',
    editAmountDateText: '今天',
    editCategoryType: 'expense' as 'expense' | 'income',
    /** COSTRA-228: swiper current 绑定（0=支出 / 1=收入） */
    editCategoryTypeIndex: 0,
    /** COSTRA-228: swiper 切换动画时长 */
    editCategorySwiperDuration: 240,
    editCategoryList: [] as { id: string; icon: string; name: string }[],
    editSelectedCategoryId: '',
    // COSTRA-228: 双 pane 数据（手势横滑期间两个 pane 都已渲染）
    editExpenseTier1Categories: [] as { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[],
    editIncomeTier1Categories: [] as { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[],
    editExpenseDedupedSubCategories: [] as { id: string; name: string; icon: string }[],
    editIncomeDedupedSubCategories: [] as { id: string; name: string; icon: string }[],

    // ─── 列表滚动位置（COSTRA-220: 月份切换后滚动到顶部） ───
    listScrollTop: 0,
  },

  // 内部状态
  _ledgerId: '' as string,
  _familyId: '' as string,
  _allEntries: [] as Entry[],
  _touchStartX: 0 as number,
  _touchStartY: 0 as number,
  _touchRefId: '' as string,
  _swipeStarted: false as boolean,
  _lastSwipeEndAt: 0 as number,
  _shouldRefreshEmptyHintOnNextEmpty: false as boolean,
  /** 费用性质筛选状态 */
  _filterExpenseType: 'all' as ExpenseTypeFilter,
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
   * 拼接字段：client_ref_id|version|occurred_at|amount|type|category_id|note|deleted_at|shared_type|created_by
   */
  _entriesSignature: '' as string,
  /** 当前已渲染内容所属账本，用于切回时保留旧画面但避免账本切换误展示 */
  _renderedLedgerId: '' as string,
  /** 当前已渲染内容所属月份 */
  _renderedMonth: '' as string,
  /** 首次首屏完成事件是否已发出 */
  _displayReadyEmitted: false as boolean,
  /** COSTRA-227: 当前正在编辑的条目 client_ref_id */
  _editingRefId: '' as string,

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  // onLoad gate（冗余兜底 · onShow gate 是主防线）
  onLoad() {
    // COSTRA-214: 使用统一安全区服务替代直接调用 wx.getWindowInfo()
    const { statusBarHeight, navBarHeight, navBarTotalHeight } = getSafeAreaMetrics();
    this.setData({
      statusBarHeight,
      navBarHeight,
      navBarTotalHeight,
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

  async _loadContext() {
    markPerf('ledger.context.start');
    this._setLedgerLoadingState('validating-ledger');
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
    let displayLedgerName = ledgerName || (familyKind === 'personal' ? '个人账本' : '账本待同步');

    // 协作账本需确认当前用户仍在 family 列表中；被移出时立即回退 personal，避免展示旧协作账本数据。
    if (isMultiMember && familyId) {
      try {
        const { families } = await getFamilies();
        const matched = families.find((f) => f.id === familyId && f.ledger_id === ledgerId);
        if (!matched) {
          const fallback = await fallbackToPersonalFamily('family-switch');
          if (fallback) {
            this._familyId = fallback.family_id;
            this._ledgerId = fallback.ledger_id;
            this.setData({ showMemberFilter: false, ledgerName: fallback.ledger_name || '个人账本' });
            setPerfContext({ ledger: fallback.family_kind || 'personal', activeContext: 'fallback-personal' });
          } else {
            this._familyId = '';
            this._ledgerId = '';
            this._setLedgerLoadingState('failed', '账本待同步，请稍后重试');
            // 首屏校验失败且无法回退 · 释放后台预热
            this._emitLedgerDisplayFailed();
          }
          markPerf('ledger.context.done', { result: fallback ? 'fallback-personal' : 'family-missing' });
          wx.showToast({ title: '你已不在该账本中', icon: 'none' });
          return;
        }
        displayLedgerName = matched.ledger_name || matched.name || displayLedgerName;
      } catch {
        displayLedgerName = ledgerName ? `${ledgerName}（离线）` : '协作账本（离线）';
        if (!ledgerId) {
          wx.showToast({ title: '网络异常，账本待验证', icon: 'none' });
        }
      }
    }

    this.setData({
      showMemberFilter: isMultiMember,
      // 仅明确 personal 时 fallback 为“个人账本”；unknown/partial context 不再误显示个人账本。
      ledgerName: displayLedgerName,
    });

    // 切换到非共享账本时重置筛选
    if (!isMultiMember) {
      this._filterExpenseType = 'all';
      this._filterSelectedMemberIds = [];
      this.setData({
        filterExpenseType: 'all',
        filterMembers: [],
        filterActive: false,
        filterPanelVisible: false,
        memberFilterText: '全部',
      });
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
    markPerf('ledger.context.done', {
      ledger: familyKind || 'unknown',
      shared: isMultiMember,
      hasLedgerId: !!this._ledgerId,
      hasFamilyId: !!this._familyId,
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

    const canKeepCurrentView = this._renderedLedgerId === this._ledgerId
      && this._renderedMonth === targetMonth
      && this.data.dateGroups.length > 0;
    if (canKeepCurrentView) {
      markPerf('ledger.loading-state', { state: 'loading-cache', preserve: 'existing-view' });
    } else {
      this._setLedgerLoadingState('loading-cache');
    }
    const recentResult = await listMonthEntries({
      ledger_id: this._ledgerId,
      month: targetMonth,
      limit: LEDGER_RECENT_ENTRY_LIMIT,
    });

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
      void this._loadFullMonthEntries(targetMonth, this._ledgerId, recentResult);
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

  async _loadFullMonthEntries(monthValue: string, ledgerId: string, recentResult?: MonthEntriesResult) {
    markPerf('ledger.entries.full.start', { month: monthValue, ledgerId, recentCount: recentResult?.entries.length ?? 0 });
    try {
      const fullResult = await listMonthEntries({ ledger_id: ledgerId, month: monthValue });
      if (this._ledgerId !== ledgerId || this.data.currentMonth !== monthValue) {
        markPerf('ledger.entries.full.skip', { reason: 'context-changed', month: monthValue });
        return;
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
    const targetMonth = this.data.currentMonth;
    const fullResult = await listMonthEntries({ ledger_id: this._ledgerId, month: targetMonth });
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

    // 筛选：费用性质 + 成员多选
    let entries = this._allEntries;

    // 费用性质过滤
    if (this._filterExpenseType === 'personal') {
      entries = entries.filter(e => e.shared_type !== 'shared');
    } else if (this._filterExpenseType === 'shared') {
      entries = entries.filter(e => e.shared_type === 'shared');
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
        if (e.type === 'expense') {
          dayExpense = dayExpense.plus(amt);
          totalExpenseCents = totalExpenseCents.plus(amt);
        } else {
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

  async onTapLedgerName() {
    try {
      const { families } = await getFamilies();
      if (!families || families.length <= 1) {
        wx.showToast({ title: '当前只有一个账本', icon: 'none' });
        return;
      }

      const items = families.map(f => {
        const suffix = f.kind === 'personal' ? '（个人）' : `（${f.member_count}人）`;
        return f.name + suffix;
      });

      wx.showActionSheet({
        itemList: items,
        success: async (res) => {
          const selected = families[res.tapIndex];
          if (selected.ledger_id === this._ledgerId) return;

          // 统一切换 active family context + 可靠持久化服务端偏好
          await switchActiveFamily({
            family_id: selected.id,
            ledger_id: selected.ledger_id,
            family_kind: selected.kind,
            ledger_name: selected.ledger_name || selected.name,
          }, 'ledger-switch');

          this._familyId = selected.id;
          this._ledgerId = selected.ledger_id;
          this.setData({ ledgerName: selected.ledger_name || selected.name });
          await this._loadEntries();
          // 切换账本后主动拉取新账本数据 · 其他成员可能已记账但本地未同步
          void syncOnce('ledger-switch');
        },
      });
    } catch {
      wx.showToast({ title: '获取账本列表失败', icon: 'none' });
    }
  },

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

  /** 筛选面板：费用性质变更 */
  onFilterExpenseTypeChange(e: WechatMiniprogram.CustomEvent<{ expenseType: ExpenseTypeFilter }>) {
    const { expenseType } = e.detail;
    this._filterExpenseType = expenseType;
    this.setData({ filterExpenseType: expenseType });
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
    const isAllExpense = this._filterExpenseType === 'all';
    const filterActive = !isAllMembers || !isAllExpense;

    let memberFilterText = '全部';
    if (filterActive) {
      const parts: string[] = [];
      if (!isAllExpense) {
        parts.push(this._filterExpenseType === 'personal' ? '个人' : '公共');
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
  },

  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    const deltaX = e.touches[0].clientX - this._touchStartX;
    const deltaY = e.touches[0].clientY - this._touchStartY;

    if (!this._swipeStarted && Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (Math.abs(deltaX) < 10) return;

    this._swipeStarted = true;

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
    if (!this._swipeStarted) return;
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
    this._lastSwipeEndAt = Date.now();
  },

  _resetSwipe(refId: string) {
    this._updateEntryTranslate(refId, 0);
  },

  _resetAllSwipe() {
    const { dateGroups } = this.data;
    let changed = false;
    for (const g of dateGroups) {
      for (const e of g.entries) {
        if (e.translateX !== 0) {
          e.translateX = 0;
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

  onDeleteEntry(e: WechatMiniprogram.TouchEvent) {
    const refId = e.currentTarget.dataset.refid;
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
    if (this.data.swipingRefId) { this._resetAllSwipe(); return; }
    const refId = (e.currentTarget.dataset as Record<string, string>).refid;
    if (!refId) return;
    const entry = this._findRawEntry(refId);
    if (!entry) return;

    this._editingRefId = refId;

    const familyId = this._familyId;
    if (!familyId) return;

    // —— 阶段 1：同步加载分类（内存缓存 → fallback）——
    const categoryData = loadCategoriesSync(familyId);
    (this as unknown as Record<string, unknown>)._editCategoryData = categoryData;

    const entryType = entry.type || 'expense';
    const tier1 = entryType === 'expense' ? categoryData.expense : categoryData.income;
    const deduped = entryType === 'expense' ? categoryData.expenseDedupedSubs : categoryData.incomeDedupedSubs;

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
      editCategoryType: entryType,
      editCategoryTypeIndex: entryType === 'income' ? 1 : 0,
      editCategorySwiperDuration: 0,
      // COSTRA-228: 双 pane 数据
      editExpenseTier1Categories: categoryData.expense,
      editIncomeTier1Categories: categoryData.income,
      editExpenseDedupedSubCategories: categoryData.expenseDedupedSubs,
      editIncomeDedupedSubCategories: categoryData.incomeDedupedSubs,
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

    const tier1 = this.data.editCategoryType === 'expense' ? next.expense : next.income;
    const deduped = this.data.editCategoryType === 'expense' ? next.expenseDedupedSubs : next.incomeDedupedSubs;

    // COSTRA-228: 双 pane 数据同时刷新
    this.setData({
      editExpenseTier1Categories: next.expense,
      editIncomeTier1Categories: next.income,
      editExpenseDedupedSubCategories: next.expenseDedupedSubs,
      editIncomeDedupedSubCategories: next.incomeDedupedSubs,
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
      this.setData({ editCategoryVisible: false });
      eventBus.emit(EventNames.SHOW_TAB_BAR);
      return;
    }

    // SOP 步骤 2: 取内存对象
    const entry = this._findRawEntry(refId);
    if (!entry) {
      this.setData({ editCategoryVisible: false });
      eventBus.emit(EventNames.SHOW_TAB_BAR);
      return;
    }

    // SOP 步骤 3: 同等性 guard
    if (entry.category_id === catId) {
      this.setData({ editCategoryVisible: false });
      eventBus.emit(EventNames.SHOW_TAB_BAR);
      return;
    }

    // SOP 步骤 4: 同步赋值内存
    const now = new Date().toISOString();
    entry.category_id = catId;
    entry.updated_at = now;

    // SOP 步骤 5: 关闭面板
    this.setData({ editCategoryVisible: false });
    eventBus.emit(EventNames.SHOW_TAB_BAR);

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
    this.setData({ editCategoryVisible: false });
    eventBus.emit(EventNames.SHOW_TAB_BAR);
  },

  /** 分类面板：点击 tab 切换收支（仅修改 editCategoryTypeIndex，由 swiper 过渡） */
  onEditCategoryTypeTab(e: WechatMiniprogram.TouchEvent) {
    const type = (e.currentTarget.dataset as Record<string, string>).type as 'expense' | 'income';
    const targetIdx = type === 'income' ? 1 : 0;
    if (targetIdx === this.data.editCategoryTypeIndex) return;
    this.setData({ editCategoryTypeIndex: targetIdx });
  },

  /** 分类面板：swiper 横滑切换回调（统一更新 editCategoryType + 分类列表） */
  onEditCategorySwiperChange(e: WechatMiniprogram.SwiperChange) {
    const idx = e.detail.current;
    const nextType: 'expense' | 'income' = idx === 1 ? 'income' : 'expense';
    if (nextType === this.data.editCategoryType) return;
    this._switchEditCategoryType(nextType);
  },

  /** 分类面板：收支切换核心逻辑 */
  _switchEditCategoryType(type: 'expense' | 'income') {
    const catData = (this as unknown as Record<string, unknown>)._editCategoryData as {
      expense: { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[];
      income: { id: string; icon: string; name: string; children: { id: string; name: string; icon: string }[] }[];
      expenseDedupedSubs: { id: string; name: string; icon: string }[];
      incomeDedupedSubs: { id: string; name: string; icon: string }[];
    } | undefined;
    if (!catData) return;

    const tier1 = type === 'expense' ? catData.expense : catData.income;
    const deduped = type === 'expense' ? catData.expenseDedupedSubs : catData.incomeDedupedSubs;

    this.setData({
      editCategoryType: type,
      editCategoryTypeIndex: type === 'income' ? 1 : 0,
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
    if (this.data.swipingRefId) { this._resetAllSwipe(); return; }
    const refId = (e.currentTarget.dataset as Record<string, string>).refid;
    if (!refId) return;
    const entry = this._findRawEntry(refId);
    if (!entry) return;

    this._editingRefId = refId;
    this.setData({
      editingNoteRefId: refId,
      editNoteValue: entry.note || '',
    });
  },

  onEditNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ editNoteValue: e.detail.value });
  },

  async onConfirmEditNote(_e?: WechatMiniprogram.TouchEvent) {
    // SOP 步骤 1: 幂等 guard（首行清，任何二次触发立即 bail）
    const refId = this._editingRefId;
    this._editingRefId = '';
    if (!refId) {
      this.setData({ editingNoteRefId: '' });
      return;
    }

    // SOP 步骤 2: 取内存对象
    const entry = this._findRawEntry(refId);
    if (!entry) {
      this.setData({ editingNoteRefId: '' });
      return;
    }

    // SOP 步骤 3: 同等性 guard
    const newNote = this.data.editNoteValue.trim();
    const oldNote = (entry.note || '').trim();
    this.setData({ editingNoteRefId: '' });
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
    if (this.data.swipingRefId) { this._resetAllSwipe(); return; }
    const refId = (e.currentTarget.dataset as Record<string, string>).refid;
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
      case 'backspace':
        calc = inputBackspace(calc);
        break;
      default:
        return;
    }

    this.setData({ editAmountCalc: calc, editAmountDisplay: calc.display });
  },

  _onEditAmountAction() {
    const calc = this.data.editAmountCalc;
    if (calc.actionState === 'equals') {
      const newCalc = pressEquals(calc);
      this.setData({ editAmountCalc: newCalc, editAmountDisplay: newCalc.display });
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
    this.setData({ editAmountVisible: false });
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
    if (this.data.swipingRefId) {
      this._resetAllSwipe();
    }
  },
});
