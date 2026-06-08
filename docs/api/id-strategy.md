# Costra ID 生成策略

> **卡号**：COSTRA-100（D-006 §5 补齐项 #4）· **Owner**：Backend-Agent  
> **版本**：v1.0（随 OpenAPI v0.1 生效）  
> **事实源**：`server/src/id/idGen.ts`（v0.2 实装）· `miniprogram/utils/id.ts`（v0.2 实装）  
> **消费方**：MiniApp-Agent / QA-Agent / Backend-Agent

---

## 0. 总则

Costra 存在**三种**不同用途的 ID，**绝不混用**：

| # | 名称 | 生成方 | 用途 | 生命周期 | OpenAPI 字段 |
|---|---|---|---|---|---|
| 1 | **服务端实体 ID** | Server | 资源唯一主键 | 永久（软删保留） | `id` |
| 2 | **客户端本地引用 ID** (`client_ref_id`) | Client | 离线态本地主键 / sync 去重 | 从本地创建 → 收到服务端 `id` 后可丢弃 | `client_ref_id` |
| 3 | **幂等键** (`Idempotency-Key`) | Client | 网络重试去重 | 单次写操作 + 24h 去重窗口 | HTTP 头 `Idempotency-Key` |

---

## 1. 服务端实体 ID

### 1.1 规格

- **算法**：**UUID v7**（时间有序 UUID）· 兼容 OpenAPI `format: uuid`
- **长度**：36 字符（含连字符）
- **示例**：`01960b02-7c40-7abc-8a61-9f2b5c1d4e8f`（前 48bit 为 unix-ms，后续随机）

### 1.2 为什么选 UUID v7（而非 v4 / ULID / Snowflake）

| 备选 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| UUID v4 | 随机无偏差，零配置 | 写入索引非顺序 → B-tree 页分裂写放大 | ❌ 已知痛点 |
| **UUID v7** | 标准化（RFC 9562）· 时间有序 · 文本兼容 v4 | 2024 年生效，部分库刚刚支持 | ✅ **采用** |
| ULID | 时间有序 · 26 字符更短 | 与 `format: uuid` 不兼容 · 需要额外 lib | ❌ 契约破坏 |
| Snowflake | 整数压缩好 | 需要 worker-id 协调 · 和 UUID 契约冲突 | ❌ 成本高 |

> **决策点**：OpenAPI schemas 已广泛使用 `format: uuid`，v7 与 v4 格式兼容，**无需改任何字段类型**，直接切换生成算法即可。

### 1.3 覆盖实体

所有可持久化实体主键：`users` / `families` / `family_members` / `ledgers` / `categories` / `entries` / `budgets` / `sync_versions` / `audit_logs` / `subscribe_tokens` / `feature_flags`。

### 1.4 DB 层

- 列类型：`uuid`（Postgres 原生）
- 主键 + 默认：`DEFAULT gen_random_uuid_v7()`（需 `pg_uuidv7` 扩展；MVP 先在应用层生成）
- 索引：时间有序特性天然友好于主键索引 + `updated_at + id` 复合游标索引

### 1.5 生成位点

```ts
// server/src/id/idGen.ts
import { uuidv7 } from 'uuidv7';       // npm: uuidv7
export const newId = (): string => uuidv7();
```

- 入口：`POST /entries` 等创建端点 → service 层调 `newId()` → 写入 DB
- **绝不**把 `client_ref_id` 写为 `id`，即使它看起来像 uuid

---

## 2. 客户端本地引用 ID（`client_ref_id`）

### 2.1 规格

- **算法**：UUID v4（客户端不依赖时间有序，且要与后端解耦）
- **长度**：36 字符
- **前缀（可选，MVP 不加）**：若未来需要区分端，可约定 `wx-<uuidv4>`
- **示例**：`9f2c6a1e-4f3b-4a1c-b8a2-7e6d5c4b3a21`

### 2.2 生命周期

```
[离线] 用户记一笔 → 客户端 newUuidV4() → client_ref_id = uuid
[离线] 写入本地 IndexedDB，主键 = client_ref_id
[联网] POST /entries { client_ref_id, ... }
[成功] 后端返回 { id, client_ref_id } → 客户端把 id 回写本地；client_ref_id 保留作为外键桥
[最终] 只有历史 sync 轨迹需要时才查 client_ref_id，日常读写用 id
```

### 2.3 服务端处理规则

| 场景 | 处理 |
|---|---|
| 单条创建带 `client_ref_id` | 存入 `entries.client_ref_id`；结合 `Idempotency-Key` 防重 |
| 未带 `client_ref_id` | 允许（服务端不 fallback 生成；纯在线调用场景） |
| 同 `client_ref_id` 在 `/sync/push` 多次出现 | 按首次处理，其余返回 `status=ok` + 相同 `server_id`（见 sync-protocol） |
| `client_ref_id` 跨用户重复 | 不冲突（DB 唯一约束为 `(user_id, client_ref_id)`） |

### 2.4 DB 约束

```sql
-- 仅示例，v0.2 真实迁移实装
ALTER TABLE ledger_entries
  ADD COLUMN client_ref_id TEXT,
  ADD CONSTRAINT uk_entries_client_ref UNIQUE (created_by, client_ref_id);
```

### 2.5 客户端生成

