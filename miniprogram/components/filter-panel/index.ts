// components/filter-panel/index.ts · 明细页筛选面板
// 浮出式面板：支持费用性质（全部/个人/公共）+ 成员多选筛选

export interface FilterMember {
  user_id: string;
  nickname: string;
  avatar_url: string;
  initial: string;
  selected: boolean;
}

export type ExpenseTypeFilter = 'all' | 'personal' | 'shared';

export interface FilterState {
  expenseType: ExpenseTypeFilter;
  selectedMemberIds: string[];
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
    /** 费用性质筛选 */
    expenseType: {
      type: String,
      value: 'all' as ExpenseTypeFilter,
    },
  },

  data: {
    isAllSelected: true,
  },

  observers: {
    'members.**'() {
      this._computeAllSelected();
    },
  },

  methods: {
    /** 点击蒙层 → 关闭面板（自动保存） */
    onTapMask() {
      this._closeAndSave();
    },

    /** 费用性质切换 */
    onTapExpenseType(e: WechatMiniprogram.TouchEvent) {
      const type = (e.currentTarget.dataset as Record<string, string>).type as ExpenseTypeFilter;
      if (type === this.properties.expenseType) return;
      this.triggerEvent('expenseTypeChange', { expenseType: type });
    },

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

    /** 阻止穿透 */
    noop() {},
  },
});
