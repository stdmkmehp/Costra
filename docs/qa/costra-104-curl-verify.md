# COSTRA-104 · Backend `/sync/push` + `/entries` CRUD · Human curl 联调实测手册

> **D-022 v2.0 §4.2 等效 runtime 实测前置铁律** · 本手册 = COSTRA-104 R1 终审前置 · backend 卡非微信 SDK runtime 类 · 但 client/server 协议联调 = 等效 runtime 风险 · 必须 Human curl 实测 5 步 + 3 硬断言全 PASS 才能 T1 终审。
>
> **实测者**：Human Orchestrator + Human 项目负责人
> **预计时间**：~ 15 分钟
> **修订版本**：v1.0 · 2026-05-11 14:00 · COSTRA-104 R1 实装收尾

---

## 0. 前置准备

### 0.1 实测模式

本手册不依赖 ICP 备案 / 公网 staging · **本地 server + Mock 微信 code2Session**：

```bash
cd server
npm run dev    # 启动本地 server · 默认 http://127.0.0.1:3000
```

确认终端输出：

```
[server] listening on http://127.0.0.1:3000
[plugins] jwt loaded · errorHandler loaded · ratelimit loaded
[routes] /auth/wx-login + /auth/refresh + /auth/logout + /entries + /sync/push + /sync/pull(stub) registered
```

### 0.2 准备一个新终端跑 curl（保留 dev server 终端）

### 0.3 R1 范围声明（重要）

本卡 R1 实装范围（与 dispatch §2 + Card-Review PASS 29/30 锁定）：

| 实装项 | 状态 |
|---|---|
| POST `/sync/push` 主通道（三态消费 + 24h 幂等 + 乐观锁 409）| ✅ R1 实装 |
| POST `/entries` 单条创建（201 Entry）| ✅ R1 实装 |
| GET `/entries` 游标分页查询 | ✅ R1 实装 |
| GET `/entries/{entry_id}` 单条查询 | ✅ R1 实装 |
| PATCH `/entries/{entry_id}` 部分更新 | ❌ stub 501 + `deferred_card: COSTRA-152`（FU-104-ENTRIES-PATCH 留 Sprint-3）|
| DELETE `/entries/{entry_id}` 软删 | ❌ stub 501 + `deferred_card: COSTRA-153`（FU-104-ENTRIES-DELETE 留 Sprint-3）|
| GET `/sync/pull` 增量拉取 | ❌ stub 501 + `deferred_card: COSTRA-154`（FU-104-SYNC-PULL 留 Sprint-3 · 与 COSTRA-150 联动）|

**Human 实测时**：步骤 D 探测 stub 路由收到 `501 + deferred_card` 是**预期** · 切出去 3 件套铁律首次实战。

---

## 1. 步骤 A · 启动检查

```bash
curl -i http://127.0.0.1:3000/healthz
```

**期望**：`HTTP/1.1 200 OK` + `{"status":"ok"}`

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如 FAIL：`revise:COSTRA-104 reason:server-not-up`）

---

## 2. 步骤 B · 登录拿 JWT

```bash
RESPONSE=$(curl -s -X POST http://127.0.0.1:3000/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"test-curl-verify"}')
echo $RESPONSE | jq .
TOKEN=$(echo $RESPONSE | jq -r '.access_token')
echo "TOKEN=$TOKEN"
```

**期望**：`access_token` / `refresh_token` / `user.id` 全 snake_case 返回 · TOKEN 非空 36+ 字符。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

> **注**：开发环境 `wx_fetch` mock 已注入 · code 任意值都能成功登入。

---

## 3. 步骤 C · POST /entries 创建一笔（验 201 + Entry 全字段 snake_case）

```bash
curl -i -X POST http://127.0.0.1:3000/entries \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "ledger_id": "00000000-0000-0000-0000-000000000001",
    "amount": 12345,
    "currency": "CNY",
    "type": "expense",
    "occurred_at": "2026-05-11T10:00:00.000Z",
    "note": "curl 实测 1",
    "client_ref_id": "curl-test-001"
  }'
```

**期望响应**：`HTTP/1.1 201 Created`

```json
{
  "id": "<uuid v7>",
  "ledger_id": "00000000-0000-0000-0000-000000000001",
  "amount": 12345,
  "currency": "CNY",
  "type": "expense",
  "occurred_at": "2026-05-11T10:00:00.000Z",
  "note": "curl 实测 1",
  "version": 1,
  "client_ref_id": "curl-test-001",
  "created_at": "...",
  "updated_at": "..."
}
```

**断言**：所有字段 `snake_case` 命名（无 `amountCents` / `categoryId` 等驼峰）· `version=1`。

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如 schema 不对：`revise:COSTRA-104 reason:entries-payload-mismatch`）

---

## 4. 步骤 D · POST /sync/push 三态混合（含 stub 路由 501 探测）

### 4.1 三态混合一次推 3 op

