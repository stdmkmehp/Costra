// components/recurring-dom-picker/index.ts · 月日选择组件
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import { formatDaysForSummary, type FormatContext } from '../../services/recurringSchedule';
import type { RecurringPeriod } from '../../services/recurringApi';
import { toggleLimitedSelection } from '../recurring-selection';

const DOM_MAX = 14;

Component({
  properties: {
    value: { type: Array, value: [] },
    period: { type: String, value: 'monthly' },
  },
  data: {
    domMax: DOM_MAX,
    domGrid: Array.from({ length: 31 }, (_, i) => i + 1),
    summaryCount: '',
    summaryList: '',
    showHint: false,
    rejectedDay: 0,
  },
  observers: {
    value() {
      this._updateSummary();
    },
  },
  methods: {
    onTapDom(e: WechatMiniprogram.TouchEvent) {
      const day = Number(e.currentTarget.dataset.day);
      const result = toggleLimitedSelection(
        this.properties.value as number[],
        day,
        DOM_MAX,
      );
      if (result.limitRejected) {
        // 被拒 tag 抖动 + flash + vibrate + toast
        this.setData({ rejectedDay: day });
        wx.vibrateShort({ type: 'light' });
        wx.showToast({ title: `最多可选 ${DOM_MAX} 天`, icon: 'none', duration: 1500 });
        setTimeout(() => this.setData({ rejectedDay: 0 }), 180);
        this.triggerEvent('limit', { max: DOM_MAX });
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
    _updateSummary() {
      const arr = this.properties.value as number[];
      const showHint = arr.some((d) => d >= 29);
      if (arr.length === 0) {
        this.setData({ summaryCount: '', summaryList: '', showHint });
        return;
      }
      const ctx: FormatContext = {
        period: this.properties.period as RecurringPeriod,
        mode: 'full',
        days_of_week: null,
        days_of_month: arr,
        year_month_days: null,
      };
      this.setData({
        summaryCount: `${arr.length}`,
        summaryList: formatDaysForSummary(ctx),
        showHint,
      });
    },
  },
});
