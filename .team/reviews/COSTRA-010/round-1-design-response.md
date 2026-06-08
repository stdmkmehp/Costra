# COSTRA-010 · Round-1 回执（Design-Agent → Review-Agent-Product）

- **被审 Agent**：Design-Agent
- **回执时间**：2026-04-23 20:30
- **Round-1 verdict**：REVISE（27/30 · 54/60）
- **本回执针对**：Round-1 报告 3 条 P1 + 3 条 P2，全部采纳闭合
- **Round-2 入口文件**：
  - `docs/design/ia.md`（v0.1.1）
  - `docs/design/user-story-map.md`（v0.1.1）
  - `docs/design/flows/login.md`（v0.1.1）

---

## 0. 总览

Round-1 评分 **54/60（27/30）**，无 P0，3 条 P1 + 3 条 P2，全部属于文档自洽 / 与契约字符级对齐层级的修正，无方案歧义，逐条闭合。

| 类别 | 条目 | 处置 | 文件 |
|---|---|---|---|
| P1-1 | 41 vs 44 点数不一致 | ✅ 采纳，加注脚说明 Walking Skeleton vs R1 | `user-story-map.md` §2.2 |
| P1-2 | login 缺"用户取消绑手机"分支 | ✅ 采纳，flows 补分支时序图 + IA §4.2 判定 3 | `flows/login.md` §4 / `ia.md` §4.1/4.2 |
| P1-3 | `:id` vs `{id}` 风格 | ✅ 采纳，§3.3 全部统一为 `{id}` | `ia.md` §3.3 |
| P2-1 | 扫码失效 code 兜底 | ✅ 采纳，§5.1 加脚注 | `ia.md` §5.1 |
| P2-2 | 主包 0.7MB 缓冲偏紧 | ✅ 采纳，§3.4 加硬警戒线 1.3MB | `ia.md` §3.4 |
| P2-3 | tabBar custom 对齐 design-system | ✅ 采纳，§2 加切换计划 | `ia.md` §2 |

---

## 1. 逐条回应

### P1-1 · MVP 最小路径 41 点 vs R1 44 点不一致 — ✅ FIXED

**原判**：§2.2 写 "41 点"、§3 表格写 "R1 · 44 点"，读者分不清 R1 到底含不含 COSTRA-103。

**修复**（`user-story-map.md` §2.2 末尾新增注脚）：

> **41 vs 44 差值说明**（Round-1 P1-1）：本节 41 点是 **Walking Skeleton 最窄闭环**——仅覆盖用户从进入到记一笔并看到统计的单线。§3 表格中的 R1 · 44 点额外包含 COSTRA-103 token 自动续签（3 点）：它是 Alpha 内测上线硬约束（token 过期 15min 不续签会频繁掉登录），但不属于最窄闭环。因此 **Walking Skeleton = 41 点，R1 交付范围 = 41 + 3 = 44 点**。

对 PM / 编排侧的影响：Sprint-1 必含 COSTRA-103；Sprint-1 排期点数按 R1 44 点的切片计。

---

### P1-2 · login 流程图未覆盖"手机号绑定被用户取消"分支 — ✅ FIXED

**原判**：用户拿到 token 但拒绝绑手机号时，MiniApp 端的行为（强拦截 vs 允许跳过）未定义，IA §4.2 无对应守卫判定。

**修复决策**：采用 Reviewer 建议项二 **"允许跳过、在关键操作再拦截"**。理由：
- MVP 阶段用户第一次进入小程序即被要求绑手机，实测弃率极高（类目调研数据）；
- 账本核心功能（记账/统计）不强依赖手机号；
- 仅在创建家庭 / 订阅消息 / 数据导出等"真正需要手机"的操作前拦截，用户心智更自然。

**修复 1**（`flows/login.md` §4）：手机号绑定时序图改为 `alt/else` 双分支，显式刻画"用户点击允许 → 200 成功"与"用户点击拒绝 → `errMsg = "getPhoneNumber:fail user deny"` + Toast 引导 + 不 redirect"。同时在图下补"分支策略"段，约定 7 天冷却期与关键操作触发列表。

**修复 2**（`ia.md` §4.1）：AuthPartial 定义加备注"用户可自由浏览 AuthRequired 页面（详见 §4.2 判定 3）"。

**修复 3**（`ia.md` §4.2）：守卫策略伪代码扩为 4 条判定（无 token / 过期 / AuthPartial 放行 / 异常兜底），其中判定 3 显式说明"不把未绑手机视为未登录，仅在关键操作前 `wx.showModal`"。

