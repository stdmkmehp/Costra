// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-201 / COSTRA-223 · 骨架 + 导航栏账本切换
// COSTRA-223: 顶部导航栏与明细页/家庭页保持一致（居中账本名+▼切换）
import { getSafeAreaMetrics } from '../../utils/safeArea';
import {
  getActiveLedgerName,
  setActiveFamily,
} from '../../services/family';
import { getFamilies } from '../../services/familyApi';

Page({
  data: {
    statusBarHeight: 0,
    navBarHeight: 44,
    ledgerName: '我的账本',
  },

  _ledgerId: '' as string,

  onLoad() {
    const metrics = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
    });
  },

  async onShow() {
    this.getTabBar?.()?.setData?.({ selected: 1 });
    // 同步最新的 active family 名称（其他页面可能已切换）
    const name = await getActiveLedgerName();
    this.setData({ ledgerName: name });
  },

  // ─── 交互：账本切换（与明细页/家庭页一致） ───────────────────────────────────

  async onTapLedgerName() {
    try {
      const { families } = await getFamilies();
      if (!families || families.length <= 1) {
        wx.showToast({ title: '当前只有一个账本', icon: 'none' });
        return;
      }

      const items = families.map(f => {
        const suffix = f.kind === 'personal' ? '（个人）' : `（${f.member_count}人）`;
        return f.name + suffix;
      });

      wx.showActionSheet({
        itemList: items,
        success: async (res) => {
          const selected = families[res.tapIndex];
          if (selected.ledger_id === this._ledgerId) return;

          await setActiveFamily({
            family_id: selected.id,
            ledger_id: selected.ledger_id,
            family_kind: selected.kind,
            ledger_name: selected.name,
          });

          this._ledgerId = selected.ledger_id;
          this.setData({ ledgerName: selected.name });
          // 未来统计页实装后这里刷新数据
        },
      });
    } catch {
      wx.showToast({ title: '获取账本列表失败', icon: 'none' });
    }
  },
});
