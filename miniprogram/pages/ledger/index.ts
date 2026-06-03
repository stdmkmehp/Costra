// pages/ledger/index.ts · 明细页（首屏 Tab1）
// 卡号: COSTRA-203 / COSTRA-214 / COSTRA-220 · 明细首屏巨大月支出+日期分组吸顶流水列表+左滑删除+账本切换+统一安全区+真实数据对接
// 设计源: design/ui/design_spec.md §6.2 + design/ui/interaction_flow.md §4
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）

import Decimal from '../../utils/vendor/decimal';
import { toYuan } from '../../utils/money';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { listEntries, deleteEntry, type Entry } from '../../services/db';
import {
  getActiveLedgerId,
  getActiveFamilyId,
  getActiveFamilyKind,
  getActiveLedgerName,
  setActiveFamily,
} from '../../services/family';
import { enqueue } from '../../services/outbox';
import { getToken } from '../../services/auth';
import { eventBus, EventNames } from '../../services/eventBus';
import { pickRandomSlogan } from '../../config/slogans';
import { getFamilies } from '../../services/familyApi';
import {
  getCategories,
  warmUpMemoryCache,
  getCategoryIconById,
  getCategoryNameById,
} from '../../services/categoryService';

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
  /** 滑动偏移量（左滑删除，rpx） */
  translateX: number;
}

/** 成员筛选状态（COSTRA-220 MVP: 仅全部/仅看自己） */
type MemberFilter = 'all' | 'self';

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

/** picker 值 → 范围过滤 */
function getMonthRange(value: string): { since: string; until: string } {
  const parts = value.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const since = `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const until = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000Z`;
  return { since, until };
}

// ─── Page ─────────────────────────────────────────────────────────────────────────

