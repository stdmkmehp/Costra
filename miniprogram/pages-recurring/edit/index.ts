// pages-recurring/edit/index.ts · 定时记账编辑页（创建/编辑/复制模式）
// 产品事实源：docs/design/recurring-entry-product-spec.md §5.3

import type {
  RecurringRule,
  RecurringPeriod,
  RecurringBucket,
  CreateRecurringPayload,
  UpdateRecurringPayload,
} from '../../services/recurringApi';
import {
  getRecurringRule,
  createRecurringRule,
  updateRecurringRule,
} from '../../services/recurringApi';
import { invalidateCache, generateIdempotencyKey } from '../../services/recurringLocal';
import { toYuan, parseAmountInputToCents } from '../../utils/money';
import { formatDaysForSummary, type FormatContext } from '../../services/recurringFormat';
import { getActiveFamilyId } from '../../services/family';
import { getToken } from '../../services/auth';
import { getFamilies, type FamilyItem } from '../../services/familyApi';
import { getCategories, getCategoriesSync, getCategoryById, type CategoryItem } from '../../services/categoryService';
import { resolveIconGlyph } from '../../services/iconMap';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import {
  shouldClearDaysOnPeriodChange,
  shouldKeepCategoryOnLedgerChange,
  computePreviewNextRun,
  isVersionConflict,
} from './model';
import { setRecurringReturnToast, setPendingSave, type PendingSaveResult } from '../returnFeedback';

type EditMode = 'create' | 'edit' | 'copy';

/** 自动保存 / 手动保存的统一结果 */
type SaveOutcome =
  | { status: 'success' }
  | { status: 'invalid'; error: string }
  | { status: 'network_error' }
  | { status: 'version_conflict' }
  | { status: 'error'; message: string };

/**
 * 根据 period + interval 生成展示标签
 */
function computePeriodLabel(period: RecurringPeriod, interval: number): string {
  if (period === 'yearly') return '每年';
  if (['weekly', 'biweekly'].includes(period)) {
    if (interval === 1) return '每周';
    return `每${interval}周`;
  }
  if (['monthly', 'bimonthly', 'trimonthly'].includes(period)) {
    if (interval === 1) return '每月';
    return `每${interval}月`;
  }
  return '每周';
}

/**
 * 从 period 值解析 interval
 */
function parsePeriodInterval(period: RecurringPeriod): number {
  switch (period) {
    case 'weekly': return 1;
    case 'biweekly': return 2;
    case 'monthly': return 1;
    case 'bimonthly': return 2;
    case 'trimonthly': return 3;
    case 'yearly': return 1;
    default: return 1;
  }
}

const BUCKET_LABELS: Record<string, string> = {
  dawn: '凌晨', morning: '上午', afternoon: '下午', night: '夜晚',
};

