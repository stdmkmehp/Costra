// components/recurring-yearly-picker/index.ts · 每年日期选择组件
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import { formatDaysForSummary, type FormatContext } from '../../services/recurringSchedule';
import {
  countYearMonthBadges,
  findFirstSelectedMonth,
  toggleLimitedSelection,
} from '../recurring-selection';

const YEARLY_MAX = 12;

function daysInMonth(month: number): number {
  const map = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return map[month - 1] || 31;
}

Component({
  properties: {
    value: { type: Array, value: [] },
  },
  data: {
    yearlyMax: YEARLY_MAX,
    activeMonth: 1,
    monthGrid: Array.from({ length: 12 }, (_, i) => i + 1),
    dayGrid: Array.from({ length: 31 }, (_, i) => i + 1),
    monthBadges: {} as Record<number, number>,
    summaryCount: '',
    summaryList: '',
    showHint: false,
    rejectedDay: 0,
  },
  lifetimes: {
    attached() {
      const arr = this.properties.value as number[];
      const m = findFirstSelectedMonth(arr);
      this.setData({ activeMonth: m });
      this._updateDayGrid();
      this._updateSummary();
    },
  },
  observers: {
    value() {
      this._updateSummary();
      this._updateDayGrid();
    },
  },
  methods: {
    onTapMonth(e: WechatMiniprogram.TouchEvent) {
      const month = Number(e.currentTarget.dataset.month);
      this.setData({ activeMonth: month });
      this._updateDayGrid();
    },
    onTapDay(e: WechatMiniprogram.TouchEvent) {
      const day = Number(e.currentTarget.dataset.day);
      const month = this.data.activeMonth;
      const encoded = month * 100 + day;
      const result = toggleLimitedSelection(
        this.properties.value as number[],
        encoded,
        YEARLY_MAX,
      );
      if (result.limitRejected) {
        // 被拒 tag 抖动 + flash + vibrate + toast
        this.setData({ rejectedDay: day });
        wx.vibrateShort({ type: 'light' });
        wx.showToast({ title: `最多可选 ${YEARLY_MAX} 天`, icon: 'none', duration: 1500 });
        setTimeout(() => this.setData({ rejectedDay: 0 }), 180);
        this.triggerEvent('limit', { max: YEARLY_MAX });
        return;
      }
      this.triggerEvent('change', { value: result.values });
    },
    onClear() {
      if ((this.properties.value as number[]).length === 0) return;
      wx.showModal({
        title: '清空所有已选日期？',
        confirmText: '清空',
        confirmColor: '#C08A7B',
        success: (res) => {
          if (res.confirm) {
            this.triggerEvent('clear');
          }
        },
      });
    },
    _updateDayGrid() {
      const month = this.data.activeMonth;
      const count = daysInMonth(month);
      this.setData({ dayGrid: Array.from({ length: count }, (_, i) => i + 1) });
      // 提示
      const selected = this.properties.value as number[];
      const monthDays = selected.filter((v) => Math.floor(v / 100) === month).map((v) => v % 100);
      const showHint = month === 2 ? monthDays.includes(29) : monthDays.some((d) => d >= 29);
      this.setData({ showHint });
    },
    _updateSummary() {
      const arr = this.properties.value as number[];
      // 月份徽标
      const badges = countYearMonthBadges(arr);
      if (arr.length === 0) {
        this.setData({ summaryCount: '', summaryList: '', monthBadges: badges });
        return;
      }
      const ctx: FormatContext = {
        period: 'yearly',
        mode: 'full',
        days_of_week: null,
        days_of_month: null,
        year_month_days: arr,
      };
      this.setData({
        summaryCount: `${arr.length}`,
        summaryList: formatDaysForSummary(ctx),
        monthBadges: badges,
      });
    },
  },
});
