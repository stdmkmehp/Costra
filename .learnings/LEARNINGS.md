# Learnings

## [LRN-20260601-001] correction

**Logged**: 2026-06-01T19:08:00+08:00
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
微信小程序列表行内 `<text>` 不要把插值内容写成多行缩进，视觉对齐时应先排除 text 节点保留换行/空白造成的行盒偏移。

### Details
用户指出明细页条目行中分类图标、分类文字、金额三者中心线仍不一致。前一次只调整 `line-height` 没有效果，原因是金额 `<text>` 内部写成多行：换行 + 缩进 + `{{entry.amountText}}` + 换行，微信 `text` 组件可能保留空白/形成异常行盒；同时仅依赖 `align-items:center` 对齐的是 flex item 外框，不一定等于可见字形中心。

### Suggested Action
处理小程序行内视觉对齐时：1) 插值 `<text>` 改为单行无内部空白；2) 图标、文字容器、金额使用同一固定高度对齐框（如 48rpx），再在框内居中。

### Metadata
- Source: user_feedback
- Related Files: miniprogram/pages/ledger/index.wxml, miniprogram/pages/ledger/index.wxss
- Tags: wechat-miniprogram, text, alignment, ui

---
