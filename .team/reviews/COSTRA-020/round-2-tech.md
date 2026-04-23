# COSTRA-020 · Round-2 · Review-Agent-Tech

- **被审产物**：`server/api/openapi.yaml` v0.1（Round-2 修订后）
- **被审 Agent**：Backend-Agent（Round-1 → Round-2 Revise）
- **评审人**：Review-Agent-Tech（独立实例）
- **评审时间**：2026-04-23 20:37
- **轮次**：2
- **前轮评分**：25 / 30 · REVISE
- **输入**：Round-1 报告、Backend-Agent Round-1 回执、openapi.yaml Round-2

---

## 0. 独立声明

独立实例。依据 Round-1 问题清单逐条复核 openapi.yaml Round-2 文本 + Backend 回执交叉验证。未与 Backend-Agent 对话。

---

## 1. Round-1 Findings 关闭情况

| # | 级别 | Round-1 原问题 | Round-2 状态 | 证据 |
|---|---|---|---|---|
| P0-1 | P0 | OpenAPI 缺 `accounts` 资源端点 | ✅ 已闭 | `/accounts` L323 + `/accounts/{account_id}` L362 四方法齐全；`Account`/`AccountCreate`/`AccountUpdate` schemas L920+；`Entry.account_id/to_account_id` L1037/L1074 |
| P0-2 | P0 | `servers` 域名与 D-009 冲突 | ✅ 已闭 | L22-30 四档：localhost / 49.235.216.20 / api-staging.costra.cloud / api.costra.cloud，完全锁定到 D-009 |
| P1-1 | P1 | 缺 `SubscribeMessageJob` 刻画 | ✅ 已闭 | schema `SubscribeMessageJob` L1230+；响应 201 L707；四态 pending/sent/expired/revoked + expires_at 7d + idempotency quota |
| P1-2 | P1 | `ratio: float` 精度隐患 | ✅ 已闭 | `ratio_bp: integer` L1210，说明 `ratio_bp / 100` 展示两位小数百分比 |
| P1-3 | P1 | `/families/{family_id}` 缺 DELETE | ✅ 已闭 | L226-246：仅 owner + version 乐观锁 + Idempotency-Key，级联软删描述明确 |
| P1-4 | P1 | `EntryUpdate` 未声明 `type` 不可改 | ✅ 已闭 | L1086-1089 description 明确 "**不可修改**，若需改变 type 请先 delete 再 create。DB 层有相同约束" |

**6/6 全部关闭**。

---

## 2. Round-2 评分

| 维度 | 满分 | Round-1 | Round-2 | 变化说明 |
|---|---|---|---|---|
| 契约完整性 vs PRD | 6 | 5 | **6** | accounts 补齐；SubscribeMessageJob 刻画完整；覆盖 PRD 7 Epic |
| Schema 合规 / 命名一致性 | 6 | 5 | **6** | ratio_bp 整数；snake_case 全一致；`AccountUpdate` 显式声明 kind/currency/balance 不可改 |
| 错误/冲突/审计/幂等模型 | 6 | 6 | **6** | 维持；DELETE /families 和 subscribe job 均含 Idempotency-Key |
| 与 DB schema / ADR 对齐 | 6 | 4 | **6** | `Account.kind` 六枚举与 COSTRA-021 Round-2 `accounts.type` 一致（两侧一致，详见 §3 一致性分析）；D-009 对齐 |
| 可实施性 / Sprint-1 可消费 | 6 | 5 | **6** | 开发机 IP 入 servers 方便联调；解散家庭契约占位完备 |
| **合计** | **30** | **25** | **30** | |

---

## 3. 交叉契约一致性分析（重点）

### 3.1 OpenAPI `Account.kind` ↔ DB `accounts.type`

- OpenAPI: `Account.kind` 六枚举 `cash/bank_card/credit_card/e_wallet/prepaid_card/other`
- DB schema v1.1: `accounts.type` 同六枚举（COSTRA-021 Round-2）

**字段命名差异刻意保留**（方案 B · D-008 领域约定）：
- API 对外 `kind`（JS 保留字冲突最小）
- DB 列名 `type`（SQL 风格）
- Backend 映射层 ORM 做双向 rename，一次收敛

