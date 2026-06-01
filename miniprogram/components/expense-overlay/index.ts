// components/expense-overlay/index.ts · 全屏记账覆盖层（分类网格+计算器+算式+账本切换+保存）
// 卡号: COSTRA-204/206 · 整体重写占位组件 + COSTRA-206 UI 修复
// 设计源: design/ui/design_spec.md §6.3 + design/ui/interaction_flow.md §2/§3
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）

import { newClientRefId } from '../../utils/id';
import { putEntry, type Entry } from '../../services/db';
import { enqueue } from '../../services/outbox';
import { getActiveLedgerId } from '../../services/family';
import { eventBus, EventNames } from '../../services/eventBus';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES,
  EXPENSE_DEDUPED_SUBS, INCOME_DEDUPED_SUBS,
  DEDUP_MAPPING,
  type CategoryTier1, type CategoryTier2,
} from './categories';
import {
  INITIAL_CALC_STATE,
  inputDigit, inputDoubleZero, inputDot,
  inputOperator, inputBackspace, pressEquals,
  type CalcState,
} from './calc';

// ─── 账本选项 ─────────────────────────────────────────────────────────────────

interface LedgerOption {
  id: string;
  name: string;
  isMultiMember: boolean;
}

// ─── Component ─────────────────────────────────────────────────────────────────

