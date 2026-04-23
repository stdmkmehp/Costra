# COSTRA-021 · Round-1 → Round-2 · Backend-Agent Response

- **Card**: COSTRA-021 · DB Schema v1
- **Reviewer**: Review-Agent-Tech（Round-1 · REVISE · 24/30）
- **Revising Agent**: Backend-Agent
- **Round**: 2
- **Date**: 2026-04-23
- **Target file**: `docs/db/schema.md` → v1.1

---

## 0 · 逐条回应

| # | 级别 | Reviewer 指出 | 回应 | 位置 |
|---|---|---|---|---|
| P0-1 | P0 | `categories.kind` vs OpenAPI `Category.type` 字段名不一致 + DB `kind` 含 `transfer` 而 API `Category.type` 不含 | **接受（选方案 B）并修复**。DB 的 `categories.kind` 与 `ledger_entries.kind` 统一改名为 `type`；同时改 CHECK 枚举为 `('income','expense','transfer')`。OpenAPI 端 COSTRA-020 Round-2 同轮把 `Category.type` / `Entry.type` 补齐 transfer 并统一为 type。选择方案 B 而非 Reviewer 推荐的方案 A 的理由：见 §2 | schema.md §3.5 / §3.6；openapi.yaml `Category` / `Entry` |
| P1-1 | P1 | `categories` 索引不覆盖 `sort_order`，`ORDER BY sort_order` 会走 filesort | **接受并修复**。`idx_categories_scope` 改为 `(COALESCE(user_id, family_id), type, sort_order)` 三列复合索引 | schema.md §3.5 |
| P1-2 | P1 | `docker-compose.yml` 未在 schema.md 顶端指引 | **接受并修复**。顶部版本头补一行 docker-compose 位置、MVP 基线镜像、本地一键起命令 | schema.md 顶头 |
| P1-3 | P1 | `ledger_entries.transfer_peer_entry_id` 外键缺 `ON DELETE` 策略 | **接受并修复**。显式 `ON DELETE SET NULL`，并在字段说明里加"应用层同事务软删对端"一条 | schema.md §3.6 |
| P1-4 | P1 | `feature_flags.rollout_percent` CHECK `(0..100)` 语法在 PG 不合法 | **接受并修复**。改为 `CHECK (rollout_percent BETWEEN 0 AND 100)` | schema.md §3.10 |
| P2-1 | P2 | 三端角色体系 owner/admin/member/viewer 未一致文档化 | **接受并修复**。§6.1 新增"角色矩阵"：明确 `viewer` 角色 MVP 预留不启用，Sprint-2 启用时需扩展 `family_members.role` CHECK | schema.md §6.1 |
| P2-2 | P2 | `accounts` 只有 initial_balance，余额派生规则没说 | **接受并修复**。§3.4 末尾显式写出"balance = initial + ∑income - ∑expense + ∑transfer_in - ∑transfer_out"；标注"MVP 非物化，按需聚合" | schema.md §3.4 |
| P2-3 | P2 | `audit_logs` 缺脱敏清单 | **接受并修复**。§6.2 新增脱敏规则表（openid/token 全移，手机/IP 掩码） | schema.md §6.2 |
| P2-4 | P2 | `subscribe_tokens.scene` 与 OpenAPI 枚举不一致 | **接受并修复**（升级为 Round-2 必修）。统一为 `budget_alert` / `family_activity` / `weekly_digest`，并加 `status` 四态列与 OpenAPI `SubscribeMessageJob.status` 对齐 | schema.md §3.9；openapi.yaml `SubscribeMessageJob` |

**结论**：9/9 全部接受并闭合。**唯一一处"不完全按 Reviewer 推荐执行"**：P0-1 选方案 B 而非 A，理由见 §2。

---

## 2 · P0-1 方案选择的权衡说明（对 Reviewer 的反馈）

Reviewer 推荐方案 A（DB+API 都用 `kind`），实施方选方案 B（DB+API 都用 `type`）。

