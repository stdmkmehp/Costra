// app.ts · Costra 小程序入口
// 卡号: COSTRA-030 · 参考: https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html
// 约束: 见 .team/decisions/ADR-0004-miniapp-runtime-details.md
// COSTRA-124: onLaunch 首行加 ensureVersion() · 消除 storage.ts 模块顶层副作用的启动期时序风险（R1 部分闭合）
// COSTRA-125: bootstrap Promise 统一门控（B'+E' 合并版）· async storage 全量化 · onLaunch 内串行 ensureVersion → initAuth
// COSTRA-901: onLaunch 注册 wx.onNeedPrivacyAuthorization · 隐私授权弹窗 + 拒绝后只读演示
// Refs:
//   - FU-LAUNCH-FIRST-RENDER-RACE-A（COSTRA-124 已 close · 顶层副作用消除）
//   - FU-LAUNCH-FIRST-RENDER-RACE-B（COSTRA-125 本卡 close · 渲染层 storage group `_prepare` 未就绪）
//   - .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §2.2 / §3 (d)
//   - docs/devops/libversion-upgrade.md §3.4（反模式 #4）
import { initAuth, isLoggedIn, getToken } from './services/auth';
import { getEnv } from './services/env';
import { ensureVersion } from './services/storage';
import { startScheduler, stopScheduler, syncOnce } from './services/syncScheduler';
import { tokens } from './tokens/index';
import { eventBus, EventNames } from './services/eventBus';
import { flushPendingPreference, getActiveFamilyId } from './services/family';
import { prefetchCategories } from './services/categoryService';
import { scheduleHomeDataPrefetchAfterLedgerReady } from './services/prefetch';
import { captureNetworkType, markPerf, resetPerfSession, setPerfContext } from './services/perf';
import { logger } from './utils/logger';

interface AppGlobalData {
  env: ReturnType<typeof getEnv>;
  tokens: typeof tokens;
  bootAt: number;
  // COSTRA-105 R1.x.1 BUG-001: COSTRA-155 实装真账本切换时填充 · 目前 fallback 到 FALLBACK_LEDGER_ID
  activeLedgerId?: string;
  /**
   * 从分享邀请链接启动时，onLaunch query 中的 token。
   * 落地页为 /pages/invite-confirm/index?token=xxx，直接由落地页 onLoad 消费。
   * 存于 globalData 仅为未登录路径备用：bootstrap 检测到未登录 → reLaunch 到 login，
   * login 登录成功后读取此值并跳转到 invite-confirm 页面，消费后置 null。
   */
  pendingInviteToken?: string | null;
  /**
   * 跨页面挂起动作：mine 页点击"创建协作账本"后写入，switchTab 到 family 页后由 onShow 消费。
   * 消费后须置 null，防止后续 onShow 重复触发。
   */
  pendingFamilyAction?: 'create' | null;
  /**
   * 协作页 L1 点击后写入，switchTab 到统计页后由 onShow 消费（COSTRA-302 写入 · COSTRA-303 消费）。
   * 消费后须置 null，防止后续 onShow 重复触发。
   */
  pendingStatisticsAction?: {
    memberKey: string;
    dimension: 'monthly' | 'yearly';
    month?: string;
    year?: string;
    expandL1Id?: string;
  } | null;
  /**
   * COSTRA-901: 用户隐私授权状态。
   * - 'granted'：已授权，正常使用全部功能。
   * - 'denied'：已拒绝，降级为只读演示模式（不写入服务器、不采集任何信息）。
   * - undefined：尚未决策（首次启动 · 等待 wx.onNeedPrivacyAuthorization 触发）。
   */
  privacyAuthorized?: 'granted' | 'denied';
}

/**
 * COSTRA-125: App 类型扩展 `bootstrapPromise: Promise<void>`
 * - 用作"启动期 bootstrap 是否完成"的统一门控信号
 * - Page.onLoad 中需要登录态/storage 的页面：必须 `await getApp().bootstrapPromise`
 * - 业务调 storage 时机的统一对账锚点（参见 storage.ts 不变量 #4）
 */
interface AppOption {
  globalData: AppGlobalData;
  bootstrapPromise: Promise<void>;
  onLaunch(options: WechatMiniprogram.App.LaunchShowOption): void;
  onShow(): void;
  onHide(): void;
  onError(msg: string): void;
}