Component({
  options: {
    pureDataPattern: /^_/,
  },

  data: {
    // ─── 显隐 ───
    visible: false,

    // ─── swiper 当前面板 0=支出 1=收入 ───
    currentTab: 0,
    /** 顶部指示器 */
    tabIndicator: 'expense' as 'expense' | 'income',

    // ─── 分类网格 ───
    tier1Categories: EXPENSE_CATEGORIES as readonly CategoryTier1[],
    dedupedSubCategories: EXPENSE_DEDUPED_SUBS as readonly CategoryTier2[],
    /** 展开的一级分类 id（null = 无展开） */
    expandedTier1Id: null as string | null,
    /** 展开的一级分类的子分类 */
    expandedChildren: [] as readonly CategoryTier2[],
    /** 选中的一级分类 id */
    selectedTier1Id: '' as string,
    /** 选中的二级分类 id */
    selectedTier2Id: '' as string,
    /** 未选中一级分类的 id 列表（用于弱化效果） */
    dimmedTier1Ids: [] as string[],
    /** scroll-into-view 目标 */
    scrollIntoView: '' as string,

    // ─── 计算器 ───
    keypadVisible: false,
    calc: { ...INITIAL_CALC_STATE } as CalcState,

    // ─── 账本归属 + 费用性质 ───
    ledgerId: '' as string,
    ledgerName: '我的账本' as string,
    isMultiMemberLedger: false as boolean,
    ledgerOptions: [] as LedgerOption[],
    /** 费用性质：personal / shared */
    sharedType: 'shared' as 'personal' | 'shared',
    /** 是否显示费用性质开关（多人+支出时显示） */
    showSharedToggle: false as boolean,
    /** 备注文字 */
    note: '' as string,
    /** 是否正在输入备注（显示系统键盘） */
    noteFocused: false as boolean,

    // ─── 类型 ───
    entryType: 'expense' as 'expense' | 'income',

    // ─── 动态布局高度（COSTRA-206: swiper 不响应 flex，必须显式设置 height） ───
    /** swiper 高度 = windowHeight - headerBottom（px 单位） */
    swiperHeight: 0 as number,

    // ─── 保存中 ───
    saving: false,
  },

  lifetimes: {
    attached() {
      // COSTRA-206: 动态计算 swiper 高度（swiper 不响应 CSS flex:1）
      const sysInfo = wx.getSystemInfoSync();
      const menuBtn = wx.getMenuButtonBoundingClientRect();
      // header 底边 ≈ 胶囊按钮 bottom + 下方间距
      const headerBottom = menuBtn.bottom + 8;
      const swiperHeight = sysInfo.windowHeight - headerBottom;
      this.setData({ swiperHeight });

      type ShowHandler = () => void;
      const handler: ShowHandler = () => { this._show(); };
      (this as unknown as Record<string, unknown>)._showHandler = handler;
      eventBus.on(EventNames.SHOW_EXPENSE_OVERLAY, handler);
    },

    detached() {
      const handler = (this as unknown as Record<string, unknown>)._showHandler as (() => void) | undefined;
      if (handler) {
        eventBus.off(EventNames.SHOW_EXPENSE_OVERLAY, handler);
      }
    },
  },

  methods: {
    // ─── 显隐控制 ─────────────────────────────────────────────────────────────

    async _show() {
      const ledgerId = await getActiveLedgerId() || '';
      const ledgerOptions: LedgerOption[] = [
        { id: ledgerId || 'default', name: '我的账本', isMultiMember: false },
      ];

      this.setData({
        visible: true,
        ledgerId: ledgerId || 'default',
        ledgerName: '我的账本',
        isMultiMemberLedger: false,
        ledgerOptions,
        showSharedToggle: false,
        currentTab: 0,
        tabIndicator: 'expense',
        entryType: 'expense',
        tier1Categories: EXPENSE_CATEGORIES,
        dedupedSubCategories: EXPENSE_DEDUPED_SUBS,
        expandedTier1Id: null,
        expandedChildren: [],
        selectedTier1Id: '',
        selectedTier2Id: '',
        dimmedTier1Ids: [],
        scrollIntoView: '',
        keypadVisible: false,
        calc: { ...INITIAL_CALC_STATE },
        sharedType: 'shared',
        note: '',
        noteFocused: false,
        saving: false,
      });
    },

    onClose() {
      this.setData({ visible: false, keypadVisible: false });
      eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);
    },

    /** 阻止触摸穿透 */
    noop() {
      // intentionally empty
    },

    // ─── 收支切换（swiper）──────────────────────────────────────────────────

    onSwiperChange(e: WechatMiniprogram.SwiperChange) {
      const current = e.detail.current as number;
      this._switchTab(current);
    },

    /** 点击文字指示器切换收支面板（COSTRA-206） */
    onTapTabIndicator(e: WechatMiniprogram.TouchEvent) {
      const tab = e.currentTarget.dataset.tab as number;
      if (tab === this.data.currentTab) return; // 已是当前面板，忽略
      this._switchTab(tab);
    },

    /**
     * 收支面板切换核心逻辑（swiper 滑动 + 文字指示器点击共用）
     */
    _switchTab(current: number) {
      const tabIndicator = current === 0 ? 'expense' : 'income';
      const entryType = current === 0 ? 'expense' : 'income';

      const tier1Categories = current === 0 ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
      const dedupedSubCategories = current === 0 ? EXPENSE_DEDUPED_SUBS : INCOME_DEDUPED_SUBS;

      // 收入面板时隐藏费用性质开关
      const showSharedToggle = current === 1
        ? false
        : this.data.isMultiMemberLedger;

      this.setData({
        currentTab: current,
        tabIndicator,
        entryType,
        tier1Categories,
        dedupedSubCategories,
        expandedTier1Id: null,
        expandedChildren: [],
        selectedTier1Id: '',
        selectedTier2Id: '',
        dimmedTier1Ids: [],
        scrollIntoView: '',
        showSharedToggle,
      });
    },

    // ─── 场景 A：点击一级分类 ──────────────────────────────────────────────────

    onTapTier1(e: WechatMiniprogram.TouchEvent) {
      const tier1Id = e.currentTarget.dataset.id as string;
      if (!tier1Id) return;

      const tier1 = this.data.tier1Categories.find(c => c.id === tier1Id);
      if (!tier1) return;

      // 如果点击已展开的一级分类 → 收起
      if (this.data.expandedTier1Id === tier1Id) {
        this.setData({
          expandedTier1Id: null,
          expandedChildren: [],
          dimmedTier1Ids: [],
          selectedTier1Id: '',
          selectedTier2Id: '',
        });
        return;
      }

      // 未选中一级分类 → 弱化
      const dimmedTier1Ids = this.data.tier1Categories
        .filter(c => c.id !== tier1Id)
        .map(c => c.id);

      // 默认选中第一个同名二级分类
      const firstChild = tier1.children[0];

      this.setData({
        expandedTier1Id: tier1Id,
        expandedChildren: tier1.children,
        selectedTier1Id: tier1Id,
        selectedTier2Id: firstChild.id,
        dimmedTier1Ids,
        scrollIntoView: `tier1-${tier1Id}`,
      });

      if (!this.data.keypadVisible) {
        this.setData({ keypadVisible: true });
      }
    },

    // ─── 场景 B：直选二级分类 ──────────────────────────────────────────────────

    onTapSubCategory(e: WechatMiniprogram.TouchEvent) {
      const subId = e.currentTarget.dataset.id as string;
      const subName = e.currentTarget.dataset.name as string;
      if (!subId) return;

      // 查找归属的一级分类：先查去重映射表，再遍历查找
      let parentTier1Id = DEDUP_MAPPING[subName] || '';
      if (!parentTier1Id) {
        for (const tier1 of this.data.tier1Categories) {
          if (tier1.children.some(c => c.id === subId)) {
            parentTier1Id = tier1.id;
            break;
          }
        }
      }

      // 不触发一级展开（场景 B 规则）
      this.setData({
        selectedTier1Id: parentTier1Id,
        selectedTier2Id: subId,
      });

      // 防遮挡：滚动到该二级分类
      this.setData({ scrollIntoView: `sub-${subId}` });

      if (!this.data.keypadVisible) {
        this.setData({ keypadVisible: true });
      }
    },

    // ─── 展开面板中的二级分类点击 ─────────────────────────────────────────────

    onTapExpandedChild(e: WechatMiniprogram.TouchEvent) {
      const subId = e.currentTarget.dataset.id as string;
      if (!subId) return;
      this.setData({ selectedTier2Id: subId });
    },

    // ─── 计算器键盘 ───────────────────────────────────────────────────────────

    onKeypadTap(e: WechatMiniprogram.TouchEvent) {
      const key = e.currentTarget.dataset.key as string;
      if (!key) return;

      const calc = this.data.calc;
      let newCalc: CalcState;

      switch (key) {
        case '0': case '1': case '2': case '3': case '4':
        case '5': case '6': case '7': case '8': case '9':
          newCalc = inputDigit(calc, key);
          break;
        case '00':
          newCalc = inputDoubleZero(calc);
          break;
        case '.':
          newCalc = inputDot(calc);
          break;
        case '+':
          newCalc = inputOperator(calc, '+');
          break;
        case '-':
          newCalc = inputOperator(calc, '-');
          break;
        case 'backspace':
          newCalc = inputBackspace(calc);
          break;
        case 'action':
          this._onAction();
          return;
        default:
          return;
      }

      this.setData({ calc: newCalc });
    },

    /** 右下角按钮动作 */
    _onAction() {
      const calc = this.data.calc;

      if (calc.actionState === 'equals') {
        // 按 = 计算结果
        const newCalc = pressEquals(calc);
        this.setData({ calc: newCalc });
      } else {
        // 按"完成" → 保存
        this._saveEntry();
      }
    },

    // ─── 账本归属 ───────────────────────────────────────────────────────────

    onTapLedgerSwitch() {
      const items = this.data.ledgerOptions.map(o => o.name);
      if (items.length <= 1) return;

      wx.showActionSheet({
        itemList: items,
        success: (res) => {
          const selected = this.data.ledgerOptions[res.tapIndex];
          if (!selected) return;

          const showSharedToggle = selected.isMultiMember && this.data.entryType === 'expense';

          this.setData({
            ledgerId: selected.id,
            ledgerName: selected.name,
            isMultiMemberLedger: selected.isMultiMember,
            showSharedToggle,
            sharedType: selected.isMultiMember ? 'shared' : 'shared',
          });
        },
      });
    },

    // ─── 费用性质切换 ────────────────────────────────────────────────────────

    onTapSharedType() {
      this.setData({
        sharedType: this.data.sharedType === 'shared' ? 'personal' : 'shared',
      });
    },

    // ─── 备注 ────────────────────────────────────────────────────────────────

    onTapNote() {
      this.setData({ noteFocused: true });
    },

    onNoteInput(e: WechatMiniprogram.Input) {
      this.setData({ note: e.detail.value });
    },

    onNoteConfirm() {
      this.setData({ noteFocused: false });
    },

    onNoteBlur() {
      this.setData({ noteFocused: false });
    },

    // ─── 保存 ────────────────────────────────────────────────────────────────

    async _saveEntry() {
      if (this.data.saving) return;

      const amountCents = this.data.calc.amountCents;
      if (amountCents <= 0) {
        wx.showToast({ title: '请输入金额', icon: 'none' });
        return;
      }

      if (!this.data.selectedTier2Id) {
        wx.showToast({ title: '请选择分类', icon: 'none' });
        return;
      }

      this.setData({ saving: true });

      try {
        const clientRefId = newClientRefId();
        const now = new Date().toISOString();

        const entry: Entry = {
          client_ref_id: clientRefId,
          ledger_id: this.data.ledgerId,
          amount: amountCents,
          currency: 'CNY',
          type: this.data.entryType,
          category_id: this.data.selectedTier2Id,
          note: this.data.note,
          occurred_at: now,
          created_at: now,
          updated_at: now,
          dirty: true,
        };

        await putEntry(entry);
        await enqueue({
          op: 'create',
          entity: 'entry',
          client_ref_id: clientRefId,
          base_version: null,
          payload: { ...entry },
        });

        // 关闭覆盖层
        this.setData({ visible: false, keypadVisible: false, saving: false });
        eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);

        wx.showToast({ title: '记账成功', icon: 'success' });
      } catch (err) {
        console.error('[expense-overlay] save failed', err);
        this.setData({ saving: false });
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    },
  },
});
