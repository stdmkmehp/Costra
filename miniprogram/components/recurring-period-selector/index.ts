// components/recurring-period-selector/index.ts ·周期选择组件
// 支持：每n周（n≥1）、每n月（n≥1）、每年

import type { RecurringPeriod } from '../../services/recurringApi';

/** 周期基础类型 */
type PeriodType = 'weekly' | 'monthly' | 'yearly';

/**
 * 从RecurringPeriod 提取基础类型和间隔
 */
function parsePeriod(period: RecurringPeriod): { type: PeriodType; interval: number } {
  switch (period) {
    case 'weekly': return { type: 'weekly', interval: 1 };
    case 'biweekly': return { type: 'weekly', interval: 2 };
    case 'monthly': return { type: 'monthly', interval: 1 };
    case 'bimonthly': return { type: 'monthly', interval: 2 };
    case 'trimonthly': return { type: 'monthly', interval: 3 };
    case 'yearly': return { type: 'yearly', interval: 1 };
    default: return { type: 'weekly', interval: 1 };
  }
}

/**
 * 将基础类型和间隔组合为RecurringPeriod（兼容已有枚举）
 * 对于超出已有枚举范围的值，使用 weekly/monthly 作为基底+ period_interval 扩展
 */
function composePeriod(type: PeriodType, interval: number): RecurringPeriod {
  if (type === 'weekly') {
    if (interval === 1) return 'weekly';
    if (interval === 2) return 'biweekly';
    // n>2 的情况 → 使用 weekly作为基底，搭配 period_interval
    return 'weekly';
  }
  if (type === 'monthly') {
    if (interval === 1) return 'monthly';
    if (interval === 2) return 'bimonthly';
    if (interval === 3) return 'trimonthly';
    // n>3 的情况 → 使用 monthly 作为基底，搭配 period_interval
    return 'monthly';
  }
  return 'yearly';
}

Component({
  properties: {
    value: { type: String, value: 'weekly' },
    show: { type: Boolean, value: false },
    /** 周期间隔值 */
    periodInterval: { type: Number, value: 1 },
  },
  data: {
    periodType: 'weekly' as PeriodType,
    weekInterval: 1,
    monthInterval: 1,
  },
  observers: {
    'value, periodInterval'() {
      this._syncFromProps();
    },
  },
  lifetimes: {
    attached() {
      this._syncFromProps();
    },
  },
  methods: {
    _syncFromProps() {
      const parsed = parsePeriod(this.properties.value as RecurringPeriod);
      const interval = (this.properties.periodInterval as number) || parsed.interval;

      const updates: Record<string, any> = { periodType: parsed.type };
      if (parsed.type === 'weekly') {
        updates.weekInterval = interval;
      } else if (parsed.type === 'monthly') {
        updates.monthInterval = interval;
      }
      this.setData(updates);
    },

    onSelectType(e: WechatMiniprogram.TouchEvent) {
      const type = e.currentTarget.dataset.type as PeriodType;
      this.setData({ periodType: type });

      const interval = type === 'weekly'
        ? this.data.weekInterval
        : type === 'monthly'
          ? this.data.monthInterval
          : 1;

      const period = composePeriod(type, interval);
      this.triggerEvent('change', { value: period, periodInterval: interval });
    },

    onWeekIntervalInput(e: WechatMiniprogram.Input) {
      const raw = e.detail.value;
      // 允许用户自由输入，中间态可以为空（blur 时兜底）
      const parsed = raw === '' ? '' : (parseInt(raw, 10) || '');
      this.setData({ weekInterval: parsed as any });
    },

    onWeekIntervalBlur(e: WechatMiniprogram.Input) {
      let val = parseInt(e.detail.value, 10);
      if (!val || val < 1) val = 1;
      this.setData({ weekInterval: val });
      const period = composePeriod('weekly', val);
      this.triggerEvent('change', { value: period, periodInterval: val });
    },

    onMonthIntervalInput(e: WechatMiniprogram.Input) {
      const raw = e.detail.value;
      // 允许用户自由输入，中间态可以为空（blur 时兜底）
      const parsed = raw === '' ? '' : (parseInt(raw, 10) || '');
      this.setData({ monthInterval: parsed as any });
    },

    onMonthIntervalBlur(e: WechatMiniprogram.Input) {
      let val = parseInt(e.detail.value, 10);
      if (!val || val < 1) val = 1;
      this.setData({ monthInterval: val });
      const period = composePeriod('monthly', val);
      this.triggerEvent('change', { value: period, periodInterval: val });
    },

    onClose() {
      this.triggerEvent('close');
    },
    onNoop() { /* catchtap noop handler */ },
  },
});
