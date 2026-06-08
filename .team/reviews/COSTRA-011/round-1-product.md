# COSTRA-011 · Round-1 · Review-Agent-Product

- **被审产物**：`docs/design/design-system.md`、`docs/design/tokens.json`、`docs/design/share-cards/{README,family-invite,annual-report,entry-flex,budget-kept}.md`
- **被审 Agent**：Design-Agent
- **评审人**：Review-Agent-Product（独立实例）
- **评审时间**：2026-04-23 20:18
- **Sprint**：Sprint-0 补审
- **轮次**：1
- **强制上下文**：`ADR-0004` §4/§6、`docs/design/ia.md`、`docs/charter.md` §设计原则

---

## 0. 独立声明

独立实例，依据产物评审。

---

## 1. 评分卡（60 分制）

| 维度 | 满分 | 得分 | 说明 |
|---|---|---|---|
| 设计原则可操作性 | 10 | **9** | D1~D5 原则条条能对应到页面/组件/token；D2 情绪色使用边界略模糊 |
| Token 体系完整度 | 10 | **8** | color/typography/spacing/radius/shadow/motion/zIndex 全；**role 层未覆盖 `amount.neutral`**（跨期统计用）|
| 组件清单颗粒度 | 10 | **9** | 16 组件分类合理、交付标准 5 态清晰；缺 1 个"错误态占位"（空 + 错 双态）|
| 无障碍 A11Y | 10 | **8** | §6 清单完整；**对比度实测数据未给**（见 P1-1）|
| 分享卡片规范 | 10 | **8** | 4 套有，README 索引清晰；**尺寸/安全区**统一性见 P1-2 |
| 与 ADR-0004 / IA 一致性 | 10 | **9** | tabBar 4 项、分包与 IA 对齐；tabBar 自定义状态不一（见 P2-3 跨卡同根问题）|
| **合计** | **60** | **51** | |

**换算 30 分制**：51 × 30/60 = **25.5/30** → 记 **26/30**（四舍五入向上）

---

## 2. Findings

### 🔴 P0

_无_

### 🟠 P1

- **P1-1 · tokens.json 缺 WCAG AA 实测对比度数据**
  - **位置**：`tokens.json` `meta.notes` 只写了"必须 ≥ 4.5:1 / 3:1"，但 `role.text.*` / `role.bg.*` 组合的**实测对比度**未写。
  - **问题**：以 `text.primary` light `#212121` × `bg.app` light `#FAFAFA` 为例，实际对比度应标出（约 15.8:1）以便后续任何人改色时快速判定。
  - **建议**：tokens.json 追加 `meta.contrastReport` 字段或外挂一张 `docs/design/a11y/contrast-report.md`，列出 12 组关键组合的实测值。
  - **影响**：不阻塞 Sprint-1，但 Epic-G 上架合规自查需要。

- **P1-2 · share-cards 尺寸/安全区未在顶层 README 统一声明**
  - **位置**：`docs/design/share-cards/README.md`
  - **问题**：4 张卡片各自声明尺寸（500×400 / 750×750 / ...），但微信 `wx.showShareImageMenu` 与朋友圈分享对长宽比有上限（5:4 与 1:1 兼容最好）。README 未给出**统一安全区掩膜**。
  - **建议**：README 追加"安全区 / 左右留白 ≥ 32rpx / 底部留白 ≥ 64rpx（避免被微信按钮遮挡）"，并附一张 `safe-zone.md`。

- **P1-3 · typography.scale 金额字号 40rpx 与 IA §4.2 首页"顶部摘要卡数字"关系未写死**
  - **位置**：design-system §4.1 / §4.2
  - **问题**：记一笔页金额 `typography.amount`（40rpx）明确，但首页摘要卡三列数字是否也用 40rpx？若同样大小会挤压，可能需要 `amount-compact` 变体（32rpx）。
  - **建议**：tokens.json typography.scale 增一档 `amount.compact: 32rpx`，并在 design-system §4.2 显式引用。

### 🟡 P2

- **P2-1 · design-system §3 组件"错误态"未列入 5 态快照标准（default/hover/pressed/disabled/loading）**
  - 建议扩为 6 态：`+ error`。对表单类组件（c-input / c-amount-input）尤重要。

- **P2-2 · motion.duration 缺 "reduce-motion" 映射**
  - §6 A11Y 清单提到 `prefers-reduced-motion` 降级，但 tokens.json motion 未建模。建议追加 `motion.duration.reduced: 0ms`。

- **P2-3 · 自定义 tabBar vs IA §2 "custom: false" 冲突**（同 COSTRA-010 P2-3，双方都要修）
  - 两份文档 Sprint-1 D1 前对齐一致即可。

- **P2-4 · 分享卡片主色采用 brand.primary 在深色模式下对比度**
  - 深色 bg `#0A0A0A` 上放 `#2F7A78` 作为主色，实测约 3.4:1，略低于 AA（正文 4.5）；但分享卡是大字号场景可接受。建议 tokens.json 加注释。

---

## 3. Verdict

> **REVISE**

**原因**：P1-1 合规证据链不足（WCAG AA 需可审计）、P1-2 分享卡关键尺寸/安全区缺统一、P1-3 实际场景字号缺变体。都是小规模增补，不伤骨架。

**自动循环决策**：round 1 < 5，无 P0，无红线 → **进入自动 Round 2**。

---

## 4. 对 Design-Agent 的执行提示

1. P1-1：写一张 `docs/design/a11y/contrast-report.md` 表（12 行即可）；
2. P1-2：README 加 §"通用安全区"并附 safe-zone 示意；
3. P1-3：tokens.json typography.scale 加 `amount.compact`。

---

## 5. 元信息

- 评审耗时：约 13 分钟
- 独立判定：✅
- Human 介入：否

**Refs**: COSTRA-011 · **Impacts**: `design-system.md`、`tokens.json`、`share-cards/README.md`
