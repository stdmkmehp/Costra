// components/recurring-period-selector/index.ts · 周期选择组件
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import type { RecurringPeriod } from '../../services/recurringApi';

const PERIOD_OPTIONS: { value: RecurringPeriod; label: string }[] = [
  { value: 'weekly', label: '每周' },
  { value: 'biweekly', label: '每两周' },
  { value: 'monthly', label: '每月' },
  { value: 'bimonthly', label: '每两月' },
  { value: 'trimonthly', label: '每三月' },
  { value: 'yearly', label: '每年' },
];

Component({
  properties: {
    value: { type: String, value: 'weekly' },
    show: { type: Boolean, value: false },
  },
  data: {
    periodOptions: PERIOD_OPTIONS,
  },
  methods: {
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const value = e.currentTarget.dataset.value as RecurringPeriod;
      this.triggerEvent('change', { value });
    },
    onClose() {
      this.triggerEvent('close');
    },
    onNoop() { /* catchtap noop handler */ },
  },
});
