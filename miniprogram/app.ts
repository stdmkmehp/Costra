// app.ts · Costra 小程序入口
// 卡号: COSTRA-030 · 参考: https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html
// 约束: 见 .team/decisions/ADR-0004-miniapp-runtime-details.md
// COSTRA-124: onLaunch 首行加 ensureVersion() · 消除 storage.ts 模块顶层副作用的启动期时序风险
// Refs: COSTRA-124 · FU-LAUNCH-FIRST-RENDER-RACE
import { initAuth, isLoggedIn, getToken } from './services/auth';
import { getEnv } from './services/env';
import { ensureVersion } from './services/storage';
import { tokens } from './tokens/index';

interface AppGlobalData {
  env: ReturnType<typeof getEnv>;
  tokens: typeof tokens;
  bootAt: number;
}

App<{ globalData: AppGlobalData }>({
  globalData: {
    env: getEnv(),
    tokens,
    bootAt: 0
  },

  onLaunch() {
    // COSTRA-124: storage 版本校验必须在 App() 注册后首行执行
    // 原 storage.ts:29 顶层 ensureVersion() 会在 App 注册前触发 wx.getStorageSync
    // 与基础库 2.32.3+ 的 storage group prepare 未就绪冲突 → `too eayly`
    ensureVersion();

    this.globalData.bootAt = Date.now();
    console.info('[Costra] onLaunch env=', this.globalData.env.name);

    // 登录闭环（Mock 模式 · AC-2）
    // 生产下由 services/auth.ts 调用真实 POST /v1/auth/wx-login
    initAuth().then(() => {
      if (!isLoggedIn()) {
        wx.reLaunch({ url: '/pages/login/index' });
      }
    }).catch((err) => {
      console.error('[Costra] auth.init failed', err);
      wx.reLaunch({ url: '/pages/login/index' });
    });
  },

  onShow() {
    // 冷/热切后检查 token 续签；由 services/auth.ts 内部节流
    if (isLoggedIn()) {
      const token = getToken();
      if (token && token.shouldRefresh()) {
        // services/auth 负责静默续签，失败时兜底跳 login
        // COSTRA-030 Round-2 修复：原为 (token as any).refresh?.()，方法名错误且永远 undefined
        void token.refreshFn().catch((err) => {
          console.warn('[Costra] token refresh failed, fallback to login', err);
          wx.reLaunch({ url: '/pages/login/index' });
        });
      }
    }
  },

  onError(msg: string) {
    console.error('[Costra] runtime error', msg);
  }
});
