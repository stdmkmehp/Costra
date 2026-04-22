# 冲突与离线同步策略

> **目标**：在弱网 / 多端 / 多用户（家庭共享）场景下，保证数据一致性、可追溯、可恢复。
> **适用**：所有可变实体 —— `entry` / `category` / `budget` / `ledger` / `family`。
> **相关**：OpenAPI `SyncPushRequest` / `SyncPushResponse` / `409 Conflict`。

---

## 1. 核心原则

1. **服务端是仲裁者**（Server Wins on Conflict），客户端是拥抱合并的乐观副本。
2. **每个可变实体都有单调递增的 `version`**（int），由服务端在每次成功写入后 `+1`。
3. **客户端**在本地维护：
   - `client_ref_id`：离线时的本地临时主键（UUID）
   - `base_version`：最后一次从服务端拿到的 `version`
   - `dirty` 标记：本地变更未上行
4. **上行**通过 `POST /sync/push`，**下行**通过 `GET /sync/pull?since=...`。

---

## 2. 单条请求（在线即时路径）

| 操作 | 客户端 | 服务端 |
|---|---|---|
| 新建 | `POST /entries` 带 `Idempotency-Key` + `client_ref_id` | 成功返回 `id` + `version=1`；幂等键命中直接返回历史 |
| 修改 | `PATCH /entries/{id}` 带 `version`（即 `base_version`） | `version == server.version` 则 `+1` 成功；否则 **409** 返回 `ConflictError`（含 `server_record` + `server_version`） |
| 删除 | `DELETE /entries/{id}` | 软删（`deleted_at`=now, `version+=1`） |

### 409 客户端处理

```
1) 若本地 dirty 尚未给用户明确反馈 → 静默拉最新 server_record，本地自动合并（见 §4 合并规则）
2) 若用户已点了"保存" → 弹「与他人修改冲突」面板，展示 diff，用户选择：
     a) 使用服务端版本（放弃本地改动）
     b) 覆盖服务端版本（再次提交时 version 取 server_version）
     c) 手动合并（进入编辑态，三方合并 UI）
```

---

## 3. 批量同步（离线攒单路径）

### 3.1 上行：`POST /sync/push`

- 客户端把本地 `dirty` 记录按产生时间升序打包成 `ops[]`（最多 200 条）
- 每条 op：
  ```json
  {
    "op": "update",
    "entity": "entry",
    "client_ref_id": "c-a1...b2",
    "base_version": 3,
    "payload": { "id": "srv-uuid", "amount": 15000, "note": "..." }
  }
  ```
- 服务端**逐条**处理，返回 `results[]`：

| status | 含义 | 客户端动作 |
|---|---|---|
| `ok` | 写入成功 | 更新本地 `id` / `version`、清 dirty |
| `conflict` | 乐观锁冲突 | 保留本地 dirty，拉 `server_record` 进合并 UI 或按规则自动合并 |
| `rejected` | 业务拒绝（如分类越权 / 参数错） | 标记本地错误态，用户二次编辑或放弃 |

### 3.2 下行：`GET /sync/pull?since=...`

- `since` 为客户端水位（上次 pull 返回的 `watermark`）
- 服务端按 `updated_at` 升序返回含软删的变更集
- 客户端按规则覆盖本地缓存：
  - `server.version > local.version` → 覆盖（如本地 dirty，进合并）
  - 含 `deleted_at` → 本地软删对齐
  - 最后更新本地水位 = `watermark`

---

## 4. 字段级合并规则（MVP 简版）

当冲突需要合并（`entry` 为主）：

| 字段 | 策略 |
|---|---|
| `amount` | 不合并，必须二选一（触发 UI） |
| `note` | 若两侧都非空且不同 → 拼接 `"server_note | local_note"`（保留全部信息，用户后续可编辑） |
| `category_id` | 不合并，二选一 |
| `occurred_at` | 不合并，二选一 |
| `deleted_at` | 任一侧为删除 → 最终为删除（**删除优先**） |

> **MVP 范围**：实现 `amount / deleted_at` 两字段的硬冲突 UI；其余走"服务端版本"为默认选项并允许用户放弃。
> **后续**：引入字段级 CRDT（`note` 用 text diff，`category_id` 用 LWW with timestamp）。

---

## 5. 幂等保证

- 同一 `client_ref_id` + 同一 `op` 在 `/sync/push` 内多次出现，服务端视为一次（按首次结果返回）
- 同一 `Idempotency-Key` 在 24h 内重复请求，返回首次响应（含 `201` 或 `409`）
- 上行网络失败后的重试**必须**复用同一 `Idempotency-Key` + 同一 `client_ref_id`

---

## 6. 失败回退策略

- 客户端 dirty 缓冲按"指数退避"重试：`2s / 8s / 32s / 2min / 15min / 1h`，最长 24h
- 连续失败 > 24h：提示用户"同步异常"，提供"强制重新登录"按钮（清 access 重试）
- 服务端 5xx 不计入 dirty 失败次数，仅做网络层重试

---

## 7. 边界案例

| 场景 | 处理 |
|---|---|
| 离线创建后被他人线上删除 | `push` 收到 `rejected(code=NOT_FOUND)`，本地记录降级为"本地草稿" |
| 同时修改同一 entry（A/B 同时在线） | 后到者 409，按 §2 合并 |
| 客户端时钟错乱 | 所有时间字段服务端重写（`created_at` / `updated_at` 由服务端赋），客户端 `occurred_at` 保留用户选择值 |
| 分包延迟加载导致 dirty 积压 | MiniApp 端 `sync.ts` 常驻主包，不随分包 |

---

## 8. 与 QA 的握手

- QA 冒烟用例须覆盖：
  - 单条写入 `201 → 409 → 合并 → 再提交 `200`
  - `/sync/push` 含 3 条 ops：1 ok / 1 conflict / 1 rejected 的混合响应
  - 弱网场景下幂等键重放返回一致性
- 见 `docs/qa/test-strategy.md` §同步链路。
