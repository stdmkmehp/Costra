// components/recurring-dow-picker/index.ts · 星期选择组件
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import { formatDaysForSummary, type FormatContext } from '../../services/recurringSchedule';
import type { RecurringPeriod } from '../../services/recurringApi';
import { toggleLimitedSelection } from '../recurring-selection';

const DOW_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const DOW_MAX = 7;

Component({
  properties: {
    value: { type: Array, value: [] },
    period: { type: String, value: 'weekly' },
  },
  data: {
    dowLabels: DOW_LABELS,
    dowMax: DOW_MAX,
    summaryCount: '',
    summaryList: '',
  },
  observers: {
    value() {
      this._updateSummary();
    },
  },
  methods: {
    onTapDow(e: WechatMiniprogram.TouchEvent) {
      const day = Number(e.currentTarget.dataset.day);
      const result = toggleLimitedSelection(
        this.properties.value as number[],
        day,
        DOW_MAX,
      );
      if (result.limitRejected) {
        this.triggerEvent('limit', { max: DOW_MAX });
        return;
      }
      this.triggerEvent('change', { value: result.values });
    },
    onClear() {
      if ((this.properties.value as number[]).length === 0) return;
      wx.showModal({
        title: '清空所有已选星期？',
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
      if (arr.length === 0) {
        this.setData({ summaryCount: '', summaryList: '' });
        return;
      }
      const ctx: FormatContext = {
        period: this.properties.period as RecurringPeriod,
        mode: 'full',
        days_of_week: arr,
        days_of_month: null,
        year_month_days: null,
      };
      this.setData({
        summaryCount: `${arr.length}`,
        summaryList: formatDaysForSummary(ctx),
      });
    },
  },
});
