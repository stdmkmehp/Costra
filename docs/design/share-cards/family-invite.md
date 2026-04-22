# 分享卡片 · 家庭邀请 `family-invite`

> **触发**：家庭设置页 → "邀请家人"；或家庭详情页的 FAB 分享
> **落地页**：`pages-family/invite?code=<invite_code>`

---

## 视觉稿

```
┌──────────────────────────────────────────────┐
│  [👨‍👩‍👧 头像组叠放 96rpx]                         │
│                                               │
│   小周 邀请你加入「周家小账本」              │  ← h1 28rpx · text.primary
│                                               │
│   一起记，日子更清楚                          │  ← body 20rpx · text.secondary
│                                               │
│   ┌──────────────────────┐                    │
│   │  邀请码 · 8K3Q7M     │  ← h2 24rpx tnum   │
│   └──────────────────────┘                    │
│                                               │
│                       Costra · 家庭记账 [logo]│  ← 右下署名 caption
└──────────────────────────────────────────────┘
```

- 画布：750 × 600 rpx
- 主色背景：`color.role.bg.surface`（浅） / `#121212`（深）
- 头像组：家庭成员前 3 人头像重叠，溢出用 `+N`
- 邀请码容器：`radius.md` + 背景 `neutral.100`，`caption` 号码等宽
- 家庭名支持最多 8 字（超出省略号）

## 文案矩阵

| 变体 | 标题（≤ 20 字） | 副标题 |
|---|---|---|
| a（默认） | `<昵称> 邀请你加入「<家庭名>」` | `一起记，日子更清楚` |
| b | `和 <昵称> 一起记这个家的账` | `家庭账本 · 同步更清爽` |

## 接口与埋点

- `onShareAppMessage` 返回：
  ```ts
  {
    title: '<昵称> 邀请你加入「<家庭名>」',
    path: `/pages-family/invite?code=${inviteCode}&from=share&card=family-invite&v=${tokensVersion}`,
    imageUrl: '/assets/share/family-invite.png'
  }
  ```
- 埋点：`share.impression`、`share.click`、`invite.accept`（落地页成功进入）

## 无障碍

- 分享生成后，H5 渲染阶段为头像组写入 `alt="家庭成员头像"`
- 邀请码区为可 long-press 复制：`role="button"`，支持 VoiceOver 朗读 "邀请码 8 K 3 Q 7 M"

## 验收切图

- `@2x 1500×1200 px` · `@3x 2250×1800 px` → `miniprogram/tokens/share-cards/family-invite@2x.png`
