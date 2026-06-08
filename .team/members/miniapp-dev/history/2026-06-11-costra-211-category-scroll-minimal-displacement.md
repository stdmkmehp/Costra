# COSTRA-211 优化记账分类防遮挡滚动：最小滚动 + 丝滑体验

> 日期：2026-06-11 · 角色：miniapp-dev · 类型：fix

## 1. 任务描述

用户选择下半区分类（如 `水电煤`）后，键盘弹出时分类被滚动到了很高的位置。预期是：
- 只做**避免遮挡所需的最小滚动**
- 目标分类停在键盘上方附近，而不是屏幕上方
- 滚动过程更丝滑

根因：COSTRA-209 使用了固定估算键盘高度 `KEYPAD_SHEET_ESTIMATED_HEIGHT_PX = 300`，
且在键盘弹出**之前**计算滚动距离。此时 scroll-view 还是全高，导致估算偏差大。

## 2. 产出

### 修改文件
| 文件 | 变更 |
|------|------|
| `miniprogram/components/expense-overlay/index.ts` | +74 / -45 |

### 核心变更

1. **移除 `KEYPAD_SHEET_ESTIMATED_HEIGHT_PX = 300` 常量**：不再依赖固定键盘高度估算

2. **新增二阶段算法入口 `_showKeypadAndEnsureVisible(selector)`**：
   - 阶段 1：`setData({ keypadVisible: true })` 让键盘进入 flex 布局
   - 阶段 2：等待 `KEYPAD_LAYOUT_SETTLE_MS = 80ms` 后查询真实布局
   - 调用 `_ensureSelectedNearKeyboard()` 计算最小滚动量

3. **重构核心方法 `_ensureSelectedNearKeyboard(selector)`**：
   - 查询目标分类和 `.category-scroll` 的真实 `boundingClientRect`
   - 此时 scroll-view 已被键盘挤压到真实高度
   - `safeBottom = scrollRect.bottom - SAFE_MARGIN_PX(12px)`
   - 只在 `targetRect.bottom > safeBottom` 时滚动，`delta = targetRect.bottom - safeBottom`

4. **调整常量**：
   - `SAFE_MARGIN_PX`: 16 → **12**（更紧凑）
   - 新增 `KEYPAD_LAYOUT_SETTLE_MS = 80`

5. **统一调用点**：
   - `onTapTier1`：键盘未显示时走 `_showKeypadAndEnsureVisible`，已显示时直接 `_ensureSelectedNearKeyboard`
   - `onTapSubCategory`：同上
   - `onTapExpandedChild`：仅键盘已显示时滚动，未显示时不滚（用户在浏览）

6. **保留不变**：
   - `_show()` 中 `categoryScrollTop: 1 → 0` 重置逻辑
   - `scroll-with-animation="{{true}}"` 丝滑动画
   - `onCategoryScroll` 实时记录 `_currentScrollTop`

## 3. 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 算法选型 | 二阶段真实布局 vs 固定估算 | 固定估算在不同机型/键盘状态下偏差大；二阶段基于真实 rect 精确可控 |
| 布局稳定延迟 | 80ms | 微信 setData + flex 回流约需 50~80ms；太短布局未稳，太长用户感知卡顿 |
| 安全间距 | 12px (原 16px) | 设计稿 24rpx ≈ 12px @375pt；原 16px 偏保守导致额外位移 |
| 展开面板切换子分类 | 仅键盘已显示时滚动 | 用户可能先浏览再决定，不强制弹键盘 |

## 4. 遗留

- **P0 无**
- **P1 无**
- **P2（观察）**：80ms 延迟在某些低端 Android 机上可能不够（flex 回流慢），若实测仍有偏移可考虑调到 100~120ms 或用 `wx.nextTick` 多帧轮询
- **P2（观察）**：`boundingClientRect` 在快速连续点击时可能拿到旧值（setData 未渲染完），当前通过 KEYPAD_LAYOUT_SETTLE_MS 缓解

## 5. state.md diff

- §2 active tasks：新增 🔧 COSTRA-211 条目
- §3 交付历史索引：新增 2026-06-11 history 条目
- §7 时间戳：新增 COSTRA-211 交付时间
