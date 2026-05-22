# Costra 同步协议（Sync Protocol v1）

> **卡号**：COSTRA-100（D-006 §5 补齐项 #5）· **Owner**：Backend-Agent  
> **端点**：`POST /sync/push` · `GET /sync/pull`  
> **版本**：v1.0（随 OpenAPI v0.1 生效）  
> **相关**：`conflict-strategy.md`（冲突语义）· `id-strategy.md`（三种 ID）· `error-codes.md`（错误码）

---

## 0. 目标

1. 在**弱网 / 离线 / 多端 / 多家庭成员并发**场景下，保证数据最终一致、可审计、可断点续传。
2. 把"事件流水账"（push）与"快照差分"（pull）**清晰分离**，避免双向耦合。
3. 所有复杂度收敛在服务端，客户端只需：**入本地 outbox → 定期 push → 按水位 pull**。

---

## 1. 两条通道总览

```
                             ┌─────────────────────────────┐
                             │         Costra Server       │
                             │                             │
  push ops[]                 │  /sync/push  → 逐条仲裁     │
  (本地变更 →) ──────────────▶│    ok / conflict / rejected │
                             │                             │
  pull since=ts              │  /sync/pull  → 返回水位 +   │
  (拉增量) ◀───────────────── │    各实体 changes 数组      │
                             └─────────────────────────────┘
```

| 通道 | 方向 | 方法 | 幂等 | 典型频率 |
|---|---|---|---|---|
| `/sync/push` | 客户端 → 服务端 | POST | `Idempotency-Key` + `client_ref_id` 双重 | 有 dirty 时立即；否则不发 |
| `/sync/pull` | 服务端 → 客户端 | GET | 天然幂等 | 启动 + 前台切换 + push 成功后各一次 |

---

## 2. /sync/push · 批量上行

### 2.1 请求

```
POST /sync/push
Headers:
  Authorization: Bearer <access_token>
  Idempotency-Key: <uuid v4>           # 整批幂等，24h 去重
Content-Type: application/json

Body:
{
  "ops": [
    {
      "op": "create",
      "entity": "entry",
      "client_ref_id": "9f2c6a1e-...",
      "base_version": null,
      "payload": {
        "ledger_id": "01960b02-7c40-7abc-...",
        "amount": 12800,
        "currency": "CNY",
        "type": "expense",
        "category_id": "01960b02-7c40-7abc-...",
        "note": "午餐",
        "occurred_at": "2026-04-23T05:12:00.000Z"
      }
    },
    {
      "op": "update",
      "entity": "entry",
      "client_ref_id": "c-prev-01",
      "base_version": 3,
      "payload": {
        "id": "01960b01-5a20-7abc-...",   // 必填（update/delete）
        "amount": 15000,
        "note": "午餐+咖啡"
      }
    },
    {
      "op": "delete",
      "entity": "entry",
      "client_ref_id": "c-del-02",
      "base_version": 2,
      "payload": { "id": "01960b01-5a20-8def-..." }
    }
  ]
}
```

### 2.2 约束

| 约束 | 值 |
|---|---|
| `ops` 数组长度 | 1 ~ **200** 条 |
| 单 op 载荷大小 | ≤ 8 KB |
| 批内同 `client_ref_id` 重复 | 按首次处理，其余返回同 `server_id` |
| `entity` 枚举 | `entry` / `category` / `budget`（MVP；`ledger` / `family` 走单端点） |
| 权限 | 服务端按 token 取 `user_id`，所有 op 必须属于该用户可见的 family |
| `base_version` | `create` 必为 `null`；`update` / `delete` **必填** |
| 批次时序 | 服务端按数组顺序逐条处理，不并发 |
| 部分失败 | **允许**；批整体返回 200，逐条报 `status` |

### 2.3 响应

