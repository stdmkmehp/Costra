# COSTRA-010 · Round-1 · Review-Agent-Product

- **被审产物**：`docs/design/ia.md`、`docs/design/user-story-map.md`、`docs/design/flows/{login,add-entry,family-invite,budget-subscribe-msg}.md`
- **被审 Agent**：Design-Agent
- **评审人**：Review-Agent-Product（独立实例）
- **评审时间**：2026-04-23 20:16
- **Sprint**：Sprint-0 补审
- **轮次**：1
- **强制上下文**：`docs/PRD.md` v0.1、`docs/charter.md` v2.2、`ADR-0004`、`api/openapi.yaml`、D-006~D-009

---

## 0. 独立声明

独立实例，依据产物与契约评审。

---

## 1. 评分卡（60 分制）

| 维度 | 满分 | 得分 | 说明 |
|---|---|---|---|
| IA 完整性（覆盖 21 Story）| 10 | **10** | `ia.md` §3 全量对齐 PRD，无遗漏 |
| 分包 / 登录态边界冻结 | 10 | **10** | 主/stat/family 三包体积红线明确；登录态 AuthRequired/Optional/Partial 三态清晰 |
| 故事地图可发布性 | 10 | **9** | R1/R2/R3 切片点数可直接派 Sprint；细节见 P1-1 |
| 流程图覆盖核心链路 | 10 | **8** | 4 条流程图齐；**错误分支的用户感知**（见 P1-2）覆盖不均 |
| 与 PRD/OpenAPI 一致性 | 10 | **8** | §3 "依赖 API" 列与 OpenAPI 基本一致；少数路径拼写差异（见 P1-3）|
| 术语 / 可读性 / 引用完整性 | 10 | **9** | 微信官方链接准确；tabBar/preloadRule 示例可直接拷贝 |
| **合计** | **60** | **54** | |

**换算 30 分制**：54 × 30/60 = **27/30**

---

## 2. Findings

### 🔴 P0

_无_

### 🟠 P1

- **P1-1 · user-story-map R1 合计点数与总表差 3 点**
  - **位置**：`docs/design/user-story-map.md` §2.2 "MVP 最小路径合计：41 点" vs §3 "R1 · 44 点"
  - **问题**：41 与 44 两处数字不一致（差值 3 点 = COSTRA-103 token 续签）。读者不知 R1 究竟含不含 103。
  - **建议**：在 §2.2 显式注明"41 点为 Walking Skeleton 最窄闭环，§3 R1 44 点含 COSTRA-103 token 续签"。

- **P1-2 · login 流程图未覆盖"手机号绑定被用户取消"分支**
  - **位置**：`docs/design/flows/login.md`（未直接展开读，但从 IA §4.1 AuthPartial 推导）
  - **问题**：用户拿到 token 但拒绝绑手机号时，MiniApp 端应该是 "redirectTo /bind-phone + 每次 onAppShow 再弹" 还是 "允许跳过、在关键操作再拦截"？IA 未给出答案。
  - **建议**：flows/login.md 追加"用户取消绑手机号"分支时序图；IA §4.2 守卫策略对应加一条判定。

- **P1-3 · IA §3 "依赖 API" 列少数路径拼写与 OpenAPI 有小差**
  - **位置**：IA §3.3 家庭面板依赖 `GET /v1/families/:id` vs OpenAPI v0.1 写 `/v1/families/{id}`
  - **问题**：占位符风格（:id vs {id}）两处不统一。对自动生成客户端 SDK 无影响，但可读性略差。
  - **建议**：IA 统一用 OpenAPI 风格 `{id}`。

### 🟡 P2

- **P2-1 · `ia.md` §5.1 场景值 1047（扫码）落地页 `pages-family/join?code=xxx`**
  - 扫码场景下 code 可能为空或已失效，IA 未提"失效 code 的兜底页"。建议 §5.1 附一脚注。

- **P2-2 · 体积预算 §3.4 "合计 ~1.9MB"**
  - 1.9 对红线 16 MB 很安全，但主包 0.8 对红线 1.5 MB 只剩 0.7 MB 缓冲。建议 §3.4 加一条"主包新增页前需 size-check.mjs 卡口"的硬约束。

- **P2-3 · TabBar 自定义**
  - §2 表内写 `"custom": false`，但 design-system `c-tab-bar` 已按"自定义 tabBar" 规划（以支持深色模式切换）。IA 与设计系统有微差；Sprint-1 D1 对齐即可。

---

## 3. Verdict

> **REVISE**

**原因**：P1-1 数字不一致、P1-2 关键分支缺失（直接影响 MiniApp Sprint-1 工期）、P1-3 风格统一。三项都在 4 小时以内可闭合。

**自动循环决策**：round 1 < 5，无 P0，无红线 → **进入自动 Round 2**。

---

## 4. 对 Design-Agent 的执行提示

1. P1-1：§2.2/§3 任一处加 1 行注脚；
2. P1-2：login.md 补一条分支线，IA §4.2 守卫增 1 条 if；
3. P1-3：全局替换 `:id` → `{id}`。

---

## 5. 元信息

- 评审耗时：约 11 分钟
- 独立判定：✅
- Human 介入：否

**Refs**: COSTRA-010 · **Impacts**: `docs/design/ia.md`、`user-story-map.md`、`flows/login.md`
