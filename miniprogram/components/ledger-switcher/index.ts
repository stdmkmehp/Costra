// components/ledger-switcher/index.ts · 账本切换器
// 锚定顶部导航栏标题的下拉气泡，替代原生 wx.showActionSheet（对齐 design/ui/design_spec.md §6.2
// + family member-menu 视觉语言：暖调毛玻璃 + 顶部小三角 + 180ms 入场）。
//
// 账本名单一数据源：storage 的 active context（services/family.ts）。组件不接收 name prop，
//   attached 时用 getActiveLedgerName() 自取初值 + 订阅 ACTIVE_FAMILY_CHANGED 即时更新 displayName。
//   切换账本、重命名账本（本端或远程，经 reconcileActiveLedgerName 回流）都通过该事件驱动显示更新，
//   三页无需再各自持有 / 下传账本名，保证状态一致。
//
// 切换动作单点收敛在组件内：getFamilies → switchActiveFamily（内部自动广播 ACTIVE_FAMILY_CHANGED）
//   → syncOnce。三页保留各自已订阅的 _onActiveFamilyChanged 做数据重载。

import { getSafeAreaMetrics } from '../../utils/safeArea';
import { getFamilies, type FamilyItem } from '../../services/familyApi';
import { switchActiveFamily, getActiveLedgerId, getActiveLedgerName } from '../../services/family';
import { syncOnce } from '../../services/syncScheduler';
import { eventBus, EventNames, type ActiveFamilyChangedPayload } from '../../services/eventBus';

/** 气泡列表项（由 FamilyItem 加工） */
interface LedgerOption {
  /** family_id */
  id: string;
  ledger_id: string;
  /** 主名（优先 ledger_name，降级 family name） */
  name: string;
  /** 副标题：个人账本 / N 人协作 */
  subtitle: string;
  kind: 'personal' | 'shared';
  /** 是否为当前 active 账本（列表右侧绿勾） */
  isActive: boolean;
}

type AfcHandler = (payload?: unknown) => void;

Component({
  data: {
    /** 当前账本显示名（自 storage 取初值 + 事件更新；为空时不渲染标题与箭头） */
    displayName: '',
    open: false,
    statusBarHeight: 0,
    navBarHeight: 44,
    /** 气泡顶部定位 = statusBarHeight + navBarHeight（导航栏底沿，px） */
    navTotalPx: 0,
    families: [] as LedgerOption[],
    activeLedgerId: '',
  },

  lifetimes: {
    async attached() {
      const { statusBarHeight, navBarHeight } = getSafeAreaMetrics();
      this.setData({
        statusBarHeight,
        navBarHeight,
        navTotalPx: statusBarHeight + navBarHeight,
      });

      // 账本名初值：storage 单一数据源（异步读取，首帧接受一帧占位）
      this.setData({ displayName: await getActiveLedgerName() });

      // 订阅 active 账本变化（切换 / 改名）→ 即时更新显示名
      const handler: AfcHandler = (payload) => {
        const p = payload as ActiveFamilyChangedPayload | undefined;
        if (p) this.setData({ displayName: p.ledger_name || '' });
      };
      (this as unknown as { _afcHandler: AfcHandler })._afcHandler = handler;
      eventBus.on(EventNames.ACTIVE_FAMILY_CHANGED, handler);
    },

    detached() {
      const self = this as unknown as { _afcHandler?: AfcHandler };
      if (self._afcHandler) {
        eventBus.off(EventNames.ACTIVE_FAMILY_CHANGED, self._afcHandler);
        self._afcHandler = undefined;
      }
    },
  },

  methods: {
    /** 点击导航栏标题 → 拉列表并弹出气泡（≤1 个账本仅 toast，不弹） */
    async onTapEntry() {
      if (!this.data.displayName) return;

      let families: FamilyItem[] = [];
      try {
        const res = await getFamilies();
        families = res.families || [];
      } catch {
        wx.showToast({ title: '获取账本列表失败', icon: 'none' });
        return;
      }

      if (families.length <= 1) {
        wx.showToast({ title: '当前只有一个账本', icon: 'none' });
        return;
      }

      const activeLedgerId = (await getActiveLedgerId()) || '';
      const options: LedgerOption[] = families.map((f) => ({
        id: f.id,
        ledger_id: f.ledger_id,
        name: f.ledger_name || f.name,
        subtitle: f.kind === 'personal' ? '个人账本' : `${f.member_count} 人协作`,
        kind: f.kind,
        isActive: f.ledger_id === activeLedgerId,
      }));

      this.setData({ open: true, families: options, activeLedgerId });
    },

    /** 关闭气泡（点蒙层 / 选中后） */
    onClose() {
      if (!this.data.open) return;
      this.setData({ open: false });
    },

    /**
     * 选中某账本 → 切换 active context。
     * switchActiveFamily 内部在 family/ledger 真正变化时广播 ACTIVE_FAMILY_CHANGED，
     * 三页的 _onActiveFamilyChanged 据此重载数据；此处再补一次 syncOnce 主动拉新账本远端数据。
     */
    async onSelect(e: WechatMiniprogram.TouchEvent) {
      const index = Number((e.currentTarget.dataset as Record<string, string>).index);
      const opt = this.data.families[index];
      this.setData({ open: false });
      if (!opt || opt.ledger_id === this.data.activeLedgerId) return;

      await switchActiveFamily({
        family_id: opt.id,
        ledger_id: opt.ledger_id,
        family_kind: opt.kind,
        ledger_name: opt.name,
      }, 'ledger-switch');
      void syncOnce('ledger-switch');
    },

    /** 阻止气泡内点击穿透关闭 / 屏蔽蒙层滑动 */
    noop() {},
  },
});
