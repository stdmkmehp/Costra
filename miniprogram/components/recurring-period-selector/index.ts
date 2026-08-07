// components/recurring-period-selector/index.ts · 周期选择组件
// 支持：每n周（n≥1）、每n月（n≥1）、每年
//
// 交互模型：面板始终保持打开状态供用户编辑。
// - 点击档位行 → 仅本地切换 periodType（预览），不提交。
// - 编辑数字框 → 仅本地更新对应 interval（预览），不提交。
// - 点击「确认」 → 一次性提交 change + 关闭面板。
// - 点击「取消」 → 仅关闭，不提交。
// 蒙层（选择周期之外的区域）不响应点击，避免误触导致取消，用户只能通过「确认」/「取消」关闭面板。
// 这样"切档"与"确认"解耦，避免用户点数字框时被误认为已确认。

import type { RecurringPeriod } from '../../services/recurringApi';

/** 周期基础类型 */
type PeriodType = 'weekly' | 'monthly' | 'yearly' | 'workday' | 'daily';

/**
 * 从 RecurringPeriod 提取基础类型和间隔
 */
function parsePeriod(period: RecurringPeriod): { type: PeriodType; interval: number } {
  switch (period) {
    case 'daily': return { type: 'daily', interval: 1 };
    case 'weekly': return { type: 'weekly', interval: 1 };
    case 'monthly': return { type: 'monthly', interval: 1 };
    case 'yearly': return { type: 'yearly', interval: 1 };
    case 'workday': return { type: 'workday', interval: 1 };
    default: return { type: 'weekly', interval: 1 };
  }
}

/**
 * 将基础类型和间隔组合为 RecurringPeriod。
 * 对于超出已有枚举范围的值（n>2 周 或 n>3 月），使用 weekly/monthly 作为基底搭配 period_interval 扩展。
 */
function composePeriod(type: PeriodType, _interval: number): RecurringPeriod {
  if (type === 'daily') return 'daily';
  if (type === 'weekly') return 'weekly';
  if (type === 'monthly') return 'monthly';
  if (type === 'workday') return 'workday';
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
    dayInterval: 1,
    weekInterval: 1,
    monthInterval: 1,
    /** 数字框展示值：用户清空时不强制回填 1，让用户继续输入 */
    dayIntervalDisplay: '1',
    weekIntervalDisplay: '1',
    monthIntervalDisplay: '1',
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

      // 当前档位对应的数字框用 props 同步；其它档位的数字框保留本地上一次值，
      // 让用户切档时不用重新输入。
      const dayInterval = parsed.type === 'daily' ? interval : (this.data.dayInterval || 1);
      const weekInterval = parsed.type === 'weekly' ? interval : (this.data.weekInterval || 1);
      const monthInterval = parsed.type === 'monthly' ? interval : (this.data.monthInterval || 1);

      this.setData({
        periodType: parsed.type,
        dayInterval,
        dayIntervalDisplay: String(dayInterval),
        weekInterval,
        weekIntervalDisplay: String(weekInterval),
        monthInterval,
        monthIntervalDisplay: String(monthInterval),
      });
    },

    /** 点击档位行 → 仅本地切换预览态 */
    onSelectType(e: WechatMiniprogram.TouchEvent) {
      const type = e.currentTarget.dataset.type as PeriodType;
      if (type === this.data.periodType) return;
      this.setData({ periodType: type });
    },

    onDayIntervalInput(e: WechatMiniprogram.Input) {
      // 允许用户自由输入（中间态可以为空），不要在 input 时就强制兜底
      this.setData({ dayIntervalDisplay: e.detail.value });
    },

    onDayIntervalBlur(e: WechatMiniprogram.Input) {
      let val = parseInt(e.detail.value, 10);
      if (!val || val < 1) val = 1;
      this.setData({ dayInterval: val, dayIntervalDisplay: String(val) });
    },

    onWeekIntervalInput(e: WechatMiniprogram.Input) {
      // 允许用户自由输入（中间态可以为空），不要在 input 时就强制兜底
      this.setData({ weekIntervalDisplay: e.detail.value });
    },

    onWeekIntervalBlur(e: WechatMiniprogram.Input) {
      let val = parseInt(e.detail.value, 10);
      if (!val || val < 1) val = 1;
      this.setData({ weekInterval: val, weekIntervalDisplay: String(val) });
    },

    onMonthIntervalInput(e: WechatMiniprogram.Input) {
      this.setData({ monthIntervalDisplay: e.detail.value });
    },

    onMonthIntervalBlur(e: WechatMiniprogram.Input) {
      let val = parseInt(e.detail.value, 10);
      if (!val || val < 1) val = 1;
      this.setData({ monthInterval: val, monthIntervalDisplay: String(val) });
    },

    /** 点击「确认」→ 提交 + 关闭 */
    onConfirm() {
      const periodType = this.data.periodType as PeriodType;
      const interval = periodType === 'daily'
        ? this.data.dayInterval
        : periodType === 'weekly'
          ? this.data.weekInterval
          : periodType === 'monthly'
            ? this.data.monthInterval
            : 1;
      const period = composePeriod(periodType, interval);
      // 一次性提交：父页面收到 change 后会更新表单态，收到 close 后会关面板。
      // 两个事件一起发，避免父页面逻辑还要感知"提交时是否需要顺手关面板"的耦合。
      this.triggerEvent('change', { value: period, periodInterval: interval });
      this.triggerEvent('close');
    },

    /** 点击「取消」→ 仅关闭，不提交 */
    onClose() {
      this.triggerEvent('close');
    },

    onNoop() { /* catchtap noop handler */ },
  },
});
