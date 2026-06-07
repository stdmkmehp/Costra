# COSTRA-264 · COSTRA-263 review 修复 + 二指手势后统计页左边距异常修复

- **task_type**: fix
- **date**: 2026-06-22
- **commit**: `3013344`
- **branch**: dev

---

## 1. 任务描述

COSTRA-263（native swiper 改造）review 后收到 Tech Review REJECT（P0 超 1000 行）+ Product Review PASS-WITH-FOLLOWUP（P1 高度状态生命周期 / loading 时序 / P2 深滚回跳）。同时用户反馈二指手势后统计页左边距异常。本卡一并修复。

## 2. 产出

### 改动文件清单（6 文件 +328/-201）

| 文件 | 变更 |
|------|------|
| `miniprogram/pages/statistics/formatters.ts` | **新建** · 格式化工具函数（fmtAmount/fmtYuan/时间导航/日期格式化） |
| `miniprogram/pages/statistics/viewModels.ts` | **新建** · 视图模型工厂（empty*View/constants/getInitialSwiperHeightPx/buildL1Display） |
| `miniprogram/pages/statistics/memberHelpers.ts` | **新建** · 成员辅助函数（makeAllTab/buildMemberTabs） |
| `miniprogram/pages/statistics/index.ts` | **重构** · 1093→979 行 · 引用拆分模块 + P1/P2 修复 |
| `miniprogram/pages/statistics/index.wxss` | **修改** · overflow-x:hidden 防护链 + box-sizing |
| `docs/design/statistics-page-tech-spec.md` | **修改** · §4.7 补充 swiper 选型理由/高度重置策略/水平溢出防护 + §8.4 补充 T-263-A~F 验收路径 |

### Review 修复对照

| 级别 | 问题 | 修复 |
|------|------|------|
| **P0** | index.ts 1092 行超 1000 行硬拒绝线 | 拆分 formatters.ts(66行) + viewModels.ts(63行) + memberHelpers.ts(54行) → index.ts 降至 979 行 |
| **P1-tech** | `_paneHeights` 未随 scope/member/账本/维度重置 | 新增 `_resetMemberSwiperHeightState()` 在 5 个场景调用 |
| **P1-prod-1** | 顶部点击 duration=0 目标未加载可能空白 | `onTapMemberTab` 先 setData emptyView+loading:true 再切 |
| **P1-prod-2** | 初始 800px 硬编码大留白 | `getInitialSwiperHeightPx()` = windowHeight*0.5 兜底 420 |
| **P1-prod-3** | 切账本后高度状态未重置 | `onTapLedgerName` 调用 `_resetMemberSwiperHeightState` |
| **P2-tech** | 深滚 pageScrollTo 未扣 fixed nav | target = `_memberAnchorTopPx - (statusBarHeight + navBarHeight + 8)` |
| **P2-tech** | anchor 测量要求 rect.top > 0 深滚失效 | 移除 > 0 限制 + selector 未命中 retry 50ms |
| **P2-prod-3** | 切月份/年份 _paneHeights 未清空 | `_clearCurrentDimViews` 内调用 `_resetMemberSwiperHeightState` |
| **P2-prod-4** | tech-spec §8.4 未补验收路径 | 新增 T-263-A~F 六条验收路径 |

## 3. 关键决策

- **二指手势 root cause**：`.l2` 使用 `margin: 4rpx -32rpx 0`、`.l3` 使用 `margin: 4rpx -32rpx 4rpx -56rpx` 负 margin 扩展宽度，导致页面实际内容宽度超出视口。WebView 在二指拖动/捏合手势下触发了水平 scrollLeft。修复策略：从 `page` → `.stat` → `.stat__content` → `.member-pages-swiper` → `.member-pane` → `.rank` 逐层加 `overflow-x: hidden` + `box-sizing: border-box` + `max-width: 100%`，截断水平溢出。`.member-strip` scroll-view 的 `scroll-x` 不受影响（scroll-view 内部机制独立于外层 overflow）。
- **拆分策略**：按职责拆分（格式化 / 视图模型+常量 / 成员辅助），保持 Page 对外事件名不变（WXML bind 不改）。
- **初始高度**：`windowHeight * 0.5` 是合理折中——既不会像 800px 那样大留白，也不会像 200px 那样首屏内容被裁。兜底 420 适用于 wx.getWindowInfo 不可用的极端场景。

## 4. 遗留

无 P0/P1 遗留。

## 5. state.md diff

- §2: +COSTRA-264 ✅
- §3: +本条 history 索引
- §7: 时间戳更新为 2026-06-22T23:15:00+08:00