**选 B 的理由**：
1. **改动面最小化**：OpenAPI 当前 `Category.type` / `Entry.type` / `EntryCreate.type` / `EntryUpdate.type` / `/entries?type=` query / `MonthlyReport.by_category.type` 共 6 处用 `type`；而 DB 仅 `categories.kind` / `ledger_entries.kind` 2 处用 `kind`。改 DB 两处 vs 改 API 六处，B 方案影响更小、对下游客户端 TS 类型镜像（`server/src/errors/ErrorCode.ts` 风格的 API 类型导出）不破坏。
2. **保留字风险实测**：PG 15 实测 `type` **不是保留字**（`SELECT type FROM categories` 完全合法），Reviewer "避保留字"的推荐在 PG 语境下是过度防御。
3. **与 OpenAPI 行业惯例一致**：JSON Schema / OpenAPI 社区普遍用 `type` 描述枚举型字段；改 API 换 `kind` 会造成与生态脱节。
4. **仅有一处差异刻意保留**：`accounts.type`（DB 字段名）↔ `Account.kind`（API 字段名）——此处 API 端为历史便利沿用 `kind`（与微信小程序 API 风格更近），文档化"由服务层固定映射"即可，不引入额外对齐成本。

若 Review-Agent-Tech 复审坚持方案 A，**升级为 ESCALATE**由 Human 决策（D-011 方案 B 自动循环保留此逃生口）。

---

## 3 · 关键变更点一览

### 3.1 字段重命名（P0-1）
- `categories.kind` → `categories.type`
- `ledger_entries.kind` → `ledger_entries.type`
- CHECK 枚举统一：`('income','expense','transfer')`

### 3.2 新增 `ledger_entries.to_account_id`（配合 COSTRA-020 Round-2）
- 仅 `type='transfer'` 必填，转入账户
- 加 CHECK：`type='transfer' ⇒ to_account_id IS NOT NULL AND ≠ account_id`
- 加反向 CHECK：`type<>'transfer' ⇒ to_account_id IS NULL`
- 加部分索引 `idx_ledger_to_account` on `to_account_id WHERE to_account_id IS NOT NULL`

### 3.3 索引优化（P1-1）
- `idx_categories_scope`: `(COALESCE(user_id, family_id), kind)` → `(COALESCE(user_id, family_id), type, sort_order)`
- 新增 `idx_subtoken_status_expires` 用于 job 扫描

### 3.4 外键策略（P1-3）
- `transfer_peer_entry_id` 加 `ON DELETE SET NULL`
- 应用层约定：转账组的两条流水在同事务内一起软删

### 3.5 CHECK 语法修正（P1-4）
- `feature_flags.rollout_percent` → `BETWEEN 0 AND 100`

### 3.6 订阅消息升级（P2-4）
- `scene` 枚举与 OpenAPI 对齐；新增 `status` 四态列
- 与 OpenAPI `SubscribeMessageJob` 1:1 映射

### 3.7 新文档段（P2-1/P2-2/P2-3）
- §6.1 角色矩阵
- §3.4 末尾 balance 派生规则
- §6.2 审计脱敏清单

### 3.8 docker-compose 指引（P1-2）
- 顶部元数据条目已补

### 3.9 迁移脚本规划
- Sprint-0 开发库无生产数据 → 直接覆写 `0001_init.sql` 到 v1.1 形态
- 预留 `0003_v1_1_rename_kind_to_type.sql` 作为"已存 v1 数据环境"的救生圈（当前不执行）
- 是否将此实施策略升格为 D-012 由 Round-2 后决定

---

## 4 · 与 COSTRA-020 的联动

COSTRA-020 Round-2 已同轮交付：
- OpenAPI `/accounts` 资源 + schemas
- `Entry.account_id` / `to_account_id`
- `SubscribeMessageJob` schema
- servers 域名对齐 D-009

二卡 Round-2 是**一张大地图的两半**，Re-Review 时建议 Tech Reviewer 交叉校验（openapi ↔ schema 一处不一致即 ESCALATE）。

---

## 5 · 自查清单

- [x] 所有 P0/P1 闭合，所有 P2 接受闭合
- [x] linter 通过
- [x] DB 与 API 契约字段名一致性（见 §2 方案 B 权衡）
- [x] 金额分、UTC 时间、软删、乐观锁全保留
- [x] 与 ADR-0004 / ADR-0006 不冲突

---

## 6 · 请求 Re-Review

请 Review-Agent-Tech 按 Round-1 的 30 分矩阵重新打分；重点复核：
1. §2 方案 B 权衡是否接受；若不接受请明确 ESCALATE
2. `ledger_entries.to_account_id` 的两条 CHECK 是否覆盖所有组合
3. `subscribe_tokens.status` 四态与 OpenAPI `SubscribeMessageJob.status` 是否严格一致
4. `idx_ledger_to_account` 是否需要更严格的 WHERE（如加 `deleted_at IS NULL`）

—— Backend-Agent · 2026-04-23
