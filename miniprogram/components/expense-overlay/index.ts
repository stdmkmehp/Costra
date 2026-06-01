// components/expense-overlay/index.ts · 全屏记账覆盖层（COSTRA-208 完全重写 · COSTRA-209 防遮挡滚动）
// 卡号: COSTRA-208 / COSTRA-209 / COSTRA-210 · 分类防键盘遮挡滚动 + 打开重置 + 多实例状态同步关闭
// 设计源: design/ui/design_spec.md §6.3 + design/ui/interaction_flow.md §2/§3
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）
//
// 架构决策：
//   - overlay → shell(flex-column:100vh) → header + scroll-view(flex:1) + keypad-sheet
//   - 禁止 swiper，禁止 JS 动态计算 scroll-view 高度
//   - 高度完全由 CSS flex 布局负责

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

// ─── 防遮挡滚动常量 ────────────────────────────────────────────────────────────

/**
 * 键盘面板估算高度（px）。
 * 键盘弹出前无法 query .keypad-sheet 实际高度，故用估算值。
 * 该值基于 4 行键盘(96rpx/行) + 金额区 + 操作行 + 安全区 ≈ 300px（iPhone 标准屏）。
 * 实际键盘弹出后 scroll-view 会因 flex:1 自动缩小，此估算仅用于预判遮挡。
 */
const KEYPAD_SHEET_ESTIMATED_HEIGHT_PX = 300;

/**
 * 安全间距（px）：选中分类底部与键盘顶部之间至少留出的间距。
 * 对应设计稿 24rpx ≈ 12px（375pt 屏宽），此处用 16px 略宽以保安全。
 */
const SAFE_MARGIN_PX = 16;

// ─── Component ─────────────────────────────────────────────────────────────────

