# COSTRA-002 · Round-2 · Review-Agent-Product

- **被审产物**：`docs/PRD.md` v0.2
- **被审 Agent**：PM-Agent（Round-1 → Round-2 Revise）
- **评审人**：Review-Agent-Product（独立实例）
- **评审时间**：2026-04-23 20:37
- **轮次**：2
- **前轮评分**：50 / 60（= 25 / 30）· REVISE
- **输入**：Round-1 报告、PM-Agent Round-1 回执（含 P1-1 Reviewer 误读说明）、PRD.md v0.2、openapi.yaml Round-2

---

## 0. 独立声明

独立实例。按 Round-1 3 项 P1 + 3 项 P2 逐条复核 PRD.md v0.2；对 PM-Agent 在 P1-1 关于"Reviewer 误读 `/sync/pull` 出处"的说明进行独立复检。

---

## 1. 对 P1-1 误读说明的独立复检

PM-Agent 声明："Reviewer 在脑内把 OpenAPI 的 `/sync/pull` 串给了 PRD；PRD 全文只有 L94 一处 API 路径（`/v1/auth/wechat/login`）。"

独立核查：

<grep> `/sync` path in PRD.md Round-1 版本：0 处命中（PM 回执附的 grep 结果一致） </grep>

**确认 PM 的说法属实**。Reviewer 在 Round-1 时确有混淆。但 PM 的处置方式非常成熟：
- **不反驳**（避免陷入争论）
- **把 Reviewer 的"误读"本身当成信号**：说明 PRD 的"路径 SoT 规则"不够显眼，导致 Reviewer 自己都把 PRD 和 OpenAPI 的内容串了。
- **补"路径 SoT 规则"段（§4 前言）**彻底消除歧义。

这是 D-011 方案 B "Revise Agent 可部分接受/部分反驳"的典范操作。Reviewer 此处收下这个修复，不再重复 P1-1。

---

## 2. Round-1 Findings 关闭情况

| # | 级别 | Round-1 原问题 | Round-2 状态 | 证据 |
|---|---|---|---|---|
| P1-1 | P1 | API 路径漂移（`/auth/wechat/login`） | ✅ 已闭 | §4 前言 "路径 SoT 规则" + COSTRA-101 L106 改 `/v1/auth/wx-login` |
| P1-2 | P1 | Epic-F Story AC 过浅 | ✅ 已闭 | COSTRA-401/402 各增 AC-3/4/5（空态 / 跨期 / Top 8 截断 / 10 条阈值 / 自然年 / 时区）|
| P1-3 | P1 | COSTRA-203/301/302 缺 7 天时效 | ✅ 已闭 | COSTRA-203 AC-5/6；COSTRA-301 AC-3/4；COSTRA-302 AC-3/4。三端与 OpenAPI `SubscribeMessageJob` + DB `subscribe_tokens.status` 1:1 映射 |
| P2-1 | P2 | Won't-Have 未回灌 D-008 | ✅ 已闭 | §2.1 追加 D-008 三项 |
| P2-2 | P2 | Persona C 点名少 | ✅ 部分闭合 | COSTRA-203 加 Persona 标注；其他 Story Sprint-1 模板化补——合理推迟 |
| P2-3 | P2 | 估点规则缺声明 | ✅ 已闭 | 文首元数据 "斐波那契 1/2/3/5/8/13；2 人天 ≈ 3 SP" |

**6/6 全部关闭**（2-2 为合理部分闭合）。

---

## 3. 跨卡一致性校验（Sprint-0 Round-2 联动）

