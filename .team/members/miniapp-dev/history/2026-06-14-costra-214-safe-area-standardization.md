# COSTRA-214 · 统一安全区与自定义导航高度标准化

> task_type: feature · 2026-06-14 · commit `41877e6`

---

## 1. 任务描述

Human 发现微信开发者工具中记账覆盖层顶部被刘海/状态栏遮挡，但真机正常。诊断结论：当前项目缺少统一的安全区/自定义导航高度标准——`ledger` 页面用 JS `wx.getWindowInfo().statusBarHeight`，`expense-overlay` 用 CSS `env(safe-area-inset-top)`，开发者工具与真机对 CSS env 支持/返回值不一致。Human 要求直接走长期标准化方案：建立统一安全区服务并迁移关键页面/组件。

## 2. 产出

### D1: 新建 `miniprogram/utils/safeArea.ts`
- 导出 `SafeAreaMetrics` 接口（10 个字段：statusBarHeight / menuButtonTop / menuButtonBottom / menuButtonHeight / navBarHeight / navBarTotalHeight / safeAreaTop / safeAreaBottom / windowHeight / windowWidth）
- 导出 `getSafeAreaMetrics()` 函数：优先 `wx.getWindowInfo()`，fallback `wx.getSystemInfoSync()`，menuButton try/catch 防御，navBarHeight 微信推荐公式 `(menuButtonTop - statusBarHeight) * 2 + menuButtonHeight` + fallback 44
- 缓存机制 + `resetSafeAreaMetricsCache()` 供测试
- 顶部写明项目标准：全屏 overlay / 自定义导航不得依赖 CSS env(safe-area-inset-top)，必须使用 `getSafeAreaMetrics()`

### D2: 新建 `miniprogram/utils/safeArea.spec.ts`
- 7 个单测：getWindowInfo+menuButton 正常返回 / getWindowInfo 抛错 fallback / menuButton 抛错 fallback 44 / safeAreaBottom 计算 / safeAreaBottom 兜底 0 / cache 行为 / reset 行为
- 使用 `vi.stubGlobal('wx', mockWx)` 与项目现有 storage.spec.ts 风格一致

### D3: 迁移 `expense-overlay`
- `index.ts`：import `getSafeAreaMetrics`，`_show()` 中读取 `safeAreaTop` / `safeAreaBottom` 并 setData
- `index.wxml`：header 加 `style="padding-top: {{safeAreaTop + 4}}px;"` 替代 CSS env；keypad-sheet 加 `style="padding-bottom: {{safeAreaBottom}}px;"` 替代 CSS env；category-bottom-spacer 加 `style="height: {{safeAreaBottom || 20}}px;"` 替代 CSS env
- `index.wxss`：移除 `padding-top: calc(env(safe-area-inset-top) + 8rpx)` / `padding-bottom: env(safe-area-inset-bottom)` / `height: env(safe-area-inset-bottom)` 等 CSS env 依赖

### D4: 迁移 `ledger` 页面
- `index.ts`：import `getSafeAreaMetrics`，`onLoad()` 中用 `getSafeAreaMetrics()` 替代直接 `wx.getWindowInfo()` 调用
- `statusBarHeight` / `navBarHeight` / `navBarTotalHeight` 从统一服务获取，行为不变

### D5: 项目标准注释
- `safeArea.ts` 顶部 4 条标准规则，明确禁止 CSS env(safe-area-inset-top) 用于顶部避让

## 3. 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 顶部安全区用 JS inline style 而非 CSS env | 微信开发者工具对 CSS env() 支持与真机不一致，JS 方案在两端表现一致 |
| 2 | navBarHeight 用微信推荐公式 + fallback 44 | 胶囊按钮信息在开发者工具可能不可用，44px 是 iOS 通用导航栏高度 |
| 3 | header padding-top 用 `safeAreaTop + 4`（px） | 原 CSS 为 `calc(env(safe-area-inset-top) + 8rpx)`，8rpx ≈ 4px，保持等价 |
| 4 | category-bottom-spacer 高度用 `safeAreaBottom \|\| 20`（px） | 原 CSS `min-height: 40rpx` ≈ 20px，保持 fallback 等价 |
| 5 | 缓存安全区指标 | 进程生命周期内设备信息不变，避免频繁调用 wx API |

## 4. 遗留

- **P2**: 其他页面/组件（如未来新增的全屏 overlay）也需迁移到 `getSafeAreaMetrics()`，当前只迁移了 expense-overlay 和 ledger 两个关键页面
- **P2**: `app.wxss` 中 `--safe-area-bottom: env(safe-area-inset-bottom)` 全局变量仍保留，后续可考虑是否也迁移到 JS 驱动
- **P2**: ledger 页面 `entry-list` 的 `padding-bottom: calc(env(safe-area-inset-bottom) + 120rpx)` 仍用 CSS env，因这是底部留白而非核心布局高度计算，按 D5 规则"CSS env(safe-area-inset-bottom) 可作为底部 fallback"可暂保留

## 5. state.md diff

- §2 active tasks：新增 COSTRA-214 条目
- §3 交付历史索引：新增 COSTRA-214 条目
- §7 时间戳：更新为 2026-06-14T15:30:00+08:00