App<AppOption>({
  globalData: {
    env: getEnv(),
    tokens,
    bootAt: 0
  },

  // COSTRA-125: 占位 · onLaunch 内会被覆盖为真实 bootstrap Promise
  bootstrapPromise: Promise.resolve(),

  onLaunch(options: WechatMiniprogram.App.LaunchShowOption) {
    this.globalData.bootAt = Date.now();
    resetPerfSession(this.globalData.bootAt);
    setPerfContext({ appEnv: this.globalData.env.name, launch: 'cold' });
    captureNetworkType();
    logger.info('Costra', 'onLaunch', { env: this.globalData.env.name });

    // COSTRA-901: 隐私授权回调不在此处全局注册。
    // chooseAvatar/nickname 仅在 profile-setup 页面使用，弹窗由该页面的 privacy-popup 组件自行处理。
    // 此 globalData.privacyAuthorized 由组件内 getApp() 更新，供其他模块读取降级判断。

    // 分享邀请链接携带的 invite token：存入 globalData 供登录流程消费
    // 落地页为 /pages/invite-confirm/index?token=xxx，query key 为 'token'
    // ⚠️ 不存 storage：ensureVersion() 可能 clearStorage，导致 token 丢失
    // globalData 与小程序实例同生命周期，不受 storage 版本清除影响
    const inviteToken = options?.query?.token as string | undefined;
    if (inviteToken) {
      logger.info('Costra', 'onLaunch invite_token detected');
      this.globalData.pendingInviteToken = inviteToken;
    }

    // COSTRA-125: 串行 bootstrap 两阶段都是 async storage
    //   阶段 1 · ensureVersion()  → 走 wx.getStorage Promise 形态 · SDK 内部等渲染层 _prepare 就绪
    //   阶段 2 · initAuth()       → 内部 await getItem(TOKEN_KEY) · 必在阶段 1 之后
    //   末尾若无登录态 → wx.reLaunch 跳 login（保持原 R1 行为）
    this.bootstrapPromise = (async () => {
      markPerf('app.bootstrap.start');
      markPerf('app.ensure-version.start');
      await ensureVersion();
      markPerf('app.ensure-version.done');
      markPerf('app.init-auth.start');
      await initAuth();
      markPerf('app.init-auth.done');
      // 启动期兜底 · entry page 渲染前先定登录态（与 Page.onLoad/onShow gate 形成多层保险）
      const loggedIn = isLoggedIn();
      setPerfContext({ session: loggedIn ? 'logged-in' : 'guest' });
      if (!loggedIn) {
        markPerf('app.bootstrap.done', { session: 'guest' });
        try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* 单测 / 非 wx 环境 noop */ }
        return;
      }
      // 登录态已就绪：补偿上次未保存成功的 active ledger preference
      void flushPendingPreference();

      // 登录态已就绪：检测画像完善状态，驱动 tabBar 红点弱引导
      const token = getToken();
      if (token && !token.raw.user.has_completed_profile) {
        eventBus.emit(EventNames.PROFILE_INCOMPLETE);
      }

      // 2026-06-05: 分类数据预热（fire-and-forget · 不阻塞 bootstrap）
      // 命中 storage 缓存秒级回写内存；无缓存则后台拉一次 API；全部失败用 fallback。
      // 后续打开记账面板/分类编辑面板走 loadCategoriesSync 同步路径直接命中内存缓存，弱网 0 等待。
      void getActiveFamilyId().then((fid) => {
        if (fid) void prefetchCategories(fid);
      });

      // 2026-06-09: 统计/协作页数据预热改为 ledger 首屏完成后触发。
      // 原先 bootstrap 后立即预热可能与首屏 storage/渲染/同步竞争；M1 将其挂到 LEDGER_DISPLAY_READY。
      scheduleHomeDataPrefetchAfterLedgerReady('app-bootstrap');

      markPerf('app.bootstrap.done', { session: 'logged-in' });

      // 已登录用户从邀请链接冷启动/热切换：检测 pendingInviteToken 并跳转到邀请确认页
      // 微信小程序冷启动时先渲染 pages[0]（ledger/index），bootstrap 异步完成期间落地页自动导航
      // 可能被阻断，因此这里必须主动 reLaunch，确保邀请流程不丢失。
      if (this.globalData.pendingInviteToken) {
        const pendingToken = this.globalData.pendingInviteToken;
        this.globalData.pendingInviteToken = null;
        try {
          wx.reLaunch({ url: `/pages/invite-confirm/index?token=${encodeURIComponent(pendingToken)}` });
        } catch { /* 单测 / 非 wx 环境 noop */ }
        return;
      }
    })().catch((err) => {
      markPerf('app.bootstrap.failed', { error: err instanceof Error ? err.message : String(err) });
      logger.error('Costra', 'bootstrap failed', err);
      try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
    });

    // COSTRA-150: 启动同步调度器（4 触发源 + mutex + debounce）
    // 增强：传入 bootstrapPromise · launch sync 在 bootstrap 完成后立即触发，
    //   消除原 setTimeout(500ms) 时序竞争，加速首屏新数据到达
    startScheduler(this.bootstrapPromise);
  },

  onShow() {
    // COSTRA-125: 等 bootstrap 完成才检查续签 · 避免与 onLaunch 路径并发触发 storage 调用
    void this.bootstrapPromise.then(() => {
      if (isLoggedIn()) {
        void flushPendingPreference();
        const token = getToken();
        if (token && token.shouldRefresh()) {
          // services/auth 负责静默续签，失败时兜底跳 login
          // COSTRA-030 Round-2 修复：原为 (token as any).refresh?.()，方法名错误且永远 undefined
          void token.refreshFn().catch((err) => {
            logger.warn('Costra', 'token refresh failed, fallback to login', err);
            try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
          });
        }
      }
    });
  },

  onHide() {
    // 关闭/切后台时主动推送一次本地未同步数据 · 保证离开前数据尽量上行
    // 注：小程序 onHide 后仍有短暂可执行时间窗口（iOS ~5s / Android ~10s），
    //   syncOnce 内部是 push 先于 pull，最关键的 pushDelta 通常 < 1s 可完成
    void syncOnce('hide');
    // COSTRA-150: 后台阶段停止周期调度，避免无意义轮询
    stopScheduler();
  },

  onError(msg: string) {
    logger.error('Costra', 'App.onError', msg);
  },
});
