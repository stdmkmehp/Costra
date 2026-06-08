# Costra 设计系统 v0.1

> **卡号**: COSTRA-011 · **Owner**: Design-Agent · **更新**: 2026-04-21
> **配套文件**: [`tokens.json`](./tokens.json) · [`share-cards/`](./share-cards/)
> **依赖**: `ADR-0004` §4 UI 规范 / §6 无障碍

---

## 1. 设计原则（5 条）

| # | 原则 | 落地 |
|---|---|---|
| D1 | **数字不撒谎** | 金额永远 `tnum`（等宽数字），精确到分，禁止浮点字号抖动 |
| D2 | **情绪克制** | 全局默认中性色；仅在"支出超额/收入进账/庆祝达成"三处使用情绪色 |
| D3 | **一屏可记一笔** | 主记账入口必须在 tabBar 可达；弹起键盘后金额输入区不被遮挡 |
| D4 | **家庭优先** | 家庭视角下视觉强调"谁记的"（头像+昵称），消除责任模糊 |
| D5 | **无障碍** | 所有文本对比度 WCAG AA；触控目标 ≥ 88rpx；支持系统字号 |

---

## 2. Token 体系（概览 · 详见 [`tokens.json`](./tokens.json)）

```
color/
 ├── brand       品牌三原色（primary 墨湖绿 / secondary 琥珀 / accent 朱红）
 ├── neutral     中性 10 级灰阶（0~900）
 ├── semantic    成功/警告/危险/信息
 └── role        语义角色（bg/text/border/amount.*）- 深浅双主题映射
typography/
 ├── fontFamily  base / mono / number(等宽)
 └── scale       display / h1 / h2 / body / caption / amount / **amount.compact**（首页摘要卡三列紧凑变体）
spacing/          4 为基数，0~16
radius/           none / sm / md / lg / xl / pill
shadow/           sm / md / lg
motion/           duration(含 reduced 0ms) + easing (standard/enter/exit)
zIndex/           nav<overlay<modal<toast
```

**命名契约**（MiniApp 层消费 token 时必须对齐）：
- SCSS/LESS 变量：`$color-role-bg-app`、`$spacing-4`、`$radius-md`
- WXSS 自定义属性：`--color-role-bg-app`、`--spacing-4`
- TS 常量：`import { tokens } from '@/theme/tokens'` → `tokens.color.role.bgApp`

---

## 3. 核心组件清单（v0.1 · 16 个）

| 分类 | 组件 | 说明 | 位置 |
|---|---|---|---|
| 基础 | `c-button` | 主/次/文字/危险四态；loading；disabled | `components/c-button/` |
| 基础 | `c-icon` | 48 个核心图标（对齐分类图标） | `components/c-icon/` |
| 基础 | `c-input` | 通用输入（带 clear/counter） | `components/c-input/` |
| 基础 | `c-amount-input` | **金额键盘**（分存，禁浮点） | `components/c-amount-input/` |
| 基础 | `c-avatar` | 头像（family 视图必用） | `components/c-avatar/` |
| 基础 | `c-tag` | 标签（分类/流水 tags） | `components/c-tag/` |
| 反馈 | `c-toast` | 全局轻提示 | `components/c-toast/` |
| 反馈 | `c-dialog` | 确认框（危险操作必经） | `components/c-dialog/` |
| 反馈 | `c-action-sheet` | 底部动作选择 | `components/c-action-sheet/` |
| 反馈 | `c-skeleton` | 骨架屏（首屏强制） | `components/c-skeleton/` |
| 反馈 | `c-empty` | 空态（附引导 CTA） | `components/c-empty/` |
| 列表 | `c-list-item` | 流水条目（金额右对齐 tnum） | `components/c-list-item/` |
| 列表 | `c-section-header` | 日期/分组标题 | `components/c-section-header/` |
| 导航 | `c-nav-bar` | 自定义导航栏（对接灵动岛/胶囊） | `components/c-nav-bar/` |
| 导航 | `c-tab-bar` | 自定义 tabBar（4 项）；**上线时机对齐 IA §2 切换计划，Sprint-0 骨架期 `app.json` 仍用 `custom: false`，Sprint-2 D1 配合深色模式切换为 `custom: true`** | `components/c-tab-bar/` |
| 业务 | `c-category-picker` | 两级分类选择器 | `components/c-category-picker/` |
| 业务 | `c-share-card` | 分享卡片承载（详见 [`share-cards/`](./share-cards/)） | `components/c-share-card/` |