```ts
// miniprogram/utils/id.ts
export function newClientRefId(): string {
  // 使用 crypto.getRandomValues（基础库 2.20+ 支持）
  const bytes = new Uint8Array(16);
  (wx as any).getRandomValues?.(bytes) ?? crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // v4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

---

## 3. 幂等键（`Idempotency-Key`）

### 3.1 规格

- **算法**：UUID v4（每个写请求独立生成）
- **传递**：HTTP 请求头 `Idempotency-Key: <uuid>`
- **生命周期**：24h 去重窗口（见 `ttl-policy.md`）

### 3.2 生成时机

| 场景 | 生成方式 |
|---|---|
| 单条在线写（`POST /entries` / `PATCH /entries/{id}` / `DELETE /entries/{id}` 等） | `request.ts` 拦截器在发送前生成一次，写入请求头 |
| 网络失败重试 | **复用同一 key** + 同一 body；不得新生成 |
| 离线 outbox 入队 | 入队时生成并持久化到队列记录；重试共用该 key |
| 批量 `/sync/push` | 整个批次一个 key（保护整批重放）；批内每条 op 另有 `client_ref_id` 保证条目级去重 |

### 3.3 服务端去重窗口

```
Redis key: idem:{user_id}:{key}
value    : { body_hash, status, response_json }
TTL      : 24h（TTL_IDEMPOTENCY_HOURS）

处理流程：
1. 收到请求带 Idempotency-Key
2. 查 Redis：
   - miss     → 正常处理，处理完成后 SETEX 缓存
   - hit + body_hash 一致 → 直接返回缓存响应（含原 status）
   - hit + body_hash 不一致 → 返回 409 IDEMPOTENCY_KEY_MISMATCH
```

### 3.4 不需要幂等键的端点

| 端点 | 原因 |
|---|---|
| 所有 `GET` | 天然幂等 |
| `/auth/wx-login` | 微信 code 一次性，天然幂等 |
| `/auth/refresh` | 依赖 refresh_token 状态，天然幂等 |
| `/auth/logout` | 多次登出等价 |
| `/notifications/subscribe-template` | 幂等（同 template_id + scene 多次提交无副作用） |

其他写操作 **必须** 带 `Idempotency-Key`，否则返回 `400 IDEMPOTENCY_KEY_REQUIRED`。

---

## 4. 三种 ID 的关系图

```
┌──────────────── 客户端 ────────────────┐                     ┌───── 服务端 ─────┐
│                                          │                     │                   │
│ [创建一条记账]                          │                     │                   │
│                                          │                     │                   │
│   client_ref_id = newClientRefId()       │                     │                   │
│   idemKey       = newUuidV4()            │                     │                   │
│                                          │                     │                   │
│   POST /entries                          │                     │                   │
│   Header: Idempotency-Key: <idemKey>     │ ─────HTTP──────▶    │                   │
│   Body  : { client_ref_id, amount, ... } │                     │ [service 层]      │
│                                          │                     │   id = uuidv7()   │
│                                          │ ◀────201 Created─── │   存入 entries    │
│                                          │   { id, client_ref_id, version=1 }      │
│                                          │                     │                   │
│   本地 IndexedDB：                        │                     │                   │
│     { client_ref_id, id, version }      │                     │                   │
│                                          │                     │                   │
└──────────────────────────────────────────┘                     └───────────────────┘

关系：
  id            ← 服务端实体唯一，贯穿资源生命周期
  client_ref_id ← 客户端本地主键 + sync 桥接（成功后作为外键留存）
  Idempotency-Key ← 单次写请求级别，24h 后失效
```

---

## 5. 常见坑 & 规约

| 反模式 | 正确做法 |
|---|---|
| ❌ 客户端把 `client_ref_id` 当 `id` 发给 `/entries/{id}` | `id` 必须用服务端返回值；`client_ref_id` 只在 `/sync/push` 和创建响应中出现 |
| ❌ 重试时重新生成 `Idempotency-Key` | 重试必须复用原 key；否则幂等失效 |
| ❌ 服务端把 `client_ref_id` 当唯一键（跨用户） | 唯一性仅限 `(user_id, client_ref_id)` |
| ❌ 把 `Idempotency-Key` 用作 `client_ref_id` | 两者 TTL 和用途完全不同；幂等键 24h 过期 |
| ❌ 用 UUID v4 生成服务端主键（写放大） | 统一用 UUID v7 |
| ❌ 客户端依赖 `id` 字段猜时间 | UUID v7 前缀虽然是时间，但**契约上视为不透明**；时间以 `created_at` 为准 |

---

## 6. 迁移兼容性

- 现有 `0001_init.sql` 中主键为 `uuid` 类型，与 v7 字符串格式兼容，无需迁移
- v0.2 应用层切换 `gen_random_uuid()` → `uuidv7()`
- 历史数据（若有，MVP 无）不回填 v7，保持 v4 主键共存

---

## 7. QA 断言

| 用例 ID | 断言 |
|---|---|
| `smoke_id_01` | 连续创建 10 条 entries，`id` 字符串按字典序近似升序（UUID v7 时间前缀） |
| `smoke_id_02` | `POST /entries` 同 `Idempotency-Key` 两次，第二次返回与第一次完全相同的 body（含 `id`） |
| `smoke_id_03` | `POST /entries` 同 `Idempotency-Key` 但 body 不同 → 409 `IDEMPOTENCY_KEY_MISMATCH` |
| `smoke_id_04` | `POST /entries` 不带 `Idempotency-Key` → 400 `IDEMPOTENCY_KEY_REQUIRED` |
| `smoke_id_05` | `/sync/push` 同 `client_ref_id` 在 ops 数组中出现 2 次 → 服务端仅创建 1 条，两次 result 同 `server_id` |

---

## 8. 相关文档

- `./error-codes.md` · `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_MISMATCH` 契约
- `./sync-protocol.md` · `client_ref_id` 在批量同步中的用法
- `./conflict-strategy.md` · `version` 字段（另一个"ID 维度"）
- `./ttl-policy.md` · 幂等窗口 24h
