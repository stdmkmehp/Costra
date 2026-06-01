// pages/ledger/index.ts · 明细页（首屏 Tab1）
// 卡号: COSTRA-203 / COSTRA-214 · 明细首屏巨大月支出+日期分组吸顶流水列表+左滑删除+账本切换+统一安全区
// 设计源: design/ui/design_spec.md §6.2 + design/ui/interaction_flow.md §4
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）

import Decimal from '../../utils/vendor/decimal';
import { toYuan } from '../../utils/money';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { listEntries, deleteEntry, type Entry } from '../../services/db';
import { getActiveLedgerId, getActiveFamilyId } from '../../services/family';
import { enqueue } from '../../services/outbox';

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

// ─── 辅助函数 ────────────────────────────────────────────────────────────────────

/** 格式化金额为 ¥X,XXX.XX（带千分位） */
function formatAmountDisplay(cents: number): string {
  const yuanStr = toYuan(Math.abs(cents));
  const parts = yuanStr.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥${intPart}.${parts[1]}`;
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

/** 获取分类图标首字 */
function getCategoryIcon(categoryId: string | null): string {
  if (!categoryId) return '·';
  const iconMap: Record<string, string> = {
    food: '餐',
    transport: '行',
    shopping: '购',
    entertainment: '乐',
    housing: '住',
    medical: '医',
    education: '学',
    salary: '薪',
    investment: '投',
    other: '…',
  };
  return iconMap[categoryId] || categoryId.slice(0, 1).toUpperCase();
}

/** 获取分类名 */
function getCategoryName(categoryId: string | null): string {
  if (!categoryId) return '未分类';
  const nameMap: Record<string, string> = {
    food: '餐饮',
    transport: '交通',
    shopping: '购物',
    entertainment: '娱乐',
    housing: '住房',
    medical: '医疗',
    education: '教育',
    salary: '工资',
    investment: '投资',
    other: '其他',
  };
  return nameMap[categoryId] || categoryId;
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

    // ─── 左滑 ───
    swipingRefId: '',
  },

  // 内部状态
  _ledgerId: '' as string,
  _familyId: '' as string,
  _allEntries: [] as Entry[],
  _touchStartX: 0 as number,
  _touchStartY: 0 as number,
  _touchRefId: '' as string,
  _swipeStarted: false as boolean,

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  onLoad() {
    // COSTRA-214: 使用统一安全区服务替代直接调用 wx.getWindowInfo()
    const { statusBarHeight, navBarHeight, navBarTotalHeight } = getSafeAreaMetrics();
    this.setData({
      statusBarHeight,
      navBarHeight,
      navBarTotalHeight,
      monthDisplay: formatMonthDisplay(this.data.currentMonth),
    });
  },

  async onShow() {
    this.getTabBar?.()?.setData?.({ selected: 0 });
    await this._loadContext();
    await this._loadEntries();
  },

  // ─── 数据加载 ────────────────────────────────────────────────────────────────

  async _loadContext() {
    const [ledgerId, familyId] = await Promise.all([
      getActiveLedgerId(),
      getActiveFamilyId(),
    ]);
    this._ledgerId = ledgerId || '';
    this._familyId = familyId || '';

    const isMultiMember = !!familyId && familyId !== 'solo';
    this.setData({
      showMemberFilter: isMultiMember,
      ledgerName: '我的账本',
    });
  },

  async _loadEntries() {
    if (!this._ledgerId) {
      this.setData({
        dateGroups: [],
        isEmpty: true,
        totalExpense: '¥0.00',
        totalBalance: '',
        totalExpenseCents: 0,
        totalIncomeCents: 0,
      });
      return;
    }

    const monthRange = getMonthRange(this.data.currentMonth);
    const entries = await listEntries({
      ledger_id: this._ledgerId,
      since: monthRange.since,
    });

    this._allEntries = entries.filter(e => e.occurred_at < monthRange.until);
    this._buildDisplay();
  },

  /** 从 _allEntries 构建 dateGroups + 汇总 */
  _buildDisplay() {
    const entries = this._allEntries;

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

    this.setData({
      dateGroups,
      isEmpty: dateGroups.length === 0,
      totalExpense: formatAmountDisplay(totalExpenseCents.toNumber()),
      totalExpenseCents: totalExpenseCents.toNumber(),
      totalIncomeCents: totalIncomeCents.toNumber(),
      totalBalance: `收入 ¥${formatAmountShort(totalIncomeCents.toNumber())} · 结余 ${balanceStr}`,
    });
  },

  // ─── 交互：账本切换 ──────────────────────────────────────────────────────────

  onTapLedgerName() {
    const items = ['我的账本'];
    if (this._familyId && this._familyId !== 'solo') {
      items.push('家庭账本');
    }

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const selected = items[res.tapIndex];
        this.setData({ ledgerName: selected });
      },
    });
  },

  // ─── 交互：月份选择 ──────────────────────────────────────────────────────────

  onMonthChange(e: WechatMiniprogram.PickerChange) {
    const value = e.detail.value as string;
    this.setData({
      currentMonth: value,
      monthDisplay: formatMonthDisplay(value),
    });
    this._loadEntries();
  },

  // ─── 交互：成员筛选 ──────────────────────────────────────────────────────────

  onTapMemberFilter() {
    const items = ['全部成员', '仅看自己'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        this.setData({ memberFilterText: items[res.tapIndex] });
      },
    });
  },

  // ─── 交互：左滑删除 ──────────────────────────────────────────────────────────

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
        if (!res.confirm) return;

        await deleteEntry(refId);
        await enqueue({
          op: 'delete',
          entity: 'entry',
          client_ref_id: refId,
          base_version: null,
          payload: {},
        });

        wx.vibrateShort({ type: 'medium' });

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
