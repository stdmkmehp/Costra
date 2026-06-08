# COSTRA-020 · Round-1 · Review-Agent-Tech

- **被审产物**：`server/api/openapi.yaml` v0.1（+ `docs/api/README.md`）
- **被审 Agent**：Backend-Agent
- **评审人**：Review-Agent-Tech（独立实例）
- **评审时间**：2026-04-23 20:22
- **Sprint**：Sprint-0 补审
- **轮次**：1
- **强制上下文**：`docs/PRD.md` v0.1、`docs/design/ia.md`、`docs/db/schema.md`、ADR-0002 / ADR-0004 / ADR-0006、D-006~D-009

> ⚠️ **评审范围界定**：COSTRA-020 的 5 项 G3 follow-up 已在 **COSTRA-100（今天 20:14 PASS · 30/30）** 完整闭环。本 review **不重复审 COSTRA-100 已审内容**（error-codes.md / ErrorCode 枚举 / `*_ttl_sec` / id-strategy.md / sync-protocol.md），仅聚焦 **Sprint-0 锁时刻 v0.1 原生产出**与**COSTRA-100 未覆盖的遗漏项**。

---

## 0. 独立声明

独立实例，未被 Backend-Agent 引导，依据产物与契约独立评审。

---

## 1. 评分卡（30 分制 · 参考 `07-review-agent-tech.md`）

| 维度 | 满分 | 得分 | 说明 |
|---|---|---|---|
| 契约完整性 vs PRD | 6 | **5** | 7 Epic 端点基本覆盖；`/notifications/subscribe-template` 端点存在但订阅消息**下发触发端点**缺失（见 P1-1）|
| Schema 合规 / 命名一致性 | 6 | **5** | snake_case 全一致；金额 int64 分制 OK；**`MonthlyReport.by_category` 的 `ratio` 用 float 可能产生浮点隐患**（见 P1-2）|
| 错误/冲突/审计/幂等模型 | 6 | **6** | COSTRA-100 已闭环，30/30 |
| 与 DB schema / ADR 对齐 | 6 | **4** | **路径变量 `family_id` vs schema `owner_user_id` 字段命名**：API 无明显问题；但 **OpenAPI 完全缺 `accounts` 资源**（见 P0-1）|
| 可实施性 / Sprint-1 可消费 | 6 | **5** | Backend 拉起后基本可跑 COSTRA-101/104；`servers` 列的域名**与 D-009 锁定 costra.cloud 不一致**（见 P0-2）|
| **合计** | **30** | **25** | |

---

## 2. Findings

### 🔴 P0（阻断 / 必改）

- **P0-1 · OpenAPI 完全缺 `accounts`（资金账户）资源端点**
  - **位置**：`server/api/openapi.yaml` paths 段
  - **问题**：DB schema §3.4 `accounts` 是核心表之一，PRD COSTRA-111（账户管理）对应 Story 估 5 点，IA §3.1 明确有 `pages/accounts/index` 与 `pages/account-edit/index` 两页；但 OpenAPI v0.1 **完全没有 `/accounts` / `/accounts/{id}` 端点**。
  - **影响**：Sprint-1 COSTRA-104 要做 `/entries` CRUD 时，client 必须先选 `account_id`，但此值无法从后端拿到。**MiniApp 端到端链路断裂**。
  - **建议**：补 `/accounts GET`、`/accounts POST`、`/accounts/{account_id} GET/PATCH/DELETE`，以及对应的 `Account` / `AccountCreate` / `AccountUpdate` schemas。
  - **Sprint-1 必修**：D1 前闭合，否则阻塞 COSTRA-104。

- **P0-2 · `servers` 列域名与 D-009 决议不一致**
  - **位置**：`server/api/openapi.yaml` L22-28
  - **问题**：当前写的是 `api.costra.local` / `api-staging.costra.example.com` / `api.costra.example.com`。但 D-009（2026-04-23 13:00 生效）已正式锁定生产域名为 **`costra.cloud`**，生产 API 入口为 **`api.costra.cloud`**。
  - **影响**：CI 校验脚本（COSTRA-115，DNS 白名单 vs OpenAPI `servers` 一致性）**会直接 fail**。微信后台"服务器域名"白名单也会因此配错。
  - **建议**：三行直接改为：
    - `https://api.costra.local/v1`（本地保持）
    - `https://api-staging.costra.cloud/v1`
    - `https://api.costra.cloud/v1`
  - **Sprint-1 必修**：D1 前闭合，COSTRA-115 依赖。

### 🟠 P1

