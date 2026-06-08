# COSTRA-020 · Round-1 → Round-2 · Backend-Agent Response

- **Card**: COSTRA-020 · OpenAPI v0.1 契约
- **Reviewer**: Review-Agent-Tech（Round-1 · REVISE · 25/30）
- **Revising Agent**: Backend-Agent
- **Round**: 2
- **Date**: 2026-04-23
- **Target**: 将 Round-1 全部 P0/P1 收拢为"可 Re-Review PASS"

---

## 0 · 逐条回应 Round-1 问题

| # | 级别 | Reviewer 指出 | 回应 | 证据 |
|---|---|---|---|---|
| P0-1 | P0 | OpenAPI 缺 `accounts` 资源端点，与 DB schema §3.4 不一致 | **接受并修复**。新增 `/accounts`、`/accounts/{account_id}`（GET/POST/PATCH/DELETE）+ `Account`/`AccountCreate`/`AccountUpdate` schemas；`Entry` 与 `EntryCreate` 补 `account_id`、`to_account_id` 两个占位字段 | openapi.yaml L319–401 / L921–992 |
| P0-2 | P0 | `servers` 域名 `api.costra.local`、`api-staging.costra.app` 与 D-009 锁定 `costra.cloud` 冲突 | **接受并修复**。servers 重写为四档：localhost / 开发 IP 49.235.216.20 / staging.costra.cloud / prod.costra.cloud | openapi.yaml L22–29 |
| P1-1 | P1 | 缺 `SubscribeMessageJob` 契约：订阅消息 7 天时效、幂等、状态机未表达 | **接受并修复**。`/notifications/subscribe-template` POST 响应从 204 升级为 201 + `SubscribeMessageJob`；schema 含 job_id / expires_at(=created_at+7d) / remaining_quota / status 四状态（pending/sent/expired/revoked） | openapi.yaml L679–708 / L1092–1125 |
| P1-2 | P1 | `MonthlyReport.by_category.ratio: float` 跨端序列化不稳 | **接受并修复**。改为 `ratio_bp: integer (0~10000)` 万分比 | openapi.yaml L1090–1098 |
| P1-3 | P1 | `/families/{family_id}` 缺 DELETE（解散家庭契约占位） | **接受并修复**。新增 DELETE（仅 owner + 版本锁 + Idempotency-Key） | openapi.yaml L224–244 |
| P1-4 | P1 | `EntryUpdate` 未明确 `type` 不可改 | **接受并修复**。description 明确 type 不可改 + DB 层约束同步；改 type 需 delete + create | openapi.yaml L1008–1022 |

**结论**：6/6 全部接受并已修复。无反驳、无 ESCALATE。

---

## 1 · 关键变更点

### 1.1 Accounts 资源（P0-1）
- DB schema §3.4 早就冻结了 `accounts` 表（kind 六枚举、user_id/family_id 二选一、balance 由流水聚合），但 API 契约里缺端点。Round-2 补齐 4 个方法：
  - `GET /accounts?family_id=&include_archived=` 列表（留空 family_id 返回私有）
  - `POST /accounts` 创建（body 不传 family_id → 私有；传则家庭）
  - `GET/PATCH/DELETE /accounts/{account_id}`
- PATCH 体用 `AccountUpdate`，显式声明 **kind/currency/balance 不可改**。
- DELETE 附 `422 BUSINESS_RULE_VIOLATION`（账户仍有流水时拒删），对齐 `ErrorCode`。

### 1.2 Entry 跨账户字段（P0-1 延伸）
- `Entry` / `EntryCreate` 增加 `account_id`（收支：资金账户；转账：转出账户）+ `to_account_id`（仅 transfer 必填：转入账户）。
- **不改 DB**（本卡范围仅 API）。COSTRA-021 Round-2 会在 `entries` 表同步这两列（届时 DB Review 会再审）。
- 对 Round-1 Reviewer 提到的"type=transfer 语义不完整"算**半闭环**：API 层已刻画；DB 层待 COSTRA-021。

### 1.3 订阅消息 Job（P1-1）
- 原 204 表示"服务端记一下就够了"，但缺：①幂等 key（同一 scene 重复登记会产生重复发射）；②7 天时效（微信规则）。
- Round-2 把"授权"抽象为 `SubscribeMessageJob` 实体：每次授权 → 一个 job_id；告警/动态/周报消费时按 job_id 去重 + 校验 expires_at。
- 单次授权 `remaining_quota=1`（保留字段以备未来支持一次性多次授权）。

### 1.4 统计占比改万分比（P1-2）
- `ratio: float` 在 Node ↔ JVM ↔ Python 之间都会有精度抖动（尤其 `0.1 + 0.2`）。
- 改 `ratio_bp: integer 0~10000`，客户端展示 `ratio_bp / 100`（两位小数）。
- 与金额"分"策略一致（ADR-0004：整数优先）。

### 1.5 家庭 DELETE（P1-3）
- MVP UI 不开放入口，但契约占位是必要的（否则 PM 后续加"解散家庭"功能需要改版本号）。
- 仅 owner、需 version、需 Idempotency-Key、软删 + 级联软删所有从属实体。

### 1.6 EntryUpdate type 不可改（P1-4）
- 原字段列表里没有 type，但没说明。补 description + DB 层同步（COSTRA-021 Round-2 由 Backend-Agent 跟进）。

### 1.7 servers 域名（P0-2）
- 四档：
  1. `http://localhost:8080/v1` — 本地 docker
  2. `http://49.235.216.20:8080/v1` — 开发服务器（ICP 下证前）
  3. `https://api-staging.costra.cloud/v1` — ICP 下证后启用
  4. `https://api.costra.cloud/v1` — 生产

与 `miniprogram/services/env.ts` 已同步（COSTRA-030 Round-2 已改）。

---

## 2 · 范围声明（不在本轮修复的项）

- **DB schema 对齐**：`entries` 表加 `account_id`、`to_account_id` 两列 + 对应索引 + `categories.kind` 改名为 `type` 或 API `Category.type` 改 `kind`（二选一） → 归 **COSTRA-021 Round-2**。
- **openapi 校验 CI 集成**：引入 `@redocly/cli lint` 到 CI → 另起 DevOps 卡。
- **错误码文档 `docs/api/error-codes.md` 新增 CONSTRAINT_VIOLATION_ACCOUNT_NOT_EMPTY 等具名项** → 归 COSTRA-022（待建）。

---

## 3 · 自查清单

- [x] `servers` 域名与 D-009 一致
- [x] 所有写端点含 `Idempotency-Key`
- [x] 所有更新端点含 `version` 乐观锁
- [x] 金额统一 int64 分，占比用 bp 整数
- [x] 时间统一 ISO-8601 UTC
- [x] 错误响应全部走 `Error` / `ConflictError`
- [x] tags / schemas 引用完整、无悬空 `$ref`（本地手动 grep 校验）
- [x] 无 linter 错误（read_lints 通过）

---

## 4 · 请求 Re-Review

请 Review-Agent-Tech 按 Round-1 的 30 分矩阵重新打分；重点复核：
1. `Account` / `Entry.account_id` 的契约是否能在 COSTRA-021 Round-2 的 DB schema 上 1:1 映射
2. `SubscribeMessageJob.status` 四态是否覆盖完整生命周期
3. `ratio_bp` 命名是否与 `basis_points` 行业约定（通常 `bps`）能对上

—— Backend-Agent · 2026-04-23
