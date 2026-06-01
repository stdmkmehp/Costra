# COSTRA-206 记账覆盖层 4 个 UI 问题修复

> 日期: 2026-06-05
> 角色: miniapp-dev (SBAI v1.1)
> 任务类型: fix
> commit: `063b9e0`

## 任务描述

Human 在真机测试中发现记账覆盖层（expense-overlay）存在 4 个 UI 问题，需要逐一修复：

1. **底部绿色残留**：覆盖层打开后最底部有一小块绿色区域（custom-tab-bar 中间的 [+] 按钮未被完全隐藏）
2. **初始态下半屏空白**：打开后不应默认展开键盘，应全屏展示分类网格（一级+二级），但实际下半部分空白
3. **缺少收支文字指示器**：顶部只有两个小圆点，没有"支出/收入"文字说明当前面板
4. **关闭按钮被胶囊遮挡**：右上角 ✕ 按钮与微信胶囊按钮（···|○）重叠

## 产出

### 修改文件清单（4 文件，+106/-30）

| 文件 | 变更说明 |
|------|---------|
| `miniprogram/components/expense-overlay/index.wxml` | header 改三栏布局(取消|支出·收入|占位)；圆点指示器→文字指示器；scroll-view 增加 enhanced/show-scrollbar + 底部安全区占位 |
| `miniprogram/components/expense-overlay/index.wxss` | 关闭按钮样式改为左上角"取消"(28rpx)；新增 tab-indicator 文字样式(active #1c1b1a/600 vs inactive rgba28%)；swiper overflow:hidden；keypad-panel max-height+overflow:hidden；新增 category-scroll__padding-bottom |
| `miniprogram/components/expense-overlay/index.ts` | 注释头更新卡号；onSwiperChange 重构→抽取 _switchTab 公共方法；新增 onTapTabIndicator 点击切换方法 |
| `miniprogram/custom-tab-bar/index.wxss` | .tab-bar--hidden 新增 visibility: hidden（确保 [+] 绿色按钮完全不可见） |

## 关键决策

1. **问题1 根因**：`.tab-bar--hidden` 仅用 `transform: translateY(100%)` 隐藏，但中间 [+] 按钮有 `margin-top: -48rpx` 向上凸起，transition 动画期间可能露出。**修复**：增加 `visibility: hidden` 确保隐藏期间完全不可见，同时 overlay 保持 z-index:9999 > tab-bar:999 的遮盖关系。

2. **问题2 根因**：scroll-view 高度未正确填满 swiper-item 剩余空间。**修复**：swiper 增加 `overflow:hidden` + scroll-view 增加 `box-sizing:border-box` + `height:100%` + 底部增加 `category-scroll__padding-bottom`(env(safe-area-inset-bottom) + min 40rpx)，确保无键盘时分类网格可滚动到屏幕最底端。

3. **问题3 设计决策**：圆点指示器替换为居中排列的 `支出 · 收入` 文字。当前激活面板对应文字高亮（#1c1b1a, 600 字重），另一个弱化（rgba 0.28）。支持点击文字直接切换面板（新增 onTapTabIndicator 方法）。重构 _switchTab 公共方法避免 swiper change 和 tap 两处重复代码。

4. **问题4 设计决策**：关闭按钮从右上角 ✕ 移至左上角 "取消" 文字（28rpx, rgba 0.48），header 改为三栏 flex 布局（取消|指示器|占位），右侧占位保持布局平衡。

## 遗留

- P0: 无
- P1: 无  
- P2: **建议真机验证**底部绿色在 iPhone X/Pro 等有底部安全区的设备上是否彻底消失（visibility:hidden 应已解决，但 [+] 按钮 margin-top:-48rpx 凸出是特殊 case）
- P2: **交互增强建议**：文字指示器可考虑添加 underline 滑动动画（类似 iOS segmented control），当前仅做颜色切换

## state.md diff

- §2 active tasks: 新增 🆕 COSTRA-206 条目
- §3 交付历史索引: 新增 history/2026-06-05-costra-206-overlay-ui-fix.md 条目
- §7 时间戳: 新增 2026-06-05T19:00:00+08:00 条目
