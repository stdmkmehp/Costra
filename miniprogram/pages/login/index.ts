// pages/login/index.ts
// 登录页 · COSTRA-202 极简重做：暖灰白背景 + Wordmark + 随机格言 + 微信绿 CTA
// 设计规范：design/ui/design_spec.md §6.1 · 交互流程：design/ui/interaction_flow.md §1
// 保留业务逻辑：loginFlow / token 续签（COSTRA-102/COSTRA-118/COSTRA-125/COSTRA-127）
// 注意：wx.getUserProfile 自 2022-10 起在正式版中不弹授权弹窗，仅返回匿名信息（灰色头像/"微信用户"），
//       真实头像/昵称由用户在 pages/profile-setup 页面主动完善（open-type="chooseAvatar" + type="nickname"）。
// Refs: COSTRA-202, COSTRA-102, COSTRA-127, ADR-0004 §3 Token
import { loginFlow, hasValidSession, getToken } from '../../services/auth';
import { mapError } from '../../utils/error-mapper';
import { pickRandomSlogan } from '../../config/slogans';
import { eventBus, EventNames } from '../../services/eventBus';
import { getItem } from '../../services/storage';
import { consumeInviteToken, PENDING_INVITE_TOKEN_KEY } from '../../app';

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
      // 注意：已登录用户从邀请链接打开时，invite_token 由 app.ts bootstrap 末尾直接消费，
      //       此处无需再处理，直接跳明细页即可。
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
   *  2. POST /auth/wx-login { code } → 拿 AuthTokenPair（nickname 此时为服务端默认值"微信用户"）
   *  3. 若 storage 中有 pending invite_token → 消费（POST /families/invites/accept）
   *  4. 跳明细页；用户可在「我的」页点击头像区域进入 profile-setup 完善资料
   */
  async onTapLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, errMsg: '' });

    try {
      await loginFlow();

      // 登录成功后检测画像完善状态，触发 tabBar 红点弱引导
      const token = getToken();
      if (token && !token.raw.user.has_completed_profile) {
        eventBus.emit(EventNames.PROFILE_INCOMPLETE);
      }

      // 消费 pending invite_token（首次登录从分享链接进入的场景）
      // storage 读取确保 ensureVersion 已在 bootstrap 中执行完毕（此时 bootstrap 已完成）
      const pendingToken = await getItem<string>(PENDING_INVITE_TOKEN_KEY);
      if (pendingToken) {
        await consumeInviteToken(pendingToken);
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
