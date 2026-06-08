# COSTRA-201 · Custom TabBar + 路由重组 + 事件总线

> task_type: feature
> 日期: 2026-06-01
> commit: `defab0e`

---

## 1. 任务描述

将微信原生 4-Tab tabBar 替换为自定义 5-Tab 中置式 custom-tab-bar，重组路由架构（首屏改为明细页），实现全局事件总线用于记账覆盖层控制，创建记账覆盖层占位组件。

## 2. 产出

### D1: app.json 路由架构重组
- pages 数组重组：`pages/ledger/index` 首位（首屏）+ 4 新 Tab 页 + add-placeholder + 5 旧页面保留
- tabBar 改为 `custom: true`，5 项 list（明细/统计/记账/家庭/我的）
- tabBar 色值对齐 tokens v2.0.0（selectedColor `#1c1b1a`，backgroundColor `#f1f2ec`）
- preloadRule 更新为 `pages/ledger/index`

### D2: custom-tab-bar 组件
- `miniprogram/custom-tab-bar/` 4 文件（json/wxml/wxss/ts）
- 毛玻璃效果 `backdrop-filter: blur(20px)` + 降级 `rgba(255,255,255,0.95)`
- 中间 [+] 凸起按钮（96rpx 圆形，#07C160 微信绿，向上偏移 -48rpx）
- `switchTab`: index 2 → emit eventBus；其他 → `wx.switchTab`
- `setSelected(idx)`: 外部调用更新选中态

### D3: 全局事件总线
- `miniprogram/services/eventBus.ts`：极简发布/订阅单例
- `EventNames` 常量：`SHOW_EXPENSE_OVERLAY` / `HIDE_EXPENSE_OVERLAY`
- `on/off/emit` 三方法 + handler 错误隔离

### D4: 新增 4 个 Tab 页面骨架 + mine 适配
- `pages/ledger/index`（selected: 0）+ `pages/statistics/index`（selected: 1）+ `pages/family/index`（selected: 3）+ `pages/add-placeholder/index`（极简占位）
- mine 页面：onShow 添加 `this.getTabBar?.()?.setData?.({ selected: 4 })`，json 添加 expense-overlay 组件引用，wxml 底部添加 `<expense-overlay />`

### D5: 记账覆盖层占位组件
- `miniprogram/components/expense-overlay/` 4 文件
- 全屏覆盖层，默认 `translateY(100%)`，visible 时 `translateY(0)`，350ms ease 过渡
- lifetimes.attached 订阅 `SHOW_EXPENSE_OVERLAY`，detached 取消订阅
- catchtouchmove 阻止穿透，✕ 按钮关闭 + emit `HIDE_EXPENSE_OVERLAY`

### 验证结果
- ✅ `npx tsc --noEmit` — 0 错误
- ✅ `npm run lint` — 0 错误
- ✅ `npm run check:appjson` — 14 pages matched, 5/5 tabBar pass
- ✅ `npm run check:whitelist` — 通过
- ✅ `npm test` — 69/69 测试全绿
- ✅ husky pre-commit hooks 通过（lint + typecheck）

## 3. 关键决策

1. **eventBus 采用单例 import 模式**而非 globalData 挂载 — 依赖关系更清晰，TypeScript 类型推断更友好
2. **[+] 按钮不走路由** — 严格遵循 interaction_flow.md §2 "不发生页面路由跳转" · 通过 eventBus 触发覆盖层
3. **add-placeholder 页面** — 微信 custom-tab-bar 要求 tabBar.list 中路径必须注册为 page · 该页面极简空 Page · 实际不会被 `wx.switchTab` 跳转
4. **旧页面保留不动** — home/entry/family-dashboard/stat-overview 在 pages 数组保留（避免引用报错）· 从 tabBar list 移除 · 后续 E2 任务统一清理
5. **icon 采用纯 CSS 绘制** — 不引入图标库/图片资源 · 保持主包体积 · 后续可替换为 SVG/CDN 图标
6. **expense-overlay handler 类型** — 微信 Component this 无自定义属性类型声明 · 通过 `as unknown as Record<string, unknown>` 中转 · 保持 strict: true 无错误

## 4. 遗留

- **P1**: TabBar 图标当前为纯 CSS 简笔 · 后续 COSTRA-20x 需替换为正式设计图标（SVG/CDN）
- **P2**: 4 个新 Tab 页面仅有骨架 · 后续需逐步实装业务逻辑（明细页内容、统计页图表、家庭页协作等）
- **P2**: expense-overlay 当前为占位 · 后续需实装分类网格 + 计算器键盘（design_spec §6.3 完整交互）
- **P2**: 旧页面（home/entry/family-dashboard/stat-overview）需在 E2 任务统一清理

## 5. state.md diff

- §2: 新增 COSTRA-201 active task
- §3: 新增 COSTRA-201 交付历史索引条目
- §7: 新增 2026-06-01T19:30:00+08:00 时间戳