Page({
  data: {
    // ─── 导航栏 ───
    statusBarHeight: 0,
    navBarHeight: 44,
    navBarTotalHeight: 0,
    ledgerName: '我的账本',

    // ─── 头部汇总 ───
    currentMonth: getCurrentMonthValue(),
    monthDisplay: '',
    totalExpense: '¥0.00',
    totalExpenseCents: 0,
    totalIncomeCents: 0,
    totalBalance: '',
    showMemberFilter: false,
    memberFilterText: '全部成员',

    // ─── 列表 ───
    dateGroups: [] as DateGroup[],
    isEmpty: true,
    emptyTitle: buildEmptyTitle(getCurrentMonthValue()),
    emptyHint: '',

    // ─── 左滑 ───
    swipingRefId: '',

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
  /** 成员筛选状态（COSTRA-220: 'all' | 'self'） */
  _memberFilter: 'all' as MemberFilter,
  /** 当前用户 ID（COSTRA-220: 从 auth token 获取 · 用于成员筛选） */
  _currentUserId: '' as string,
  /** eventBus 订阅 handler（COSTRA-220: 防内存泄漏） */
  _entrySavedHandler: null as (() => void) | null,

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

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

    // COSTRA-220: 获取当前 userId（用于成员筛选）
    const token = getToken();
    if (token?.raw?.user?.id) {
      this._currentUserId = token.raw.user.id;
    }

    // COSTRA-220: 订阅 ENTRY_SAVED 事件 → 响应式刷新明细页
    const handler = () => { this._onEntrySaved(); };
    this._entrySavedHandler = handler;
    eventBus.on(EventNames.ENTRY_SAVED, handler);
  },

  async onShow() {
    this.getTabBar?.()?.setData?.({ selected: 0 });
    await this._loadContext();
    await this._loadEntries();
  },

  onUnload() {
    // COSTRA-220: 取消订阅 ENTRY_SAVED 事件（防内存泄漏）
    if (this._entrySavedHandler) {
      eventBus.off(EventNames.ENTRY_SAVED, this._entrySavedHandler);
      this._entrySavedHandler = null;
    }
  },

  // ─── 数据加载 ────────────────────────────────────────────────────────────────

  async _loadContext() {
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
    this.setData({
      showMemberFilter: isMultiMember,
      // COSTRA-220: 从 FamilyContext 获取真实账本名称
      ledgerName: ledgerName || '我的账本',
    });

    // 切换到非共享账本时重置成员筛选
    if (!isMultiMember && this._memberFilter !== 'all') {
      this._memberFilter = 'all';
      this.setData({ memberFilterText: '全部成员' });
    }

    // COSTRA-219: 预加载分类数据到内存缓存（供 getCategoryIconById/getCategoryNameById 查找）
    if (familyId) {
      try {
        const items = await getCategories(familyId);
        warmUpMemoryCache(familyId, items);
      } catch {
        // 分类加载失败不阻塞明细页渲染（降级 fallback 在 categoryService 内处理）
      }
    }
  },

  async _loadEntries(monthValue?: string) {
    const targetMonth = monthValue || this.data.currentMonth;
    if (!this._ledgerId) {
      const emptyHint = this._shouldRefreshEmptyHintOnNextEmpty
        ? pickRandomSlogan(this.data.emptyHint)
        : this.data.emptyHint || pickRandomSlogan();
      this.setData({
        dateGroups: [],
        isEmpty: true,
        emptyTitle: buildEmptyTitle(targetMonth),
        emptyHint,
        totalExpense: '¥0.00',
        totalBalance: '',
        totalExpenseCents: 0,
        totalIncomeCents: 0,
      });
      this._shouldRefreshEmptyHintOnNextEmpty = false;
      return;
    }

    const monthRange = getMonthRange(targetMonth);
    const entries = await listEntries({
      ledger_id: this._ledgerId,
      since: monthRange.since,
    });

    this._allEntries = entries.filter(e => e.occurred_at < monthRange.until);
    this._buildDisplay(targetMonth);
  },

  /** 从 _allEntries 构建 dateGroups + 汇总 */
  _buildDisplay(monthValue?: string) {
    const targetMonth = monthValue || this.data.currentMonth;

    // COSTRA-220: 成员筛选 · 按 _memberFilter 过滤 entries
    let entries = this._allEntries;
    if (this._memberFilter === 'self' && this._currentUserId) {
      entries = entries.filter(e => e.created_by === this._currentUserId);
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
        return {
          client_ref_id: e.client_ref_id,
          label: hasNote ? e.note : getCategoryName(e.category_id),
          icon: getCategoryIcon(e.category_id),
          amountText: formatEntryAmount(e.amount, e.type),
          type: e.type,
          hasNote,
          avatarUrl: '',
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
    this._shouldRefreshEmptyHintOnNextEmpty = false;
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

          // 切换 active family context
          await setActiveFamily({
            family_id: selected.id,
            ledger_id: selected.ledger_id,
            family_kind: selected.kind,
            ledger_name: selected.name,
          });

          this._familyId = selected.id;
          this._ledgerId = selected.ledger_id;
          this.setData({ ledgerName: selected.name });
          await this._loadEntries();
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
    // COSTRA-220: 真实过滤逻辑 · 选择后记录 _memberFilter 状态 + 重建显示
    const items = ['全部成员', '仅看自己'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const filter: MemberFilter = res.tapIndex === 0 ? 'all' : 'self';
        this._memberFilter = filter;
        this.setData({ memberFilterText: items[res.tapIndex] });
        this._buildDisplay();
      },
    });
  },

  // ─── eventBus 响应式刷新（COSTRA-220）─────────────────────────────────────────

  async _onEntrySaved() {
    // 记账保存成功后刷新明细页数据
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

  onTapEntry() {
    if (this.data.swipingRefId) {
      this._resetAllSwipe();
    }
  },

  onListScroll() {
    if (this.data.swipingRefId) {
      this._resetAllSwipe();
    }
  },
});
