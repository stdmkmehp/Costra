# 分享卡片（Share Cards）v0.1

> **卡号**: COSTRA-011 · **Owner**: Design-Agent
> **约束**: 微信小程序 `onShareAppMessage` + `onShareTimeline` 接口；`imageUrl` 5:4（500×400）；标题 ≤ 20 字
> **技术栈**：业务组件 `c-share-card`，H5 风格页放 `pages-family/share/` 或 `pages-stat/report/`

---

## 1. 共用规范

| 项 | 规则 |
|---|---|
| **画布** | 750 × 600 rpx（3:2.4，与微信聊天缩略图一致的 5:4 框内居中） |
| **安全边距** | **上/下 ≥ 64rpx、左/右 ≥ 32rpx**（避免被微信发送者条 / 小程序名片 / 朋友圈裁切遮挡；**关键文本/金额/CTA 必须落在安全区内**，详见 [`safe-zone.md`](./safe-zone.md)） |
| **字号** | 主标题 `h1`（28rpx）；辅文 `caption`（18rpx）；数字 `typography.amount` 或 `typography.amount.compact` |
| **圆角** | 卡外 `radius.lg`（12rpx）；内部模块 `radius.md`（8rpx） |
| **阴影** | 外部禁用；内部头像/徽章 `shadow.sm` |
| **品牌署名** | 右下角 "Costra · 家庭记账" + 小图标，`neutral.500`，`caption`（必须在底部安全区内） |
| **A11Y** | 所有文字对比度按 `docs/design/a11y/contrast-report.md` 执行；分享卡深色背景 × brand.primary 仅限 ≥ 44rpx 大字号 |
| **禁止** | 二维码浮层（微信规范）、诱导分享话术、虚假数字对比 |

---

## 2. 卡片清单

| # | 卡片 | 触发场景 | 落地页 | 文件 |
|---|---|---|---|---|
| 1 | 家庭邀请 | 家庭设置 → 邀请 | `pages-family/invite` | [`family-invite.md`](./family-invite.md) |
| 2 | 年度报告 | 统计 → 年度 / 每年 01-15 推送 | `pages-stat/report-year` | [`annual-report.md`](./annual-report.md) |
| 3 | 炫一笔 | 记完一笔后"分享给 TA" | `pages/entry-detail` | [`entry-flex.md`](./entry-flex.md) |
| 4 | 预算守卫 | 月末结算 + 未超预算 | `pages-stat/budget-kept` | [`budget-kept.md`](./budget-kept.md) |

---

## 3. 技术承接

- 卡片静态图：`miniprogram/tokens/share-cards/<name>.png`（2x / 3x）
- 动态卡片：使用 `wx.createOffscreenCanvas({ type: '2d' })` 按 token 合成；金额必须用 `decimal.js` 格式化
- 默认 `imageUrl`：在 `app.globalData.shareFallback` 保底
- 每张卡片必须附 `query` 参数：`?from=share&card=<slug>&v=<tokens.version>` 以便埋点归因

---

## 4. A/B 预留

每张卡片预留 `variant: 'a' | 'b'`，文案/颜色由 `feature_flags.share_card_variant` 控制，详见 `ADR-0004` §7。
