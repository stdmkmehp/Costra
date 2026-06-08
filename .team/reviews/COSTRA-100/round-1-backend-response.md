# Backend-Agent · Round-1 Response · COSTRA-100

- **角色**：Backend-Agent
- **回应对象**：`.team/reviews/COSTRA-100/round-1-tech.md`（Review-Tech Round 1，verdict=REVISE，3 P0 / 4 P1 / 3 P2）
- **本轮时间**：2026-04-23 19:54 - 20:10（约 16 分钟）
- **模式**：**自动循环**（D-011 · 方案 B · Orchestrator 无人触发启动）

---

## 1. 反驳声明

**未反驳任何 P0 / P1**。Review-Tech 提出的 3 条 P0 + 4 条 P1 均证据充分、定位精确，**全盘接受**。

---

## 2. 每条 Finding 的处置

### P0-1 · UUID / 主存储事实源分裂 → **采用方案 A + 方案 C（双落）**

| 动作 | 位置 | 状态 |
|---|---|---|
| `docs/db/schema.md` P8 改写为 UUID v7 + 应用层 `newId()`，交叉引用 `id-strategy.md` | §1 设计原则 P8 | ✅ 已改 |
| `docs/db/schema.md` 头部补 UUID v7 运行时说明 + Owner/更新行升级到 2026-04-23 | §0 头部 | ✅ 已改 |
| `docs/db/schema.md` §2 `users` 表 `id` 列注释改为"应用层 `newId()`（UUID v7）" | §2 users | ✅ 已改 |
| `docs/db/schema.md` §6 下一步补 `pg_uuidv7` 扩展迁移计划 | §6 下一步 | ✅ 已改 |
| `docs/api/README.md §1` UUID 行改为"服务端主键 v7 / client_ref_id + Idempotency-Key v4" | §1 命名与类型 | ✅ 已改 |
| **新起 `ADR-0006-backend-runtime-and-primary-store.md`**（方案 C） | `.team/decisions/` | ✅ 已新建 |
| ADR-0002 §决策表"后端语言 / 后端框架 / 主存储"三行就地修订 + 追加 ADR-0006 补丁段 | ADR-0002 末尾 | ✅ 已改 |

**闭环状态**：同一产出链内 UUID 版本 / 主存储 / 运行时**统一口径**——PostgreSQL 15 + UUID v7（应用层生成）+ TypeScript on Node.js 20 LTS。

---

### P0-2 · `IDEMPOTENCY_KEY_MISMATCH` HTTP status 归属不一致 → **已修复**

| 动作 | 位置 | 状态 |
|---|---|---|
| 从 §2.1 400 小节删除 | `docs/api/error-codes.md` | ✅ 已改 |
| 追加到 §2.5 409 冲突小节（编号 #14） | 同上 | ✅ 已改 |
| §2.2~§2.9 全表重编号 1-21，保持连续 | 同上 | ✅ 已改 |
| `README.md §3` 错误码精简表追加 `409 IDEMPOTENCY_KEY_MISMATCH` 行 + 加标题"精简视图" | `docs/api/README.md` | ✅ 已改 |
| `id-strategy.md §3.3` / OpenAPI `components.schemas.ErrorCode` / `ErrorCode.ts` **原本就是 409**，无需改 | — | ✅ 三处已一致 |

**闭环状态**：五份事实源（error-codes.md §2.5 · README.md §3 · id-strategy.md §3.3 · openapi.yaml `IdempotencyKey` description · ErrorCode.ts `ErrorHttpStatus` map）**全部一致归属 409**。

---

### P0-3 · ADR-0002 后端语言与实现事实脱钩 → **方案 A 落地（新起 ADR-0006）**

| 动作 | 位置 | 状态 |
|---|---|---|
| 新起 ADR-0006（Node.js + TS / PostgreSQL 15 + UUID v7） | `.team/decisions/ADR-0006-*.md` | ✅ 已建 |
| ADR-0002 §决策表就地修订 3 行 + 追加 2026-04-23 · ADR-0006 补丁段 | ADR-0002 | ✅ 已改 |
| 影响面清单（Dockerfile / docker-compose / .env / 迁移脚本）转为 DevOps-Agent 在 COSTRA-13x 跟进项 | ADR-0006 §4 | ✅ 登记 |

**闭环状态**：**无历史决策可被引用**（Review-Tech 猜测的"方案 B：历史决策遗失链接"不成立——ADR-0002 v2 就是唯一历史），因此采纳 **方案 A**。不零动作通过。

---

### P1-1 · README.md §1 UUID 字段规则未更新 + §3 错误码旧表漂移 → **已修复**

| 动作 | 位置 | 状态 |
|---|---|---|
| §1 "UUID" 行改为"服务端主键 v7 / 幂等键 + client_ref_id v4，详见 id-strategy.md" | `docs/api/README.md` | ✅ 已改 |
| §3 错误码表头改为"精简视图"并加"完整见 error-codes.md / 冲突以 error-codes.md 为准" | 同上 | ✅ 已改 |
| §3 精简表补上 `409 IDEMPOTENCY_KEY_MISMATCH` 行（与 P0-2 闭环） | 同上 | ✅ 已改 |

---

### P1-2 · OpenAPI `IdempotencyKey` description 信息不全 → **已修复**

变更前：
```yaml
description: UUID v4；同 key 24h 内重复请求返回相同结果
```