**组件交付标准**：
- 属性表（props）+ 事件表（events）+ 插槽表（slots）
- **6 种状态快照：default / hover / pressed / disabled / loading / error**
  - `error` 态对表单类组件（`c-input` / `c-amount-input`）为强制要求：红色边框 + 错误文案位槽 + `aria-invalid="true"`；
  - 非表单类组件（`c-button` / `c-list-item`）`error` 态可选，若不支持需在组件 README 显式声明 "no error state"。
- 无障碍说明（`aria-*` / 焦点环 / VoiceOver 朗读）
- 色值对比度引用 [`a11y/contrast-report.md`](./a11y/contrast-report.md)

---

## 4. 关键页面视觉规则（4 条）

### 4.1 记一笔（Entry）
- **金额区**：`typography.amount`（40rpx, tnum），颜色按 kind 取 `amount.expense/income/transfer`
- **键盘**：自定义数字键盘（非系统）；"·" 键禁用三位以上小数；长按 `0` 直接入 `00`
- **分类网格**：4 × N，网格单元 160×160rpx；点按动效 `motion.fast` + `scale(0.96)`
- **保存按钮**：`c-button primary`，必满足"金额 > 0 && 分类已选"方能激活

### 4.2 首页（Home）
- **顶部摘要卡**：本月支出/收入/结余（三列等宽），数字用 **`typography.amount.compact`（32rpx, tnum）**——避免三列 40rpx 在 375px 机型挤压；单列独立展示时升级到 `typography.amount`（40rpx）
- **流水列表**：按日分组，日期吸顶（sticky header）
- **FAB**：右下 112×112rpx 记账按钮，悬浮于 tabBar 之上

### 4.3 统计（Stat · 分包）
- **饼图**：ECharts；最多展示 Top 7 + "其他"；颜色走分类图标色板
- **趋势**：折线 + 面积；Y 轴 tnum；X 轴按周/月切换

### 4.4 家庭（Family · 分包）
- **成员徽章**：每条流水显示 `c-avatar 48rpx` + 昵称前 4 字
- **邀请卡片**：见 [`share-cards/family-invite.md`](./share-cards/family-invite.md)

---

## 5. 分享卡片

详见 [`share-cards/README.md`](./share-cards/README.md)，4 套：

1. [`family-invite.md`](./share-cards/family-invite.md) · 家庭邀请
2. [`annual-report.md`](./share-cards/annual-report.md) · 年度报告
3. [`entry-flex.md`](./share-cards/entry-flex.md) · 炫一笔（单条流水分享）
4. [`budget-kept.md`](./share-cards/budget-kept.md) · 预算守卫成就

---

## 6. 无障碍（A11Y）清单

- [ ] 所有文本对比度 AA（正文 ≥ 4.5:1、大字 ≥ 3:1）——**实测数据见 [`a11y/contrast-report.md`](./a11y/contrast-report.md)**
- [ ] 触控目标最小 88×88rpx
- [ ] 金额字段语义朗读："支出，三十五元二十分"（避免"3520"直读）
- [ ] 表单项有 `label`，错误有 `aria-describedby`
- [ ] 动效遵循 `prefers-reduced-motion`（降级为 `motion.duration.reduced = 0ms`；由 `services/theme.ts` `respectReducedMotion()` 统一承接）

---

## 7. 深色模式

由 `color.role.*` 的 `light/dark` 对偶统一承接，**组件代码不判断主题**。切换策略见 `miniprogram/services/theme.ts`（MiniApp 线落地）。

---

## 8. 变更流程

- token 变更 → 更新 `tokens.json` + bump `meta.version` + 记录 `docs/changelog.md`
- 组件新增/破坏式改动 → 需 Design + MiniApp 双签（消息总线 `design.change_proposal`）