---

### P1-3 · `:id` vs `{id}` 风格不统一 — ✅ FIXED

**修复**（`ia.md` §3.3）：全局替换 `:id` → `{id}`，共 3 处：
- `GET /v1/families/:id` → `GET /v1/families/{id}`
- `POST /v1/families/:id/invites` → `POST /v1/families/{id}/invites`
- `GET/PATCH/DELETE /v1/families/:id/members` → `GET/PATCH/DELETE /v1/families/{id}/members`

**自检**：`grep "/:id"` 返回 0 条，`grep "{id}"` 与 OpenAPI `server/api/openapi.yaml` v0.1 对齐。

---

### P2-1 · 扫码失效 code 兜底 — ✅ FIXED

**修复**（`ia.md` §5.1 表格后新增脚注）：明确三档兜底：
- `code` 为空或格式非法 → "邀请链接无效" + 返回首页；
- 服务端返 `invitation_expired/revoked/exhausted` → 展示对应文案；
- 5xx → "稍后再试" toast + 允许重试。

对 Backend：`POST /v1/families/join` 4xx 返回需支持这 3 个 reason code。这一约束同步给 Backend-Agent 做 COSTRA-020 下一轮增量。

---

### P2-2 · 主包 0.8MB / 红线 1.5MB 缓冲偏紧 — ✅ FIXED

**修复**（`ia.md` §3.4 表格后新增硬约束）：
- CI 侧 `size-check.mjs` 对 `main` 分支包体硬警戒线从 1.5MB 下调为 **1.3MB**（留 0.2MB 安全垫），超过 block PR；
- 任何新增主包页面或 >50KB 依赖，PR 前必须本地跑 `npm run size-check`；
- 确需突破走 ADR 决策。

对 DevOps：这是对 COSTRA-040 size-check 阈值的规范性约束，后续 `scripts/mp-ci/size-check.mjs` 实现时按 1.3MB 写死 `MAIN_PKG_HARD_LIMIT`。

---

### P2-3 · tabBar custom 与 design-system `c-tab-bar` 有微差 — ✅ FIXED

**修复**（`ia.md` §2 说明段后新增切换计划）：Sprint-0 骨架期保持 `custom: false`；Sprint-2 D1 配合 design-system `c-tab-bar` 深色模式/红点/Badge 上线时切换到 `custom: true` + `pages/custom-tab-bar/index`，单独 PR + 全量回归。

这也解释了为什么 COSTRA-011 design-system 的 `c-tab-bar` 组件在 Sprint-0 没有直接挂到 `app.json`——是故意的分阶段上线。

---

## 2. 没有改动的内容（理由）

- **§3.3 家庭面板 / 统计总览 / 成员管理 / 预算设置 / 订阅消息的其他字段**：原样不动，与 OpenAPI v0.1（COSTRA-020 Round-2 已交付）完全对齐；
- **§5.2 关键跳转链路**：未来若有"从分享卡片直接打开 entry-detail"类新场景再扩；
- **§6 关键流程时序索引**：4 条 flows 已齐备，本轮不新增。

---

## 3. 对 Review-Agent-Product 的复审请求

请按 Round-1 报告 §4 执行提示复核以下三项：

1. `user-story-map.md` §2.2 注脚是否清晰？
2. `flows/login.md` §4 分支图 + 策略段、`ia.md` §4.2 判定 3 组合是否闭合"未绑手机拒绝"场景？
3. `ia.md` §3.3 `{id}` 风格是否全局一致？

附加复核（P2 项，可选）：
- `ia.md` §5.1 脚注 3 档兜底是否齐全？
- §3.4 硬警戒线 1.3MB 是否合理？
- §2 tabBar custom 切换计划时机（Sprint-2 D1）是否与 Design-System 交付节奏一致？

**期望 Round-2 verdict**：PASS 或 PASS-WITH-FOLLOWUP（若 P2 项某条被要求强化）。

---

## 4. 元信息

- 修复耗时：约 38 分钟
- 影响文件：3（`ia.md` / `user-story-map.md` / `flows/login.md`）
- 未触发红线、未新增 ADR、未变更分包策略
- 下一步：等待 Round-2 复审；若 PASS 则并入 SPRINT-0-SUMMARY

**Refs**: COSTRA-010 · **Impacts**: COSTRA-020（join 4xx reason code）、COSTRA-040（size-check 1.3MB）、COSTRA-011（c-tab-bar 上线时机）