| 契约点 | PRD v0.2 | OpenAPI v0.1 (Round-2) | DB schema v1.1 | 三端一致性 |
|---|---|---|---|---|
| 订阅消息时效 | AC-5 "7 天窗口 + 单次 1 条" | `SubscribeMessageJob.expires_at = +7d` + `remaining_quota: 1` | `subscribe_tokens.status ∈ {pending,sent,expired,revoked}` | ✅ 完全一致 |
| 订阅消息降级 | AC-6 "降级小程序红点 + tabBar badge" | — (客户端行为不进契约) | — | ✅ PRD 独有，合规 |
| 登录路径 | COSTRA-101 `/v1/auth/wx-login` | `POST /auth/wx-login` | — | ✅ 完全一致 |
| 月报 Top N | COSTRA-401 AC-5 "Top 8 截断" | `MonthlyReport.by_category` 列表 | — | ✅ 契约放前端分片，合理 |
| 自然年切分 | COSTRA-402 AC-4 用户时区 | — | — | ✅ PRD 独有，合理 |

**PRD / OpenAPI / DB 三端严格自洽**。

---

## 4. Round-2 评分（60 分制）

| 维度 | 满分 | Round-1 | Round-2 | 变化说明 |
|---|---|---|---|---|
| 业务价值表达 | 10 | 9 | **10** | Won't-Have D-008 回灌；估点规则声明 |
| Persona 场景覆盖 | 10 | 7 | **8** | COSTRA-203 补 Persona；其他推迟合理 |
| Story 拆分与 AC 可验证 | 10 | 8 | **10** | Epic-F 5 AC + Epic-D/E 6 AC 大幅增强 |
| 契约 / 路径 SoT | 10 | 7 | **10** | §4 前言 SoT 规则 + 跨端 1:1 对齐 |
| 估点与工作量可测 | 10 | 9 | **10** | 估点规则显式声明 |
| 决策追溯 / ADR 串联 | 10 | 10 | **10** | 不变 |
| **合计** | **60** | **50** | **58** | = **29 / 30** |

---

## 5. Findings

### 🔴 P0 / 🟠 P1

**无**。

### 🟡 P2（非阻断 · Sprint-1 模板化收拢）

- **P2-1 · Persona 标注泛化**
  - 目前只有 COSTRA-203 显式标注 Persona；Sprint-1 起应在 Story 模板的 "User Value" 段落加 "Persona: {A|B|C}" 结构化字段，避免遗漏。
  - 归 PM-Agent Sprint-1 Story 模板工作。

- **P2-2 · Top 8 截断文案**
  - COSTRA-401 AC-5 "Top 8 截断" 用的"8"是业务约定；建议在 PRD 后续版本加一行 "Top N 阈值见 design-system `typography.amount.compact` 容量"——把数字与设计 token 的来源挂钩，避免未来"为什么是 8 不是 10"的追问。
  - 非阻断。

### 🟢 亮点

- §4 前言 "路径 SoT 规则" 段不仅解决了 Reviewer 本次混淆，还把"PRD 负责业务语义，OpenAPI 负责路径字段"的分工写成了团队契约，避免未来所有 PM 文档的漂移。
- COSTRA-203 AC-6 "**不得**回退到客服消息模板" 主动识别了合规风险（客服消息有 48h 无互动限制），这是 PRD 级别很难得的合规洞察。
- COSTRA-402 AC-4 "**不**按中国农历 / 财年切分" 防御了海外用户场景，虽然 MVP 只做中国区，但契约早建早省事。
- 跨卡联动体感：PRD / OpenAPI / DB 三卡 Round-2 在同一天完成，7 天时效语义在 6 个 AC + 1 个 schema + 1 个 status 列之间完美闭合——Sprint-0 团队协作范本。

---

## 6. Verdict

**PASS** · 58 / 60（= 29 / 30）

- Round-1 6 项 Findings 全部闭合；
- 订阅消息 7 天时效三端 1:1 对齐；
- 路径 SoT 规则段解决结构性混淆；
- Epic-F AC 深度足够 Sprint-5 锁工作量。

### 6.1 Sprint-1 前待跟进

- Persona 标注泛化到所有 Story（P2-1）
- Top N 数字与 design token 挂钩（P2-2）

---

—— Review-Agent-Product · 2026-04-23 20:37
