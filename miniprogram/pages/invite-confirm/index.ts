// pages/invite-confirm/index.ts · 邀请确认页
// 被邀请方打开邀请链接后进入此页，展示家庭名称和邀请人，由用户主动选择加入或拒绝。
// 进入路径：
//   1. 已登录用户从分享链接冷启动（app.ts 检测到 invite_token → reLaunch 到本页）
//   2. 未登录用户完成登录后（login.ts 检测到 pendingInviteToken → reLaunch 到本页）
// 路由参数：token=<invite_token>（由 onLaunch query 透传）
// ⚠️ 本页进入时必然已登录（两条路径均保证），onLoad 加 bootstrapPromise 兜底防止异常情形

import { previewInvite, acceptInvite } from '../../services/familyApi';
import { setActiveFamily } from '../../services/family';
import { isLoggedIn } from '../../services/auth';

interface AppWithBootstrap {
  bootstrapPromise: Promise<void>;
  globalData: { activeLedgerId?: string };
}

Page({
  data: {
    loading: true,
    expired: false,
    joining: false,
    familyName: '',
    inviterNickname: '',
  },

  _inviteToken: '' as string,

  async onLoad(query: Record<string, string>) {
    const inviteToken = query.token;

    // 等 bootstrap 完成（auth 初始化），再检查登录态
    const app = getApp<AppWithBootstrap>();
    await app.bootstrapPromise;

    if (!isLoggedIn()) {
      // 理论上不会到此处；兜底：保留 token 让 login 页消费
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }

    if (!inviteToken) {
      this.setData({ loading: false, expired: true });
      return;
    }
    this._inviteToken = inviteToken;
    await this._loadPreview(inviteToken);
  },

  async _loadPreview(token: string) {
    this.setData({ loading: true, expired: false });
    try {
      const preview = await previewInvite(token);
      this.setData({
        loading: false,
        familyName: preview.family_name,
        inviterNickname: preview.inviter_nickname,
      });
    } catch (e: unknown) {
      this.setData({ loading: false, expired: true });
    }
  },

  /** 用户点击"加入账本" */
  async onTapConfirm() {
    if (this.data.joining) return;
    this.setData({ joining: true });
    try {
      const family = await acceptInvite(this._inviteToken);
      // 更新 active family context 到刚加入的家庭
      await setActiveFamily({
        family_id: family.id,
        ledger_id: family.ledger_id,
        family_kind: family.kind,
        ledger_name: family.ledger_name,
      });
      const app = getApp<AppWithBootstrap>();
      if (app?.globalData) {
        app.globalData.activeLedgerId = family.ledger_id;
      }
      wx.showToast({ title: `已加入「${family.name}」`, icon: 'success', duration: 2000 });
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/ledger/index' });
      }, 1500);
    } catch (e: unknown) {
      const err = e as { code?: string; status?: number };
      if (err.code === 'INVITE_EXPIRED' || err.status === 410) {
        this.setData({ joining: false, expired: true, familyName: '' });
      } else {
        this.setData({ joining: false });
        wx.showToast({ title: '加入失败，请稍后重试', icon: 'none' });
      }
    }
  },

  /** 用户点击"拒绝" */
  onTapDecline() {
    wx.reLaunch({ url: '/pages/ledger/index' });
  },

  /** 关闭（邀请失效状态） */
  onTapClose() {
    wx.reLaunch({ url: '/pages/ledger/index' });
  },
});
