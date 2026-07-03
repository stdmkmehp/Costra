// components/filter-panel/index.ts · 明细页筛选面板
// 浮出式面板：支持流水类型（全部/个人支出/公共支出/收入/转移）+ 成员多选筛选

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

export interface FilterState {
  entryType: EntryTypeFilter;
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
    /** 流水类型筛选 */
    entryType: {
      type: String,
      value: 'all' as EntryTypeFilter,
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

    /** 流水类型切换 */
    onTapEntryType(e: WechatMiniprogram.TouchEvent) {
      const type = (e.currentTarget.dataset as Record<string, string>).type as EntryTypeFilter;
      if (type === this.properties.entryType) return;
      this.triggerEvent('entryTypeChange', { entryType: type });
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