**这是刻意设计而非 bug**。Backend 回执 §1.2 明确声明。Reviewer 接受此方案。

### 3.2 OpenAPI `Entry.type` ↔ DB `ledger_entries.type`

- OpenAPI: `Entry.type`（income/expense/transfer）
- DB: `ledger_entries.type` 同三枚举（COSTRA-021 Round-2 从 kind 改 type）

**两边均为 `type`，完全一致**。COSTRA-021 Round-2 方案 B 选择 "DB+API 都用 type" 决策成立。

### 3.3 OpenAPI `Entry.to_account_id` ↔ DB `ledger_entries.to_account_id`

- OpenAPI L1038/L1076: `to_account_id` transfer 必填
- DB schema v1.1 §3.5: `to_account_id UUID NULL` + CHECK 约束（type=transfer 时 NOT NULL 且 ≠ account_id）

**两端 1:1 对齐**。CHECK 约束在服务层之外给最后一道兜底。

### 3.4 OpenAPI `SubscribeMessageJob.status` ↔ DB `subscribe_tokens.status`

- OpenAPI 四态: `pending/sent/expired/revoked`
- DB schema v1.1 §3.8: `subscribe_tokens.status` 同四态 + 默认 `pending`

**一致**。Backend 回执 §1.3 与 DB schema §3.8 两处描述对齐。

### 3.5 `ratio_bp` 命名一致性

- 行业约定 "basis point" 缩写通常为 `bps`（basis points），但 `bp` 在中文金融语境也通用（尤其"千分之几"/"万分之几"写作 "N bp"）
- Backend 选择 `ratio_bp`（单数）语义更清晰："占比 in basis points"
- 与 DB 不冲突（DB 层报表是聚合查询结果，不落表）

**建议保留 `ratio_bp`，不强制改 `ratio_bps`**。

---

## 4. Findings

### 🔴 P0

**无**。

### 🟠 P1

**无**。

### 🟡 P2（可选优化 · 不阻断 PASS）

- **P2-1 · `SubscribeMessageJob.remaining_quota` 默认值**（Sprint-1 可观察）
  - 当前 schema 未显式写 default 值；建议加 `default: 1` 便于客户端/后端做默认登记。
  - **非阻断**：Backend 实施时默认行为也是 1，契约层面不写不会导致实施歧义。

- **P2-2 · `/accounts` `include_archived` 默认行为**（Sprint-1 联调时观察）
  - 查询参数 `include_archived` 建议显式 `default: false`（当前为 boolean 无默认），避免客户端各自默认不一致。
  - **非阻断**：语义清晰（archive flag 在 DB 侧），Sprint-1 COSTRA-104 联调时确认一致即可。

- **P2-3 · OpenAPI lint CI 集成**
  - 建议引入 `@redocly/cli lint` 到 CI（参考 Backend 回执 §2），及早发现语法/refs 退化。
  - **建 DevOps 子卡追踪**（不阻断 020）。

### 🟢 亮点

- `DELETE /families/{family_id}` 契约占位做了完整的 owner + version + Idempotency-Key 三保险，比 Reviewer 预期更完备。
- `Entry.account_id` 同时支持 income/expense 和 transfer 两种语义（后者 `to_account_id` 配对），单字段刻画双用途，契约简洁。
- `ratio_bp` 的选择比想象的更严谨：不仅避免浮点精度，还与金额"分"策略统一了"整数优先"原则（ADR-0004）。

---

## 5. Verdict

**PASS** · 30 / 30

- Round-1 6 项 Findings **全部关闭**；
- 契约层与 DB schema v1.1 / D-008 / D-009 / ADR-0004 全线对齐；
- P2 为可选优化，不阻断 Sprint-1 消费该契约；
- Sprint-1 COSTRA-104 / COSTRA-101 / COSTRA-111 均可以此契约起跑。

### 5.1 Sprint-1 前待跟进（非本卡阻断）

- OpenAPI lint CI（P2-3）→ DevOps 子卡
- `include_archived` / `remaining_quota` 显式 default（P2-1/2-2）→ 随 Sprint-1 第一次契约微调一次性收拢

---

—— Review-Agent-Tech · 2026-04-23 20:37
