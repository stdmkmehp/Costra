# COSTRA-021 · Round-1 · Review-Agent-Tech

- **被审产物**：`docs/db/schema.md` v1（+ `server/db/migrations/` 意向 · `docker-compose.yml` 意向）
- **被审 Agent**：Backend-Agent
- **评审人**：Review-Agent-Tech（独立实例）
- **评审时间**：2026-04-23 20:24
- **Sprint**：Sprint-0 补审
- **轮次**：1
- **强制上下文**：`server/api/openapi.yaml`、`docs/api/id-strategy.md`（COSTRA-100 产出）、ADR-0004 / ADR-0006、D-008

---

## 0. 独立声明

独立实例，依据产物独立评审。

---

## 1. 评分卡（30 分制）

| 维度 | 满分 | 得分 | 说明 |
|---|---|---|---|
| 表结构完整性（覆盖 Epic）| 6 | **5** | 10 张表覆盖核心；**缺 `budgets` 表**（明确在 §7 下一步列入 v0.2，属合理延期）|
| 字段规范（金额/时间/软删/乐观锁）| 6 | **6** | P1~P4 落实度满分 |
| 索引与查询路径 | 6 | **5** | `ledger_entries` 索引齐；**`categories` 索引仅覆盖 scope+kind，未覆盖 sort_order**（见 P1-1）|
| 与 OpenAPI 对齐 | 6 | **4** | **`accounts` 表存在但 OpenAPI 没暴露**（见 COSTRA-020 P0-1 同根问题）；`categories.kind` vs OpenAPI `Category.type` 字段名不一（见 P0-1） |
| 迁移 / 可回滚 / docker-compose | 6 | **4** | §5 声明了 up/down 规范；**`0001_init.down.sql` 标注 v0.2 交付**（Sprint-0 锁时刻缺失），`docker-compose.yml` 本次未读到实际文件（见 P1-2 核验） |
| **合计** | **30** | **24** | |

---

## 2. Findings

### 🔴 P0

- **P0-1 · DB schema `categories.kind` 与 OpenAPI `Category.type` 字段名不一致**
  - **位置**：
    - `docs/db/schema.md` §3.5 `kind TEXT NOT NULL CHECK (kind IN ('expense','income','transfer'))`
    - `server/api/openapi.yaml` L798 `Category.type: { enum: [income, expense] }`
  - **问题**：同一业务概念（分类的"支出/收入/转账"）在 DB 叫 `kind`、在 API 叫 `type`。**虽然可以在服务层映射，但会引入反复 bug**；更严重的是：DB 有 `transfer`，API enum 只有 `income/expense`（差了一项）。
  - **建议**：
    - 方案 A（推荐）：DB 和 API 都统一用 `kind`（避开 SQL 保留字和 OO 关键字 `type`）；
    - 方案 B：都用 `type`，并在 API enum 补上 `transfer`。
  - **Sprint-1 必修**：COSTRA-104（`/entries` CRUD）要查 categories，字段名不一致直接报错。

### 🟠 P1

- **P1-1 · `categories` 索引未覆盖 `sort_order`**
  - **位置**：§3.5 `idx_categories_scope` on `(COALESCE(user_id, family_id), kind)`
  - **问题**：PRD 明确分类列表**按 sort_order 排序展示**；当前索引不含该字段，`ORDER BY sort_order` 会引入文件排序。
  - **建议**：改为 `(COALESCE(user_id, family_id), kind, sort_order)` 复合索引，覆盖分类列表主查询路径。

- **P1-2 · `docker-compose.yml` 未在本次评审范围内核实**
  - **位置**：`docs/db/schema.md` 声明"迁移脚本 0001_init.sql"等，但未见 docker-compose 文件路径指引
  - **问题**：COSTRA-021 AC 之一是"docker-compose up 即可本地起 PG+Redis+Server"，需实测。
  - **建议**：在 schema.md 顶端补一行"docker-compose 位置：`/docker-compose.yml`；MVP 使用 `postgres:15-alpine` + `redis:7-alpine`"。

- **P1-3 · `ledger_entries.transfer_peer_entry_id` 自引用外键缺 `ON DELETE` 策略**
  - **位置**：§3.6
  - **问题**：转账两条流水互相引用。若一条被硬删（不走软删），另一条悬空。
  - **建议**：明确 `ON DELETE SET NULL`，并在应用层对"转账组"做原子性保证（事务内两条一起软删）。

- **P1-4 · `feature_flags.rollout_percent` CHECK (0..100) 语法**
  - **位置**：§3.10
  - **问题**：PG 不支持 `0..100` 范围语法，正确写法是 `CHECK (rollout_percent BETWEEN 0 AND 100)`。
  - **建议**：直接改为 `BETWEEN 0 AND 100`（或 `>= 0 AND <= 100`）。

### 🟡 P2

- **P2-1 · `family_members.role` 枚举与 OpenAPI `FamilyMember.role` 枚举一致**（都是 `owner/admin/member`），但 **OpenAPI `FamilyInvite.role` 枚举是 `member/viewer`**。三端角色体系（member/admin/owner/viewer）未统一，建议一张"角色矩阵"单独文档化。
- **P2-2 · `accounts.initial_balance_cents`** 只有初始余额，没有"当前余额"字段。当前余额是否由流水聚合而来？若是，应在 schema.md 明确说"余额 = initial + Σ(inflow) - Σ(outflow)"作为业务规则。
- **P2-3 · `audit_logs.before/after` JSONB**：缺脱敏规则（如 openid / 手机号不应落到 audit）。建议附一张"敏感字段脱敏清单"，由合规 Epic-G 消费。
- **P2-4 · `subscribe_tokens.scene` 枚举**与 OpenAPI `notifications/subscribe-template.scene` 不一致：DB 写 `budget_warn / family_invite / weekly_digest`，API 写 `budget_alert / family_activity / weekly_digest`。**三对一、一对一、又一致** → 实际上**前两个不对齐**。
  - 建议：统一 `budget_warn` 或 `budget_alert`、`family_invite` 或 `family_activity`。Sprint-2 前必修（升级为 P1？当前仅计 P2，因 Sprint-1 未触发）。

---

## 3. Verdict

> **REVISE**

**原因**：P0-1 字段名不一致直接导致 Sprint-1 COSTRA-104 实现断链；P1 四项都是小改动但必须闭合。

**自动循环决策**：round 1 < 5，P0 级问题可修复 → **进入自动 Round 2**。

---

## 4. 对 Backend-Agent 的执行提示

1. P0-1 选方案（推荐 A：DB+API 都用 `kind`）；
2. P1-1 索引加 sort_order；
3. P1-2 schema.md 顶端补 docker-compose 指引；
4. P1-3/P1-4 两行小改；
5. P2-4 顺手修（避免 Sprint-2 返工）。

---

## 5. 元信息

- 评审耗时：约 15 分钟
- 独立判定：✅
- Human 介入：否

**Refs**: COSTRA-021 · **Impacts**: `docs/db/schema.md` v1 → v1.1、`server/api/openapi.yaml`
