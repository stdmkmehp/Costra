// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-201 / COSTRA-223 · 骨架 + 导航栏账本切换
// COSTRA-223: 顶部导航栏与明细页/家庭页保持一致（居中账本名+▼切换）
import { getSafeAreaMetrics } from '../../utils/safeArea';
import {
  getActiveLedgerName,
  setActiveFamily,
} from '../../services/family';
import { getFamilies } from '../../services/familyApi';
import { triggerOnPageShow, syncOnce } from '../../services/syncScheduler';
import { eventBus, EventNames, type SyncDonePayload } from '../../services/eventBus';

Page({
  data: {
    statusBarHeight: 0,
    navBarHeight: 44,
    ledgerName: '我的账本',
  },

  _ledgerId: '' as string,
  /** eventBus 订阅 handler（sync-refresh: SYNC_DONE 桩 · 防内存泄漏） */
  _syncDoneHandler: null as ((payload?: unknown) => void) | null,

  onLoad() {
    const metrics = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
    });

    // sync-refresh: 订阅 SYNC_DONE 预留桩
    // 当前统计页是骨架页面，无真实聚合数据；待统计图表实装后，
    // 在此 handler 内补 _loadStatistics(this._ledgerId, currentMonth) 即可
    const syncDoneHandler = (payload?: unknown) => {
      const p = payload as SyncDonePayload | undefined;
      if (!p) return;
      // 骨架阶段 · 仅留日志便于联调；TODO: 统计页实装后改为重拉聚合接口
      console.log(`[statistics] SYNC_DONE pulled=${p.pulled} pushed=${p.pushed} trigger=${p.trigger} (page is skeleton, no-op)`);
    };
    this._syncDoneHandler = syncDoneHandler;
    eventBus.on(EventNames.SYNC_DONE, syncDoneHandler);
  },

  async onShow() {
    this.getTabBar?.()?.setData?.({ selected: 1 });
    // 同步最新的 active family 名称（其他页面可能已切换）
    const name = await getActiveLedgerName();
    this.setData({ ledgerName: name });
    triggerOnPageShow('statistics');
  },

  onUnload() {
    // sync-refresh: 取消订阅 SYNC_DONE 事件（防内存泄漏）
    if (this._syncDoneHandler) {
      eventBus.off(EventNames.SYNC_DONE, this._syncDoneHandler);
      this._syncDoneHandler = null;
    }
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
          // 切换账本后主动拉取新账本数据
          void syncOnce('ledger-switch');
          // 未来统计页实装后这里刷新数据
        },
      });
    } catch {
      wx.showToast({ title: '获取账本列表失败', icon: 'none' });
    }
  },
});
