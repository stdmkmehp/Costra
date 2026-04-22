// app.ts · Costra 小程序入口
// 卡号: COSTRA-030 · 参考: https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html
// 约束: 见 .team/decisions/ADR-0004-miniapp-runtime-details.md
import { initAuth, isLoggedIn, getToken } from './services/auth';
import { getEnv } from './services/env';
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
        void (token as any).refresh?.();
      }
    }
  },

  onError(msg: string) {
    console.error('[Costra] runtime error', msg);
  }
});
