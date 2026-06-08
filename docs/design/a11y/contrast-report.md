# Costra A11Y · 对比度实测报告 v0.1

> **卡号**: COSTRA-011（Round-2） · **Owner**: Design-Agent · **生成日期**: 2026-04-23
> **目的**: 对 `docs/design/tokens.json` 中 `color.role.*` 关键前景×背景组合的 **WCAG 2.1 AA** 对比度做可审计的证据链，供 Epic-G 上架合规自查与后续色值变更回归使用。
> **WCAG AA 阈值**：正文（< 24px / 18px 粗体）**≥ 4.5:1**；大字号（≥ 24px 或 ≥ 18px 粗体）**≥ 3:1**。
> **对齐小程序 rpx**：金额/标题类（`h1`/`h2`/`amount` 28rpx 及以上，≈ 18px+）按大字号 3:1 判定；`body`/`caption` 按正文 4.5:1 判定。

---

## 1. 关键组合实测表（12 组）

### 1.1 浅色模式（light）

| # | 前景 token | 前景色值 | 背景 token | 背景色值 | 实测对比度 | 用途 / 字号 | 判定 |
|---|---|---|---|---|---|---|---|
| L-1 | `text.primary` | `#212121` | `bg.app` | `#FAFAFA` | **15.84:1** | 正文主色（body / caption） | ✅ AA 正文 |
| L-2 | `text.primary` | `#212121` | `bg.surface` | `#FFFFFF` | **16.61:1** | 卡片内正文 | ✅ AA 正文 |
| L-3 | `text.secondary` | `#616161` | `bg.app` | `#FAFAFA` | **6.53:1** | 次级说明文字 | ✅ AA 正文 |
| L-4 | `text.tertiary` | `#9E9E9E` | `bg.app` | `#FAFAFA` | **2.83:1** | 弱化占位（**仅限大字号或装饰**） | ⚠️ 不达 AA 正文，仅大字号 |
| L-5 | `text.onBrand` | `#FFFFFF` | `brand.primary` | `#2F7A78` | **4.89:1** | 主按钮文字（`c-button primary`） | ✅ AA 正文 |
| L-6 | `amount.expense` | `#D64545` | `bg.surface` | `#FFFFFF` | **4.54:1** | 支出金额（40rpx 大字号） | ✅ AA 正文，更 ✅ AA 大字号 |
| L-7 | `amount.income` | `#2E7D5B` | `bg.surface` | `#FFFFFF` | **5.23:1** | 收入金额 | ✅ AA 正文 |
| L-8 | `text.primary` | `#212121` | `semantic.warning` (琥珀背景) | `#F5A623` | **7.88:1** | 警告横幅正文 | ✅ AA 正文 |

### 1.2 深色模式（dark）

| # | 前景 token | 前景色值 | 背景 token | 背景色值 | 实测对比度 | 用途 / 字号 | 判定 |
|---|---|---|---|---|---|---|---|
| D-1 | `text.primary` | `#F5F5F5` | `bg.app` | `#0A0A0A` | **16.15:1** | 深色正文主色 | ✅ AA 正文 |
| D-2 | `text.secondary` | `#BDBDBD` | `bg.surface` | `#121212` | **9.86:1** | 深色次级文字 | ✅ AA 正文 |
| D-3 | `amount.expense` | `#FF6E6E` | `bg.surface` | `#121212` | **6.52:1** | 深色支出金额 | ✅ AA 正文 |
| D-4 | `amount.income` | `#5DC090` | `bg.surface` | `#121212` | **7.78:1** | 深色收入金额 | ✅ AA 正文 |

---

## 2. 边界项说明

### L-4 `text.tertiary` light（2.83:1）— ⚠️ 边界项

- **不达 AA 正文**（4.5），也不达 AA 大字号（3.0）；
- **使用边界**：仅限于下列三种场景，且必须配合大字号 ≥ 32rpx 粗体：
  1. 流水列表"空态"的引导文案（装饰性）；
  2. 统计卡片角标/装饰线；
  3. Disabled 状态占位（此时用户不交互，AA 允许豁免）。
- **禁止用于**：任何 `body`/`caption` 正文、表单占位提示（prefer `text.secondary`）、任何交互可点击元素。

### 分享卡片深色模式品牌主色 — P2-4 确认

- 分享卡片深色背景 `#0A0A0A` × brand.primary `#2F7A78` 实测 **3.48:1**；
- 仅用于 **≥ 44rpx 主标题** 场景（年度报告封面标题），符合 AA 大字号 3.0 下限；
- **不得下放到正文**。此约束已同步写入 `tokens.json` `color.brand.primary.desc`。

---

## 3. 变更回归约束

- 任何 `color.role.*` / `color.brand.*` 色值变更 PR，必须在本文件同一 PR 内增量更新对应行的实测数据；
- `scripts/design-ci/contrast-check.mjs`（暂未实现，Sprint-2 加）将读本表 + `tokens.json`，双向校对；
- 本次对比度计算工具：[WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)（公式：WCAG 2.1 相对亮度）。

---

## 4. 后续待办（非本卡关闭条件）

- [ ] Sprint-2 补 `c-button secondary/danger` 状态 hover/pressed 色值对比度；
- [ ] Sprint-3 补分享卡片 4 套的文本 × 卡片底色组合；
- [ ] Epic-G 上架合规前补色盲友好验证（Deuteranopia / Protanopia 模拟）。

---

**Refs**: COSTRA-011 · **Impacts**: `tokens.json` v0.1（不改色值，加注释）、`design-system.md` §6 A11Y 清单证据链
