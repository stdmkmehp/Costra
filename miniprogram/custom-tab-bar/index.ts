// custom-tab-bar/index.ts · 5 Tab 中置式自定义 TabBar
// 卡号: COSTRA-201 / COSTRA-210 · 中间 [+] 按钮通过 eventBus 触发记账覆盖层（不跳路由） + 切Tab防御性关闭
// COSTRA-205: 覆盖层显隐时同步隐藏/显示 TabBar（解决键盘底部被遮挡）
// 设计源: design/ui/design_spec.md §3 + design/ui/interaction_flow.md §2
// 微信文档: https://developers.weixin.qq.com/miniprogram/dev/framework/ability/custom-tabbar.html
//
// hidden 状态机（2026-06-05 重构）：
//   tabbar 是 hidden 真相源，外部不再直接 setData({hidden})。
//   内部根据两个独立维度合成：
//     _unlocked：页面 onShow 中 markUnlocked() 解锁，单向不可逆（防冷启动闪烁）
//     _panelOpen：是否有任何全屏面板打开，由 HIDE_TAB_BAR/SHOW_TAB_BAR 事件维护
//   hidden = !_unlocked || _panelOpen
//
//   优势：
//   1. 解决退后台再前台时 page.onShow 与面板状态的 race（page.onShow 不再直接覆盖 hidden）
//   2. tabbar 进后台不 detach，_panelOpen 在前后台切换时保留，无需 page 重新校正
//   3. family/ledger 等 page.onShow 不再需要重复实现"是否有面板打开"的判断逻辑

import { eventBus, EventNames } from '../services/eventBus';
import { getItem, setItem } from '../services/storage';
import { getToken, hasValidSession } from '../services/auth';
import { getSafeAreaMetrics } from '../utils/safeArea';

/** App 实例携带 bootstrap 就绪 Promise（与各 Tab 页 onShow gate 同源） */
interface AppWithBootstrap { bootstrapPromise: Promise<void> }

/** 取当前栈顶页面路由，用于把本 tabbar 实例映射回其所属 Tab（attach 自解锁用）。 */
function getCurrentPageRoute(): string {
  try {
    const pages = getCurrentPages();
    return pages.length > 0 ? pages[pages.length - 1].route || '' : '';
  } catch {
    return '';
  }
}

/** Tab 路由映射 · index 2 是 [+] 不走路由 */
const TAB_ROUTES: Record<number, string> = {
  0: '/pages/ledger/index',
  1: '/pages/statistics/index',
  // 2: 记账按钮 · 不跳路由 · 通过 eventBus 显示覆盖层
  3: '/pages/family/index',
  4: '/pages/mine/index',
};

/**
 * storage key：用户是否已点击过「我的」tab。
 * 只要点过一次，本次及后续启动都不再显示 tabBar 红点（与资料是否填写解绑）。
 */
const MINE_TAB_VISITED_KEY = '__costra_mine_tab_visited';

