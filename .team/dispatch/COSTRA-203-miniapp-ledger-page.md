# COSTRA-203 · 明细页全新开发 (Ledger Page)

> **Owner**: miniapp-dev · **Est**: 8pt · **Dep**: COSTRA-201 (✅) · **Sprint**: UI-Refactor Phase-C
> **状态**: Todo → Doing

---

## 背景

设计文档 `design/ui/design_spec.md §6.2` 定义了明细页作为小程序首屏，展示当月财务概况与日常流水。当前 `pages/ledger/index` 仅为骨架占位。

---

## 设计规范核心要点（权威来源 design_spec.md §6.2 + interaction_flow.md §4）

### 视觉
- 背景：暖灰白 `#f1f2ec`
- 顶部导航栏：作为**账本切换入口**，当前账本名称居中 + `▼` 箭头，点击唤出 ActionSheet 切换

### 头部汇总区
- **左上主视觉**：巨大"当月总支出"金额（56px=112rpx，SF Pro Display 风格，字重 600，负字距，`#1c1b1a`）
- **左上下方**：较小字号（14px=28rpx，`rgba(28,27,26,0.48)`）显示"当月总收入"与"结余"
- **右上交互区**：
  - 时间维度：年月选择器（`2026年5月 ▼`），点击唤起底部日期滚轮
  - 成员维度（仅多人家庭账本）：成员筛选器（`全部成员 ▼`），单人账本隐藏

### 流水列表
- **分组标题 (Date Header)**：按日期倒序，包含日期+当日总收支，支持**吸顶 (Sticky)**
- **条目设计**：极致精简，无卡片，无分割线
  - `[极简单色图标] + [分类名] + [金额]`
  - 多人家庭时：图标与分类名之间插入 16px 圆形 Mini 微信头像
  - 有备注时：备注替换分类名
  - 金额：最右对齐，等宽数字体(tnum)，21px=42rpx，`#1c1b1a`
- **单人账本**：隐藏 Mini 头像位
- **空状态**：页面正中央一行中灰小字"本月暂无收支记录"（严禁卡通/插画）

### 交互
- 左滑删除：红色 [删除] 操作块 + 震动
- **级联更新**：删除后 Header 总计 + Date Header 日汇总实时重算重绘（150ms counter 过渡）
- 下拉无需刷新（响应式更新）

---

## DoD

### D1: 页面结构 (WXML)
- [ ] 自定义顶部导航栏（账本名称居中 + ▼，点击唤出 ActionSheet）
- [ ] 头部汇总区（巨大月支出 + 收入/结余小字 + 右上年月选择器）
- [ ] 流水列表（scroll-view，日期分组头 sticky，条目行）
- [ ] 条目行结构：图标 + [Mini头像(条件)] + 分类名/备注 + 金额
- [ ] 左滑删除（movable-area 或 touch 手势实现）
- [ ] 空状态文案
- [ ] 引入 expense-overlay 组件

### D2: 样式 (WXSS)
- [ ] 暖灰白背景全屏
- [ ] 头部巨大金额：112rpx / semibold / tight line-height / negative letter-spacing / tnum
- [ ] 辅助金额：28rpx / secondary color
- [ ] 日期分组头：sticky 定位 + 半透明背景
- [ ] 条目行：无分割线 / 无卡片 / 适当纵向间距
- [ ] Mini 头像：32rpx 圆形
- [ ] 金额右对齐 tnum 42rpx
- [ ] 左滑红色删除块
- [ ] 空状态居中灰色小字

### D3: 逻辑 (TypeScript)
- [ ] onShow: 设置 custom-tab-bar selected(0) + 加载数据
- [ ] 数据加载：从本地 storage 读取当前账本的 entries（调用 services/db.ts）
- [ ] 月度汇总计算：总支出/总收入/结余
- [ ] 按日期分组排列（倒序）
- [ ] 年月切换：picker-view + 数据刷新
- [ ] 账本切换：ActionSheet + 数据刷新
- [ ] 成员筛选（多人家庭时）：条件显示 + 过滤
- [ ] 左滑删除：调用 services/db deleteEntry + enqueue outbox + 级联更新 Header
- [ ] eventBus 监听 HIDE_EXPENSE_OVERLAY 时刷新数据（记账完成后）

### D4: 数据格式与 Mock
- [ ] 当前阶段使用本地 storage 数据（services/db.ts 已有 listEntries 等 API）
- [ ] 若本地无数据则显示空状态
- [ ] 金额使用 utils/money.ts 格式化（分→元展示）

---

## 技术约束
- 列表性能：使用 `scroll-view` + 虚拟化思路（大量数据时考虑分页）
- sticky 效果：使用 CSS `position: sticky` + `scroll-view` 配合
- 左滑删除：推荐 touch 手势 + transform 实现（不依赖第三方）
- 不调用后端 API（当前阶段纯本地数据，后续联调卡对接）
- 金额计算严格走 decimal.js（utils/money.ts）

---

## 强制阅读清单
- `design/ui/design_spec.md` §6.2 明细页
- `design/ui/interaction_flow.md` §4 明细页流转
- `miniprogram/services/db.ts`（listEntries / deleteEntry 等 API）
- `miniprogram/services/family.ts`（getActiveFamily 获取当前账本）
- `miniprogram/utils/money.ts`（金额格式化）
- `miniprogram/pages/ledger/index.*`（当前骨架）