Component({
  options: {
    pureDataPattern: /^_/,
  },

  data: {
    // ─── 显隐 ───
    visible: false,

    // ─── 收支类型 ───
    entryType: 'expense' as 'expense' | 'income',

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

    // ─── 保存中 ───
    saving: false,

    // ─── 分类滚动控制（COSTRA-209） ───
    /** scroll-view 的 scroll-top 绑定值 */
    categoryScrollTop: 0,
  },

  lifetimes: {
    attached() {
      // 订阅 SHOW 事件 → 显示覆盖层
      const showHandler = () => { this._show(); };
      (this as unknown as Record<string, unknown>)._showHandler = showHandler;
      eventBus.on(EventNames.SHOW_EXPENSE_OVERLAY, showHandler);

      // COSTRA-210 方案 A：订阅 HIDE 事件 → 同步关闭所有实例
      // 根因：各 Tab 页都挂载 <expense-overlay/>，SHOW 是广播导致所有实例 visible=true。
      // 用户在某页点关闭只关当前实例 + emit HIDE，但其他实例不订阅 HIDE 导致残留。
      const hideHandler = () => {
        this.setData({ visible: false, keypadVisible: false, noteFocused: false, saving: false });
      };
      (this as unknown as Record<string, unknown>)._hideHandler = hideHandler;
      eventBus.on(EventNames.HIDE_EXPENSE_OVERLAY, hideHandler);
    },

    detached() {
      const showHandler = (this as unknown as Record<string, unknown>)._showHandler as (() => void) | undefined;
      if (showHandler) {
        eventBus.off(EventNames.SHOW_EXPENSE_OVERLAY, showHandler);
      }
      // COSTRA-210 方案 A：取消订阅 HIDE handler
      const hideHandler = (this as unknown as Record<string, unknown>)._hideHandler as (() => void) | undefined;
      if (hideHandler) {
        eventBus.off(EventNames.HIDE_EXPENSE_OVERLAY, hideHandler);
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

      // COSTRA-209: 重置滚动位置到顶部
      // 小程序 scroll-view 不会响应同值赋值，先设 1 再 nextTick 设 0
      (this as unknown as Record<string, number>)._currentScrollTop = 0;

      this.setData({
        visible: true,
        ledgerId: ledgerId || 'default',
        ledgerName: '我的账本',
        isMultiMemberLedger: false,
        ledgerOptions,
        showSharedToggle: false,
        entryType: 'expense',
        tier1Categories: EXPENSE_CATEGORIES,
        dedupedSubCategories: EXPENSE_DEDUPED_SUBS,
        expandedTier1Id: null,
        expandedChildren: [],
        selectedTier1Id: '',
        selectedTier2Id: '',
        dimmedTier1Ids: [],
        keypadVisible: false,
        calc: { ...INITIAL_CALC_STATE },
        sharedType: 'shared',
        note: '',
        noteFocused: false,
        saving: false,
        categoryScrollTop: 1,
      });

      // nextTick 确保先渲染 categoryScrollTop:1，再设为 0 触发实际滚动
      setTimeout(() => {
        this.setData({ categoryScrollTop: 0 });
      }, 50);
    },

    onClose() {
      this.setData({ visible: false, keypadVisible: false });
      eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);
    },

    /** 阻止触摸穿透 */
    noop() {
      // intentionally empty
    },

    // ─── 分类滚动控制（COSTRA-209）─────────────────────────────────────────────

    /** scroll-view 滚动事件：实时记录 scrollTop 到实例属性 */
    onCategoryScroll(e: WechatMiniprogram.ScrollViewScroll) {
      (this as unknown as Record<string, number>)._currentScrollTop = e.detail.scrollTop;
    },

    /**
     * 防遮挡滚动：确保选中分类元素在键盘弹出后仍可见。
     *
     * 逻辑：
     * 1. 查询目标元素和 scroll-view 的 bounding rect
     * 2. 估算键盘弹出后的安全底线 = scrollRect.bottom - keypadHeight - safeMargin
     * 3. 如果目标元素底部超过安全底线，计算需要滚动的距离
     * 4. 使用 scroll-top + scroll-with-animation 平滑滚动
     *
     * @param selector 目标元素的 CSS selector（如 '#cat-sub-xxx'）
     */
    _ensureCategoryVisibleAboveKeypad(selector: string) {
      const query = wx.createSelectorQuery().in(this);
      query.select(selector).boundingClientRect();
      query.select('.category-scroll').boundingClientRect();
      query.exec((res) => {
        const targetRect = res[0] as WechatMiniprogram.BoundingClientRectCallbackResult | null;
        const scrollRect = res[1] as WechatMiniprogram.BoundingClientRectCallbackResult | null;

        if (!targetRect || !scrollRect) return;

        // 安全底线：scroll-view 底部 - 键盘高度 - 安全间距
        const safeBottom = scrollRect.bottom - KEYPAD_SHEET_ESTIMATED_HEIGHT_PX - SAFE_MARGIN_PX;

        // 如果目标元素底部在安全区内，不需要滚动
        if (targetRect.bottom <= safeBottom) return;

        // 需要滚动的距离 = 目标底部超出安全底线的量
        const delta = targetRect.bottom - safeBottom;
        const currentScrollTop = (this as unknown as Record<string, number>)._currentScrollTop || 0;
        const nextScrollTop = currentScrollTop + delta;

        this.setData({ categoryScrollTop: nextScrollTop });
      });
    },

    // ─── 收支切换（轻量横滑手势 + 文字指示器点击）────────────────────────────

    /** 记录触摸起点（轻量横滑手势） */
    onTouchStart(e: WechatMiniprogram.TouchEvent) {
      const touch = e.touches[0];
      if (touch) {
        (this as unknown as Record<string, number>)._touchStartX = touch.pageX;
        (this as unknown as Record<string, number>)._touchStartY = touch.pageY;
      }
    },

    /** 判断是否切换收支面板（轻量横滑手势） */
    onTouchEnd(e: WechatMiniprogram.TouchEvent) {
      const touch = e.changedTouches[0];
      if (!touch) return;

      const startX = (this as unknown as Record<string, number>)._touchStartX;
      const startY = (this as unknown as Record<string, number>)._touchStartY;
      if (startX == null || startY == null) return;

      const deltaX = touch.pageX - startX;
      const deltaY = touch.pageY - startY;

      // 横滑判定：水平位移 > 60px 且 水平明显大于纵向（避免误触纵向滚动）
      if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
        // 左滑→收入，右滑→支出
        const nextType = deltaX < 0 ? 'income' : 'expense';
        if (nextType !== this.data.entryType) {
          this._switchEntryType(nextType);
        }
      }

      // 清理
      (this as unknown as Record<string, number>)._touchStartX = 0;
      (this as unknown as Record<string, number>)._touchStartY = 0;
    },

    /** 点击顶部文字指示器切换收支 */
    onTapTab(e: WechatMiniprogram.TouchEvent) {
      const type = e.currentTarget.dataset.type as 'expense' | 'income';
      if (type === this.data.entryType) return;
      this._switchEntryType(type);
    },

    /**
     * 收支切换核心逻辑（横滑手势 + 文字指示器共用）
     */
    _switchEntryType(type: 'expense' | 'income') {
      const tier1Categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
      const dedupedSubCategories = type === 'expense' ? EXPENSE_DEDUPED_SUBS : INCOME_DEDUPED_SUBS;

      // 收入时隐藏费用性质开关
      const showSharedToggle = type === 'income'
        ? false
        : this.data.isMultiMemberLedger;

      this.setData({
        entryType: type,
        tier1Categories,
        dedupedSubCategories,
        expandedTier1Id: null,
        expandedChildren: [],
        selectedTier1Id: '',
        selectedTier2Id: '',
        dimmedTier1Ids: [],
        showSharedToggle,
      });
    },

    // ─── 场景 A：点击一级分类 → 展开子分类 + 弱化其他 + 弹出键盘 ─────────

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

      // 未选中一级分类 → 弱化其他
      const dimmedTier1Ids = this.data.tier1Categories
        .filter(c => c.id !== tier1Id)
        .map(c => c.id);

      // 默认选中第一个子分类
      const firstChild = tier1.children[0];

      this.setData({
        expandedTier1Id: tier1Id,
        expandedChildren: tier1.children,
        selectedTier1Id: tier1Id,
        selectedTier2Id: firstChild.id,
        dimmedTier1Ids,
      });

      // COSTRA-209: setData 完成后 nextTick 判断默认子分类是否被键盘遮挡
      // 此时 keypad 尚未弹出，scroll-view 高度未缩小，用估算键盘高度预判
      setTimeout(() => {
        this._ensureCategoryVisibleAboveKeypad(`#cat-sub-${firstChild.id}`);
      }, 50);

      // 弹出键盘
      if (!this.data.keypadVisible) {
        this.setData({ keypadVisible: true });
      }
    },

    // ─── 场景 B：直选二级分类 → 不展开一级 + 弹出键盘 ──────────────────────

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

      // COSTRA-209: 场景 B 直选二级分类，判断是否会被键盘遮挡
      setTimeout(() => {
        this._ensureCategoryVisibleAboveKeypad(`#cat-sub-${subId}`);
      }, 50);

      // 弹出键盘
      if (!this.data.keypadVisible) {
        this.setData({ keypadVisible: true });
      }
    },

    // ─── 展开面板中的二级分类点击 ─────────────────────────────────────────────

    onTapExpandedChild(e: WechatMiniprogram.TouchEvent) {
      const subId = e.currentTarget.dataset.id as string;
      if (!subId) return;
      this.setData({ selectedTier2Id: subId });

      // COSTRA-209: 展开面板中切换子分类，判断是否被键盘遮挡
      // 此时键盘已弹出，scroll-view 已缩小，可更精确判断
      setTimeout(() => {
        this._ensureCategoryVisibleAboveKeypad(`#cat-sub-${subId}`);
      }, 50);
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

    /** 右下角按钮动作：= 计算 / 完成 保存 */
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
