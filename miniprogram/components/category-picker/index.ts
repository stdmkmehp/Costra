// components/category-picker/index.ts · 通用分类选择组件
// 卡号占位：COSTRA-5xx（T3 · Sprint-4 · Epic-E）
// Refs: COSTRA-5xx
// 从 expense-overlay/categories.ts 数据层复用 · 支持 expense/income/transfer 跨 type 选择

import {
  loadCategoriesSync,
  refreshCategoryDataAsync,
  type CategoryData,
  type CategoryTier1,
} from '../expense-overlay/categories';
import { getActiveFamilyId } from '../../services/family';

Component({
  properties: {
    /** 是否显示 */
    show: { type: Boolean, value: false },
    /** 当前选中的分类 ID */
    value: { type: String, value: '' },
    /** 是否允许跨 type 选择（定时编辑页 true · 记账面板 false） */
    allowCrossType: { type: Boolean, value: false },
    /** 当前 type 上下文 */
    currentType: { type: String, value: 'expense' },
    /** 当前编辑规则所属 family；不传时才回退到全局 active family */
    familyId: { type: String, value: '' },
  },

  data: {
    activeTab: 'expense' as 'expense' | 'income' | 'transfer',
    categories: [] as CategoryTier1[],
    allData: null as CategoryData | null,
  },

  observers: {
    'show, currentType, familyId': function (show: boolean, currentType: string) {
      if (show) {
        // 先设 activeTab 再加载数据，确保 _loadData 读到正确的 tab
        this.setData({ activeTab: currentType as any });
        this._loadData();
      }
    },
  },

  methods: {
    async _loadData() {
      const familyId = this.properties.familyId || await getActiveFamilyId();
      if (!familyId) return;
      const data = loadCategoriesSync(familyId);
      this.setData({
        allData: data,
        categories: this._getCategoriesForTab(data, this.data.activeTab),
      });
      // 后台刷新
      refreshCategoryDataAsync(familyId).then((fresh) => {
        if (fresh.signature !== data.signature) {
          this.setData({
            allData: fresh,
            categories: this._getCategoriesForTab(fresh, this.data.activeTab),
          });
        }
      }).catch(() => { /* 静默 */ });
    },

    _getCategoriesForTab(data: CategoryData, tab: string): CategoryTier1[] {
      switch (tab) {
        case 'income': return data.income;
        case 'transfer': return data.transfer;
        default: return data.expense;
      }
    },

    onTabChange(e: WechatMiniprogram.TouchEvent) {
      const tab = e.currentTarget.dataset.tab as 'expense' | 'income' | 'transfer';
      if (!this.data.allowCrossType && tab !== this.properties.currentType) return;
      const data = this.data.allData;
      if (!data) return;
      this.setData({
        activeTab: tab,
        categories: this._getCategoriesForTab(data, tab),
      });
    },

    onSelectCategory(e: WechatMiniprogram.TouchEvent) {
      const { id, name, icon, type } = e.currentTarget.dataset;
      this.triggerEvent('select', { id, name, icon, type: type || this.data.activeTab });
    },

    onSelectSub(e: WechatMiniprogram.TouchEvent) {
      const { id, name, icon, parentType } = e.currentTarget.dataset;
      const type = parentType || this.data.activeTab;
      this.triggerEvent('select', { id, name, icon, type });
    },

    onClose() {
      this.triggerEvent('close');
    },

    onNoop() { /* 阻止触摸移动穿透到底层页面 */ },
  },
});