Component({
  data: {
    /** 当前选中 index（0-4）· index 2 是 [+] 不会被 selected */
    selected: 0,
    /**
     * 是否隐藏 TabBar（由内部 _unlocked + _panelOpen 合成 · 外部不应直接 setData）
     * 初始 true：冷启动时 _unlocked=false 即 hidden=true，防止未登录用户闪烁 tabBar 后再跳登录页。
     */
    hidden: true,
    /**
     * 「我的」tab 红点：
     * - 显示：has_completed_profile=false 且用户尚未点过 mine tab
     * - 消除：点击「我的」tab 即刻消失 + 写 storage，与资料是否真正填写无关
     */
    showProfileBadge: false,
    /**
     * 过渡开关（2026-07-02 引入 · 2026-07-03 解耦）：控制 .tab-bar--animatable 是否挂载。
     * 初始 false：挂载 + 首次揭示(hidden true→false) 全程无 transition → 瞬时到位，
     * 避免每个 Tab 页首次进入时 tabbar「从底部滑上来」的闪烁。
     * 由 markActive 揭示后经 _ensureAnimatable() 在下一时间片幂等开启，此后常驻供滑动动画使用。
     * 注意：绝不能把 hidden 的写入塞进开启 animatable 的 setData 回调里（后台实例回调会滞留、
     * 携带过期值覆盖 hidden 导致 tabbar 消失）——animatable 与 hidden 写入必须解耦。
     */
    animatable: false,
    /** 底部视觉安全区（px）：系统安全区 + 无安全区设备的最小呼吸空间 */
    visualSafeAreaBottom: 0,
  },

  lifetimes: {
    attached() {
      this._refreshSafeAreaBottom();

      // 初始化实例状态（Component 不支持顶层声明实例属性，挂在 this 上）
      const self = this as unknown as Record<string, unknown>;
      const resizeHandler = () => { this._refreshSafeAreaBottom(true); };
      self._windowResizeHandler = resizeHandler;
      try { wx.onWindowResize(resizeHandler); } catch { /* noop */ }
      self._unlocked = false;
      self._panelOpen = false;

      // 隐藏 TabBar：记账覆盖层 SHOW + 任何全屏面板 HIDE_TAB_BAR
      const hideHandler = () => {
        (this as unknown as Record<string, unknown>)._panelOpen = true;
        this._applyHidden();
      };
      (this as unknown as Record<string, unknown>)._hideHandler = hideHandler;
      eventBus.on(EventNames.SHOW_EXPENSE_OVERLAY, hideHandler);
      eventBus.on(EventNames.HIDE_TAB_BAR, hideHandler);

      // 恢复 TabBar：覆盖层 HIDE + 全屏面板 SHOW_TAB_BAR
      const showHandler = () => {
        (this as unknown as Record<string, unknown>)._panelOpen = false;
        this._applyHidden();
      };
      (this as unknown as Record<string, unknown>)._showHandler = showHandler;
      eventBus.on(EventNames.HIDE_EXPENSE_OVERLAY, showHandler);
      eventBus.on(EventNames.SHOW_TAB_BAR, showHandler);

      // 订阅 PROFILE_INCOMPLETE 事件（覆盖冷启动已登录 / 登录成功后的 emit）
      const badgeOnHandler = () => { this._tryShowBadge(); };
      (this as unknown as Record<string, unknown>)._badgeOnHandler = badgeOnHandler;
      eventBus.on(EventNames.PROFILE_INCOMPLETE, badgeOnHandler);

      // 主动检测一次：应对 tabBar attach 晚于 emit 的时序竞争
      // 场景：冷启动 bootstrap 极快，emit 发出时 tabBar 尚未 attach，事件被错过
      this._tryShowBadge();

      // 反 attach/onShow 竞争（2026-07-02）：tab-bar 可能晚于所属页 onShow 才 attach，
      // 此时页面 `getTabBar()?.markActive()` 因 getTabBar() 返回 null 而静默落空，
      // 导致 tab-bar 永久停留在初始 hidden=true → tabbar 消失（真机已复现）。
      // 修复：由 tab-bar 自身在 attach 后完成解锁，不再依赖 getTabBar() 时序。
      //   - 沿用与页面相同的门槛（等 bootstrap 就绪 + 校验会话），避免未登录冷启动闪 tabbar 后跳登录；
      //   - this 即已 attach 的本实例，markActive 必定生效；
      //   - animatable 此刻仍为 false → 无 transition → 直接就位，无「从底部滑上来」闪烁；
      //   - 页面 onShow 里的 markActive 退化为幂等的二次校正（hidden 已 false 时不改动）。
      const route = getCurrentPageRoute();
      const selfIdx = Object.keys(TAB_ROUTES)
        .map(Number)
        .find((i) => TAB_ROUTES[i] === `/${route}`);
      if (selfIdx !== undefined) {
        void getApp<AppWithBootstrap>().bootstrapPromise.then(() => {
          if (!hasValidSession()) return; // 未登录：交由页面 reLaunch 到 login，不揭示 tabbar
          this.markActive(selfIdx);
        });
      }
    },

    detached() {
      const hideHandler = (this as unknown as Record<string, unknown>)._hideHandler as (() => void) | undefined;
      if (hideHandler) {
        eventBus.off(EventNames.SHOW_EXPENSE_OVERLAY, hideHandler);
        eventBus.off(EventNames.HIDE_TAB_BAR, hideHandler);
      }
      const showHandler = (this as unknown as Record<string, unknown>)._showHandler as (() => void) | undefined;
      if (showHandler) {
        eventBus.off(EventNames.HIDE_EXPENSE_OVERLAY, showHandler);
        eventBus.off(EventNames.SHOW_TAB_BAR, showHandler);
      }
      const badgeOnHandler = (this as unknown as Record<string, unknown>)._badgeOnHandler as (() => void) | undefined;
      if (badgeOnHandler) {
        eventBus.off(EventNames.PROFILE_INCOMPLETE, badgeOnHandler);
      }
      const resizeHandler = (this as unknown as Record<string, unknown>)._windowResizeHandler as (() => void) | undefined;
      if (resizeHandler) {
        try { wx.offWindowResize(resizeHandler); } catch { /* noop */ }
      }
    },
  },

  methods: {
    _refreshSafeAreaBottom(force = false) {
      const { visualSafeAreaBottom } = getSafeAreaMetrics({ force });
      this.setData({ visualSafeAreaBottom });
    },

    /**
     * 尝试显示红点：需同时满足
     *   1. 当前 token 的 has_completed_profile=false
     *   2. 用户尚未点击过 mine tab（storage 无已访问标记）
     */
    _tryShowBadge() {
      const token = getToken();
      if (!token || token.raw.user.has_completed_profile) return;
      void getItem<boolean>(MINE_TAB_VISITED_KEY).then((visited) => {
        if (!visited) {
          this.setData({ showProfileBadge: true });
        }
      });
    },

    /**
     * 切换 Tab · index 2 特殊处理为 emit 事件
     * 交互规范: interaction_flow.md §2 — "不发生页面路由跳转"
     */
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);

      if (index === 2) {
        // 中间 [+] 按钮 · 触发记账覆盖层
        eventBus.emit(EventNames.SHOW_EXPENSE_OVERLAY);
        return;
      }

      // 点击「我的」tab：立即消红点 + 持久化已访问标记（与资料是否填写解绑）
      if (index === 4 && this.data.showProfileBadge) {
        this.setData({ showProfileBadge: false });
        void setItem(MINE_TAB_VISITED_KEY, true);
      }

      // COSTRA-210 方案 C：普通 Tab 切换前防御性 emit HIDE
      // 根因：overlay 多实例 + SHOW 广播，切 Tab 时后台实例可能 visible=true 残留。
      // 在 wx.switchTab 前广播 HIDE，确保所有 overlay 实例同步关闭。
      eventBus.emit(EventNames.HIDE_EXPENSE_OVERLAY);

      const url = TAB_ROUTES[index];
      if (url) {
        wx.switchTab({ url });
      }
    },

    /**
     * 各 Tab 页 onShow 调用：仅传 selected，不再传 hidden（hidden 由 tabbar 内部计算）。
     * 调用此方法即视为"页面就绪"，会单向解锁 _unlocked。
     */
    markActive(idx: number) {
      (this as unknown as Record<string, unknown>)._unlocked = true;
      this.setData({ selected: idx });

      // 揭示路径绝不与 animatable 同帧：首次进入时 hidden(true→false) 必须瞬时（无 transition），
      // 否则会被动画成「从底部滑上来」。hidden 统一由 _applyHidden 现算写入。
      this._applyHidden();

      // 揭示绘制完成后再开启过渡开关（此时 hidden 已就位，开启 transition 不产生位移），
      // 供后续面板开合的滑动动画使用。
      //
      // 关键修复（tabbar 必现消失 · 2026-07-03）：
      //   animatable 的开启从 _applyHidden 移到这里，与 hidden 写入彻底解耦。
      //   原实现里 _applyHidden 用 `setData({animatable:true}, applyHiddenCallback)`
      //   把 hidden 写入塞进了 animatable 的**渲染回调**，且回调闭包捕获了当时的 nextHidden 快照。
      //   后台 tab 页的 tabbar 实例（webview 渲染被冻结）会让该回调长期滞留，
      //   携带过期的 nextHidden=true，在页面切回前台、渲染恢复时才冲刷落地，
      //   覆盖 markActive 刚写好的 hidden=false → tabbar 消失。
      //   解耦后 _applyHidden 立即、现算地写 hidden，杜绝滞留回调覆盖。
      this._ensureAnimatable();
    },

    /**
     * 揭示后开启过渡开关（幂等）。放在下一时间片，确保 hidden 已就位再挂 transition，
     * 避免揭示帧被动画化；面板真正开合时 animatable 早已为 true，滑动动画可靠。
     */
    _ensureAnimatable() {
      if (this.data.animatable) return;
      wx.nextTick(() => {
        if (!this.data.animatable) {
          this.setData({ animatable: true });
        }
      });
    },

    /**
     * 内部：根据**当前最新**的 _unlocked + _panelOpen 立即应用 hidden。
     * 每次调用都现算 nextHidden，绝不缓存/延迟——这是唯一的 hidden 收口，
     * 保证无论调用时机如何，hidden 永远反映真相源的最新状态，不会被过期值覆盖。
     */
    _applyHidden() {
      const self = this as unknown as Record<string, unknown>;
      const nextHidden = !(self._unlocked as boolean) || (self._panelOpen as boolean);
      if (this.data.hidden !== nextHidden) {
        this.setData({ hidden: nextHidden });
      }
    },
  },
});
