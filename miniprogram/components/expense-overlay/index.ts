// components/expense-overlay/index.ts · 全屏记账覆盖层（COSTRA-208 完全重写 · COSTRA-209 防遮挡滚动 · COSTRA-211 最小位移优化 · COSTRA-212 滚动插值动画+备注可重复编辑+计算器算式修复 · COSTRA-214 安全区标准化）
// 卡号: COSTRA-208 / COSTRA-209 / COSTRA-210 / COSTRA-211 / COSTRA-212 / COSTRA-214 · 分类防键盘遮挡滚动(真实布局最小位移+插值动画) + 打开重置 + 多实例状态同步关闭 + 统一安全区
// 设计源: design/ui/design_spec.md §6.3 + design/ui/interaction_flow.md §2/§3
// 金额 ADR-0002: 全部走 decimal.js（utils/money.ts）
//
// 架构决策：
//   - overlay → shell(flex-column:100vh) → header + scroll-view(flex:1) + keypad-sheet
//   - 禁止 swiper，禁止 JS 动态计算 scroll-view 高度
//   - 高度完全由 CSS flex 布局负责
//   - COSTRA-211: 防遮挡滚动采用二阶段真实布局算法，不再依赖固定键盘高度估算
//   - COSTRA-212: 滚动动画改为 JS 分段插值（easeOutCubic 220ms），替代 scroll-with-animation
//   - COSTRA-214: 顶部安全区由 getSafeAreaMetrics() 统一驱动，不再依赖 CSS env(safe-area-inset-top)

import { newClientRefId } from '../../utils/id';
import { getSafeAreaMetrics } from '../../utils/safeArea';
import { putEntry, updateEntryFields, type Entry } from '../../services/db';
import { enqueue } from '../../services/outbox';
import { getActiveLedgerId, getActiveFamilyId, getActiveFamilyKind, getActiveLedgerName } from '../../services/family';
import { getFamilies } from '../../services/familyApi';
import { getToken } from '../../services/auth';
import { eventBus, EventNames } from '../../services/eventBus';
import {
  loadCategoriesSync,
  refreshCategoryDataAsync,
  type CategoryData,
  type CategoryTier1, type CategoryTier2,
} from './categories';
import {
  INITIAL_CALC_STATE,
  inputDigit, inputDot,
  inputOperator, inputBackspace, pressEquals,
  type CalcState,
} from './calc';

// ─── 账本选项 ─────────────────────────────────────────────────────────────────

interface LedgerOption {
  id: string;
  name: string;
  isMultiMember: boolean;
}

// ─── 防遮挡滚动常量（COSTRA-211 真实布局算法）────────────────────────────────────

/**
 * 安全间距（px）：选中分类底部与 scroll-view 可视区底部之间至少留出的间距。
 * 设计稿 24rpx ≈ 12px（375pt 屏宽），用 12px 保持紧凑。
 */
const SAFE_MARGIN_PX = 12;

/**
 * 键盘布局稳定等待时间（ms）。
 * setData({ keypadVisible: true }) 后，flex 布局需要时间将 scroll-view 压缩到真实高度。
 * 80ms 足以让布局稳定，同时保持响应速度（用户感知：选中→键盘弹出→轻微滚动）。
 */
const KEYPAD_LAYOUT_SETTLE_MS = 80;

/**
 * 分类滚动插值动画时长（ms）（COSTRA-212）。
 * 220ms 在用户感知上属于"即时但有过渡"区间，避免瞬移感。
 */
const SCROLL_ANIM_DURATION_MS = 220;

/**
 * 分类滚动插值动画帧间隔（ms）（COSTRA-212）。
 * 16ms ≈ 60fps，与 requestAnimationFrame 对齐。
 */
const SCROLL_ANIM_FRAME_MS = 16;

