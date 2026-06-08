# 分享卡片 · 炫一笔 `entry-flex`

> **触发**：记一笔保存后的"分享给 TA"按钮；或流水详情页的菜单项
> **落地页**：`pages/entry-detail?id=<entry_id>`（需被邀对方已登录；否则转邀请流程）

---

## 视觉稿

```
┌──────────────────────────────────────────────┐
│  【🍜 餐饮】2025-04-21                        │  ← caption
│                                               │
│   - ￥38.00                                   │  ← amount 40rpx · amount.expense
│                                               │
│   和同事在街角的小面馆                        │  ← body · text.secondary
│                                               │
│   —— 来自 Costra 记账                         │  ← caption · neutral.500
│                                               │
│                       Costra · 家庭记账 [logo]│
└──────────────────────────────────────────────┘
```

- 画布：750 × 600 rpx
- 金额符号 `-` 与数字同行；收入为 `+` + `amount.income`；转账为灰色 + 无符号
- 备注超过 30 字显示省略号
- 分类图标 48×48rpx（优先使用分类真实图标）

## 文案矩阵

| 变体 | 规则 |
|---|---|
| a（默认） | `金额 + 分类 + 备注` 原样 |
| b | 金额隐藏，仅展示 `<分类 + 备注>`（用户可勾选"隐私模式"） |

## 隐私开关

- 设置项：`设置 → 分享偏好 → 记一笔时默认隐藏金额`
- 生成前，组件读取用户偏好；同步到 `wx.storage.shareFlexAmountMask`

## 接口与埋点

- `onShareAppMessage` 返回：
  ```ts
  {
    title: '「￥38 · 餐饮」 的一笔',
    path: `/pages/entry-detail?id=${entryId}&from=share&card=entry-flex`,
    imageUrl: canvasSnapshotPath
  }
  ```
- 埋点：`entry.share.click`、`entry.share.completed`

## A11Y

- 金额朗读："支出，三十八元"；隐私模式下朗读："一笔消费"
