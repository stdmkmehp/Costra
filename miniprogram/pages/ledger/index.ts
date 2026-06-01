// pages/ledger/index.ts · 明细页（首屏 Tab1）
// 卡号: COSTRA-201 · 骨架 · 后续 COSTRA-20x 逐步实装

Page({
  data: {},

  onShow() {
    // 更新 custom-tab-bar 选中态
    this.getTabBar?.()?.setData?.({ selected: 0 });
  },
});