const TYPE_LABELS: Record<string, string> = {
  expense: '支出', income: '收入', transfer: '转账',
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(dateText: string, options: { days?: number; years?: number }): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (options.days) date.setDate(date.getDate() + options.days);
  if (options.years) date.setFullYear(date.getFullYear() + options.years);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 根据当前小时数返回默认时段
 * 0~5 → dawn, 6~11 → morning, 12~17 → afternoon, 18~23 → night
 */
function getDefaultBucket(): RecurringBucket {
  const hour = new Date().getHours();
  if (hour < 6) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'night';
}

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

Page({
  data: {
    mode: 'create' as EditMode,
    ruleId: '',
    ruleVersion: 1,
    dirty: false,
    saving: false,

    // 卡片1：记什么
    entryType: 'expense' as 'income' | 'expense' | 'transfer',
    entryTypeLabel: '支出',
    amountCents: 0,
    amountDisplay: '',
    categoryId: '',
    categoryName: '',
    categoryIcon: '',
    ledgerId: '',
    ledgerName: '',
    ledgerFamilyId: '',
    timezone: 'Asia/Shanghai',
    sharedType: 'personal' as 'personal' | 'shared',
    sharedDisabled: false,
    note: '',
    showCategoryPicker: false,

    // 卡片2：什么时候记
    period: 'weekly' as RecurringPeriod,
    periodInterval: 1,
    periodLabel: '每周',
    showPeriodSheet: false,
    bucket: getDefaultBucket() as RecurringBucket,
    startDate: todayStr(),
    startDateMin: shiftDate(todayStr(), { days: -1 }),
    startDateMax: shiftDate(todayStr(), { years: 3 }),
    hasEndDate: false,
    endDate: '',
    endDateMin: todayStr(),
    endDateMax: shiftDate(todayStr(), { years: 10 }),

    // 控件数据
    daysOfWeek: [] as number[],
    daysOfMonth: [] as number[],
    yearMonthDays: [] as number[],

    // 卡片3：预览
    previewDesc: '',
    previewDate: '—',
    previewBucket: '',

    // 校验
    isValid: false,
    validationError: '',
    validationSection: 0,
    saveFlashError: false,

    // 自定义导航栏
    navBarTotalHeight: 0,
    statusBarHeight: 0,
    navBarHeight: 0,
    navActionRight: 0,

    // 编辑/复制模式拉取规则 + 分类时遮罩整个表单，避免短促显示占位文本
    loading: true,
  },

  _families: [] as FamilyItem[],
  _originalRule: null as RecurringRule | null,
  _executeHour: undefined as number | undefined,
  _executeMinute: undefined as number | undefined,
  _saveFailedOnBack: false as boolean,
  // 主动返回路径（左上角返回 / 保存按钮）在navigateBack 前置 true，
  // 用于让 onUnload 区分「主动返回（已写反馈）」与「右滑返回（未写反馈）」。
  _backHandled: false as boolean,

  async onLoad(options: Record<string, string | undefined>) {
    // 安全区
    const metrics = getSafeAreaMetrics();
    this.setData({
      navBarTotalHeight: metrics.navBarTotalHeight,
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
      navActionRight: metrics.menuButtonLeft > 0
        ? Math.max(16, metrics.windowWidth - metrics.menuButtonLeft + 8)
        : 16,
    });

    // bootstrapPromise gate
    const app = getApp<AppWithBootstrap>();
    await app.bootstrapPromise;
    this.setData({ timezone: getToken()?.raw.user.timezone || 'Asia/Shanghai' });

    const mode = (options.mode || 'create') as EditMode;
    const id = options.id || '';
    this.setData({ mode, ruleId: mode === 'copy' ? '' : id });

    // 加载账本
    try {
      const res = await getFamilies();
      this._families = res.families;
      if (mode === 'create' && res.families.length > 0) {
        const activeFamilyId = await getActiveFamilyId();
        const activeFamily = activeFamilyId
          ? res.families.find((f) => f.id === activeFamilyId)
          : res.families[0];
        const target = activeFamily || res.families[0];
        this.setData({
          ledgerId: target.ledger_id,
          ledgerName: target.ledger_name,
          ledgerFamilyId: target.id,
        });
      }
    } catch { /* 静默 */ }

    // 编辑/复制模式：加载已有规则（先取账本 → 拉规则 → 拉规则所属账本的分类 → 回填）
    // 注意：必须先等分类数据就绪再 _fillForm，否则 getCategoriesSync 只返回 fallback
    // （UUID 与真实数据不一致），会导致 categoryName 为空，UI 错误显示"请选择"。
    if ((mode === 'edit' || mode === 'copy') && id) {
      try {
        const rule = await getRecurringRule(id);
        this._originalRule = rule;
        const ruleFamily = this._families.find((f) => f.ledger_id === rule.ledger_id);
        const ruleFamilyId = ruleFamily?.id || '';
        const categories = await this._loadCategoriesForFamily(ruleFamilyId);
        this._fillForm(rule, mode, categories);
        if (mode === 'copy') {
          // 复制模式清空内部 ruleId
          this.setData({ ruleId: '' });
          wx.showToast({ title: '已复制，编辑后保存', icon: 'none', duration: 2000 });
        }
      } catch {
        wx.showToast({ title: '加载失败', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1500);
      }
    }

    // 初始表单尚无用户修改，不开启系统离开告警。
    this._updateSharedState();
    this._updatePreview();
    this._validate();
    this.setData({ loading: false });
  },

  /**
   * 加载指定家庭的全量分类（异步 + 同步降级）。
   * 异步路径：缓存 → API → fallback；同步降级路径仅在异步异常时使用，避免 UI 一直转圈。
   */
  async _loadCategoriesForFamily(familyId: string): Promise<CategoryItem[]> {
    if (!familyId) return [];
    try {
      return await getCategories(familyId);
    } catch {
      return getCategoriesSync(familyId);
    }
  },

  _fillForm(r: RecurringRule, mode: EditMode, categories: CategoryItem[]) {
    const family = this._families.find((f) => f.ledger_id === r.ledger_id);
    const familyId = family?.id || '';
    // 优先用调用方传入的 categories（已 await getCategories 拉到的真实数据）；
    // 兼容传入空数组时再回退一次（极端降级，例如 ruleFamilyId 解析失败时）。
    const resolvedCategories = categories.length > 0
      ? categories
      : (familyId ? getCategoriesSync(familyId) : []);
    const cat = r.category_id ? resolvedCategories.find((c) => c.id === r.category_id) : null;
    const catParent = cat?.parentId ? resolvedCategories.find((c) => c.id === cat.parentId) : null;
    const catDisplayName = cat ? (catParent ? `${catParent.name}·${cat.name}` : cat.name) : '';

    // 编辑模式保留服务端 execute_hour/minute
    if (mode === 'edit') {
      this._executeHour = r.execute_hour;
      this._executeMinute = r.execute_minute;
    }

    this.setData({
      ruleVersion: mode === 'edit' ? r.version : 1,
      entryType: r.type,
      entryTypeLabel: TYPE_LABELS[r.type] || '',
 amountCents: r.amount,
      amountDisplay: toYuan(r.amount),
      categoryId: r.category_id || '',
      categoryName: catDisplayName,
      categoryIcon: resolveIconGlyph(cat?.icon),
      ledgerId: r.ledger_id,
      ledgerName: family?.ledger_name || '',
      ledgerFamilyId: family?.id || '',
      timezone: r.timezone || this.data.timezone,
      sharedType: (r.shared_type as 'personal' | 'shared') || 'shared',
      note: r.note || '',
      period: r.period,
      periodInterval: r.period_interval || parsePeriodInterval(r.period),
      periodLabel: computePeriodLabel(r.period, r.period_interval || parsePeriodInterval(r.period)),
      bucket: r.execute_bucket,
      startDate: r.start_date,
      hasEndDate: !!r.end_date,
      endDate: r.end_date || '',
      endDateMin: r.start_date,
      endDateMax: shiftDate(r.start_date, { years: 10 }),
      daysOfWeek: r.days_of_week || [],
      daysOfMonth: r.days_of_month || [],
      yearMonthDays: r.year_month_days || [],
    });
  },

  // ─── 未保存离开保护 ──────────────────────────────────────────────────────

  _markDirty() {
    if (!this.data.dirty) this.setData({ dirty: true });
    this._saveFailedOnBack = false;
    this._enableUnloadAlert();
  },

  _enableUnloadAlert() {
    try {
      wx.enableAlertBeforeUnload({
        message: '你有未保存的修改，确定要离开吗？',
      });
    } catch { /* 兼容：部分基础库不支持 */ }
  },

  _disableUnloadAlert() {
    try {
      wx.disableAlertBeforeUnload();
    } catch { /* 兼容 */ }
  },

  async onTapBack() {
    // 进入主动返回路径：先标记，避免 onUnload 误补写「未保存」提示。
    // 若最终决定「不退出」（网络/其他错误），会在对应分支重置回 false。
    this._backHandled = true;
    // 无修改 → 直接退出
    if (!this.data.dirty) {
      this._disableUnloadAlert();
      wx.navigateBack();
      return;
    }
    // 上次返回时保存失败 → 直接退出，不重复尝试
    if (this._saveFailedOnBack) {
      this._disableUnloadAlert();
      wx.navigateBack();
      return;
    }
    // 有修改 → 自动保存后退出
    const outcome = await this._doSave();
    switch (outcome.status) {
      case 'success':
        wx.vibrateShort({ type: 'medium' });
        this._disableUnloadAlert();
        setRecurringReturnToast('已保存');
        wx.navigateBack();
        break;
      case 'invalid':
        this._disableUnloadAlert();
        setRecurringReturnToast('修改不符合规范，已还原');
        wx.navigateBack();
        break;
      case 'network_error':
        // 网络失败：不退出，让用户决定是否重试或再次返回
        this._backHandled = false;
        this._saveFailedOnBack = true;
        wx.showToast({ title: '网络失败', icon: 'none' });
        break;
      case 'version_conflict':
        this._disableUnloadAlert();
        setRecurringReturnToast('数据已更新，已还原');
        wx.navigateBack();
        break;
      case 'error':
        this._backHandled = false;
        this._saveFailedOnBack = true;
        wx.showToast({ title: outcome.message, icon: 'none' });
        break;
    }
  },

  // ─── 卡片1 交互 ──────────────────────────────────────────────────────────

  onAmountInput(e: WechatMiniprogram.Input) {
    // 仅同步显示值，不做格式化，让用户自由输入
    this.setData({ amountDisplay: e.detail.value });
  },

  onAmountBlur(e: WechatMiniprogram.Input) {
    const raw = e.detail.value || '';
    const cents = parseAmountInputToCents(raw);
    this.setData({
      amountCents: cents,
      amountDisplay: cents > 0 ? toYuan(cents) : '',
  });
    if (cents > 0) {
      this._markDirty();
    }
    this._validate();
    this._updatePreview();
  },

  onShowCategoryPicker() {
    this.setData({ showCategoryPicker: true });
  },

  onCategorySelect(e: WechatMiniprogram.CustomEvent) {
    const { id, name, icon, type, parentName } = e.detail;
    const fullName = parentName ? `${parentName}·${name}` : name;
    const updates: Record<string, any> = {
      categoryId: id,
      categoryName: fullName,
      categoryIcon: resolveIconGlyph(icon),
      showCategoryPicker: false,
    };
    if (type && type !== this.data.entryType) {
      updates.entryType = type;
      updates.entryTypeLabel = TYPE_LABELS[type] || '';
  }
    this.setData(updates);
    this._updateSharedState();
    this._markDirty();
    this._validate();
 this._updatePreview();
  },

  onCategoryClose() {
    this.setData({ showCategoryPicker: false });
  },

  onTapLedger() {
    const items = this._families.map((f) => f.ledger_name);
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const f = this._families[res.tapIndex];
        if (f && f.ledger_id !== this.data.ledgerId) {
          // 切换账本后，仅当当前选中的分类在目标账本中不适用时才清空。
          // 判定依据不能依赖 getCategoriesSync(f.id)：内存缓存只保留单个家庭的数据，
          // 跨家庭时它返回的是系统预设 fallback，会把"家庭自定义分类"误判为不存在而错误重置。
          // 正确做法：按分类自身的归属（familyId）判定——
          //   系统预设分类（familyId===null）所有账本通用 → 保留；
          //   家庭自定义分类仅在其所属家庭有效 → 仅当属于目标家庭才保留。
          let categoryUpdates: Record<string, any> = {};
          const currentCategoryId = this.data.categoryId;
          if (currentCategoryId && !shouldKeepCategoryOnLedgerChange(getCategoryById(currentCategoryId), f.id)) {
            categoryUpdates = {
              categoryId: '',
              categoryName: '',
              categoryIcon: resolveIconGlyph(null),
            };
          }
          this.setData({
            ledgerId: f.ledger_id,
            ledgerName: f.ledger_name,
            ledgerFamilyId: f.id,
            ...categoryUpdates,
          });
          this._updateSharedState();
    this._markDirty();
          this._validate();
        this._updatePreview();
        }
      },
    });
  },

  onToggleShared(e: WechatMiniprogram.TouchEvent) {
    if (this.data.sharedDisabled) return;
    const val = e.currentTarget.dataset.val as 'personal' | 'shared';
    if (val === this.data.sharedType) return;
    this.setData({ sharedType: val });
    this._markDirty();
  },

  onNoteInput(e: WechatMiniprogram.Input) {
    this.setData({ note: e.detail.value });
    this._markDirty();
  },

  // ─── 卡片2 交互（组件事件） ──────────────────────────────────────────────

  onPeriodChange(e: WechatMiniprogram.CustomEvent) {
    const value = e.detail.value as RecurringPeriod;
    const interval = (e.detail.periodInterval as number) || parsePeriodInterval(value);
    const oldPeriod = this.data.period;
    const label = computePeriodLabel(value, interval);
    const clearDays = shouldClearDaysOnPeriodChange(oldPeriod, value);

    const updates: Record<string, any> = {
      period: value,
      periodInterval: interval,
      periodLabel: label,
      showPeriodSheet: false,
    };

    if (clearDays) {
      updates.daysOfWeek = [];
      updates.daysOfMonth = [];
      updates.yearMonthDays = [];
      wx.showToast({ title: '日期选择已重置', icon: 'none', duration: 1000 });
    }

    this.setData(updates);
    this._markDirty();
    this._validate();
    this._updatePreview();
  },

  onPeriodClose() {
    this.setData({ showPeriodSheet: false });
  },

  onShowPeriodSheet() {
    this.setData({ showPeriodSheet: true });
  },

  // DOW
  onDowChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ daysOfWeek: e.detail.value });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },
  onDowClear() {
    this.setData({ daysOfWeek: [] });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },
  onDowLimit() {
    wx.vibrateShort({ type: 'light' });
  },

  // DOM
  onDomChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ daysOfMonth: e.detail.value });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },
  onDomClear() {
    this.setData({ daysOfMonth: [] });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },
  onDomLimit() {
    // vibrate + toast already in component
  },

  // Yearly
  onYearlyChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ yearMonthDays: e.detail.value });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },
  onYearlyClear() {
    this.setData({ yearMonthDays: [] });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },
  onYearlyLimit() {
    // vibrate + toast already in component
  },

  // Bucket
  onBucketChange(e: WechatMiniprogram.CustomEvent) {
    const bucket = e.detail.value as RecurringBucket;
    if (bucket === this.data.bucket) return;
    this.setData({ bucket });
    this._executeHour = undefined;
    this._executeMinute = undefined;
    this._markDirty();
    this._updatePreview();
  },

  // 起始日/结束日
  onStartDateChange(e: WechatMiniprogram.PickerChange) {
    const startDate = e.detail.value as string;
    const endDateMin = startDate;
    const endDateMax = shiftDate(startDate, { years: 10 });
    this.setData({
      startDate,
      endDateMin,
      endDateMax,
      endDate: this.data.endDate && this.data.endDate >= endDateMin ? this.data.endDate : '',
    });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },

  onToggleEndDate() {
    const has = !this.data.hasEndDate;
    if (has && !this.data.endDate) {
      // 默认结束日 = 起始日同一天（规则只跑一天）
      const defaultEnd = this.data.startDate;
      this.setData({ hasEndDate: true, endDate: defaultEnd });
    } else {
      this.setData({ hasEndDate: has });
      if (!has) this.setData({ endDate: '' });
    }
    this._markDirty();
    this._validate();
    this._updatePreview();
  },

  onEndDateChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ endDate: e.detail.value as string });
    this._markDirty();
    this._validate();
    this._updatePreview();
  },

  // ─── 归属联动 ──────────────────────────────────────────────────────────

  /**
   * 当类型/账本变更时，重新计算归属是否可切换。
   * 规则：只有家庭账本(kind=shared) + 支出类型才允许选"公共"；
   * 否则强制设为"个人"并置灰。
   */
  _updateSharedState() {
    const { entryType, ledgerFamilyId } = this.data;
    const family = this._families.find((f) => f.id === ledgerFamilyId);
    const isSharedLedger = family?.kind === 'shared';
    const isExpense = entryType === 'expense';
    const disabled = !isSharedLedger || !isExpense;

    if (disabled) {
    this.setData({ sharedType: 'personal', sharedDisabled: true });
    } else {
      this.setData({ sharedDisabled: false });
    }
  },

  // ─── 预览 ──────────────────────────────────────────────────────────────

  _updatePreview() {
    const { period, periodInterval, bucket, ledgerName } = this.data;
    const periodLabel = computePeriodLabel(period, periodInterval);
    const bucketLabel = BUCKET_LABELS[bucket] || '';

    // 日子描述
    const ctx: FormatContext = {
      period,
      mode: 'full',
      days_of_week: this.data.daysOfWeek.length > 0 ? this.data.daysOfWeek : null,
      days_of_month: this.data.daysOfMonth.length > 0 ? this.data.daysOfMonth : null,
      year_month_days: this.data.yearMonthDays.length > 0 ? this.data.yearMonthDays : null,
    };
    const daysDesc = formatDaysForSummary(ctx);
    const parts = [`${periodLabel} ${daysDesc}`.trim(), bucketLabel, ledgerName].filter(Boolean);
    const previewDesc = parts.join(' · ');

    // 下次执行时间
    let previewDate = '—';
    let previewBucket = '';
    if (this._isFormComplete()) {
      const result = computePreviewNextRun({
        period,
        bucket,
        startDate: this.data.startDate,
        daysOfWeek: this.data.daysOfWeek,
        daysOfMonth: this.data.daysOfMonth,
        yearMonthDays: this.data.yearMonthDays,
        timezone: this.data.timezone,
        executeHour: this._executeHour,
        executeMinute: this._executeMinute,
      }, new Date());
      if (result) {
        previewDate = result.dateStr;
        previewBucket = bucketLabel;
      }
    }

    this.setData({ previewDesc, previewDate, previewBucket });
  },

  _isFormComplete(): boolean {
    if (this.data.amountCents <= 0) return false;
    const { period, daysOfWeek, daysOfMonth, yearMonthDays } = this.data;
    if (['weekly', 'biweekly'].includes(period) && daysOfWeek.length === 0) return false;
    if (['monthly', 'bimonthly', 'trimonthly'].includes(period) && daysOfMonth.length === 0) return false;
    if (period === 'yearly' && yearMonthDays.length === 0) return false;
    return true;
  },

  // ─── 校验 ──────────────────────────────────────────────────────────────

  _validate() {
    let error = '';
    let section = 0;
    if (this.data.amountCents <= 0) { error = '请输入金额'; section = 1; }
    else if (!this.data.categoryId) { error = '请选择分类'; section = 1; }
    else if (!this.data.ledgerId) { error = '请选择账本'; section = 1; }
    else {
      const { period, daysOfWeek, daysOfMonth, yearMonthDays } = this.data;
      if (['weekly', 'biweekly'].includes(period) && daysOfWeek.length === 0) { error = '请至少选 1 天'; section = 2; }
      else if (['monthly', 'bimonthly', 'trimonthly'].includes(period) && daysOfMonth.length === 0) { error = '请至少选 1 天'; section = 2; }
      else if (period === 'yearly' && yearMonthDays.length === 0) { error = '请至少选 1 天'; section = 2; }
      else if (this.data.hasEndDate && !this.data.endDate) { error = '请选择结束日'; section = 2; }
      else if (this.data.hasEndDate && this.data.endDate < this.data.startDate) { error = '结束日不能早于起始日'; section = 2; }
    }
    this.setData({ isValid: !error, validationError: error, validationSection: section });
  },

  // ─── 保存 ──────────────────────────────────────────────────────────────

  /**
   * 从当前表单状态构建保存 payload（纯函数，不发起请求，不依赖网络）。
   * 供 _doSave（await 路径）与 onUnload 右滑 fire-and-forget 路径共用。
   */
  _buildSavePayload(): CreateRecurringPayload {
    return {
      ledger_id: this.data.ledgerId,
      type: this.data.entryType,
      amount: this.data.amountCents,
      currency: 'CNY',
      category_id: this.data.categoryId || null,
      note: this.data.note || null,
      shared_type: this.data.entryType === 'expense' ? this.data.sharedType : undefined,
      period: this.data.period,
      period_interval: this.data.periodInterval,
      days_of_week: ['weekly', 'biweekly'].includes(this.data.period)
        ? (this.data.daysOfWeek.length > 0 ? this.data.daysOfWeek : null) : null,
      days_of_month: ['monthly', 'bimonthly', 'trimonthly'].includes(this.data.period)
        ? (this.data.daysOfMonth.length > 0 ? this.data.daysOfMonth : null) : null,
      year_month_days: this.data.period === 'yearly'
        ? (this.data.yearMonthDays.length > 0 ? this.data.yearMonthDays : null) : null,
      execute_bucket: this.data.bucket,
      timezone: this.data.timezone,
      start_date: this.data.startDate,
      end_date: this.data.hasEndDate && this.data.endDate ? this.data.endDate : null,
    };
  },

  /**
   * 右滑返回时在 onUnload 发起的 fire-and-forget 保存。
   * 页面即将销毁，不能 await，也不能在回调里操作 this.setData（页面已不在）。
   * 保存由 AppService 承载，页面销毁后仍会跑完；结果通过 setPendingSave 交给列表页 onShow 消费。
   * 成功后 invalidateCache 让列表页 onShow 拉到最新数据。
   */
  _fireAndForgetViewSave(): Promise<PendingSaveResult> {
    const idempotencyKey = generateIdempotencyKey();
    const payload = this._buildSavePayload();
    const mode = this.data.mode;
    const ruleId = this.data.ruleId;
    const ruleVersion = this.data.ruleVersion;

    const task = mode === 'edit'
      ? updateRecurringRule(ruleId, { ...payload, version: ruleVersion }, { idempotencyKey })
      : createRecurringRule(payload, { idempotencyKey });

    return task
      .then(async (): Promise<PendingSaveResult> => {
        await invalidateCache();
        return { status: 'success' };
      })
      .catch((e: any): PendingSaveResult => {
        if (isVersionConflict(e)) return { status: 'version_conflict' };
        if (e?.code === 'CLIENT_NETWORK_ERROR') return { status: 'network_error' };
        const msg = e?.message || e?.data?.message || '保存失败';
        console.error('[recurring-edit] fire-and-forget save error:', JSON.stringify(e));
        return { status: 'error', message: msg };
      });
  },

  /**
   * 执行保存（不处理 UI 反馈），返回保存结果。
   * 调用方根据 outcome 决定如何展示 toast / 是否退出。
   */
  async _doSave(): Promise<SaveOutcome> {
    this._validate();
    if (!this.data.isValid) {
      return { status: 'invalid', error: this.data.validationError };
    }
    if (this.data.saving) return { status: 'error', message: '正在保存中' };
    this.setData({ saving: true });

    const idempotencyKey = generateIdempotencyKey();
    const payload = this._buildSavePayload();

    try {
      if (this.data.mode === 'edit') {
        const updatePayload: UpdateRecurringPayload = { ...payload, version: this.data.ruleVersion };
        await updateRecurringRule(this.data.ruleId, updatePayload, { idempotencyKey });
      } else {
        await createRecurringRule(payload, { idempotencyKey });
      }
      await invalidateCache();
      this.setData({ dirty: false });
      this._disableUnloadAlert();
      return { status: 'success' };
    } catch (e: any) {
      if (isVersionConflict(e)) {
        // 乐观锁冲突 → 拉最新覆盖
        try {
          const fresh = await getRecurringRule(this.data.ruleId);
          // 与 onLoad 路径对齐：重新拉一次当前账本的分类，确保分类名解析命中真实数据
          const family = this._families.find((f) => f.ledger_id === fresh.ledger_id);
          const categories = await this._loadCategoriesForFamily(family?.id || this.data.ledgerFamilyId);
          this._fillForm(fresh, 'edit', categories);
          this.setData({ ruleId: fresh.id });
        } catch { /* 静默 */ }
        return { status: 'version_conflict' };
      } else if (e?.code === 'CLIENT_NETWORK_ERROR') {
        return { status: 'network_error' };
      } else {
        const msg = e?.message || e?.data?.message || '保存失败';
        console.error('[recurring-edit] save error:', JSON.stringify(e));
        return { status: 'error', message: msg };
      }
    } finally {
      this.setData({ saving: false });
    }
  },

  async onSave() {
    const outcome = await this._doSave();
    switch (outcome.status) {
      case 'success':
        this._backHandled = true;
        wx.vibrateShort({ type: 'medium' });
        this._disableUnloadAlert();
        setRecurringReturnToast('已保存');
        wx.navigateBack();
        break;
      case 'invalid':
        wx.showToast({ title: outcome.error, icon: 'none' });
        // 保存无效：卡片陶土红边框 flash
        this.setData({ saveFlashError: true });
        setTimeout(() => this.setData({ saveFlashError: false }), 600);
        break;
      case 'network_error':
        wx.showToast({ title: '网络失败', icon: 'none' });
        break;
      case 'version_conflict':
        wx.showToast({ title: '数据已更新，请重新编辑', icon: 'none' });
        break;
      case 'error':
        wx.showToast({ title: outcome.message, icon: 'none' });
        break;
    }
  },

  onUnload() {
    this._disableUnloadAlert();
    // 右滑返回无法被 JS 拦截，页面直接销毁。
    // onUnload 是销毁前最后一个同步回调，此处同步发起 fire-and-forget 保存：
    //   - 表单有效 → 发起保存（AppService 承载，页面销毁后仍跑完），结果通过 setPendingSave 交列表页 onShow 弹 toast + 刷新。
    //   - 表单无效 → 写一次性 toast「修改未保存（不符合规范）」，不发起保存。
    // 主动返回路径（onTapBack / onSave）已置 _backHandled=true 并写好各自反馈，此处跳过避免覆盖。
    if (this._backHandled || !this.data.dirty) return;
    this._validate();
    if (!this.data.isValid) {
      setRecurringReturnToast('修改未保存（不符合规范）');
      return;
    }
    setPendingSave(this._fireAndForgetViewSave());
  },
});
