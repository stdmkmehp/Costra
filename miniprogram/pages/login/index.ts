// pages/login/index.ts
// 登录页 · COSTRA-202 极简重做：暖灰白背景 + Wordmark + 随机格言 + 微信绿 CTA
// 设计规范：design/ui/design_spec.md §6.1 · 交互流程：design/ui/interaction_flow.md §1
// 保留业务逻辑：loginFlow / wx.getUserProfile / token 续签（COSTRA-102/COSTRA-118/COSTRA-125/COSTRA-127）
// Refs: COSTRA-202, COSTRA-102, COSTRA-127, ADR-0004 §3 Token
import { loginFlow, hasValidSession, getToken, updateLocalUserProfile } from '../../services/auth';
import { mapError } from '../../utils/error-mapper';
import { getEnv } from '../../services/env';
import { request } from '../../services/request';
import { pickRandomSlogan } from '../../config/slogans';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
}

Page({
  data: {
    loading: false,
    errMsg: '' as string,
    slogan: '' as string,
  },

  onLoad() {
    // 随机抽取格言
    this.setData({ slogan: pickRandomSlogan() });

    // COSTRA-125: 等 bootstrap 完成（ensureVersion + initAuth）再判定登录态
    // 之前同步 hasValidSession() 在 bootstrap 未完成时永远返回 false · 误冗余渲染登录页
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      // 若已有有效会话 → 直接跳明细页（冷启动续期）
      if (hasValidSession()) {
        // COSTRA-202: reLaunch 目标改为 /pages/ledger/index（新首屏）
        // COSTRA-127: reLaunch 强制重新初始化 · 避免 switchTab 复用旧实例触发 first-rendering-data race
        wx.reLaunch({ url: '/pages/ledger/index' });
      }
      // 否则：保留在登录页 · 等用户点 onTapLogin
    });
  },

  /**
   * 用户主动点击"微信一键登录"
   * 步骤：
   *  1. wx.login → code
   *  2. POST /auth/wx-login { code } → 拿 AuthTokenPair
   *  3. 可选：wx.getUserProfile（**必须在用户点击事件同步上下文中**调用 · 失败不阻塞登录）
   *  4. 可选：PATCH /users/me { nickname, avatar_url }（失败不阻塞 · 属画像锦上添花）
   *  5. 跳明细页
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
      if (profile && getToken() && !getEnv().mockLogin) { // Mock 模式短路
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
          // COSTRA-158 §2.4: PATCH 成功后更新本地 user 子对象
          // 这样 home 页 hydrateUser 下次执行（onShow gate）时能立即看到 has_completed_profile=true
          await updateLocalUserProfile({ nickname: profile.nickname, avatar_url: profile.avatarUrl, has_completed_profile: true });
        } catch (e) {
          console.warn('[login] PATCH /users/me soft-fail', e);
        }
      }

      // COSTRA-202: reLaunch 目标改为 /pages/ledger/index（新首屏）
      // COSTRA-127: reLaunch 强制重新初始化 · 避免 switchTab 复用旧实例触发 first-rendering-data race
      wx.reLaunch({ url: '/pages/ledger/index' });
    } catch (e: any) {
      // FU-102-ERROR-MAPPER-INTEGRATION (COSTRA-157)
      // error-codes.md §0.5 红线：客户端不得直接展示 server message 给终端用户
      const mapped = mapError(e);
      this.setData({
        errMsg: mapped.title ? `${mapped.title}：${mapped.desc}` : '登录失败，请重试',
      });
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
