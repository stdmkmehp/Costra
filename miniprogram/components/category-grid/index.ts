// components/category-grid/index.ts · 全屏分类选择组件
// 使用场景：明细页修改分类、定时记账选择分类
// 通过 properties 控制差异：lockType / autoCommit / autoSelectFirstChild

import { getSafeAreaMetrics } from '../../utils/safeArea';
import {
  loadCategoriesSync,
  refreshCategoryDataAsync,
  type CategoryData,
  type CategoryTier1,
  type CategoryTier2,
} from '../expense-overlay/categories';
import { getActiveFamilyId } from '../../services/family';

type EntryType = 'expense' | 'income' | 'transfer';

Component({
  properties: {
    /** 是否显示 */
    show: { type: Boolean, value: false },
/** 当前选中的分类 ID（用于高亮） */
    value: { type: String, value: '' },
  /** 当前收支类型 */
    currentType: { type: String, value: 'expense' },
    /** 家庭 ID（用于加载分类） */
    familyId: { type: String, value: '' },
    /** 是否锁定类型（不允许收支切换，明细页修改分类场景） */
    lockType: { type: Boolean, value: false },
    /** 选中二级分类后是否自动触发 select 事件（定时/明细 true · 记账面板 false） */
    autoCommit: { type: Boolean, value: true },
 /** 展开一级分类时是否自动选中第一个子分类 */
    autoSelectFirstChild: { type: Boolean, value: true },
},

  data: {
    rendered: false,
    animatable: false,

    // 安全区
 headerPaddingTop: 0,
    safeAreaBottom: 0,

    // 收支类型
    entryType: 'expense' as EntryType,
entryTypeIndex: 0,
    swiperDuration: 240,

    // 三 pane 分类数据
    expenseTier1: [] as readonly CategoryTier1[],
    incomeTier1: [] as readonly CategoryTier1[],
    transferTier1: [] as readonly CategoryTier1[],
  expenseDedupedSubs: [] as readonly CategoryTier2[],
    incomeDedupedSubs: [] as readonly CategoryTier2[],
    transferDedupedSubs: [] as readonly CategoryTier2[],

    // 当前 pane 的分类快照（供 onTapTier1 等内部方法读取）
    tier1Categories: [] as readonly CategoryTier1[],
    dedupedSubCategories: [] as readonly CategoryTier2[],

    // 展开/选中状态
    expandedTier1Id: null as string | null,
    expandedChildren: [] as readonly CategoryTier2[],
    selectedTier1Id: '' as string,
    selectedTier2Id: '' as string,
    dimmedTier1Ids: [] as string[],

    // 滚动
    scrollTop: 0,
  },

  observers: {
    'show, currentType, familyId': function (show: boolean, currentType: string) {
   if (show) {
        this._open(currentType as EntryType);
      }
    },
  },

  lifetimes: {
    attached() {
  const metrics = getSafeAreaMetrics();
      this.setData({
        headerPaddingTop: metrics.menuButtonTop || metrics.statusBarHeight + 4,
      safeAreaBottom: metrics.safeAreaBottom,
 });
    },
  },

  methods: {
    // ─── 打开面板 ──

    _open(type: EntryType) {
      const familyId = this.properties.familyId;
      if (!familyId) {
    // 回退到全局活跃家庭
 getActiveFamilyId().then((fid) => {
   if (fid) this._loadAndShow(type, fid);
        });
   return;
  }
      this._loadAndShow(type, familyId);
    },

    _loadAndShow(type: EntryType, familyId: string) {
      const data = loadCategoriesSync(familyId);
      (this as unknown as Record<string, unknown>)._categoryData = data;

 const typeIndex = type === 'transfer' ? 2 : type === 'income' ? 1 : 0;
  const tier1 = this._getTier1ForType(data, type);
    const deduped = this._getDedupedForType(data, type);

      // 根据当前选中值设置选中态
      const selectedInfo = this._resolveSelection(data, type, this.properties.value as string);

      this.setData({
    rendered: true,
        entryType: type,
        entryTypeIndex: typeIndex,
    swiperDuration: 0, // 首次打开不需要动画
     expenseTier1: data.expense,
        incomeTier1: data.income,
        transferTier1: data.transfer,
        expenseDedupedSubs: data.expenseDedupedSubs,
        incomeDedupedSubs: data.incomeDedupedSubs,
        transferDedupedSubs: data.transferDedupedSubs,
        tier1Categories: tier1,
   dedupedSubCategories: deduped,
  scrollTop: 0,
        ...selectedInfo,
      });

      // 下一帧启用动画并显示
      setTimeout(() => {
        this.setData({ animatable: true, swiperDuration: 240 });
      }, 30);

      // 后台刷新
      refreshCategoryDataAsync(familyId).then((fresh) => {
        if (fresh.signature !== data.signature) {
          (this as unknown as Record<string, unknown>)._categoryData = fresh;
          this.setData({
   expenseTier1: fresh.expense,
            incomeTier1: fresh.income,
        transferTier1: fresh.transfer,
        expenseDedupedSubs: fresh.expenseDedupedSubs,
       incomeDedupedSubs: fresh.incomeDedupedSubs,
transferDedupedSubs: fresh.transferDedupedSubs,
            tier1Categories: this._getTier1ForType(fresh, this.data.entryType),
       dedupedSubCategories: this._getDedupedForType(fresh, this.data.entryType),
   });
        }
      }).catch(() => { /* 静默 */ });
    },

    _resolveSelection(data: CategoryData, type: EntryType, selectedId: string) {
    const result: Record<string, any> = {
        expandedTier1Id: null,
        expandedChildren: [],
    selectedTier1Id: '',
selectedTier2Id: '',
        dimmedTier1Ids: [],
      };
      if (!selectedId) return result;

    const tier1List = this._getTier1ForType(data, type);
  for (const t1 of tier1List) {
        if (t1.id === selectedId) {
          result.selectedTier1Id = t1.id;
      return result;
        }
        const child = t1.children.find(c => c.id === selectedId);
        if (child) {
          result.selectedTier1Id = t1.id;
          result.selectedTier2Id = selectedId;
      return result;
        }
    }
      return result;
    },

  _getTier1ForType(data: CategoryData, type: EntryType): readonly CategoryTier1[] {
      switch (type) {
 case 'income': return data.income;
        case 'transfer': return data.transfer;
   default: return data.expense;
      }
    },

    _getDedupedForType(data: CategoryData, type: EntryType): readonly CategoryTier2[] {
      switch (type) {
     case 'income': return data.incomeDedupedSubs;
      case 'transfer': return data.transferDedupedSubs;
        default: return data.expenseDedupedSubs;
   }
    },

    // ─── 收支切换 ──

    onTapTab(e: WechatMiniprogram.TouchEvent) {
      if (this.properties.lockType) return;
      const type = e.currentTarget.dataset.type as EntryType;
      const targetIdx = type === 'transfer' ? 2 : type === 'income' ? 1 : 0;
      if (targetIdx === this.data.entryTypeIndex) return;
      this.setData({ entryTypeIndex: targetIdx });
    },

    onSwiperChange(e: WechatMiniprogram.SwiperChange) {
      if (this.properties.lockType) return;
      const idx = e.detail.current;
      const nextType: EntryType = idx === 2 ? 'transfer' : idx === 1 ? 'income' : 'expense';
      if (nextType === this.data.entryType) return;
      this._switchType(nextType);
    },

    _switchType(type: EntryType) {
const categoryData = (this as unknown as Record<string, unknown>)._categoryData as CategoryData | undefined;
      const tier1Categories = this._getTier1ForType(categoryData!, type);
      const dedupedSubCategories = this._getDedupedForType(categoryData!, type);

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
      });
    },

    // ─── 一级分类点击 ──

    onTapTier1(e: WechatMiniprogram.TouchEvent) {
      const tier1Id = e.currentTarget.dataset.id as string;
      if (!tier1Id) return;

      const tier1 = this.data.tier1Categories.find((c: CategoryTier1) => c.id === tier1Id);
      if (!tier1) return;

      // 点击已展开的一级 → 收起
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

      // 弱化其他一级
      const dimmedTier1Ids = this.data.tier1Categories
        .filter((c: CategoryTier1) => c.id !== tier1Id)
        .map((c: CategoryTier1) => c.id);

   const updates: Record<string, any> = {
        expandedTier1Id: tier1Id,
        expandedChildren: tier1.children,
        selectedTier1Id: tier1Id,
        dimmedTier1Ids,
      };

      // 自动选中第一个子分类
      if (this.properties.autoSelectFirstChild && tier1.children.length > 0) {
        updates.selectedTier2Id = tier1.children[0].id;
      } else {
        updates.selectedTier2Id = '';
      }

      this.setData(updates);
    },

    // ─── 二级分类点击（去重全局列表） ──

    onTapSubCategory(e: WechatMiniprogram.TouchEvent) {
      const subId = e.currentTarget.dataset.id as string;
      const subName = e.currentTarget.dataset.name as string;
      if (!subId) return;

      const categoryData = (this as unknown as Record<string, unknown>)._categoryData as CategoryData | undefined;
      const dedupMapping = categoryData?.dedupMapping || {};

  // 查找归属一级
      let parentTier1Id = dedupMapping[subName] || '';
      if (!parentTier1Id) {
        for (const tier1 of this.data.tier1Categories) {
     if ((tier1 as CategoryTier1).children.some((c: CategoryTier2) => c.id === subId)) {
      parentTier1Id = tier1.id;
       break;
          }
    }
      }

      this.setData({
        selectedTier1Id: parentTier1Id,
        selectedTier2Id: subId,
      });

      if (this.properties.autoCommit) {
 this._emitSelect(subId);
      }
 },

    // ─── 展开面板中的子分类点击 ──

    onTapExpandedChild(e: WechatMiniprogram.TouchEvent) {
      const subId = e.currentTarget.dataset.id as string;
      if (!subId) return;
      this.setData({ selectedTier2Id: subId });

      if (this.properties.autoCommit) {
      this._emitSelect(subId);
      }
    },

    // ─── 触发选中事件 ──

    _emitSelect(subId: string) {
  const categoryData = (this as unknown as Record<string, unknown>)._categoryData as CategoryData | undefined;
      if (!categoryData) return;

      // 在所有 tier1 中找到该 sub
      const allTier1 = this._getTier1ForType(categoryData, this.data.entryType);
 let targetSub: CategoryTier2 | undefined;
      let parentName = '';
      for (const t1 of allTier1) {
        targetSub = t1.children.find((c: CategoryTier2) => c.id === subId);
  if (targetSub) { parentName = t1.name; break; }
      }
      if (!targetSub) return;

      this.triggerEvent('select', {
        id: targetSub.id,
        name: targetSub.name,
      icon: targetSub.icon,
        type: this.data.entryType,
        parentName,
      });
    },

    // ─── 关闭 ──

    onClose() {
      this.triggerEvent('close');
    },

    onScroll() {},
    onNoop() {},
  },
});
