// 家庭分包 · 设置页
// 「GM 工具」分区仅 users.is_gm 用户可见（docs/ops/gm-impersonate-design.md · onShow 实时读 token）
// 「账本导入 / 导出」入口已上移至 mine 页（pages/mine/index · onTapDataManagement）
import { getToken } from '../../services/auth';

Page({
  data: {
    isGm: false,
    /** is_gm 是否已完成首次读取（未读取前不渲染空态，避免 GM 用户首帧闪烁） */
    gmLoaded: false,
  },

  onLoad() {
    this._refreshGm();
  },

  onShow() {
    this._refreshGm();
  },

  _refreshGm() {
    this.setData({ isGm: getToken()?.raw.user.is_gm === true, gmLoaded: true });
  },

  onTapGmImpersonate() {
    wx.navigateTo({ url: '/pages-gm/impersonate/index' });
  },
});
