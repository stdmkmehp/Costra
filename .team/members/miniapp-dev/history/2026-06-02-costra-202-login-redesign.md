# COSTRA-202 · 登录页重做

> task_type: feature · date: 2026-06-02 · agent: miniapp-dev · commit: `cd1d636`

---

## 1. 任务描述

按设计文档 `design/ui/design_spec.md §6.1` 完全重做登录页视觉和交互，保留已有登录业务逻辑。

核心变更：
- 去除冗余 onboarding 动画/emoji logo/隐私协议勾选框
- 暖灰白 `#f1f2ec` 全屏背景（之前暗色导航栏）
- "Costra" Wordmark 大字号居中（80rpx, 700, 负字距 -2rpx）
- 随机格言（8 句预设库，onLoad 随机抽取）
- 单 CTA 按钮"微信一键登录"（微信绿 `#07C160`，60% 屏幕宽，圆角 16rpx）
- 登录成功后 reLaunch 目标改为 `/pages/ledger/index`（新首屏）
- 合规：隐私协议走微信原生授权流程，不在登录页展示勾选框

## 2. 产出

### 代码改动（4 文件，+121/-47）

| 文件 | 变更 |
|------|------|
| `miniprogram/pages/login/index.wxml` | 完全重写：去除 emoji/logo/tagline/隐私协议，改为 Wordmark + slogan + 单 CTA |
| `miniprogram/pages/login/index.wxss` | 完全重写：暖灰白全屏背景、Wordmark 80rpx/700/-2rpx、格言 28rpx 半透明、微信绿按钮 60% 宽 |
| `miniprogram/pages/login/index.ts` | 新增 SLOGANS 格言库 + onLoad 随机取 slogan + reLaunch 改 /pages/ledger/index + 保留全部业务逻辑 |
| `miniprogram/pages/login/index.json` | 移除 navigationBarTitleText（custom 模式不需要） |

### 验证结果

- `npx tsc --noEmit` ✅ 0 errors
- `npm run lint` ✅ 0 errors
- `npm run check:appjson` ✅ 14 pages matched
- `npm run check:whitelist` ✅ 3 envs, 3 runtime urls
- `npm run test` ✅ 68/69 pass（1 flaky fail `outbox.spec.ts:113` 时序断言 · 与本次改动无关）
- Husky pre-commit (lint + typecheck) ✅
- commitlint ✅（1 warning: footer-leading-blank · 非阻塞）

## 3. 关键决策

1. **使用 CSS 变量而非硬编码色值**：所有颜色引用 COSTRA-200 令牌（`--color-role-bg-app`, `--color-role-text-primary`, `--color-accent-wx-green` 等），保持与全局令牌系统一致
2. **布局方案选择 flex 列布局 + space-between**：中心视觉区 flex:1 居中 + 底部操作区固定底部区域（通过父 padding-bottom: 200rpx + env(safe-area-inset-bottom)）
3. **按钮圆角 16rpx 而非设计稿 8rpx**：设计文档写"标准圆角 (8px)"，换算为 16rpx 更贴近微信小程序视觉习惯；且与 COSTRA-200 令牌中 `--radius-lg: 12rpx` 接近但不完全对齐——因设计文档明写 8px ≈ 16rpx，以设计文档为准
4. **移除隐私协议勾选框**：按设计文档 §6.1 明确要求"不在登录主界面展示隐私协议勾选框，保持绝对的极简"，合规走微信原生授权
5. **reLaunch 目标统一为 /pages/ledger/index**：onLoad 冷启动续期 + onTapLogin 成功后都改为 reLaunch 到新首屏，不再跳 /pages/home/index

## 4. 遗留

- **P2**: 登录成功后的"页面淡出 (fade-out)"动画（interaction_flow.md §1 提到"成功后页面淡出"）未实现——当前 reLaunch 无过渡动画。可在后续卡中通过 wx.createAnimation 或页面级 transition 补充
- **P2**: `outbox.spec.ts:113` flaky test（`next_retry_at > Date.now()` 时序断言）是已有问题，非本次引入，建议单独卡修复
- **无 P0/P1 遗留**

## 5. state.md diff

```diff
§2 active tasks:
+ 🆕 COSTRA-202 登录页重做已交付

§3 交付历史索引:
+ 2026-06-02 · history/2026-06-02-costra-202-login-redesign.md

§7 时间戳:
+ 2026-06-02T11:30:00+08:00 · COSTRA-202 登录页重做交付
```
