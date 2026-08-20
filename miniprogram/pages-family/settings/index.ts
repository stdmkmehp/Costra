// 家庭分包 · 设置页
// 「GM 工具」分区仅 users.is_gm 用户可见（docs/ops/gm-impersonate-design.md · onShow 实时读 token）
import { getToken } from '../../services/auth';

Page({
  data: {
    isGm: false,
  },

  onShow() {
    this.setData({ isGm: getToken()?.raw.user.is_gm === true });
  },

  onTapComingSoon() {
    wx.showToast({ title: '即将支持', icon: 'none' });
  },

  onTapGmImpersonate() {
    wx.navigateTo({ url: '/pages-gm/impersonate/index' });
  },
});
