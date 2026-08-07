// components/recurring-period-selector/index.ts · 周期选择组件
// 支持：每n周（n≥1）、每n月（n≥1）、每年
//
// 交互模型：面板始终保持打开状态供用户编辑。
// - 点击档位行 → 仅本地切换 periodType（预览），不提交。
// - 编辑数字框 → 仅本地更新对应 interval（预览），不提交。
// - 点击「确认」 → 一次性提交 change + 关闭面板。
// - 点击「取消」/ 蒙层 → 仅关闭，不提交。
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
    /**
     * 系统键盘避让：sheet 整体 translateY 偏移（px，负数=上移）。
     * 关闭微信默认 adjust-position（不让整页被上推），自己控制 sheet 位移，
     * 保证底部"确认/取消"按钮始终浮在键盘之上可直接点。
     * 测量口径：actions.bottom 到 sheet.bottom 的尾部高度 = tailHeight（含底部安全区），
     * 让 actions.bottom 顶到 keyboardHeight 上沿。
     */
    sheetOffsetY: 0 as number,
    sheetTransitionMs: 0 as number,
  },
  observers: {
    'value, periodInterval'() {
      this._syncFromProps();
    },
    'show'(show: boolean) {
      if (!show) this._resetKeyboardRuntime();
    },
  },
  lifetimes: {
    attached() {
      this._syncFromProps();
    },
    detached() {
      this._resetKeyboardRuntime();
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

    /** 点击「取消」或蒙层 → 仅关闭 */
    onClose() {
      this._resetKeyboardRuntime();
      this.triggerEvent('close');
    },

    onNoop() { /* catchtap noop handler */ },

    // ─── 系统键盘避让 ───────────────────────────────────────────────────────
    //
    // 背景：3 个数字 input（每n天/每n周/每n月）位于 sheet 中部，底部是"取消/确认"。
    // 当用户聚焦 input 唤起系统数字键盘时，键盘会盖住 actions 区，导致无法直接点确认。
    // 关闭微信 adjust-position，自己控制 sheet 整体上移，露出底部按钮。
    // 复用 expense-overlay/keypad 的成熟 session + anchor + 实测模式：
    //   tailHeight = sheet.bottom - actions.bottom （含 sheet padding-bottom 安全区）
    //   delta      = keyboardHeight - tailHeight
    //   sheetOffsetY = -delta
    // 这样 actions.bottom 始终对齐 keyboardHeight 上沿。

    /** 数字 input 聚焦：失效锚点（布局可能因切换档位而变化），准备重测 */
    onIntervalFocus(e: WechatMiniprogram.InputFocus) {
      const self = this as unknown as Record<string, unknown>;
      const key = (e.currentTarget.dataset as { inputKey?: string }).inputKey;
      self._activeInputKey = key;
      self._sheetRiseAnchor = undefined;
      // 聚焦本身不直接触发位移；等 keyboardheightchange(height>0) 来驱动。
    },

    /**
     * 系统键盘高度变化（弹起 height>0 / 收起 height=0）— sheet 位移唯一驱动点。
     */
    onKeyboardHeightChange(e: WechatMiniprogram.InputKeyboardHeightChange) {
      const height = (e.detail && e.detail.height) || 0;
      const duration = (e.detail && e.detail.duration) || 0;
      const ms = duration > 0 ? duration : 0;
      const self = this as unknown as Record<string, unknown>;

      if (height <= 0) {
        // 键盘收起：归位
        this._resetKeyboardRuntime();
        this.setData({ sheetOffsetY: 0, sheetTransitionMs: ms });
        return;
      }
      if (!this.data.show) return;

      // 仅在用户聚焦了某个数字 input 时才避让（其他 input/项目不该被键盘推）
      if (!self._activeInputKey) return;

      const session = this._getKeyboardSession();
      self._latestKeyboard = { height, ms, session };

      const anchor = self._sheetRiseAnchor as { tailHeight: number } | undefined;
      if (anchor) {
        this._applySheetOffset(anchor.tailHeight, height, ms);
        return;
      }
      this._measureAndApplySheetOffset(session);
    },

    /** 数字 input 失焦：仅清掉 active 标记 + 启动兜底定时器（~400ms 强制归位） */
    onIntervalBlur() {
      const self = this as unknown as Record<string, unknown>;
      self._activeInputKey = undefined;
      this._clearBlurFallback();
      const session = this._getKeyboardSession();
      const timer = setTimeout(() => {
        self._blurFallbackTimer = undefined;
        if ((self._keyboardSession as number | undefined) !== session) return;
        this._resetKeyboardRuntime();
        if (this.data.sheetOffsetY !== 0) {
          this.setData({ sheetOffsetY: 0, sheetTransitionMs: 0 });
        }
      }, 400) as unknown as number;
      self._blurFallbackTimer = timer;
    },

    _applySheetOffset(tailHeight: number, keyboardHeight: number, ms: number) {
      if (!Number.isFinite(tailHeight) || tailHeight < 0) return;
      const delta = Math.max(0, keyboardHeight - tailHeight);
      this.setData({ sheetOffsetY: -delta, sheetTransitionMs: ms });
    },

    _measureAndApplySheetOffset(session: number) {
      const self = this as unknown as Record<string, unknown>;
      const latest = self._latestKeyboard as { height: number; ms: number } | undefined;
      if (!latest) return;
      wx.createSelectorQuery()
        .in(this)
        .select('.rps__sheet')
        .boundingClientRect((sheetRect) => {
          if ((self._keyboardSession as number | undefined) !== session) return;
          this.createSelectorQuery()
            .select('.rps__actions')
            .boundingClientRect((actionsRect) => {
              if ((self._keyboardSession as number | undefined) !== session) return;
              if (!sheetRect || !actionsRect) return;
              const tailHeight = sheetRect.bottom - actionsRect.bottom;
              if (!Number.isFinite(tailHeight) || tailHeight < 0) return;
              self._sheetRiseAnchor = { tailHeight };
              this._applySheetOffset(tailHeight, latest.height, latest.ms);
            })
            .exec();
        })
        .exec();
    },

    _nextKeyboardSession() {
      const self = this as unknown as Record<string, unknown>;
      const next = ((self._keyboardSession as number | undefined) || 0) + 1;
      self._keyboardSession = next;
      self._sheetRiseAnchor = undefined;
      self._latestKeyboard = undefined;
      return next;
    },

    _getKeyboardSession() {
      const self = this as unknown as Record<string, unknown>;
      return (self._keyboardSession as number | undefined) || this._nextKeyboardSession();
    },

    _resetKeyboardRuntime() {
      this._clearBlurFallback();
      this._nextKeyboardSession();
      const self = this as unknown as Record<string, unknown>;
      self._activeInputKey = undefined;
    },

    _clearBlurFallback() {
      const self = this as unknown as Record<string, unknown>;
      const timer = self._blurFallbackTimer as number | undefined;
      if (timer) {
        clearTimeout(timer);
        self._blurFallbackTimer = undefined;
      }
    },
  },
});
