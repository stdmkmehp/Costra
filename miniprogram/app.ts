// app.ts · Costra 小程序入口
// 卡号: COSTRA-030 · 参考: https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html
// 约束: 见 .team/decisions/ADR-0004-miniapp-runtime-details.md
// COSTRA-124: onLaunch 首行加 ensureVersion() · 消除 storage.ts 模块顶层副作用的启动期时序风险（R1 部分闭合）
// COSTRA-125: bootstrap Promise 统一门控（B'+E' 合并版）· async storage 全量化 · onLaunch 内串行 ensureVersion → initAuth
// Refs:
//   - FU-LAUNCH-FIRST-RENDER-RACE-A（COSTRA-124 已 close · 顶层副作用消除）
//   - FU-LAUNCH-FIRST-RENDER-RACE-B（COSTRA-125 本卡 close · 渲染层 storage group `_prepare` 未就绪）
//   - .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §2.2 / §3 (d)
//   - docs/devops/libversion-upgrade.md §3.4（反模式 #4）
import { initAuth, isLoggedIn, getToken } from './services/auth';
import { getEnv } from './services/env';
import { ensureVersion } from './services/storage';
import { startScheduler, stopScheduler } from './services/syncScheduler';
import { tokens } from './tokens/index';

interface AppGlobalData {
  env: ReturnType<typeof getEnv>;
  tokens: typeof tokens;
  bootAt: number;
  // COSTRA-105 R1.x.1 BUG-001: COSTRA-155 实装真账本切换时填充 · 目前 fallback 到 FALLBACK_LEDGER_ID
  activeLedgerId?: string;
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
  onLaunch(): void;
  onShow(): void;
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

  onLaunch() {
    this.globalData.bootAt = Date.now();
    console.info('[Costra] onLaunch env=', this.globalData.env.name);

    // COSTRA-125: 串行 bootstrap 两阶段都是 async storage
    //   阶段 1 · ensureVersion()  → 走 wx.getStorage Promise 形态 · SDK 内部等渲染层 _prepare 就绪
    //   阶段 2 · initAuth()       → 内部 await getItem(TOKEN_KEY) · 必在阶段 1 之后
    //   末尾若无登录态 → wx.reLaunch 跳 login（保持原 R1 行为）
    this.bootstrapPromise = (async () => {
      await ensureVersion();
      await initAuth();
      // 启动期兜底 · entry page 渲染前先定登录态（与 Page.onLoad/onShow gate 形成多层保险）
      if (!isLoggedIn()) {
        try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* 单测 / 非 wx 环境 noop */ }
      }
    })().catch((err) => {
      console.error('[Costra] bootstrap failed', err);
      try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
    });

    // COSTRA-150: 启动同步调度器（4 触发源 + mutex + debounce）
    // 放在 bootstrapPromise 之后 · 不破异步等待链
    startScheduler();
  },

  onShow() {
    // COSTRA-125: 等 bootstrap 完成才检查续签 · 避免与 onLaunch 路径并发触发 storage 调用
    void this.bootstrapPromise.then(() => {
      if (isLoggedIn()) {
        const token = getToken();
        if (token && token.shouldRefresh()) {
          // services/auth 负责静默续签，失败时兜底跳 login
          // COSTRA-030 Round-2 修复：原为 (token as any).refresh?.()，方法名错误且永远 undefined
          void token.refreshFn().catch((err) => {
            console.warn('[Costra] token refresh failed, fallback to login', err);
            try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
          });
        }
      }
    });
  },

  onHide() {
    // COSTRA-150: 停止周期 timer · 切后台不跑 periodic sync
    stopScheduler();
  },

  onError(msg: string) {
    console.error('[Costra] runtime error', msg);
  }
});