```
200 OK
{
  "results": [
    {
      "client_ref_id": "9f2c6a1e-...",
      "status": "ok",
      "server_id": "01960b02-ef40-7abc-...",
      "server_version": 1
    },
    {
      "client_ref_id": "c-prev-01",
      "status": "conflict",
      "server_id": "01960b01-5a20-7abc-...",
      "server_version": 5,
      "error": {
        "code": "VERSION_CONFLICT",
        "message": "entry version mismatch: client=3 server=5",
        "details": {
          "entity": "entry",
          "entity_id": "01960b01-5a20-7abc-...",
          "server_record": { "...服务端当前实体..." }
        }
      }
    },
    {
      "client_ref_id": "c-del-02",
      "status": "rejected",
      "server_id": null,
      "server_version": null,
      "error": {
        "code": "NOT_FOUND",
        "message": "entry not found or already deleted"
      }
    }
  ]
}
```

### 2.4 `status` 三态

| status | 含义 | 客户端动作 |
|---|---|---|
| `ok` | 写入成功 | 本地用 `server_id` 回写，清 dirty，更新 `version = server_version` |
| `conflict` | 乐观锁冲突 / 幂等键不匹配 / 业务版本约束失败 | 保留 dirty；按 `conflict-strategy.md §4` 自动合并或升出合并 UI |
| `rejected` | 业务或权限拒绝（code ∈ 白名单，见下表） | 根据 `error.code` 决定：<br>• `NOT_FOUND` → 本地转"草稿"或丢弃<br>• `PERMISSION_DENIED` → 本地撤回 + 提示<br>• 其余 → 标红 + 等用户编辑 |

> **白名单约束（契约级）**：`results[i].status='rejected'` 时，`results[i].error.code` **必须且仅可**为以下集合之一：
>
> `{ NOT_FOUND, PERMISSION_DENIED, BUSINESS_RULE_VIOLATION, INVALID_ARGUMENT }`
>
> 其他 code（如 `VERSION_CONFLICT` / `IDEMPOTENCY_KEY_MISMATCH`）**必须**映射到 `status='conflict'`；5xx/限流不进入条目级 results，整批整体返回。
> 交叉引用：[`error-codes.md §9`](./error-codes.md) 同步登记此白名单。

> **关键**：`status=conflict/rejected` 不代表整批失败；**客户端必须逐条消费 results**，不得因一条失败而放弃整批。

### 2.5 幂等键语义（两层）

```
整批级（Idempotency-Key）：
  同 key + 同 body_hash 在 24h 内 → 返回首次 results，不重复处理
  同 key + 不同 body_hash          → 409 IDEMPOTENCY_KEY_MISMATCH

条目级（client_ref_id）：
  同 client_ref_id 在 /sync/push 多次（跨批）出现：
    create → 按首次创建，返回相同 server_id + status=ok
    update → 按 base_version 与服务端比对，已赶上则视为 ok
```

---

## 3. /sync/pull · 增量下行

### 3.1 请求

```
GET /sync/pull?family_id=<uuid>&since=<ISO8601>&limit=200
Headers:
  Authorization: Bearer <access_token>
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `family_id` | ✅ | 当前活跃家庭（客户端从 `/families` 拿） |
| `since` | ✅ | 上次 pull 返回的 `watermark`；首次用 `1970-01-01T00:00:00.000Z` |
| `limit` | ❌ | 默认 200，最大 500 |

### 3.2 响应

```
200 OK
{
  "watermark": "2026-04-23T09:45:12.318Z",   // 本批最大 updated_at
  "has_more": false,                         // true 时客户端应立刻再请一次
  "changes": {
    "entries":    [ {...Entry},  {...Entry} ],
    "categories": [ {...Category} ],
    "budgets":    [],
    "ledgers":    []
  }
}
```

### 3.3 客户端规则

```
for entity in ['ledgers','categories','budgets','entries']:  // 顺序重要
  for item in changes[entity]:
    local = localStore.get(entity, item.id)
    if item.deleted_at is not None:
      if local is None or local.version < item.version:
        localStore.softDelete(entity, item.id, item.version)
    else:
      if local is None:
        localStore.insert(entity, item)
      elif item.version > local.version:
        if local.dirty:
          // 发生并发：本地未上行 + 服务端已变更
          mergeIntoConflictQueue(local, item)   // 见 conflict-strategy.md
        else:
          localStore.replace(entity, item)
      # else: item.version <= local.version，忽略（幂等）

