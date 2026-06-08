# COSTRA-203 · 明细页全新开发

> task_type: feature
> 日期: 2026-06-03
> commit: `3f41afb`

---

## 1. 任务描述

将 `pages/ledger/index` 从 COSTRA-201 的骨架占位页全面实装为小程序首屏明细页。包含自定义导航栏、巨大月支出汇总、日期分组吸顶流水列表、左滑删除、账本/月份/成员切换。

设计源：`design/ui/design_spec.md §6.2` + `design/ui/interaction_flow.md §4`

## 2. 产出

### 修改文件（4 文件 +883/-14）

| 文件 | 改动 |
|------|------|
| `pages/ledger/index.json` | 添加 `navigationStyle: "custom"` |
| `pages/ledger/index.ts` | 从 11 行骨架→505 行完整逻辑 |
| `pages/ledger/index.wxml` | 从 8 行骨架→114 行完整模板 |
| `pages/ledger/index.wxss` | 从 13 行骨架→276 行完整样式 |

### 核心功能

1. **自定义导航栏**（`navigationStyle: "custom"`）
   - 毛玻璃背景（`rgba(241,242,236,0.92)` + `backdrop-filter: blur(20px)`）
   - 当前账本名称居中 + 极小 `▼` 箭头
   - 点击唤出 `wx.showActionSheet` 切换账本
   - 动态计算 `statusBarHeight + navBarHeight`

2. **头部汇总区**
   - 左上：112rpx / 600 / line-height 1.07 / letter-spacing -2rpx 巨大月支出金额（tnum 等宽）
   - 左下：28rpx / secondary 收入+结余辅助行
   - 右上：月份选择器 pill（`<picker mode="date" fields="month">`）
   - 右上：成员筛选 pill（仅多人账本时显示，`wx:if="{{showMemberFilter}}"`）

3. **日期分组流水列表**
   - `scroll-view` 包裹，增强模式，隐藏滚动条
   - 日期分组头 sticky 吸顶（`position: sticky; top: 0`）
   - 半透明背景（`rgba(241,242,236,0.95)` + `backdrop-filter: blur(12px)`）
   - 当日收支汇总文字

4. **条目行**
   - 极简单色圆形图标（48rpx，`rgba(28,27,26,0.06)` 背景）
   - 分类名/备注（备注替换分类名）
   - 金额 42rpx tnum 等宽；收入 `#07C160` 带 `+` 号
   - 成员头像位（32rpx 圆形，多人账本条件显示）

5. **左滑删除**
   - touch 手势实现（touchstart/touchmove/touchend）
   - 向左滑出红色 `[删除]` 按钮（160rpx，`#FA5151` 背景）
   - 点击删除→`wx.showModal` 确认→软删 + outbox 入队
   - `wx.vibrateShort({ type: 'medium' })` 震动反馈
   - 级联更新：删除后重算 Header + Date Group 汇总

6. **空状态**
   - 页面正中央：`本月暂无收支记录`
   - 28rpx / `rgba(28,27,26,0.28)`
   - 无卡通/插画/图片

7. **expense-overlay** 组件保留引入

### 金额处理

- 全部走 `decimal.js`（ADR-0002）
- `formatAmountDisplay` / `formatAmountShort` / `formatEntryAmount` / `buildDaySummary`
- 千分位格式化：`¥12,345.67`
- 结余 = 收入 - 支出，负数显示 `-¥`

### 六闸验证

- ✅ `npx tsc --noEmit` 无类型错误
- ✅ `npm run lint` ESLint 无错误
- ✅ `npm run check:appjson` app.json 一致性通过
- ✅ `npm run check:whitelist` 域名白名单通过
- ✅ `npm run check:tooling` 工具链单一源通过
- ✅ `npm run test` 69/69 测试全通过

## 3. 关键决策

1. **header padding-top 用内联 style**：`navBarTotalHeight` 是 JS 动态计算的 px 值，CSS `calc()` 无法引用 JS 变量，因此用内联 `style="padding-top: {{navBarTotalHeight + 8}}px"` 实现
2. **分类图标硬编码映射**：当前 db.ts 无 `listCategories` API，暂用 `getCategoryIcon` / `getCategoryName` 硬编码映射（10 个常见分类），后续联调卡对接真实 category 数据
3. **成员筛选仅 UI 框架**：`onTapMemberFilter` 仅更新 `memberFilterText`，数据过滤在后续联调卡实现
4. **左滑 rpx 近似转换**：touch 事件返回 px，左滑偏移用 `deltaX * 2` 近似转 rpx（750rpx 屏幕宽度约 375px，比约 2:1），在主流设备上效果可接受
5. **日期分组汇总预格式化**：`daySummary` 在 TS 层预构建字符串，避免 WXML 中多条件拼接（`wx:if` + 文本连接可读性差）

## 4. 遗留 / 后续

- **P1**：分类图标/名称映射需对接真实 `categories` 数据（db.ts 无 `listCategories` API → 后续联调卡补）
- **P1**：成员筛选仅 UI 框架，数据过滤未实装（需 family members 列表 API）
- **P2**：账本切换仅更新文字，未切换 `activeLedgerId`（需 ledger 列表 API + `setActiveFamily`）
- **P2**：删除后数字动画（150ms counter 过渡）未实装（需 WXS 动画或 CSS transition on text）
- **P2**：`getActiveLedgerId()` / `getActiveFamilyId()` 是 async API，onShow 中 await 可能短暂闪烁空白

## 5. state.md diff

- §2 active tasks：新增 COSTRA-203 条目，精简旧条目（仅保留最近 4 卡）
- §3 交付历史索引：新增 COSTRA-203 记录
- §7 时间戳：新增 `2026-06-03T12:00:00+08:00 · COSTRA-203 明细页全新开发交付`
