// components/filter-panel/index.ts · 明细页筛选面板
// 浮出式面板：搜索关键词 + 流水类型 + 成员多选 + 分类多选（手风琴展开 + 长按 solo）

export interface FilterMember {
  user_id: string;
  nickname: string;
  avatar_url: string;
  initial: string;
  selected: boolean;
}

/**
 * 流水类型筛选维度（单选）：
 *   all      → 全部流水
 *   personal → 个人支出（type=expense 且非公共）
 *   shared   → 公共支出（type=expense 且公共）
 *   income   → 收入（type=income）
 *   transfer → 转移（type=transfer）
 */
export type EntryTypeFilter = 'all' | 'personal' | 'shared' | 'income' | 'transfer';

/** 分类筛选一级项 */
export interface FilterCategoryTier1 {
  id: string;
  name: string;
  icon: string;
  /** 全选 'all' / 半选 'partial' / 未选 'none' */
  status: 'all' | 'partial' | 'none';
  children: FilterCategoryTier2[];
}

/** 分类筛选二级项 */
export interface FilterCategoryTier2 {
  id: string;
  name: string;
  icon: string;
  selected: boolean;
}

export interface FilterState {
  entryType: EntryTypeFilter;
  selectedMemberIds: string[];
  selectedCategoryIds: string[];
  categoryFilterActive: boolean;
  searchKeyword: string;
}

Component({
  properties: {
    /** 是否可见 */
    visible: {
      type: Boolean,
      value: false,
    },
    /** 成员列表（含 selected 状态） */
    members: {
      type: Array,
      value: [] as FilterMember[],
    },
    /** 流水类型筛选 */
    entryType: {
      type: String,
      value: 'all' as EntryTypeFilter,
    },
    /** 分类筛选列表（一级 + 嵌套二级） */
    categories: {
      type: Array,
      value: [] as FilterCategoryTier1[],
    },
    /** 当前展开的一级分类 ID（空 = 全部收起） */
    expandedCategoryId: {
      type: String,
      value: '',
    },
    /** 分类是否全部选中（控制「全部」Chip 激活态） */
    categoryAllSelected: {
      type: Boolean,
      value: true,
    },
    /** 搜索关键词 */
    searchKeyword: {
      type: String,
      value: '',
    },
  },

  data: {
    isAllSelected: true,
    /** 展开的一级分类的二级列表（从 categories 中提取） */
    expandedSubcategories: [] as FilterCategoryTier2[],
    expandedCategoryName: '',
    /** 当前展开一级下二级是否全选（控制「全选」Chip 激活态） */
    expandedAllSelected: true,
  },

  observers: {
    'members.**'() {
      this._computeAllSelected();
    },
    'categories, expandedCategoryId'() {
      this._computeExpandedSub();
    },
  },

  methods: {
    /** 点击蒙层 → 关闭面板（自动保存） */
    onTapMask() {
      this._closeAndSave();
    },

    // ─── 搜索 ──────────────────────────────────────────────────────────────

    onSearchInput(e: WechatMiniprogram.Input) {
      const keyword = (e.detail.value || '').trim();
      this.triggerEvent('searchInput', { keyword });
    },

    onSearchClear() {
      this.triggerEvent('searchInput', { keyword: '' });
    },

    // ─── 流水类型 ──────────────────────────────────────────────────────────

    /** 流水类型切换 */
    onTapEntryType(e: WechatMiniprogram.TouchEvent) {
      const type = (e.currentTarget.dataset as Record<string, string>).type as EntryTypeFilter;
      if (type === this.properties.entryType) return;
      this.triggerEvent('entryTypeChange', { entryType: type });
    },

    // ─── 成员 ──────────────────────────────────────────────────────────────

    /** 点击成员头像 toggle */
    onTapMember(e: WechatMiniprogram.TouchEvent) {
      const userId = (e.currentTarget.dataset as Record<string, string>).userid;
      if (!userId) return;
      this.triggerEvent('memberToggle', { userId });
    },

    /** 全选/取消全选 */
    onTapSelectAll() {
      const isAllSelected = this.data.isAllSelected;
      this.triggerEvent('selectAll', { selectAll: !isAllSelected });
    },

    // ─── 分类 ──────────────────────────────────────────────────────────────

    /** 点击「全部」Chip → toggle 全选/全反选
     *  全部已选 → 反选（清空 _filterCategoryIds）
     *  非全选 → 重置回全选 */
    onTapCategoryAll() {
      this.triggerEvent('categoryToggleAll', {
        allSelected: !!this.properties.categoryAllSelected,
      });
    },

    /** 点击一级 Chip → 展开/收起二级（手风琴） */
    onTapCategoryTier1(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as Record<string, string>).id;
      if (!id) return;
      const current = this.properties.expandedCategoryId;
      if (current === id) {
        // 已展开 → 收起
        this.triggerEvent('categoryExpand', { categoryId: '' });
      } else {
        // 展开（自动收起其他）
        this.triggerEvent('categoryExpand', { categoryId: id });
      }
    },

    /** 长按一级 Chip → solo 模式（仅保留此分类） */
    onLongPressCategoryTier1(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as Record<string, string>).id;
      if (!id) return;
      wx.vibrateShort({ type: 'light' });
      this.triggerEvent('categorySolo', { categoryId: id });
    },

    /** 点击二级 Chip → toggle */
    onTapCategoryTier2(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as Record<string, string>).id;
      if (!id) return;
      this.triggerEvent('categoryToggle', { categoryId: id });
    },

    /** 点击二级区「全选」Chip → 该一级下全选 */
    onTapSubcategoryAll(e: WechatMiniprogram.TouchEvent) {
      const parentId = (e.currentTarget.dataset as Record<string, string>).parent;
      if (!parentId) return;
      this.triggerEvent('categorySelectAll', { parentId });
    },

    /** 点击「重置」→ 重置分类 */
    onCategoryReset() {
      this.triggerEvent('categoryReset');
    },

    // ─── 内部 ──────────────────────────────────────────────────────────────

    /** 关闭面板并保存 */
    _closeAndSave() {
      // 检查是否有成员被选中，如果没有则自动全选
      const members = this.properties.members as FilterMember[];
      const hasSelected = members.some(m => m.selected);
      if (!hasSelected) {
        this.triggerEvent('selectAll', { selectAll: true });
      }
      this.triggerEvent('close');
    },

    /** 计算是否全选 */
    _computeAllSelected() {
      const members = this.properties.members as FilterMember[];
      const isAllSelected = members.length > 0 && members.every(m => m.selected);
      this.setData({ isAllSelected });
    },

    /** 从 categories 中提取当前展开一级的二级列表 */
    _computeExpandedSub() {
      const expandedId = this.properties.expandedCategoryId;
      if (!expandedId) {
        this.setData({ expandedSubcategories: [], expandedCategoryName: '', expandedAllSelected: true });
        return;
      }
      const categories = this.properties.categories as FilterCategoryTier1[];
      const found = categories.find(c => c.id === expandedId);
      if (found) {
        const expandedAllSelected = found.children.length > 0 && found.children.every(c => c.selected);
        this.setData({
          expandedSubcategories: found.children,
          expandedCategoryName: found.name,
          expandedAllSelected,
        });
      } else {
        this.setData({ expandedSubcategories: [], expandedCategoryName: '', expandedAllSelected: true });
      }
    },

    /** 阻止穿透 */
    noop() {},
  },
});
