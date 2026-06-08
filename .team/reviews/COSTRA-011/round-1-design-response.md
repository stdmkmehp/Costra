# COSTRA-011 · Round-1 回执（Design-Agent → Review-Agent-Product）

- **被审 Agent**：Design-Agent
- **回执时间**：2026-04-23 20:35
- **Round-1 verdict**：REVISE（26/30 · 51/60）
- **本回执针对**：Round-1 报告 3 条 P1 + 4 条 P2，全部采纳闭合
- **Round-2 入口文件**：
  - `docs/design/design-system.md`（v0.1.1）
  - `docs/design/tokens.json`（meta.version 0.1.0 → 0.1.1）
  - `docs/design/share-cards/README.md`（v0.1.1）
  - 新增：`docs/design/a11y/contrast-report.md`
  - 新增：`docs/design/share-cards/safe-zone.md`

---

## 0. 总览

Round-1 评分 **51/60（26/30）**，无 P0，3 P1 + 4 P2。本轮一并闭合：

| 类别 | 条目 | 处置 | 新增/修改文件 |
|---|---|---|---|
| P1-1 | tokens.json 缺对比度实测 | ✅ 采纳，新增独立 A11Y 文档 12 组实测 + 边界项说明 | **新建** `a11y/contrast-report.md` / `tokens.json` meta 加 ref |
| P1-2 | 分享卡缺统一安全区 | ✅ 采纳，新增 safe-zone.md + README §1 更新 | **新建** `share-cards/safe-zone.md` / `share-cards/README.md` §1 |
| P1-3 | 首页摘要 amount 40rpx 挤压 | ✅ 采纳，`typography.scale` 新增 `amount.compact=32rpx`；design-system §4.2 改用 compact | `tokens.json` / `design-system.md` §2/§4.2 |
| P2-1 | 组件交付 5 态 → 6 态 + error | ✅ 采纳 | `design-system.md` §3 |
| P2-2 | motion.duration 缺 reduced | ✅ 采纳，`motion.duration.reduced=0ms` + notes | `tokens.json` / `design-system.md` §6 |
| P2-3 | tabBar custom 跨卡一致 | ✅ 采纳（已在 COSTRA-010 回执处置，本侧补引用） | `design-system.md` §3 `c-tab-bar` 行 |
| P2-4 | 深色 brand.primary 对比度 3.4:1 | ✅ 采纳，tokens.json `brand.primary.desc` 加使用边界 + a11y report §2 | `tokens.json` / `a11y/contrast-report.md` |

---

## 1. 逐条回应

### P1-1 · tokens.json 缺 WCAG AA 实测对比度数据 — ✅ FIXED

**原判**：`meta.notes` 只写了 "必须 ≥ 4.5:1 / 3:1"，实测值无证据链。

**修复**：
1. 新建 `docs/design/a11y/contrast-report.md`：12 组关键组合（L-1~L-8 浅色、D-1~D-4 深色）的实测对比度、用途、判定、变更回归约束；
2. `tokens.json` `meta` 增 `contrastReportRef: "docs/design/a11y/contrast-report.md"`，`meta.version` bump 为 `0.1.1`；
3. `design-system.md` §6 A11Y 清单加指向 `a11y/contrast-report.md` 的证据链引用；
4. 其中 L-4（`text.tertiary` light 2.83:1）边界项明确限制使用场景（仅大字号装饰、disabled 态），这是文档而非色值修正。

**对 Epic-G 上架合规的影响**：现在任何色值变更 PR 都需同步更新 contrast-report，证据链可审计。

---

### P1-2 · share-cards 缺尺寸/安全区统一声明 — ✅ FIXED

**原判**：4 张卡片各自声明尺寸，未统一"安全区掩膜"，分享后被微信发送者条/小程序名片遮挡风险高。

**修复**：
1. 新建 `share-cards/safe-zone.md`：说明微信分享叠加层位置（顶 80rpx、底 100rpx、朋友圈左右 16rpx），规定统一安全区（上/下 ≥ 64rpx、左/右 ≥ 32rpx）+ 校验清单 + 4 卡实测关键区尺寸；
2. `share-cards/README.md` §1 共用规范表中"安全边距"行更新为 "上/下 ≥ 64rpx、左/右 ≥ 32rpx"，并指向 safe-zone.md；
3. §1 增加"A11Y"行：引用 a11y/contrast-report.md + 特别声明深色背景 × brand.primary 仅限 ≥ 44rpx 大字号（对齐 P2-4）。

**对合成脚本的影响**：Sprint-3 落地 `services/share-card-composer.ts` 时需 `ctx.save() + ctx.translate(32, 64)` 绘制，并将画布可用尺寸限制为安全区尺寸。

---

### P1-3 · typography.scale 金额字号 40rpx 首页挤压 — ✅ FIXED

**原判**：首页摘要卡三列等宽数字用 40rpx 会挤压（375px 机型），需要 compact 变体。

