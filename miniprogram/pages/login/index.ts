// pages/login/index.ts
// 登录页：启动即 wx.login → POST /v1/auth/wx-login (Mock) → 落盘 → 跳首页
// Refs: COSTRA-030, ADR-0004 §3 Token, Design flows/login.md
import { loginFlow, hasValidSession } from '../../services/auth';

Page({
  data: {
    loading: false,
    errMsg: '' as string,
  },

  onLoad() {
    // 若已有有效会话 → 直接跳首页（冷启动续期）
    if (hasValidSession()) {
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
  },

  async onTapLogin() {
    if (this.data.loading) return;
    this.setData({ loading: true, errMsg: '' });
    try {
      await loginFlow();
      wx.switchTab({ url: '/pages/home/index' });
    } catch (e: any) {
      this.setData({ errMsg: e?.message || '登录失败，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