localStore.setWatermark(family_id, watermark)
if has_more: retry pull immediately
```

### 3.4 实体顺序约束

客户端必须按 **ledgers → categories → budgets → entries** 顺序消费，否则可能因外键未到先行插入 entry 而命中本地约束。

### 3.5 软删处理

- 所有实体的软删由 `deleted_at != null` 表达
- 客户端看到 `deleted_at` 非空 → 本地软删对齐
- 已软删的实体仍会在 `since` 窗口内重新返回（因为 `updated_at` 被刷新），这是预期行为

---

## 4. 端到端时序图

```
客户端                                                    服务端
  │                                                         │
  │ [离线]                                                   │
  │   用户记 3 笔 → outbox = [op1, op2, op3]                 │
  │                                                         │
  │ [联网]                                                   │
  │   batchKey = newUuidV4()                                │
  │   POST /sync/push  (ops=[op1,op2,op3])                  │
  │   Idempotency-Key: <batchKey>                           │───────▶
  │                                                         │
  │                                                         │ 逐条处理
  │                                                         │   op1: create → id=X, v=1, ok
  │                                                         │   op2: update → conflict v=5
  │                                                         │   op3: delete → rejected NOT_FOUND
  │                                                         │
  │              ◀──────────── 200 { results: [3 条] } ─────│
  │                                                         │
  │ 消费 results:                                            │
  │   op1 → 本地回写 id/version，清 dirty                    │
  │   op2 → 触发合并 UI（或静默取 server_record）            │
  │   op3 → 本地降级为草稿                                   │
  │                                                         │
  │ [紧接着]                                                 │
  │   GET /sync/pull?since=<last_watermark>                 │───────▶
  │              ◀──────────── 200 { watermark, changes } ──│
  │                                                         │
  │ 按实体顺序合并；更新本地 watermark                        │
  │                                                         │