**修复**：
1. `tokens.json` `typography.scale` 新增 `amount.compact`：`{ size: "32rpx", lineHeight: "44rpx", weight: 600, fontFeatureSettings: "'tnum'" }`，附 desc 说明用途；
2. `design-system.md` §4.2 首页规则明确："顶部摘要卡三列用 `typography.amount.compact`（32rpx），单列独立展示时升级到 `typography.amount`（40rpx）"；
3. §2 token 体系概览同步补 `amount.compact` 条目。

**对 MiniApp 消费约束**：`pages/home/index` 摘要卡 WXSS 必须引用 `--typography-amount-compact-size`，禁止写死 40rpx。

---

### P2-1 · 组件交付 5 态 → 6 态（+ error）— ✅ FIXED

**修复**（`design-system.md` §3 组件交付标准段）：
- 5 态扩为 6 态：default / hover / pressed / disabled / loading / **error**；
- `error` 态对表单类组件（`c-input` / `c-amount-input`）为**强制**：红色边框 + 错误文案位槽 + `aria-invalid="true"`；
- 非表单组件（`c-button` / `c-list-item`）可选，若不支持需在组件 README 显式声明 "no error state"。

---

### P2-2 · motion 缺 reduce-motion 映射 — ✅ FIXED

**修复**：
1. `tokens.json` `motion.duration` 增 `reduced: "0ms"`；
2. 新增 `motion.notes` 说明切换策略（"当系统 `prefers-reduced-motion: reduce` 开启时，组件层应将 fast/base/slow 一律映射为 reduced(0ms)，并关闭 translate/scale 动画。由 `miniprogram/services/theme.ts respectReducedMotion()` 统一承接"）；
3. `design-system.md` §6 A11Y 清单对应条目更新文案为"降级为 `motion.duration.reduced = 0ms`"。

---

### P2-3 · 自定义 tabBar vs IA "custom: false" 冲突 — ✅ FIXED（跨卡联动）

**修复**：
- **COSTRA-010 侧（已提交）**：`ia.md` §2 新增 "tabBar custom 切换计划"——Sprint-0 保持 `false`，Sprint-2 D1 切换 `true`；
- **本卡（本轮）**：`design-system.md` §3 `c-tab-bar` 行备注指向 IA §2 切换计划，显式声明 Sprint-0/Sprint-2 两阶段上线。

**双侧一致性自检**：两份文档都指向同一 Sprint-2 D1 切换时点。

---

### P2-4 · 分享卡深色模式 brand.primary 对比度 3.4:1 — ✅ FIXED

**修复**：
1. `tokens.json` `color.brand.primary.desc` 追加使用边界："深色背景 #0A0A0A 下实测对比度 3.48:1，仅限 ≥ 44rpx 大字号（分享卡封面标题），不得下放到正文"；
2. `a11y/contrast-report.md` §2 边界项说明写入原文；
3. `share-cards/README.md` §1 A11Y 行同步约束。

---

## 2. 未改动的内容（理由）

- **5 条设计原则 D1~D5**：Reviewer 给 9/10 并指出"D2 情绪色使用边界略模糊"，本轮不扩——D2 已在原文表格写明"仅在支出超额/收入进账/庆祝达成三处使用"，三处枚举已足够明确；是否"还需要更细的情绪色分级模型"视 R2 Beta 用户反馈再定，暂不进系统规范。
- **16 组件清单**：清单范围与颗粒度未变；仅给交付标准加了"error 态"维度。
- **原 `role.amount` 已有 neutral 语义**：Reviewer §1 评分卡中"role 层未覆盖 `amount.neutral`"是笔误，实际 tokens.json `role.amount.transfer` 就承担了"跨期/转账/中性"语义（浅 `#616161` / 深 `#9E9E9E`），与 `text.secondary` 同色系刻意为之。如 Reviewer 仍建议新增独立 key 可在 Round-2 反馈。

---

## 3. 对 Review-Agent-Product 的复审请求

请按 Round-1 报告 §4 执行提示复核：

1. `a11y/contrast-report.md` 12 组组合是否覆盖齐？表格结构是否足够可审计？
2. `share-cards/safe-zone.md` + README §1 的统一安全区定义是否闭合 P1-2？
3. `tokens.json` `amount.compact` + design-system §4.2 引用链是否消除挤压风险？

附加复核：
- §3 组件交付 6 态是否涵盖必要场景？
- `motion.duration.reduced` + notes 是否足以指导 `theme.ts` 实现？
- `c-tab-bar` Sprint-0/Sprint-2 两阶段说明是否与 IA §2 完全一致？

**期望 Round-2 verdict**：PASS 或 PASS-WITH-FOLLOWUP（若 a11y 报告缺某组合需补）。

---

## 4. 元信息

- 修复耗时：约 40 分钟
- 影响文件：5 个（2 新建 + 3 修改）
- `tokens.json` version bump: 0.1.0 → 0.1.1
- 未触发红线、未新增 ADR

**Refs**: COSTRA-011 · **Impacts**: Epic-G 合规证据链、Sprint-3 share-card-composer、`c-input/c-amount-input` error 态强制、`services/theme.ts respectReducedMotion()`
