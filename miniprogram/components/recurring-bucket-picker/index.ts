// components/recurring-bucket-picker/index.ts · 时段选择组件
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx

import type { RecurringBucket } from '../../services/recurringApi';

const BUCKET_OPTIONS: { value: RecurringBucket; label: string }[] = [
  { value: 'dawn', label: '凌晨' },
  { value: 'morning', label: '早上' },
  { value: 'afternoon', label: '下午' },
  { value: 'night', label: '晚上' },
];

Component({
  properties: {
    value: { type: String, value: 'morning' },
  },
  data: {
    bucketOptions: BUCKET_OPTIONS,
  },
  methods: {
    onSelect(e: WechatMiniprogram.TouchEvent) {
      const bucket = e.currentTarget.dataset.bucket as RecurringBucket;
      this.triggerEvent('change', { value: bucket });
    },
  },
});
