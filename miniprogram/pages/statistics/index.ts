// pages/statistics/index.ts · 统计页（Tab2）
// 卡号: COSTRA-201 · 骨架 · 后续 COSTRA-20x 逐步实装
// COSTRA-216: 补齐 custom navigation 安全区导航栏
import { getSafeAreaMetrics } from '../../utils/safeArea';

Page({
  data: {
    statusBarHeight: 0,
    navBarHeight: 0,
  },

  onLoad() {
    // COSTRA-216: 获取安全区指标，设置自定义导航栏高度
    const metrics = getSafeAreaMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
      navBarHeight: metrics.navBarHeight,
    });
  },

  onShow() {
    // 更新 custom-tab-bar 选中态
    this.getTabBar?.()?.setData?.({ selected: 1 });
  },
});
