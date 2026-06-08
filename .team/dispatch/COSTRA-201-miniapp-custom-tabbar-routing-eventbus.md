# COSTRA-201 · Custom TabBar 5 Tab 中置式组件 + 路由重组 + 事件总线

> **Owner**: miniapp-dev · **Est**: 5pt · **Dep**: COSTRA-200 (✅) · **Sprint**: UI-Refactor Phase-A
> **状态**: Todo → Doing

---

## 背景

UI 设计文档 (`design/ui/design_spec.md` §3) 明确要求：
- **5 Tab 中置式布局**：明细 / 统计 / [+]记账 / 家庭 / 我的
- **毛玻璃材质 TabBar**：`rgba(255,255,255,0.85)` + blur
- 图标默认浅灰 `rgba(28,27,26,0.28)`，选中油墨暖黑 `#1c1b1a`
- 中间 [+] 按钮凸起高亮，点击不做路由跳转，而是唤起全屏记账覆盖层

交互文档 (`design/ui/interaction_flow.md` §2) 明确：
- 点击 [+] **不发生页面路由跳转**，全屏铺满分类网格
- 记完账后覆盖层收起，回到之前的页面

当前实现使用微信原生 4 Tab tabBar，与设计完全不符。

---

## DoD (Definition of Done)

### D1: app.json 路由架构重组
- [ ] pages 路由重排：`pages/ledger/index`（明细·首屏）/ `pages/statistics/index`（统计）/ `pages/family/index`（家庭）/ `pages/mine/index`（我的）
- [ ] 旧页面路由保留但从 tabBar list 移除（`pages/home/index`、`pages/entry/index` 等暂留文件不删，后续任务清理）
- [ ] tabBar 配置改为 `"custom": true`
- [ ] tabBar list 对齐 5 Tab 路径（明细/统计/占位/家庭/我的）

### D2: custom-tab-bar 组件实现
- [ ] 创建 `miniprogram/custom-tab-bar/` 目录（index.wxml / index.wxss / index.ts / index.json）
- [ ] 5 Tab 布局：明细 / 统计 / [+] / 家庭 / 我的
- [ ] 毛玻璃效果：background `rgba(255,255,255,0.85)` + `backdrop-filter: blur(20px)` + `-webkit-backdrop-filter: blur(20px)`
- [ ] 图标系统：使用文字/unicode 极简图标（设计文档未指定具体图标资源，用极简字符或 SVG 线条图标）
- [ ] 默认态：图标+文字颜色 `rgba(28,27,26,0.28)`
- [ ] 选中态：图标+文字颜色 `#1c1b1a`
- [ ] 中间 [+] 按钮：凸起样式（微信绿 `#07C160` 背景，白色 + 号，圆形，视觉突出）
- [ ] 点击普通 Tab：调用 `wx.switchTab` 切换页面
- [ ] 点击 [+]：通过全局事件总线发射 `show-expense-overlay` 事件（不做路由跳转）
- [ ] 当前页面 selected 态跟随（通过 page onShow 调用 `getTabBar().setData({selected})` 实现）

### D3: 全局事件总线
- [ ] 创建 `miniprogram/services/eventBus.ts`
- [ ] 实现极简发布/订阅：`on(event, handler)` / `off(event, handler)` / `emit(event, data?)`
- [ ] 类型安全：定义事件名常量（`SHOW_EXPENSE_OVERLAY` / `HIDE_EXPENSE_OVERLAY`）
- [ ] 挂载到 `getApp().eventBus`（globalData）
- [ ] 单测覆盖（on/off/emit 基本路径）

### D4: 新增占位 Tab 页面骨架
- [ ] `pages/ledger/index`（明细页占位 · 仅含基本结构，显示"明细"标题，后续 C2 任务填充内容）
- [ ] `pages/statistics/index`（统计页占位）
- [ ] `pages/family/index`（家庭页占位）
- [ ] 各页面 onShow 中正确设置 custom-tab-bar 的 selected index
- [ ] `pages/mine/index` 保留现有逻辑，仅适配 custom-tab-bar selected

### D5: 记账覆盖层占位组件
- [ ] 创建 `miniprogram/components/expense-overlay/`（index.wxml / index.wxss / index.ts / index.json）
- [ ] 当前仅为占位：全屏 view + 暖灰白背景 + 居中文字"记账（开发中）" + 关闭按钮
- [ ] 关闭按钮点击时通过事件总线发射 `HIDE_EXPENSE_OVERLAY`
- [ ] 显隐动画：slide-up 进入 / slide-down 退出（transition 350ms）
- [ ] 各 Tab 页面 wxml 中引入此组件，通过 eventBus 监听 `SHOW_EXPENSE_OVERLAY` 控制显隐

---

## 技术约束
- custom-tab-bar 必须兼容微信基础库 2.32.3
- 不使用任何第三方 UI 库
- 毛玻璃效果在不支持 backdrop-filter 的低版本设备上降级为纯白色 0.95 透明度
- 中间 [+] 按钮在 tabBar list 中需要一个占位 pagePath（可指向一个空页面 `pages/add-placeholder/index`），但实际不会触发跳转
- 保证 miniprogram/ 主包不超 2MB

---

## 强制阅读清单
- `design/ui/design_spec.md` §3 核心功能与页面结构 (TabBar)
- `design/ui/interaction_flow.md` §2 核心记账流程
- `miniprogram/app.json`（当前配置）
- `miniprogram/app.ts`（了解 globalData 结构，以便挂载 eventBus）
