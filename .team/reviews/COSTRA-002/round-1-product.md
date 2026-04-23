# COSTRA-002 · Round-1 · Review-Agent-Product

- **被审产物**：`docs/PRD.md` v0.1（7 Epic · 21 Story · 113 点）
- **被审 Agent**：PM-Agent
- **评审人**：Review-Agent-Product（独立实例）
- **评审时间**：2026-04-23 20:14
- **Sprint**：Sprint-0 补审
- **轮次**：1
- **强制上下文**：`docs/charter.md` v2.2、`docs/design/user-story-map.md`、`docs/design/ia.md`、`docs/api/README.md`、`api/openapi.yaml`、D-006~D-009

---

## 0. 独立声明

独立实例，依据产物与契约评审。

---

## 1. 评分卡（60 分制）

| 维度 | 满分 | 得分 | 说明 |
|---|---|---|---|
| 产品目标清晰度 | 10 | **9** | Epic/Story 粒度清晰；MVP 边界在 PRD 内明确 |
| 用户价值论证 | 10 | **8** | 每 Epic 有"为什么"；部分 Story（如 COSTRA-204 成员与角色）价值论证偏薄 |
| 可验收性（AC/DoD）| 10 | **7** | Story AC 颗粒度**不均**：COSTRA-113/301 很细，COSTRA-502/503（统计饼图/趋势）AC 只到"展示图表"层 |
| 风险/依赖识别 | 10 | **9** | 依赖箭头清楚；少量跨 Sprint 依赖（如 504 年度报告 → 分享卡）未显式标 |
| 与 charter / IA / OpenAPI 一致性 | 10 | **8** | Epic 与 IA 页面 1:1 对齐；**Story AC 中的 API 路径与 OpenAPI 偶有不同**（见 P1-1） |
| 术语 / 可读性 / 引用完整性 | 10 | **9** | 读起来顺；部分术语（"结余" vs "净额"）可统一 |
| **合计** | **60** | **50** | |

**换算 30 分制**：50 × 30/60 = **25/30**

---

## 2. Findings

### 🔴 P0

_无_

### 🟠 P1

- **P1-1 · Story AC 中的 API 路径/字段与 OpenAPI 偶有漂移**
  - **位置**：`docs/PRD.md` COSTRA-121（本地兜底）AC 写 `/sync/pull`，COSTRA-122 AC 写 `/sync/push`；OpenAPI v0.1 (`api/openapi.yaml`) 中前者标 `GET /v1/sync/pull`、后者标 `POST /v1/sync/push`。**PRD 未带版本前缀 `/v1`**，IA 内则统一带。
  - **问题**：PRD/IA/OpenAPI 三者路径不完全对齐，Sprint-1 开发时会被反复追问"谁是 SoT"。
  - **建议**：PRD 全局补 `/v1` 前缀，统一以 **OpenAPI = 路径 SoT**、**PRD = 业务语义 SoT** 分工。
  - **影响**：Sprint-1 COSTRA-104 开发前必须闭合。

- **P1-2 · 统计 Epic（F）Story AC 过浅**
  - **位置**：COSTRA-501/502/503/504
  - **问题**：AC 写到"展示月度卡片 / 饼图 / 折线图 / 年度报告"即止，**未对"空数据态 / 跨月无记录 / Top N 截断策略 / 时区"等边界做 AC 约束**。
  - **建议**：每个 Story 追加 3 条边界 AC（空态 / 跨期边界 / 时区/分享），篇幅不大但能把 Sprint-5 工作量锁死。

- **P1-3 · COSTRA-203（订阅消息授权）与 COSTRA-302（超支下发）AC 未写 7 天时效**
  - **位置**：COSTRA-203 AC / COSTRA-302 AC
  - **问题**：微信"一次性订阅消息"策略是 7 天内可下发 N 次、"长期订阅"有类目限制。PRD 没说明选哪种、配额策略是什么，直接影响 DevOps COSTRA-040 的幂等键设计。
  - **建议**：明确"采用一次性订阅、单授权 1 次下发、下发不成功时的降级策略（如 fallback 到 APP 内红点）"。

### 🟡 P2

- **P2-1 · Epic-G "Won't-Have"未回灌 D-008 的虚拟支付/企业接口/对公 SDK 三项**（同 COSTRA-001 P1-2 根源，两个产物都要改）。
- **P2-2 · Persona C（家庭成员）**在 PRD 中出现频率低于 A/B；家庭 Epic 章节可多一次点名。
- **P2-3 · 估点方法脚注** Story 用斐波那契（1/2/3/5/8），但 PRD 未在前言声明估点规则；Sprint-1 新加入 Agent 读不到上下文会困惑。

---

## 3. Verdict

> **REVISE**

**原因**：P1-1 是跨文档 SoT 一致性问题，必须 Sprint-1 D1 前闭合；P1-2/P1-3 是 AC 完整性问题，影响后续 Epic-E/F 开发效率。

**自动循环决策**：round 1 < 5，无 P0，无红线 → **进入自动 Round 2**。

---

## 4. 对 PM-Agent 的执行提示

1. **P1-1 优先**：一次 sed 替换 PRD 里所有 `/auth/*`、`/ledger/*`、`/sync/*`、`/families/*`、`/budgets/*` 补 `/v1` 前缀；
2. P1-2 批量加 AC，每个 Story 3 条边界；
3. P1-3 单条 AC 即可。

---

## 5. 元信息

- 评审耗时：约 14 分钟
- 独立判定：✅
- Human 介入：否

**Refs**: COSTRA-002 · **Impacts**: `docs/PRD.md` v0.1 → v0.2
