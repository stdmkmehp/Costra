# COSTRA-205 · 登录 Wordmark + TabBar 遮挡修复

> 日期：2026-06-05
> 任务类型：fix
> commit: `4a65569`
> 状态：已交付，待 review-tech R1

---

## 1. 任务描述

修复两个 UI 问题：

**问题 1：登录页 Wordmark 修正**
- 登录页显示的 "Costra" 改为全大写 **"COSTRA"**
- 字体风格调整为细体无衬线（font-weight: 300, letter-spacing: 8rpx）
- 布局调整：品牌区上移到页面约 1/3 位置（margin-top: 30vh），登录按钮推到下部区域

**问题 2：记账覆盖层被 TabBar 遮挡 — 彻底修复**
- 根因：expense-overlay 虽然是 fixed 全屏覆盖（z-index:1000），但 custom-tab-bar 的 z-index 为 999 且固定底部定位，键盘底行被遮挡
- 方案：覆盖层显示时通过 eventBus 通知 custom-tab-bar 隐藏自身

## 2. 产出

| 文件 | 变更说明 |
|------|----------|
| `miniprogram/pages/login/index.wxml` | Wordmark 文本 "Costra" → "COSTRA" |
| `miniprogram/pages/login/index.wxss` | font-weight: 700→300, letter-spacing: -2rpx→8rpx, 品牌区 margin-top:30vh, 按钮区 margin-top:auto |
| `miniprogram/custom-tab-bar/index.ts` | 新增 lifetimes.attached/detached 订阅 SHOW/HIDE_EXPENSE_OVERLAY 事件 |
| `miniprogram/custom-tab-bar/index.wxml` | 最外层容器加 `{{hidden ? 'tab-bar--hidden' : ''}}` 条件类 |
| `miniprogram/custom-tab-bar/index.wxss` | 新增 `.tab-bar--hidden { transform:translateY(100%); pointer-events:none }` + transition |
| `miniprogram/components/expense-overlay/index.wxss` | z-index: 1000→9999 |
| `miniprogram/app.wxss` | 新增 `--safe-area-bottom` 和 `--tabbar-height` CSS 标准变量 |

**统计**：7 文件修改，+57/-14 行

## 3. 关键决策

1. **TabBar 隐藏方案选择**：选用 `transform: translateY(100%)` + `pointer-events: none` 而非 `display: none`。理由：微信小程序中 Component 的 setData 触发 display:none 可能导致重绘闪烁，而 transform 有 GPU 加速且可加 transition 平滑动画。

2. **z-index 层级策略**：overlay 提升到 9999（远高于 tabbar 的 999），同时 TabBar 也做隐藏——双重保险。即使未来有其他组件介入也不受影响。

3. **登录布局方案**：放弃 `justify-content: space-between`（会让品牌区和按钮区均分空间），改用品牌区固定 `margin-top: 30vh` + 按钮区 `margin-top: auto` 推到底部。这样更可控且符合设计稿要求（品牌在上方 1/3，按钮在下部 1/4）。

4. **安全区标准变量**：在 app.wxss page 作用域定义 `--safe-area-bottom` 和 `--tabbar-height`，供所有页面统一使用 `calc(var(--tabbar-height) + var(--safe-area-bottom))` 做 padding-bottom 避让。

## 4. 遗留

- **P0 无**
- **P1 无**
- **P2**：登录页 wxss 注释头仍写 "font-weight: 700 · 负字距"（与实际 300/正字距不符），建议后续统一更新注释以避免误导（非阻塞）

## 5. state.md diff

- §2 active tasks：新增 COSTRA-205 🆕 条目
- §3 交付历史索引：新增 `history/2026-06-05-costra-205-login-wordmark-tabbar-fix.md`
- §7 时间戳：新增 COSTRA-205 交付时间戳
