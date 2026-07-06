// pages/login/index.ts
// 登录页 · COSTRA-202 极简重做：暖灰白背景 + Wordmark + 随机格言 + 微信绿 CTA
// 方案 X（免登录墙）：登录不再是默认入口。app.ts bootstrap 已在启动时静默 wx.login 自动建会话，
//   本页仅在「静默登录失败」或「会话过期(request 401 续签失败 reLaunch)」时作为兜底页出现：
//   - onLoad 先自动尝试一次静默登录；
//   - 成功即跳首屏；失败才显示「重试登录」按钮由用户手动触发。
// 设计规范：design/ui/design_spec.md §6.1 · 交互流程：design/ui/interaction_flow.md §1
// 保留业务逻辑：loginFlow / token 续签（COSTRA-102/COSTRA-118/COSTRA-125/COSTRA-127）
// 注意：wx.getUserProfile 自 2022-10 起在正式版中不弹授权弹窗，仅返回匿名信息（灰色头像/"微信用户"），
//       真实头像/昵称由用户在 pages/profile-setup 页面主动完善（open-type="chooseAvatar" + type="nickname"）。
// Refs: COSTRA-202, COSTRA-102, COSTRA-127, ADR-0004 §3 Token
import { loginFlow, hasValidSession, getToken } from '../../services/auth';
import { mapError } from '../../utils/error-mapper';
import { pickRandomSlogan } from '../../config/slogans';
import { eventBus, EventNames } from '../../services/eventBus';
import { syncOnce } from '../../services/syncScheduler';
import { scheduleHomeDataPrefetchAfterLedgerReady } from '../../services/prefetch';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
  globalData: { pendingInviteToken?: string | null };
}

Page({
  data: {
    // 方案 X：进入本页默认即处于「自动登录中」，无一键登录按钮
    loading: true,
    // 自动登录失败 → 显示「重试登录」按钮
    failed: false,
    errMsg: '' as string,
    slogan: '' as string,
  },

  onLoad() {
    // 随机抽取格言
    this.setData({ slogan: pickRandomSlogan() });

    // COSTRA-125: 等 bootstrap 完成（ensureVersion + initAuth + 静默登录）再判定登录态
    const app = getApp<AppWithBootstrap>();
    void app.bootstrapPromise.then(() => {
      // 已有有效会话（bootstrap 已恢复/静默登录成功）→ 直接跳转，通常不会停留在本页
      if (hasValidSession()) {
        this._redirectAfterLogin();
        return;
      }
      // 方案 X：未登录时自动静默登录，无需用户点按钮（覆盖 bootstrap 静默登录失败 / 401 过期兜底路径）
      void this._runLogin();
    });
  },

  /**
   * 登录成功后的跳转：优先消费 pending invite_token（首次从分享链接进入），否则进首屏。
   * COSTRA-127: reLaunch 强制重新初始化 · 避免 switchTab 复用旧实例触发 first-rendering-data race。
   */
  _redirectAfterLogin() {
    const app = getApp<AppWithBootstrap>();
    const pendingToken = app?.globalData?.pendingInviteToken;
    if (pendingToken) {
      app.globalData.pendingInviteToken = null;  // 消费后清除，防止重复跳转
      wx.reLaunch({ url: `/pages/invite-confirm/index?token=${encodeURIComponent(pendingToken)}` });
    } else {
      // COSTRA-202: reLaunch 目标为 /pages/ledger/index（新首屏）
      wx.reLaunch({ url: '/pages/ledger/index' });
    }
  },

  /** 用户手动重试（自动登录失败后按钮触发） */
  onTapRetry() {
    if (this.data.loading) return;
    void this._runLogin();
  },

  /**
   * 静默 / 重试登录核心流程：
   *  1. loginFlow → wx.login → POST /auth/wx-login → 拿 AuthTokenPair
   *  2. 检测画像完善状态，触发 tabBar 红点弱引导
   *  3. 强制触发一次全量 sync（清数据后本地 DB 为空，必须 sync 后才能显示明细）
   *  4. 预热非首屏数据，跳转首屏 / 邀请确认页
   *  失败：不 reLaunch，停留本页显示「重试登录」按钮
   */
  async _runLogin() {
    this.setData({ loading: true, failed: false, errMsg: '' });

    try {
      await loginFlow();

      // 登录成功后检测画像完善状态，触发 tabBar 红点弱引导
      const token = getToken();
      if (token && !token.raw.user.has_completed_profile) {
        eventBus.emit(EventNames.PROFILE_INCOMPLETE);
      }

      // 登录成功后强制触发一次全量 sync（拉取服务端数据到本地）
      // 场景：清数据后重新登录，本地 DB 为空，必须 sync 后才能显示明细
      void syncOnce('launch');

      // 2026-06-09: 登录成功路径同样等 ledger 首屏完成后再预热非首屏数据，避免抢首屏资源。
      scheduleHomeDataPrefetchAfterLedgerReady('login-success');

      this._redirectAfterLogin();
    } catch (e: any) {
      // FU-102-ERROR-MAPPER-INTEGRATION (COSTRA-157)
      // error-codes.md §0.5 红线：客户端不得直接展示 server message 给终端用户
      const mapped = mapError(e);
      this.setData({
        loading: false,
        failed: true,
        errMsg: mapped.title ? `${mapped.title}：${mapped.desc}` : '登录失败，请重试',
      });
    }
  },
});
