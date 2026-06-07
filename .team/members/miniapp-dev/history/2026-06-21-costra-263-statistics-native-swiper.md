# COSTRA-263 · 统计页成员横滑改为 native swiper + auto-height adapter

- **task_type**: feature
- **date**: 2026-06-21
- **commit**: `28798fd`

---

## 1. 任务描述

用户测试发现 COSTRA-261/262 的 scroll-view + scroll-snap 方案不符合预期：轻轻一滑可能跨多个成员、可停在中间。需求重新确认后，改用 native `<swiper>` 实现跟手滑动 + 一次只切相邻成员 + 不停中间 + 顶部点击不播放横跨多页动画。

## 2. 产出

| 文件 | 改动 |
|------|------|
| `miniprogram/pages/statistics/index.wxml` | scroll-view → `<swiper>` + `<swiper-item>` |
| `miniprogram/pages/statistics/index.wxss` | 删 `.member-pages` / `.member-pages__track` / `.member-pages__pane` / scroll-snap；新增 `.member-pages-swiper` / `.member-pane` / `.member-pane-inner` |
| `miniprogram/pages/statistics/index.ts` | 删 `onPagesScroll` / `_lastScrollHandledIdx` / `dataScrollIntoView` / `_windowWidthPx`；新增 swiper 事件处理器 + auto-height adapter + 页面滚动位置策略 |
| `docs/design/statistics-page-tech-spec.md` | §4.7 全面更新为 native swiper 方案 |

4 文件 · +253 / -69

## 3. 关键决策

1. **auto-height adapter 策略**：
   - 稳定态：`memberSwiperHeightPx` = 当前 pane 实测高度
   - `touchstart`：扩到 `max(current, prev, next)` 防邻居被裁
   - tap 跳转：扩到 `max(current, target)` + `duration=0` 直接切
   - `animationfinish`：收缩到目标 pane 实测高度
   - CSS `transition: height 180ms ease-out` 视觉平滑

2. **顶部点击不播放横跨多页动画**：`memberSwiperDuration` 临时设为 0，setData callback 后 50ms 恢复 240。配合 `_isTapSwitchingMember` flag 防止 `bindchange` 重复处理。

3. **页面滚动位置策略**：`onPageScroll` 持续追踪 `_pageScrollTop`；切成员时若已深滚（超过成员条 anchor + 120px），`wx.pageScrollTo` 回到成员条附近（duration=180ms）；上半部不强行滚动。

4. **测高 helper 全 callsite 接入**：`_buildMonthlyDisplay` / `_buildYearlyDisplay` / `onTapL1`（展开/收起/L2加载完成） / `onTapL2`（展开/收起/L3加载完成） / `onSwitchDimension` 都在 setData callback 后调 `_scheduleMeasureCurrentPane`。

5. **stale 回调防护**：`_measureSeq` 递增序号，旧回调自动丢弃。首次测不到高度 retry 一次（50ms）。

## 4. 遗留

- 无 P0/P1 遗留
- P2：`_paneHeights` 数组在切账本/切月份时未清空（影响极小：新数据渲染后会重新测高覆盖旧值）

## 5. state.md diff

- §2：新增 COSTRA-263 ✅ 条目
- §3：新增 history 索引
- §7：时间戳更新为 2026-06-21T22:50:00+08:00