```bash
curl -i -X POST http://127.0.0.1:3000/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 11111111-1111-1111-1111-111111111111' \
  -d '{
    "ops": [
      {
        "op": "create",
        "entity": "entry",
        "client_ref_id": "curl-batch-001",
        "base_version": null,
        "payload": {
          "ledger_id": "00000000-0000-0000-0000-000000000001",
          "amount": 5000,
          "type": "expense",
          "occurred_at": "2026-05-11T11:00:00.000Z"
        }
      },
      {
        "op": "create",
        "entity": "category",
        "client_ref_id": "curl-batch-cat-001",
        "base_version": null,
        "payload": {"name": "餐饮", "type": "expense"}
      },
      {
        "op": "create",
        "entity": "entry",
        "client_ref_id": "curl-test-001",
        "base_version": null,
        "payload": {
          "ledger_id": "00000000-0000-0000-0000-000000000001",
          "amount": 12345,
          "type": "expense",
          "occurred_at": "2026-05-11T10:00:00.000Z"
        }
      }
    ]
  }'
```

**期望响应**：`HTTP/1.1 200 OK`

```json
{
  "results": [
    { "client_ref_id": "curl-batch-001", "status": "ok", "server_id": "...", "server_version": 1 },
    { "client_ref_id": "curl-batch-cat-001", "status": "rejected", "error": { "code": "NOT_IMPLEMENTED", "message": "category entity deferred to COSTRA-XXX" } },
    { "client_ref_id": "curl-test-001", "status": "conflict", "server_version": 1 }
  ]
}
```

**断言**：
- 第 1 op 进入 entry 表 · status=ok
- 第 2 op entity=category 被 reject · status=rejected · code=NOT_IMPLEMENTED
- 第 3 op client_ref_id 重用步骤 C 的 · 触发 conflict 三态

### 4.2 stub 路由 501 探测

```bash
# PATCH /entries stub
curl -i -X PATCH "http://127.0.0.1:3000/entries/00000000-0000-0000-0000-000000000001" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"note":"试更新"}'
```

**期望**：`HTTP/1.1 501 Not Implemented`

```json
{
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "PATCH /entries/{entry_id} deferred to Sprint-3",
    "details": {
      "deferred_card": "COSTRA-152",
      "followup_id": "FU-104-ENTRIES-PATCH"
    }
  }
}
```

```bash
# DELETE /entries stub
curl -i -X DELETE "http://127.0.0.1:3000/entries/00000000-0000-0000-0000-000000000001" \
  -H "authorization: Bearer $TOKEN"
```

**期望**：`501` + `deferred_card: COSTRA-153` + `followup_id: FU-104-ENTRIES-DELETE`

```bash
# GET /sync/pull stub
curl -i "http://127.0.0.1:3000/sync/pull?since=1970-01-01T00:00:00.000Z" \
  -H "authorization: Bearer $TOKEN"
```

**期望**：`501` + `deferred_card: COSTRA-154` + `followup_id: FU-104-SYNC-PULL`

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如 stub 静默 / 缺 deferred_card：`revise:COSTRA-104 reason:stub-silent`）

---

## 5. 步骤 E · 重发同 Idempotency-Key 验证幂等

```bash
# 完全重发步骤 4.1 命令（同 idempotency-key + 同 body）
curl -i -X POST http://127.0.0.1:3000/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 11111111-1111-1111-1111-111111111111' \
  -d '<同步骤 4.1 body>'
```

**期望**：`HTTP/1.1 200 OK` · response 与第一次**完全一致**（不会重复入账 · 24h 内）。

```bash
# 同 idempotency-key 改 body 验证 mismatch
curl -i -X POST http://127.0.0.1:3000/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 11111111-1111-1111-1111-111111111111' \
  -d '{"ops":[]}'
```

**期望**：`HTTP/1.1 409 Conflict` + `IDEMPOTENCY_KEY_MISMATCH`

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如重复入账 / 不返回缓存：`revise:COSTRA-104 reason:idempotency-broken`）

---

## 6. 3 硬断言（H1~H3）

| # | 断言 | 验证方法 | Pass/Fail |
|---|---|---|---|
| H1 | 协议 100% snake_case · 0 驼峰外溢 | 步骤 C/D 所有响应字段全 snake_case · 0 amountCents/categoryId | [ ] |
| H2 | 切出去 3 件套铁律 stub 路由全 501 + 3 个 deferred_card 完整 | 步骤 D 4.2 三个 stub 都返 501 + 各自 COSTRA-152/153/154 | [ ] |
| H3 | 24h 强幂等保证 · idempotency-key 重发返缓存 + mismatch 409 | 步骤 E 两个验证 | [ ] |

---

## 7. 实测后

- **5 步 A/B/C/D/E 全 Pass + 3 硬断言全 Pass** → 回 `approve:COSTRA-104` → Orchestrator 写 FINAL.md + metrics + board/backlog 流转 Done + HANDOFF v1.7 + 单 commit + push
- **任意 Hard FAIL**（H1~H3 任一）→ 回 `revise:COSTRA-104 reason:<一句话>` → R2 修复路径
- **某步骤实操不清晰** → 直接问 Orchestrator

---

**协议事实源**：
- `server/api/openapi.yaml` v1.0
- `docs/api/sync-protocol.md` §2 三态 / §2.5 幂等键 / §6 一致性 / §7 安全校验
- `docs/api/error-codes.md` NOT_IMPLEMENTED + IDEMPOTENCY_KEY_MISMATCH + VERSION_CONFLICT

**修订记录**：
- v1.0 · 2026-05-11 14:00 · COSTRA-104 R1 实装收尾首版
