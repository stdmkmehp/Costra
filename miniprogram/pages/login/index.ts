// pages/login/index.ts
// 登录页：启动即检查续期；用户点按 → wx.login → POST /auth/wx-login → 可选 getUserProfile PATCH /users/me → 跳首页
// 卡号: COSTRA-102 · 承接 COSTRA-118 E.P0-10-partA（去 getUserInfo）
// COSTRA-125: onLoad 加 bootstrapPromise gate · 等 app.ts 串行 ensureVersion+initAuth 完成后再判定登录态
// COSTRA-127: switchTab → reLaunch · 避免冷启动复用 home 旧实例触发 first-rendering-data race · 见 docs/devops/libversion-upgrade.md §3.6 反模式 #6
// Refs: COSTRA-030, ADR-0004 §3 Token, Design flows/login.md · .team/dispatch/COSTRA-125-miniapp-storage-async-migration.md §3 (e)
import { loginFlow, hasValidSession, getToken } from '../../services/auth';
import { request } from '../../services/request';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

Page({
  data: {
    loading: false,
    errMsg: '' as string,
  },

  onLoad() {
    // COSTRA-125: 等 bootstrap 完成（ensureVersion + initAuth）再判定登录态
    // 之前同步 hasValidSession() 在 bootstrap 未完成时永远返回 false · 误冗余渲染登录页
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      // 若已有有效会话 → 直接跳首页（冷启动续期）
      if (hasValidSession()) {
        // COSTRA-127: reLaunch 强制重新初始化 home · 避免 switchTab 复用旧实例触发 first-rendering-data race
        wx.reLaunch({ url: '/pages/home/index' });
      }
      // 否则：保留在登录页 · 等用户点 onTapLogin
    });
  },

  /**
   * 用户主动点击"一键微信登录"
   * 步骤：
   *  1. wx.login → code
   *  2. POST /auth/wx-login { code } → 拿 AuthTokenPair
   *  3. 可选：wx.getUserProfile（**必须在用户点击事件同步上下文中**调用 · 失败不阻塞登录）
   *  4. 可选：PATCH /users/me { nickname, avatar_url }（失败不阻塞 · 属画像锦上添花）
   *  5. 跳首页
   */
  async onTapLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, errMsg: '' });

    // Step 1+2: 先拉 profile（同步点击上下文 · getUserProfile 2.x 基础库要求），再 login
    //   注：业务上先 login 更自然 · 但 wx.getUserProfile 必须在 bindtap 的同步调用栈中触发弹窗，
    //   一旦 await loginFlow 让出事件循环再回来调 getUserProfile 会报
    //   "can only be invoked by user TAP gesture"（微信 2.10.4+ 限制）。
    //   因此：**先 getUserProfile（失败容错）· 再 login · 再 patch**。
    let profile: { nickname: string; avatarUrl: string } | null = null;
    try {
      const res = await wxGetUserProfileAsync('用于展示你的昵称头像');
      profile = {
        nickname: res.userInfo.nickName,
        avatarUrl: res.userInfo.avatarUrl,
      };
    } catch {
      // 用户拒绝 / 环境不支持 → 不阻塞登录（画像由服务端兜底）
      profile = null;
    }

    try {
      await loginFlow();

      // Step 4: 可选画像同步（失败不阻塞）
      if (profile && getToken()) {
        try {
          await request({
            method: 'PATCH',
            path: '/users/me',
            body: {
              nickname: profile.nickname,
              avatar_url: profile.avatarUrl,
            },
            timeout: 5_000,
          });
        } catch (e) {
          console.warn('[login] PATCH /users/me soft-fail', e);
        }
      }

      // COSTRA-127: reLaunch 强制重新初始化 home · 避免 switchTab 复用旧实例触发 first-rendering-data race
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (e: any) {
      // 错误分型：服务端 401 / 网络错 / 其他
      let msg = '登录失败，请重试';
      if (e?.code === 'CLIENT_NETWORK_ERROR') {
        msg = '网络异常';
      } else if (e?.status === 401) {
        msg = '登录失败，请重试';
      } else if (e?.message) {
        msg = e.message;
      }
      this.setData({ errMsg: msg });
    } finally {
      this.setData({ loading: false });
    }
  },
});

function wxGetUserProfileAsync(desc: string): Promise<WechatMiniprogram.GetUserProfileSuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    wx.getUserProfile({
      desc,
      success: resolve,
      fail: reject,
    });
  });
}
