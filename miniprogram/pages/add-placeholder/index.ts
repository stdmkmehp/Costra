// pages/add-placeholder/index.ts · 占位页
// 卡号: COSTRA-201 · 为 tabBar list 占位 · 实际不会被跳转
// 微信 custom-tab-bar 要求 tabBar.list 中的路径必须注册为 page
// COSTRA-216: 补齐 custom navigation 安全区占位
import { getSafeAreaMetrics } from '../../utils/safeArea';

Page({
  data: {
    navBarTotalHeight: 0,
  },

  onLoad() {
    // COSTRA-216: 获取安全区指标，设置顶部安全区高度
    const metrics = getSafeAreaMetrics();
    this.setData({
      navBarTotalHeight: metrics.navBarTotalHeight,
    });
  },
});