- **P1-1 · 缺订阅消息"主动下发"端点**
  - **位置**：paths 段 `notifications` 标签下只有 `/notifications/subscribe-template`（记录授权）
  - **问题**：授权只是上半链路。下半链路"后端在预算超支/家庭新增记账/周报时调微信 `sendMessage`"的内部触发，PRD COSTRA-302 明确是 Sprint-2 AC，但**契约层完全没建模**。MVP 最晚到 Sprint-4 才会发，但契约 v0.1 就该占位。
  - **建议**：不需要对外端点（服务端内部触发），但应在 `components.schemas` 增一个 `SubscribeMessageJob` schema（含 template_id / openid / scene / payload 约定），便于 Backend 工程与 DevOps COSTRA-040 的队列消费对齐。
  - **优先级**：P1 ·  Sprint-2 前闭合。

- **P1-2 · `MonthlyReport.by_category.ratio` 用 float**
  - **位置**：L979 `ratio: { type: number, format: float, description: 0~1 }`
  - **问题**：整个契约 "禁止浮点金额" 是硬约束，这里 `ratio` 虽非金额但会出现"支出占比 33.33%"这种场景；serialize/deserialize 多端可能产出不同小数（JS 双精度 vs JVM float）。
  - **建议**：改为 `ratio_bp: integer (0~10000)`（万分比，bp），客户端渲染时除以 100 显示为百分比两位小数。与金额分制一致。
  - **影响**：前后端协同 Sprint-5 才会真用到，但契约 v0.1 就该定死。

- **P1-3 · `/families/{family_id}` 无 DELETE**
  - **位置**：paths 段
  - **问题**：schema §3.2 families 有 `deleted_at`（软删），但 OpenAPI 没暴露"解散家庭"端点。即便 MVP 不做 UI 入口，契约层应占位。
  - **建议**：补 `DELETE /families/{family_id}`（仅 owner，需带 version）。

- **P1-4 · `EntryUpdate` 缺 `type` 字段**
  - **位置**：L856 schema EntryUpdate
  - **问题**：`EntryCreate` 有 `type`（income/expense/transfer），但 `EntryUpdate` 不允许改 type。从业务上，用户"记错了类型"想改是合理场景。
  - **建议**：要么显式在 description 说明"type 不可修改"（DB 层也要一致），要么补上 type 允许修改（此时需同步维护 transfer_peer_entry_id 一致性）。
  - **推荐选项**：保守方案——禁止修改 type，在 description 明确说明"修改 type 请删除后新建"。

### 🟡 P2

- **P2-1 · `EntryCreate.currency` 有 default，`Ledger.currency` 也有 default**，两者理应一致（都是 CNY 默认），建议 `EntryCreate` description 明确"若 ledger 已锁定 currency，创建时必须一致，否则返回 `BUSINESS_RULE_VIOLATION`"。
- **P2-2 · `sync/pull` 的 `since` 用 ISO-8601 string**，但 `sync/push` 的 `base_version` 用 integer。**拉用时间、推用 version**，概念割裂。建议两边统一：要么都用 version（与 schema.sync_versions.max_version 对齐），要么都用时间（与 schema.updated_at 对齐）。`sync-protocol.md`（COSTRA-100 产出）应已讨论过；Round-2 请 Backend-Agent 确认。
- **P2-3 · `ConflictError` 的 `server_record`  `additionalProperties: true`** 过于宽松；建议用 oneOf `#/components/schemas/Entry | Category | Budget | ...`。
- **P2-4 · `Idempotency-Key` 描述已强 ✅**（COSTRA-100 补齐），无新问题。

---

## 3. Verdict

> **REVISE**

**原因**：P0-1（缺 accounts）/ P0-2（域名漂移）都直接阻塞 Sprint-1 开发。必须 Round-2 前闭合。P1-1~P1-4 建议一并修。

**自动循环决策**：round 1 < 5，**有 P0 但不是红线级**（红线定义：Backend 反驳 P0 或触发 STOP；本处 P0 是 Backend 未做/做错，可以修）→ **进入自动 Round 2**。

---

## 4. 对 Backend-Agent 的执行提示

1. P0-1 补 accounts 资源（1 小时工作量）；
2. P0-2 改 3 行 servers URL（5 分钟）；
3. P1-2 ratio → ratio_bp（契约改动，但无实现代码，改动成本低）；
4. P1-1/P1-3/P1-4 按顺序补。

---

## 5. 元信息

- 评审耗时：约 18 分钟
- 独立判定：✅
- Human 介入：否（P0 可由 Backend 修）
- **备注**：COSTRA-100 已审部分（error-codes / ErrorCode 枚举 / *_ttl_sec / id-strategy / sync-protocol）**本次不重复扣分**；若有改动将以 FINAL 汇总视角一并记录。

**Refs**: COSTRA-020 · **Impacts**: `server/api/openapi.yaml` v0.1 → v0.2
