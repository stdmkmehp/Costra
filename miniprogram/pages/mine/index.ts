// pages/mine/index.ts
// 我的页（tabBar #3）：用户信息 + 家庭入口 + 统计入口 + 设置。
// Refs: COSTRA-030, docs/design/ia.md §我的
import { hasValidSession, getSession, logout } from '../../services/auth';

Page({
  data: {
    nickname: '',
    avatarUrl: '',
  },

  onShow() {
    if (!hasValidSession()) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    const s = getSession();
    this.setData({
      nickname: s?.user?.nickname || '未命名用户',
      avatarUrl: s?.user?.avatarUrl || '',
    });
  },

  onTapFamily() {
    wx.navigateTo({ url: '/pages-family/home/index' });
  },
  onTapStat() {
    wx.navigateTo({ url: '/pages-stat/month/index' });
  },
  onTapSettings() {
    wx.navigateTo({ url: '/pages-family/settings/index' });
  },
  async onTapLogout() {
    const res = await wx.showModal({ title: '退出登录', content: '确定要退出吗？' });
    if (res.confirm) {
      logout();
      wx.reLaunch({ url: '/pages/login/index' });
    }
  },
});