```

---

## 5. 失败与重试

### 5.1 push 网络失败

- 客户端整批保留在 outbox；`Idempotency-Key` + body 不变
- 指数退避：`2s / 8s / 32s / 2min / 15min / 1h`，最长 24h
- 24h 仍失败 → 通知用户"同步异常，检查网络"

### 5.2 push 返回 5xx

- 同 §5.1，按网络失败处理

### 5.3 push 返回 4xx（除 409/422 以外）

- 直接 toast + 上报 Sentry；**不重试**
- 典型：`401 UNAUTHENTICATED` → 走刷新流；`403 PERMISSION_DENIED` → 本地撤回

### 5.4 push 返回 200 但部分 `conflict` / `rejected`

- 已在 §2.4 说明：批次整体视为成功；按条处理

### 5.5 pull 失败

- 直接重试（最多 3 次指数退避）；**不降级 since**

---

## 6. 并发与一致性保证

### 6.1 服务端内部

- 单批次内 `/sync/push` 在同一事务中对同 `entity + entity_id` 加行锁（`SELECT ... FOR UPDATE`），保证版本判读原子
- 跨批次：通过 `version` 字段承担乐观锁；`audit_logs` 承担回溯

### 6.2 客户端内部

- outbox 按创建时间升序；同实体 dirty 合并（后写盖前写；`base_version` 取首个 dirty 记录的值）
- `pull` 与 `push` 互斥（简单锁）；防止 "push 刚成功 / pull 又覆盖回旧值"

### 6.3 水位线 `watermark`

**v1.2 升级（2026-05-22 BUG-COSTRA-154 选项 B 彻底修复）**：watermark 从 ISO 时间戳改为 BIGINT change_seq。

- **类型**：`integer`（int64 · BIGINT change_seq）· 0 表示首次全量拉取
- **来源**：服务端 `entries.change_seq` 列（PG SEQUENCE `entries_change_seq` 严格单调）
- **定义**：服务端返回本批次数据中最大的 `change_seq`（rows 已 ORDER BY ASC · 末位即最大）
- **单调性**：PG SEQUENCE 保证严格单调递增 · 不依赖时钟 · 不受 NTP 回拨 / 主从切换影响
- **客户端规则**：下次 pull 传 `since = watermark`（数字）· **不得自行推进**

#### v1.2 设计动机（彻底消除 v1.1 残余风险）

| 历史风险（v1.0/v1.1） | v1.2 是否解决 |
|---|---|
| ① 同微秒并发漏拉（`now()` 在同一 query 多次调用返回相同微秒） | ✅ 完全解决（sequence 原子分配 · 不会撞） |
| ② NTP 时钟回拨破坏 `updated_at` 单调 | ✅ 完全解决（不依赖时钟） |
| ③ PG 主从切换导致 `updated_at` 倒退 | ✅ 完全解决（sequence 跨主从复制安全） |

#### v1.2 实现铁律

- **Server 端**：
  - migration `0006_entries_change_seq.sql` 加 `change_seq BIGINT NOT NULL DEFAULT nextval('entries_change_seq')` 列
  - INSERT 走列 DEFAULT · UPDATE/softDelete 必须显式 `SET change_seq = nextval('entries_change_seq')`
  - SQL `WHERE change_seq > $since ORDER BY change_seq ASC`（不再用 `updated_at` 比较）
- **Client 端**：
  - `getWatermark/setWatermark` 类型签名 `Promise<number>` / `(_, w: number)`
  - 默认值 `0`（不再 ISO epoch）
  - 检测 storage 残留 ISO 字符串时自动重置为 0（一次性全量重拉）
- **Wire 字段**：
  - `SyncPullResponse.watermark`: integer（替代 v1.0/v1.1 的 string）
  - `SyncPullResponse.changes.entries[].change_seq`: integer 新增
  - `SyncPullResponse.changes.entries[].updated_at`: 保留毫秒 ISO（仅展示语义 · 不再要求微秒精度）
- **背景**：详见 `qa/defects/2026-05-22-COSTRA-154-watermark-microsecond-precision.md` §11 v1.2 升级声明

---

## 7. 安全与校验

| 校验 | 位置 |
|---|---|
| `family_id` 属于当前 user | `/sync/pull` query 参数校验 |
| 每条 op 的 `payload.ledger_id` 属于 `family_id` | `/sync/push` service 层 |
| `base_version` 与当前 `version` 不匹配 | 逐条 409 conflict |
| 批次超 200 条 | 400 `INVALID_ARGUMENT` `details.field='ops'` |
| 载荷 > 8KB | 400 `INVALID_ARGUMENT` `details.field='ops[n].payload'` |

---

## 8. QA 断言钩子

| 用例 ID | 断言 |
|---|---|
| `smoke_sync_01` | push 3 条 ops（1 create 有效 / 1 update 冲突 / 1 delete 不存在）→ results 返回 `[ok, conflict, rejected]` 顺序一致 |
| `smoke_sync_02` | 同 Idempotency-Key 重放整批 → 返回与首次完全一致的 results |
| `smoke_sync_03` | 离线记 5 条 → 联网后 push 一次 → pull 一次 → 本地 5 条全部带 `id` + `version=1` 且 dirty 清零 |
| `smoke_sync_04` | A 端改 entry v=3 → B 端在 v=2 基础上 update → B 收到 `conflict` + `server_record.version=4` |
| `smoke_sync_05` | pull 返回 `has_more=true` → 客户端立即二次 pull；最终 watermark 单调推进 |

---

## 9. 非 MVP 演进

- **字段级 CRDT**：`note` 走 text merge；`category_id` 走 LWW with timestamp（Sprint-3+）
- **`since` 替换为 opaque 游标**：避免客户端伪造；需要服务端保留 per-client checkpoint
- **服务端 push（WebSocket）**：家庭内实时协作 Sprint-4+
- **分片 pull**：单 family 数据量 > 50K 时按实体分片

---

## 10. 关联文档

- `./conflict-strategy.md` · 冲突 UI / 合并规则
- `./id-strategy.md` · `client_ref_id` / `Idempotency-Key` / 服务端 `id`
- `./error-codes.md` · 所有 `error.code` 可能值
- `./ttl-policy.md` · 幂等窗口、水位线持久化
- OpenAPI：`server/api/openapi.yaml` → `SyncPushRequest` / `SyncPushResponse` / `SyncPullResponse`