/** 本地自然日 → YYYY-MM-DD */
function getLocalDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 日期键盘文案：当天显示今天，其他日期显示 M/D */
function formatRecordDateText(value: string): string {
  if (value === getLocalDateValue()) return '今天';
  const parts = value.split('-');
  if (parts.length !== 3) return '日期';
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

/** 将用户选择的自然日转为 occurred_at */
function buildOccurredAt(recordDate: string): string {
  if (recordDate === getLocalDateValue()) return new Date().toISOString();
  return `${recordDate}T12:00:00.000Z`;
}

// ─── Component ─────────────────────────────────────────────────────────────────

Component({
  options: {
    pureDataPattern: /^_/,
  },

  data: {
    // ─── 显隐 ───
    visible: false,

    // ─── 编辑模式（COSTRA-227） ───
    editMode: false,
    /** 编辑标题 */
    overlayTitle: '记一笔',
    /** 完成按钮文案 */
    actionButtonLabel: '完成',
    /** 编辑模式下收支切换是否禁用 */
    typeSwipeDisabled: false,
    /** 仅显示键盘（隐藏分类区域） */
    keypadOnly: false,

    // ─── 安全区（COSTRA-214: 统一由 getSafeAreaMetrics() 驱动） ───
    safeAreaTop: 0,
    safeAreaBottom: 0,
    menuButtonTop: 0,

    // ─── 收支类型 ───
    entryType: 'expense' as 'expense' | 'income' | 'transfer',
    /** COSTRA-228 / migration 0004: swiper current 绑定（0=支出 / 1=收入 / 2=转移） */
    entryTypeIndex: 0,
    /** COSTRA-228: swiper 切换动画时长（程序触发收支切换时设 0 避免抖动） */
    categorySwiperDuration: 240,

    // ─── 分类网格（COSTRA-219: 动态从 API 加载，初始为空）───
    // ─── COSTRA-228: 同时持有 expense / income 两套，让两个 swiper-item 各自渲染，
    //     手势横滑过程中两个 pane 始终有内容（避免空白闪过）。
    //     `tier1Categories` / `dedupedSubCategories` 仍代表"当前 entryType"对应的快照，
    //     供内部 onTapTier1 / onTapSubCategory 等回调读取，不影响渲染。
    expenseTier1Categories: [] as readonly CategoryTier1[],
    incomeTier1Categories: [] as readonly CategoryTier1[],
    /** migration 0004: 转移类目树（仅按树展示，无去重展示区） */
    transferTier1Categories: [] as readonly CategoryTier1[],
    expenseDedupedSubCategories: [] as readonly CategoryTier2[],
    incomeDedupedSubCategories: [] as readonly CategoryTier2[],
    tier1Categories: [] as readonly CategoryTier1[],
    dedupedSubCategories: [] as readonly CategoryTier2[],
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
    ledgerName: '个人账本' as string,
    isMultiMemberLedger: false as boolean,
    ledgerOptions: [] as LedgerOption[],
    /** 费用性质：personal / shared */
    sharedType: 'personal' as 'personal' | 'shared',
    /** 是否显示费用性质开关（多人+支出时显示） */
    showSharedToggle: false as boolean,
    /** 备注文字 */
    note: '' as string,
    /** 账单发生日期（自然日 YYYY-MM-DD） */
    recordDate: getLocalDateValue(),
    /** 账单发生日期键盘文案 */
    recordDateText: '今天',
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
        this.setData({ visible: false, keypadVisible: false, noteFocused: false, saving: false, editMode: false });
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

    /**
     * 显示记账面板。
     *
     * 设计原则（2026-06-05 重构）：
     *   1. **永不 await 网络**：仅等本地 storage（毫秒级），同步用内存缓存的分类数据立即打开 UI
     *   2. **后台增量刷新**：fire-and-forget 调 getFamilies / refreshCategoryDataAsync
     *   3. **不覆盖用户选择**：刷新回来后基于签名 + 当前面板状态做最小 setData
     *
     * 弱网下用户感知：点 + 立刻看到面板（< 100ms），分类来自内存缓存或 fallback；
     * 联网状态下后台刷新若发现新数据会做温和增量刷新。
     */
    async _show() {
      // —— 阶段 1：同步可得的数据（仅 storage，无网络）——
      const [ledgerId, familyKind, ledgerNameStored, familyId] = await Promise.all([
        getActiveLedgerId(),
        getActiveFamilyKind(),
        getActiveLedgerName(),
        getActiveFamilyId(),
      ]);

      const currentLedgerId = ledgerId || '';
      const currentLedgerName = ledgerNameStored || '个人账本';
      const isMultiMember = familyKind === 'shared';

      // 账本选项初值：用本地 context 拼一个单元素列表，避免开屏空状态
      // 真实多账本会由 _refreshLedgerOptionsAsync 后台拉到再合入
      const initialLedgerOptions: LedgerOption[] = [
        { id: currentLedgerId || 'default', name: currentLedgerName, isMultiMember },
      ];

      // —— 阶段 2：同步加载分类（内存缓存 → fallback，永不查 storage 永不调 API）——
      const categoryData: CategoryData = familyId
        ? loadCategoriesSync(familyId)
        : { expense: [], income: [], transfer: [], expenseDedupedSubs: [], incomeDedupedSubs: [], dedupMapping: {}, signature: '' };

      // 存储分类数据到实例属性（供收支切换使用）
      (this as unknown as Record<string, unknown>)._categoryData = categoryData;

      // 安全区
      const { safeAreaTop, safeAreaBottom, menuButtonTop } = getSafeAreaMetrics();

      // 重置滚动位置
      (this as unknown as Record<string, number>)._currentScrollTop = 0;

      const recordDate = getLocalDateValue();

      // —— 阶段 3：同步 setData 立即显示面板 ——
      this.setData({
        visible: true,
        editMode: false,
        overlayTitle: '记一笔',
        actionButtonLabel: '完成',
        typeSwipeDisabled: false,
        keypadOnly: false,
        safeAreaTop,
        safeAreaBottom,
        menuButtonTop,
        ledgerId: currentLedgerId || 'default',
        ledgerName: currentLedgerName,
        isMultiMemberLedger: isMultiMember,
        ledgerOptions: initialLedgerOptions,
        showSharedToggle: isMultiMember,
        entryType: 'expense',
        entryTypeIndex: 0,
        categorySwiperDuration: 0,
        // COSTRA-228: 双 pane 数据
        expenseTier1Categories: categoryData.expense,
        incomeTier1Categories: categoryData.income,
        transferTier1Categories: categoryData.transfer,
        expenseDedupedSubCategories: categoryData.expenseDedupedSubs,
        incomeDedupedSubCategories: categoryData.incomeDedupedSubs,
        tier1Categories: categoryData.expense,
        dedupedSubCategories: categoryData.expenseDedupedSubs,
        expandedTier1Id: null,
        expandedChildren: [],
        selectedTier1Id: '',
        selectedTier2Id: '',
        dimmedTier1Ids: [],
        keypadVisible: false,
        calc: { ...INITIAL_CALC_STATE },
        sharedType: 'personal',
        note: '',
        recordDate,
        recordDateText: formatRecordDateText(recordDate),
        noteFocused: false,
        saving: false,
        categoryScrollTop: 1,
      });

      // nextTick 确保先渲染 categoryScrollTop:1，再设为 0 触发实际滚动
      setTimeout(() => {
        // COSTRA-228: 同步恢复 swiper 动画时长，让后续手势/点击切换有 240ms 过渡
        this.setData({ categoryScrollTop: 0, categorySwiperDuration: 240 });
      }, 50);

      // —— 阶段 4：后台 fire-and-forget 刷新（不阻塞 UI）——
      if (familyId) {
        void this._refreshCategoriesAsync(familyId, categoryData.signature);
      }
      void this._refreshLedgerOptionsAsync(currentLedgerId);
    },

    /**
     * 后台刷新账本选项。命中条件下增量 setData，不覆盖 ledgerId / ledgerName 等用户选择字段。
     */
    async _refreshLedgerOptionsAsync(currentLedgerId: string) {
      let families: { id: string; ledger_id: string; name: string; kind: 'personal' | 'shared' }[];
      try {
        const resp = await getFamilies();
        families = resp.families || [];
      } catch {
        return; // 静默：保持初始本地 context 即可
      }
      if (families.length === 0) return;
      // 组件已关闭则不再刷新，避免无意义 setData
      if (!this.data.visible) return;

      const ledgerOptions: LedgerOption[] = families.map(f => ({
        id: f.ledger_id,
        name: f.name,
        isMultiMember: f.kind === 'shared',
      }));
      const activeFamily = families.find(f => f.ledger_id === currentLedgerId) || families[0];
      const currentIsMultiMember = activeFamily.kind === 'shared';

      // 签名比较：仅 ledgerOptions 内容 + isMultiMember 变化才 setData
      const oldSig = JSON.stringify(this.data.ledgerOptions) + '|' + this.data.isMultiMemberLedger;
      const newSig = JSON.stringify(ledgerOptions) + '|' + currentIsMultiMember;
      if (oldSig === newSig) return;

      const showSharedToggle = currentIsMultiMember && this.data.entryType === 'expense';
      this.setData({
        ledgerOptions,
        isMultiMemberLedger: currentIsMultiMember,
        showSharedToggle,
      });
    },

    /**
     * 后台刷新分类数据。
     *
     * 守护规则：
     *   - 签名相等 → 不 setData
     *   - 签名变化 → 只刷新 tier1Categories / dedupedSubCategories（按当前 entryType）
     *   - 不动 selected* / expanded* / keypadVisible / calc / note / recordDate / sharedType
     *   - editMode 期间完全跳过（避免编辑期间分类列表换掉导致 selectedTier1Id 失配）
     *   - 组件关闭后不刷新
     *
     * @param familyId 活跃 family
     * @param oldSignature 同步打开时拿到的旧签名（用于比对）
     */
    async _refreshCategoriesAsync(familyId: string, oldSignature: string) {
      let next: CategoryData;
      try {
        next = await refreshCategoryDataAsync(familyId);
      } catch {
        return; // 静默：保持当前缓存数据
      }
      // 签名相等 → 无需刷新
      if (next.signature === oldSignature) return;
      // 组件已关闭 / 编辑模式 / 保存中 → 跳过
      if (!this.data.visible || this.data.editMode || this.data.saving) {
        // 即便不 setData，也要更新实例属性，下一次开面板能拿到最新数据
        (this as unknown as Record<string, unknown>)._categoryData = next;
        return;
      }

      // 更新实例属性（供收支切换使用）
      (this as unknown as Record<string, unknown>)._categoryData = next;

      // 仅刷新与当前 entryType 对应的分类列表（migration 0004：transfer 单独处理）
      const tier1Categories = this.data.entryType === 'expense'
        ? next.expense
        : this.data.entryType === 'income'
          ? next.income
          : next.transfer;
      const dedupedSubCategories = this.data.entryType === 'expense'
        ? next.expenseDedupedSubs
        : this.data.entryType === 'income'
          ? next.incomeDedupedSubs
          : [];

      // COSTRA-228: 三套 pane 数据同时刷新（手势期间各 pane 也要保持最新）
      this.setData({
        expenseTier1Categories: next.expense,
        incomeTier1Categories: next.income,
        transferTier1Categories: next.transfer,
        expenseDedupedSubCategories: next.expenseDedupedSubs,
        incomeDedupedSubCategories: next.incomeDedupedSubs,
        tier1Categories,
        dedupedSubCategories,
      });
    },

    onClose() {
      const wasEditMode = this.data.editMode;
      this.setData({ visible: false, keypadVisible: false, editMode: false });
      eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);
      if (wasEditMode) {
        eventBus.emit(EventNames.SHOW_TAB_BAR);
      }
    },

    // ─── COSTRA-227: 编辑模式 ─────────────────────────────────────────────────

    /**
     * 打开编辑模式（由明细页 selectComponent 调用）。
     * 绕过 SHOW_EXPENSE_OVERLAY 事件和 _show() 全量重置路径。
     *
     * 设计原则（与 _show() 一致）：永不 await 网络，同步打开 UI；不在编辑期间做后台分类刷新
     * （编辑模式守护：refreshCategoryDataAsync 内已通过 editMode 检查跳过 setData）。
     */
    async openEditMode(entry: Entry) {
      // COSTRA-227: 通知 tabbar 隐藏
      eventBus.emit(EventNames.HIDE_TAB_BAR);

      // 存储原始 entry 引用（用于后续 diff）
      (this as unknown as Record<string, unknown>)._editOriginalEntry = entry;

      // —— 阶段 1：同步可得的数据（仅 storage，无网络）——
      const [activeLedgerId, familyKind, ledgerNameStored, activeFamilyId] = await Promise.all([
        getActiveLedgerId(),
        getActiveFamilyKind(),
        getActiveLedgerName(),
        getActiveFamilyId(),
      ]);

      const ledgerId = entry.ledger_id || activeLedgerId || '';
      const ledgerName = ledgerNameStored || '个人账本';
      const isMultiMember = familyKind === 'shared';

      const initialLedgerOptions: LedgerOption[] = [
        { id: ledgerId, name: ledgerName, isMultiMember },
      ];

      // —— 阶段 2：同步加载分类（内存缓存 → fallback）——
      const categoryData: CategoryData = activeFamilyId
        ? loadCategoriesSync(activeFamilyId)
        : { expense: [], income: [], transfer: [], expenseDedupedSubs: [], incomeDedupedSubs: [], dedupMapping: {}, signature: '' };

      (this as unknown as Record<string, unknown>)._categoryData = categoryData;

      // 安全区
      const { safeAreaTop, safeAreaBottom, menuButtonTop } = getSafeAreaMetrics();

      // 解析 entry 数据用于预填
      const entryType: 'expense' | 'income' | 'transfer' = entry.type || 'expense';
      const tier1Categories = entryType === 'expense'
        ? categoryData.expense
        : entryType === 'income'
          ? categoryData.income
          : categoryData.transfer;
      const dedupedSubCategories = entryType === 'expense'
        ? categoryData.expenseDedupedSubs
        : entryType === 'income'
          ? categoryData.incomeDedupedSubs
          : [];

      // 查找分类预填
      let selectedTier1Id = '';
      const selectedTier2Id = entry.category_id || '';
      if (selectedTier2Id) {
        for (const tier1 of tier1Categories) {
          if (tier1.children.some(c => c.id === selectedTier2Id)) {
            selectedTier1Id = tier1.id;
            break;
          }
        }
      }

      // 金额预填：cents → 元字符串（去掉尾部多余的零）
      const amountYuanRaw = entry.amount > 0
        ? (entry.amount / 100).toString()
        : '0';
      // 移除多余小数尾零（如 12.30 → 12.3，12.00 → 12）
      const amountYuan = amountYuanRaw.includes('.')
        ? amountYuanRaw.replace(/0+$/, '').replace(/\.$/, '')
        : amountYuanRaw;
      // 构建 calc state with prefilled amount
      const editCalcState: CalcState = {
        display: amountYuan === '0' ? '0' : amountYuan,
        accumulator: amountYuan,
        pendingOp: null,
        lastInputIsOp: false,
        justEvaluated: false,
        actionState: 'done',
        amountCents: entry.amount || 0,
      };

      // 日期预填：occurred_at → 本地 YYYY-MM-DD
      const occurredDate = new Date(entry.occurred_at);
      const recordDate = `${occurredDate.getFullYear()}-${String(occurredDate.getMonth() + 1).padStart(2, '0')}-${String(occurredDate.getDate()).padStart(2, '0')}`;

      // shared_type 预填
      const sharedType = entry.shared_type || 'personal';
      const showSharedToggle = isMultiMember && entryType === 'expense';

      (this as unknown as Record<string, number>)._currentScrollTop = 0;

      // —— 阶段 3：同步 setData 立即显示编辑面板 ——
      this.setData({
        visible: true,
        editMode: true,
        overlayTitle: '编辑',
        actionButtonLabel: '保存',
        typeSwipeDisabled: true,
        keypadOnly: true,
        safeAreaTop,
        safeAreaBottom,
        menuButtonTop,
        ledgerId,
        ledgerName,
        isMultiMemberLedger: isMultiMember,
        ledgerOptions: initialLedgerOptions,
        showSharedToggle,
        entryType,
        entryTypeIndex: entryType === 'transfer' ? 2 : entryType === 'income' ? 1 : 0,
        categorySwiperDuration: 0,
        // COSTRA-228: 双 pane 数据（编辑模式下分类区被 keypadOnly 隐藏，但保持数据完整以备后续退化）
        expenseTier1Categories: categoryData.expense,
        incomeTier1Categories: categoryData.income,
        transferTier1Categories: categoryData.transfer,
        expenseDedupedSubCategories: categoryData.expenseDedupedSubs,
        incomeDedupedSubCategories: categoryData.incomeDedupedSubs,
        tier1Categories,
        dedupedSubCategories,
        expandedTier1Id: null,
        expandedChildren: [],
        selectedTier1Id,
        selectedTier2Id,
        dimmedTier1Ids: [],
        keypadVisible: true,
        calc: editCalcState,
        sharedType,
        note: entry.note || '',
        recordDate,
        recordDateText: formatRecordDateText(recordDate),
        noteFocused: false,
        saving: false,
        categoryScrollTop: 1,
      });

      setTimeout(() => {
        this.setData({ categoryScrollTop: 0, categorySwiperDuration: 240 });
      }, 50);

      // —— 阶段 4：后台 fire-and-forget 刷新账本选项（编辑模式不刷分类，避免 selected 失配）——
      void this._refreshLedgerOptionsAsync(ledgerId);
    },

    /** COSTRA-227: 编辑模式保存逻辑 */
    async _saveEditEntry() {
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

      const originalEntry = (this as unknown as Record<string, unknown>)._editOriginalEntry as Entry | null;
      if (!originalEntry) return;

      // 构建新 occurred_at
      const newOccurredAt = buildOccurredAt(this.data.recordDate);

      // 解析原始日期为本地 YYYY-MM-DD（用于比较）
      const origDate = new Date(originalEntry.occurred_at);
      const origDateKey = `${origDate.getFullYear()}-${String(origDate.getMonth() + 1).padStart(2, '0')}-${String(origDate.getDate()).padStart(2, '0')}`;

      // 提取变更字段
      const changedFields: Record<string, unknown> = {};
      if (amountCents !== originalEntry.amount) {
        changedFields.amount = amountCents;
      }
      if (this.data.selectedTier2Id !== (originalEntry.category_id || '')) {
        changedFields.category_id = this.data.selectedTier2Id;
      }
      if (this.data.note.trim() !== (originalEntry.note || '').trim()) {
        changedFields.note = this.data.note.trim();
      }
      if (this.data.recordDate !== origDateKey) {
        changedFields.occurred_at = newOccurredAt;
      }
      const newSharedType = this.data.isMultiMemberLedger && this.data.entryType === 'expense'
        ? this.data.sharedType
        : null;
      if (newSharedType !== (originalEntry.shared_type || null)) {
        changedFields.shared_type = newSharedType;
      }

      // 无变更 → 直接关闭
      if (Object.keys(changedFields).length === 0) {
        this.setData({ visible: false, keypadVisible: false, editMode: false });
        eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);
        return;
      }

      this.setData({ saving: true });

      try {
        // 更新本地 entry（使用 updateEntryFields 保留 storage 中的 version/id）
        await updateEntryFields(originalEntry.client_ref_id, {
          amount: amountCents,
          category_id: this.data.selectedTier2Id,
          note: this.data.note.trim(),
          occurred_at: changedFields.occurred_at ? newOccurredAt : undefined,
          shared_type: newSharedType,
          updated_at: new Date().toISOString(),
        });
        await enqueue({
          op: 'update',
          entity: 'entry',
          client_ref_id: originalEntry.client_ref_id,
          base_version: originalEntry.version ?? null,
          payload: changedFields,
        });

        // 关闭覆盖层
        this.setData({ visible: false, keypadVisible: false, saving: false, editMode: false });
        eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);
        eventBus.emit(EventNames.SHOW_TAB_BAR);
        eventBus.emit(EventNames.ENTRY_UPDATED);

        wx.vibrateShort({ type: 'light' });
        wx.showToast({ title: '已保存', icon: 'success' });
      } catch (err) {
        console.error('[expense-overlay] edit save failed', err);
        this.setData({ saving: false });
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    },

    /** 阻止触摸穿透 */
    noop() {
      // intentionally empty
    },

    // ─── 分类滚动控制（COSTRA-209 / COSTRA-211）──────────────────────────────────

    /** scroll-view 滚动事件：实时记录 scrollTop 到实例属性 */
    onCategoryScroll(e: WechatMiniprogram.ScrollViewScroll) {
      (this as unknown as Record<string, number>)._currentScrollTop = e.detail.scrollTop;
    },

    /**
     * 显示键盘并确保选中分类可见（COSTRA-211 二阶段算法入口）。
     *
     * 调用时机：
     *   - 点击一级分类（展开+默认选中第一个子分类）
     *   - 直选二级分类（场景 B）
     *
     * 流程：
     *   1. 先 setData({ keypadVisible: true }) 让键盘进入 flex 布局
     *   2. 等待 KEYPAD_LAYOUT_SETTLE_MS 让 scroll-view 被压缩到真实高度
     *   3. 查询目标分类和 .category-scroll 的真实 boundingClientRect
     *   4. 只在目标超出可视区时做最小滚动
     *
     * @param selector 目标分类元素的 CSS selector（如 '#cat-sub-xxx'）
     */
    _showKeypadAndEnsureVisible(selector: string) {
      // 阶段 1：让键盘进入布局
      this.setData({ keypadVisible: true }, () => {
        // 阶段 2：等待 flex 布局稳定后查询真实位置
        setTimeout(() => {
          this._ensureSelectedNearKeyboard(selector);
        }, KEYPAD_LAYOUT_SETTLE_MS);
      });
    },

    /**
     * 基于真实布局计算最小滚动量（COSTRA-211 核心）。
     *
     * 此时 keypad-sheet 已进入布局，.category-scroll 已被 flex 压缩到真实高度。
     * 直接用 boundingClientRect 查询目标元素和 scroll-view 的实际位置，
     * 无需任何估算值。
     *
     * 算法：
     *   safeBottom = scrollRect.bottom - SAFE_MARGIN_PX
     *   if (targetRect.bottom > safeBottom) → 滚动 delta = targetRect.bottom - safeBottom
     *   else → 不滚动
     */
    _ensureSelectedNearKeyboard(selector: string) {
      // COSTRA-228: 现在有两个 .category-scroll（支出/收入各一），必须按当前 entryType
      // 用 id 唯一定位当前可见 pane 的 scroll-view，否则 boundingClientRect 可能落在隐藏 pane。
      const scrollSelector = `#cat-scroll-${this.data.entryType}`;
      const query = wx.createSelectorQuery().in(this);
      query.select(selector).boundingClientRect();
      query.select(scrollSelector).boundingClientRect();
      query.exec((res) => {
        const targetRect = res[0] as WechatMiniprogram.BoundingClientRectCallbackResult | null;
        const scrollRect = res[1] as WechatMiniprogram.BoundingClientRectCallbackResult | null;

        if (!targetRect || !scrollRect) return;

        // 安全底线 = scroll-view 可视区底部 - 安全间距
        // 此时 scrollRect.bottom 已经是键盘挤压后的真实值
        const safeBottom = scrollRect.bottom - SAFE_MARGIN_PX;

        // 如果目标分类底部已在安全区内，不需要滚动
        if (targetRect.bottom <= safeBottom) return;

        // 最小滚动量 = 目标超出安全底线的距离
        const delta = targetRect.bottom - safeBottom;
        const currentScrollTop = (this as unknown as Record<string, number>)._currentScrollTop || 0;
        const nextScrollTop = Math.max(0, currentScrollTop + delta);

        // COSTRA-212: 使用插值动画替代直接 setData，实现丝滑滚动
        this._animateCategoryScrollTo(nextScrollTop);
      });
    },

    /**
     * 分类滚动插值动画（COSTRA-212）。
     *
     * 根因：程序化设置 scroll-top 时，scroll-with-animation 在 enhanced scroll-view 上
     * 表现不稳定，可能瞬移。改为 JS 分段插值（easeOutCubic）更新 scroll-top，
     * 即使原生动画不生效也能平滑过渡。
     *
     * @param target 目标 scrollTop 值
     */
    _animateCategoryScrollTo(target: number) {
      const start = (this as unknown as Record<string, number>)._currentScrollTop || 0;
      const delta = target - start;

      // 极小位移不需要动画
      if (Math.abs(delta) < 2) {
        this.setData({ categoryScrollTop: target });
        return;
      }

      // 递增 token 取消旧动画（防止组件关闭/再次点击分类时旧动画继续运行）
      const token = ((this as unknown as Record<string, number>)._scrollAnimationToken || 0) + 1;
      (this as unknown as Record<string, number>)._scrollAnimationToken = token;

      const startTime = Date.now();

      const step = () => {
        // 检查是否已被新动画取消
        if ((this as unknown as Record<string, number>)._scrollAnimationToken !== token) return;

        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / SCROLL_ANIM_DURATION_MS);
        // easeOutCubic: 1 - (1 - t)^3
        const eased = 1 - Math.pow(1 - t, 3);
        const value = start + delta * eased;

        this.setData({ categoryScrollTop: value });

        if (t < 1) {
          setTimeout(step, SCROLL_ANIM_FRAME_MS);
        } else {
          // 确保最终值精确
          this.setData({ categoryScrollTop: target });
        }
      };

      step();
    },

    // ─── 收支切换（COSTRA-228: swiper 跟手横滑 + 文字指示器点击 + swiperChange 统一回调）────

    /**
     * 文字指示器点击切换收支：仅修改 entryTypeIndex，由 swiper 走原生过渡，
     * change 事件触发 onCategorySwiperChange 完成 entryType / 分类列表的实际切换。
     */
    onTapTab(e: WechatMiniprogram.TouchEvent) {
      // COSTRA-227: 编辑模式下禁止收支切换
      if (this.data.typeSwipeDisabled) return;
      const type = e.currentTarget.dataset.type as 'expense' | 'income' | 'transfer';
      const targetIdx = type === 'transfer' ? 2 : type === 'income' ? 1 : 0;
      if (targetIdx === this.data.entryTypeIndex) return;
      this.setData({ entryTypeIndex: targetIdx });
    },

    /**
     * swiper 切换回调（用户手势横滑 / 程序化切 entryTypeIndex 都会触发）。
     * 这里是收支切换的唯一落点，统一更新 entryType + 分类列表 + 联动状态。
     */
    onCategorySwiperChange(e: WechatMiniprogram.SwiperChange) {
      // COSTRA-227: 编辑模式下禁止收支切换（理论上 keypadOnly 时 swiper 不渲染，但兜底保险）
      if (this.data.typeSwipeDisabled) return;

      const idx = e.detail.current;
      const nextType: 'expense' | 'income' | 'transfer' =
        idx === 2 ? 'transfer' : idx === 1 ? 'income' : 'expense';
      if (nextType === this.data.entryType) return;
      this._switchEntryType(nextType);
    },

    /**
     * 收支切换核心逻辑（手势 swiperChange / 编辑入口共用）。
     * COSTRA-228: entryTypeIndex 总是与 entryType 同步写入，确保 swiper.current
     * 始终反映真实状态（编辑模式 openEditMode 显式设置时也走这条）。
     */
    _switchEntryType(type: 'expense' | 'income' | 'transfer') {
      // COSTRA-219: 从实例属性读取动态分类数据
      const categoryData = (this as unknown as Record<string, unknown>)._categoryData as CategoryData | undefined;

      const tier1Categories = type === 'expense'
        ? (categoryData?.expense || [])
        : type === 'income'
          ? (categoryData?.income || [])
          : (categoryData?.transfer || []);
      // 转移类目无去重展示区（display_order 全为 NULL，仅按树展示）
      const dedupedSubCategories = type === 'expense'
        ? (categoryData?.expenseDedupedSubs || [])
        : type === 'income'
          ? (categoryData?.incomeDedupedSubs || [])
          : [];

      // 收入/转移时隐藏费用性质开关（仅 expense + 多人家庭显示）
      const showSharedToggle = type === 'expense' && this.data.isMultiMemberLedger;

      this.setData({
        entryType: type,
        entryTypeIndex: type === 'transfer' ? 2 : type === 'income' ? 1 : 0,
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

      // COSTRA-211: 使用二阶段真实布局算法
      // 先弹出键盘让布局稳定，再基于真实 rect 计算最小滚动量
      if (!this.data.keypadVisible) {
        this._showKeypadAndEnsureVisible(`#cat-sub-${firstChild.id}`);
      } else {
        // 键盘已显示，直接查询（scroll-view 已被压缩）
        setTimeout(() => {
          this._ensureSelectedNearKeyboard(`#cat-sub-${firstChild.id}`);
        }, KEYPAD_LAYOUT_SETTLE_MS);
      }
    },

    // ─── 场景 B：直选二级分类 → 不展开一级 + 弹出键盘 ──────────────────────

    onTapSubCategory(e: WechatMiniprogram.TouchEvent) {
      const subId = e.currentTarget.dataset.id as string;
      const subName = e.currentTarget.dataset.name as string;
      if (!subId) return;

      // COSTRA-219: 从实例属性读取去重映射
      const categoryData = (this as unknown as Record<string, unknown>)._categoryData as Pick<CategoryData, 'dedupMapping'> | undefined;
      const dedupMapping = categoryData?.dedupMapping || {};

      // 查找归属的一级分类：先查去重映射表，再遍历查找
      let parentTier1Id = dedupMapping[subName] || '';
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

      // COSTRA-211: 使用二阶段真实布局算法
      if (!this.data.keypadVisible) {
        this._showKeypadAndEnsureVisible(`#cat-sub-${subId}`);
      } else {
        setTimeout(() => {
          this._ensureSelectedNearKeyboard(`#cat-sub-${subId}`);
        }, KEYPAD_LAYOUT_SETTLE_MS);
      }
    },

    // ─── 展开面板中的二级分类点击 ─────────────────────────────────────────────

    onTapExpandedChild(e: WechatMiniprogram.TouchEvent) {
      const subId = e.currentTarget.dataset.id as string;
      if (!subId) return;
      this.setData({ selectedTier2Id: subId });

      // COSTRA-211: 展开面板中切换子分类
      // 键盘已显示时 scroll-view 已被压缩，直接查询真实位置
      if (this.data.keypadVisible) {
        setTimeout(() => {
          this._ensureSelectedNearKeyboard(`#cat-sub-${subId}`);
        }, KEYPAD_LAYOUT_SETTLE_MS);
      }
      // 键盘未显示时不滚动（用户还在浏览分类，未触发键盘）
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
        // 按"完成/保存" → 保存
        if (this.data.editMode) {
          this._saveEditEntry();
        } else {
          this._saveEntry();
        }
      }
    },

    // ─── 账单日期 ───────────────────────────────────────────────────────────

    onRecordDateChange(e: WechatMiniprogram.PickerChange) {
      const recordDate = e.detail.value as string;
      this.setData({
        recordDate,
        recordDateText: formatRecordDateText(recordDate),
      });
    },

    // ─── 账本归属 ───────────────────────────────────────────────────────────

    onTapLedgerSwitch() {
      const items = this.data.ledgerOptions.map(o => o.name);
      if (items.length <= 1) return;

      wx.showActionSheet({
        itemList: items,
        success: async (res) => {
          const selected = this.data.ledgerOptions[res.tapIndex];
          if (!selected) return;

          const showSharedToggle = selected.isMultiMember && this.data.entryType === 'expense';

          // 方案 B: 记账面板切账本仅影响本次记账，不改全局 active。
          // 不调 setActiveFamily → 不写 storage → 其他页面不受影响。
          // 组件内部的 ledgerId/ledgerName 已通过 this.setData 更新（下方），
          // 提交 entry 时使用的就是 this.data.ledgerId（组件内部值）。
          // 分类数据可能因家庭不同而不同，需要刷新：
          try {
            const { families } = await getFamilies();
            const targetFamily = families.find(f => f.ledger_id === selected.id);
            if (targetFamily) {
              // 刷新分类数据到内存（不写 storage active，仅刷新分类供本次记账使用）
              void refreshCategoryDataAsync(targetFamily.id);
            }
          } catch { /* 静默降级 */ }

          this.setData({
            ledgerId: selected.id,
            ledgerName: selected.name,
            isMultiMemberLedger: selected.isMultiMember,
            showSharedToggle,
            sharedType: 'personal',
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
      // COSTRA-212: 先 false 再 nextTick true，确保 input 已存在于 DOM 时才设 focus
      // 避免 wx:if 场景下 input 被销毁重建导致 focus 不稳定
      if (this.data.noteFocused) {
        this.setData({ noteFocused: false }, () => {
          setTimeout(() => { this.setData({ noteFocused: true }); }, 50);
        });
      } else {
        this.setData({ noteFocused: true });
      }
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
        const occurredAt = buildOccurredAt(this.data.recordDate);

        // COSTRA-220: 本地创建的 entry 写入当前用户 ID（用于成员筛选）
        const currentUserId = getToken()?.raw.user.id || null;

        const entry: Entry = {
          client_ref_id: clientRefId,
          ledger_id: this.data.ledgerId,
          amount: amountCents,
          currency: 'CNY',
          type: this.data.entryType,
          category_id: this.data.selectedTier2Id,
          note: this.data.note,
          occurred_at: occurredAt,
          created_at: now,
          updated_at: now,
          created_by: currentUserId,
          // COSTRA-223: 费用性质（仅 expense + 多人家庭时有意义）
          shared_type: this.data.isMultiMemberLedger && this.data.entryType === 'expense'
            ? this.data.sharedType
            : null,
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
        // COSTRA-220: 通知明细页刷新数据（响应式刷新替代 onShow 轮询）
        eventBus.emit(EventNames.ENTRY_SAVED);

        wx.showToast({ title: '记账成功', icon: 'success' });
      } catch (err) {
        console.error('[expense-overlay] save failed', err);
        this.setData({ saving: false });
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    },
  },
});
