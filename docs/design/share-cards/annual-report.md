# 分享卡片 · 年度报告 `annual-report`

> **触发**：统计页 → 年度回顾入口；每年 01-15 通过订阅消息拉起
> **落地页**：`pages-stat/report-year?year=<YYYY>`

---

## 视觉稿

```
┌──────────────────────────────────────────────┐
│  2025 年报 · Costra                           │  ← caption 18rpx · neutral.500
│                                               │
│   我记了 1,284 笔                             │  ← h1 28rpx
│   花了 ￥86,420.50                            │  ← amount 40rpx · amount.expense
│                                               │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← 分割线（strong）
│                                               │
│   Top 3 去向                                  │  ← h2 24rpx
│    🍜 餐饮    ￥21,340                        │
│    🚇 交通    ￥12,980                        │
│    🛒 购物    ￥9,720                         │
│                                               │
│   最自律的一个月：3 月 · 未超预算             │  ← body
│                                               │
│                       Costra · 家庭记账 [logo]│
└──────────────────────────────────────────────┘
```

- 画布：750 × 600 rpx
- 背景：浅模式渐变 `#2F7A78 → #256562` 30% → 白；深模式渐变 `#1D504E → #0A0A0A`
- Top 3 条目：24×24rpx 图标（取自分类色板），金额右对齐 tnum

## 文案矩阵

| 变体 | 主句型 |
|---|---|
| a | `我记了 <N> 笔 / 花了 ￥<M>` |
| b | `<年份> 陪 Costra 走完的每一分钱` |

## 接口与埋点

- `onShareTimeline`（朋友圈）：`title` 用变体 b，`imageUrl` 强制用预渲染版（避免动态失败）
- `onShareAppMessage`：携带 `?year=<YYYY>&from=share&card=annual-report`
- 埋点：`report.share`、`report.view_from_share`

## 异常兜底

- 数据不足 30 天 → 不触发；CTA 显示 "数据还在积累，明年见"
- 月支出=0 的月份 → 跳过 Top 3 段，改为励志小语

## 验收切图

- `@2x / @3x` 深浅四张，按 `appearance` 自适应