变更后：
```yaml
description: |
  UUID v4。同一 `Idempotency-Key` + 相同 `body_hash` 在 24h 去重窗口内返回首次结果（原 HTTP 状态码与响应体）；
  同 key 但 body_hash 不一致时返回 **409 IDEMPOTENCY_KEY_MISMATCH**。
  详见 `docs/api/id-strategy.md §3`。
```

---

### P1-3 · sync-protocol `results.status=rejected` code 未白名单化 → **已修复（双向登记）**

| 动作 | 位置 | 状态 |
|---|---|---|
| `sync-protocol.md §2.4` 将三态表下方改为显式白名单 + 契约级约束段 | `docs/api/sync-protocol.md` | ✅ 已改 |
| `error-codes.md §9` 追加 §9.1 "sync.push results 条目级 code 白名单（契约反向登记）" | `docs/api/error-codes.md` | ✅ 已改 |

白名单定义（两份文档互相一致）：

| status | 允许的 code 集合 |
|---|---|
| `conflict` | `VERSION_CONFLICT` / `IDEMPOTENCY_KEY_MISMATCH` |
| `rejected` | `NOT_FOUND` / `PERMISSION_DENIED` / `BUSINESS_RULE_VIOLATION` / `INVALID_ARGUMENT` |

---

### P1-4 · `ErrorCode.ts` 缺事实源一致性自检 → **已修复**

在 `server/src/errors/ErrorCode.ts` 文件末尾新增一个**模块加载期自执行 IIFE** `assertErrorCodeCoverage()`：

- 遍历 `ErrorCode` 所有枚举值
- 逐一检查 `ErrorHttpStatus` / `ErrorRetryStrategy` 是否都存在映射
- 缺任一张时**启动阶段即抛错**，报告格式：
  ```
  [ErrorCode] coverage assertion failed. The following codes are missing mappings:
    - NEW_CODE: missing in ErrorHttpStatus, ErrorRetryStrategy
  Fix: update ErrorHttpStatus / ErrorRetryStrategy in server/src/errors/ErrorCode.ts and docs/api/error-codes.md.
  ```
- 当前 20 条 code 全部覆盖（IIFE 执行通过、lint 0 error）
- **未来引入单测时**可复用同样断言改写为 Vitest/Jest 用例（登记为 COSTRA-101 跟进）

---

## 3. P2 · 统一登记至 D-010 Follow-up（不在本轮落地）

| # | 题目 | 去向 |
|---|---|---|
| P2-1 | `ttl-policy.md §4` ↔ `.env.production.example` 互相引用 + 自检脚本 | Sprint-1 落 `.env.example` 时一并做（COSTRA-101） |
| P2-2 | OpenAPI `SyncPushRequest` schema 补 `minItems: 1, maxItems: 200` | Sprint-1 契约补丁卡 |
| P2-3 | `uuidv7` npm 依赖登记到 ADR-0002 §库依赖清单 | Sprint-1 首次 `npm install uuidv7` 时触发 |

**登记位置**：本轮落盘后由 Orchestrator 同步更新 `.team/decisions/D-010-costra-100-g3-gaps-delivered.md` Follow-up 段（下一条 patch）。

---

## 4. 未处置项 / 延后理由

无。本轮 3 P0 + 4 P1 全部落地；3 P2 均为明确"应登记到 Follow-up" 类，按 Review-Tech 指令照办。

---

## 5. Diff 指针（Round-2 实际落盘文件）

| # | 文件 | 动作 | 对应 Finding |
|---|---|---|---|
| 1 | `docs/db/schema.md` | 修改（头部 + P8 + §2 users + §6） | P0-1 |
| 2 | `docs/api/README.md` | 修改（§1 + §3 + §5） | P0-1 / P0-2 / P1-1 |
| 3 | `docs/api/error-codes.md` | 修改（§2.1 / §2.5 / §2.6-2.9 重编号 / §9.1 新增） | P0-2 / P1-3 |
| 4 | `docs/api/sync-protocol.md` | 修改（§2.4） | P1-3 |
| 5 | `server/api/openapi.yaml` | 修改（`IdempotencyKey` description） | P1-2 |
| 6 | `server/src/errors/ErrorCode.ts` | 追加（assertErrorCodeCoverage IIFE） | P1-4 |
| 7 | `.team/decisions/ADR-0002-tech-stack.md` | 修改（决策表 3 行 + 末尾补丁段） | P0-3 |
| 8 | `.team/decisions/ADR-0006-backend-runtime-and-primary-store.md` | **新增** | P0-3 |

---

## 6. 自我验证（Review 可核验的 Anchor）

- ✅ `rg 'gen_random_uuid' docs/db/schema.md` 仅剩 §6 未来计划的 `gen_random_uuid_v7()` 一条（合法）
- ✅ `rg 'UUID v4' docs/api/README.md` 不再作为服务端主键规格单独出现
- ✅ `rg 'IDEMPOTENCY_KEY_MISMATCH' docs/api/error-codes.md` 仅出现在 §2.5（409）
- ✅ ADR-0002 §决策表不再出现 `Go 1.22` / `Gin` / `MySQL 8.0` 作为 accept 选项，且指向 ADR-0006
- ✅ `server/src/errors/ErrorCode.ts` lint 0 error（read_lints 已核）

---

## 7. 下一步

球交回 Orchestrator → 拉起 **Review-Tech Round 2** 机审（自动循环 D-011 前置条件全满足）。
