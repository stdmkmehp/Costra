// pages/profile-setup/index.ts · 完善资料页
// 微信新规（2022-10）：wx.getUserProfile 已返回匿名信息 · 真实头像/昵称需用：
//   头像：<button open-type="chooseAvatar">
//   昵称：<input type="nickname">
// 本页提供完善资料的主动入口，PATCH /users/me 成功后更新本地 token + emit PROFILE_COMPLETED 清除红点。
import { getToken, updateLocalUserProfile } from '../../services/auth';
import { request } from '../../services/request';
import { eventBus, EventNames } from '../../services/eventBus';
import { getSafeAreaMetrics } from '../../utils/safeArea';

Page({
  data: {
    avatarUrl: '',       // 当前展示头像（用户选择前显示已有头像或占位）
    nickname: '',        // 昵称 input 绑定值
    submitting: false,
    statusBarHeight: 0,
    navBarHeight: 0,
  },

  onLoad() {
    const metrics = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
    });

    // 预填当前已有值（重复进入时不丢失已设定的信息）
    const token = getToken();
    if (token) {
      this.setData({
        avatarUrl: token.raw.user.avatar_url || '',
        nickname: token.raw.user.nickname === '微信用户' ? '' : (token.raw.user.nickname || ''),
      });
    }
  },

  /** 微信原生头像选择回调（open-type="chooseAvatar"） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChooseAvatar(e: any) {
    // e.detail.avatarUrl 由微信运行时注入 · 类型库暂无对应定义
    const avatarUrl = (e as { detail: { avatarUrl: string } }).detail.avatarUrl;
    this.setData({ avatarUrl });
  },

  /** 昵称 input 失焦回调（type="nickname"） */
  onNicknameInput(e: WechatMiniprogram.Input) {
    this.setData({ nickname: e.detail.value });
  },

  async onTapSave() {
    const { nickname, avatarUrl, submitting } = this.data;
    if (submitting) return;

    const trimmedNickname = nickname.trim();
    if (!trimmedNickname) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      await request({
        method: 'PATCH',
        path: '/users/me',
        body: {
          nickname: trimmedNickname,
          avatar_url: avatarUrl || null,
        },
        timeout: 8_000,
      });

      // 更新本地 token 中的 user 子对象 · 页面和 mine 页 onShow 都会读到新值
      await updateLocalUserProfile({
        nickname: trimmedNickname,
        avatar_url: avatarUrl || null,
        has_completed_profile: true,
      });

      // 广播"画像已完善"·  tabBar 红点 + mine 页红点同步清除
      eventBus.emit(EventNames.PROFILE_COMPLETED);

      wx.showToast({ title: '保存成功', icon: 'success', duration: 1200 });
      // 短暂延迟后返回，让 toast 有时间显示
      setTimeout(() => { wx.navigateBack(); }, 1300);
    } catch (e) {
      console.warn('[profile-setup] PATCH /users/me failed', e);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onTapBack() {
    wx.navigateBack();
  },
});
