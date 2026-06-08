# COSTRA-152 + COSTRA-153 · PATCH / DELETE /entries · Human curl 实测手册

> **D-024 §2.2 C1 第 4 次实战** · 本手册 = COSTRA-152 + COSTRA-153 联合双卡 curl 实测 · backend 卡协议联调 = 等效 runtime 风险 · 必须 Human curl 实测 7 步 + 5 硬断言全 PASS 才能 T1 终审。
>
> **实测者**：Human Orchestrator + Human 项目负责人
> **预计时间**：~ 20 分钟
> **修订版本**：v1.0 · 2026-05-23 · COSTRA-152 + COSTRA-153 联合双卡首版

---

## 0. 前置准备

### 0.1 实测模式

本手册不依赖 ICP 备案 / 公网 staging · **本地 server + Mock 微信 code2Session**：

```bash
cd server
WX_MOCK_LOGIN=1 npm run dev    # 启动本地 server · 默认 http://127.0.0.1:8080
```

**期望终端输出**（pino JSON 格式 · 关键看 `msg` 含 listening + port 8080）：

```json
{"level":30,...,"msg":"Server listening at http://127.0.0.1:8080"}
{"level":30,...,"port":8080,"nodeEnv":"development","msg":"costra-server listening"}
{"level":40,...,"wxMockLogin":true,"msg":"⚠️  WX_MOCK_LOGIN enabled · code2Session mocked · DO NOT enable in production"}
```

只要看到 `port: 8080` + `costra-server listening` + `wxMockLogin: true` 即视为启动成功。

### 0.2 DB migrations 全跑齐（首次实测 / 重建 DB 后必跑）

**关键**：必须把 `server/db/migrations/*.sql` 全部跑齐 · 否则会有列缺失 / 类型缺失等运行时炸点。

```bash
cd server
for f in db/migrations/*.sql; do
  echo "=== $f ==="
  psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -f "$f"
done
```

期望按文件名顺序跑完 **6 个**（比 104 实测时多了 2 个）：

| 文件 | 内容 | 备注 |
|---|---|---|
| `0001_init.sql` | 表 schema 全建（users/families/ledgers/family_members/entries/categories/budgets/...）| COSTRA-021 |
| `0002_seed_system_categories.sql` | 12 条系统预设分类 | seed |
| `0003_user_sessions.sql` | user_sessions 表 + 索引 | COSTRA-101 |
| `0004_entries_account_columns.sql` | entries 加 `account_id` + `to_account_id` 列 | COSTRA-104 R1.x.2 |
| `0005_users_has_completed_profile.sql` | users 加 `has_completed_profile` 列 | COSTRA-156 |
| `0006_entries_change_seq.sql` | entries 加 `change_seq` BIGINT 列 + SEQUENCE（同步引擎一致性水位升级）| **BUG-COSTRA-154 R1.x.2** · v1.2 BIGINT |

**已建 DB 重新跑也安全**：所有 migration 都用 `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` 幂等保护。

> **注意**：不需重 seed `0002_seed_system_categories.sql`（categories 非本手册依赖 · 但跑也不报错）。

### 0.3 准备一个新终端跑 curl（保留 dev server 终端）

### 0.4 R1 范围声明（重要）

本手册覆盖三处共享验证：

| 实装项 | 卡号 | 状态 |
|---|---|---|
| PATCH `/entries/{entry_id}` 乐观锁更新 + 409 冲突体 | COSTRA-152 | ✅ R1 实装 |
| K3 method-override（POST + X-HTTP-Method-Override: PATCH）| COSTRA-152 §LINKAGE 决策 1 | ✅ R1 实装 |
| DELETE `/entries/{entry_id}?version=N` 软删 + 409 冲突体 | COSTRA-153 | ✅ R1 实装 |
| P0 跨 family 越权守门补丁（GET + PATCH + DELETE 三处共享守门）| COSTRA-152 R1 附加补丁 | ✅ R1 实装 + 反向验证铁证 |

**不依赖 staging**：全部本地 server + `WX_MOCK_LOGIN=1` · 与 COSTRA-154+150 staging 重测路径完全解耦。

---

## 1. 步骤 A · 启动检查

```bash
curl -i http://127.0.0.1:8080/v1/healthz
```

**期望**：`HTTP/1.1 200 OK` + `{"status":"ok"}`

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如 FAIL：`revise:COSTRA-152 reason:server-not-up`）

---

## 2. 步骤 B · 登录拿 JWT（user_A）

```bash
RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/v1/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"test-152-153"}')
echo $RESPONSE | jq .
TOKEN=$(echo $RESPONSE | jq -r '.access_token')
USER_ID=$(echo $RESPONSE | jq -r '.user.id')
echo "TOKEN=$TOKEN"
echo "USER_ID=$USER_ID"
```

**期望**：`access_token` / `refresh_token` / `user.id` 全 snake_case 返回 · TOKEN 非空 36+ 字符。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

> **注**：dev WX mock 已在 §0.1 启动期注入 · code 任意值都能成功登入。

---

## 3. 步骤 B.5 · 准备测试数据（首次实测必跑 · psql 手动 seed）

### 3.1 为什么需要

本手册覆盖 PATCH / DELETE / 跨 family 守门 · 需要预先 seed：
- **user_A** 的 family_A / ledger_A / entry_A（PATCH + DELETE 实测目标）
- **user_B** 的 family_B / ledger_B / entry_B（跨 family 守门测试 · §7 步骤 E 用）

### 3.2 连 psql 执行 SQL seed

> **DB 连接串**：`postgres://costra:costra_dev_pw@localhost:5432/costra`（来自 `server/.env.example`）

```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
  -v user_id="'$USER_ID'" <<'SQL'
BEGIN;

-- ============================================================
-- user_A 的 family_A / ledger_A / family_members(owner)
-- ============================================================
INSERT INTO families (id, name, owner_id)
VALUES ('00000000-0000-0000-0000-0000000000F0', 'CurlTestFamily-A', :user_id)
ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id;

INSERT INTO ledgers (id, family_id, name)
VALUES ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000F0',
        'Main')
ON CONFLICT (id) DO NOTHING;

INSERT INTO family_members (family_id, user_id, role)
VALUES ('00000000-0000-0000-0000-0000000000F0', :user_id, 'owner')
ON CONFLICT DO NOTHING;

-- ============================================================
-- user_A 的 entry_A（PATCH / DELETE 实测目标 · version=1）
-- ============================================================
INSERT INTO entries (id, ledger_id, amount, currency, type, occurred_at, note, created_by, version, client_ref_id)
VALUES ('00000000-0000-0000-0000-00000000EA01',
        '00000000-0000-0000-0000-000000000001',
        3000,
        'CNY',
        'expense',
        '2026-05-23T10:00:00.000Z',
        'curl-test entry A',
        :user_id,
        1,
        'curl-entry-A')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- 验证（期望 4 行 count=1）
SELECT 'families-A' AS t, count(*) FROM families WHERE id = '00000000-0000-0000-0000-0000000000F0'
UNION ALL SELECT 'ledgers-A',  count(*) FROM ledgers  WHERE id = '00000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'members-A',  count(*) FROM family_members WHERE family_id = '00000000-0000-0000-0000-0000000000F0' AND user_id = :user_id
UNION ALL SELECT 'entry-A',    count(*) FROM entries   WHERE id = '00000000-0000-0000-0000-00000000EA01';
SQL
```

**期望输出**：4 行 count=1：

```
     t      | count
------------+-------
 families-A |     1
 ledgers-A  |     1
 members-A  |     1
 entry-A    |     1
```

### 3.3 Seed user_B + family_B + ledger_B + entry_B（跨 family 守门测试用）

先用另一个 code 登录拿 user_B 的 ID：

```bash
RESPONSE_B=$(curl -s -X POST http://127.0.0.1:8080/v1/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"test-userB"}')
USER_B_ID=$(echo $RESPONSE_B | jq -r '.user.id')
TOKEN_B=$(echo $RESPONSE_B | jq -r '.access_token')
echo "USER_B_ID=$USER_B_ID"
echo "TOKEN_B=$TOKEN_B"
```

然后 seed user_B 的数据：

```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
  -v user_b_id="'$USER_B_ID'" <<'SQL'
BEGIN;

-- ============================================================
-- user_B 的 family_B / ledger_B / family_members(owner)
-- ============================================================
INSERT INTO families (id, name, owner_id)
VALUES ('00000000-0000-0000-0000-0000000000F1', 'CurlTestFamily-B', :user_b_id)
ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id;

INSERT INTO ledgers (id, family_id, name)
VALUES ('00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-0000000000F1',
        'Main')
ON CONFLICT (id) DO NOTHING;

INSERT INTO family_members (family_id, user_id, role)
VALUES ('00000000-0000-0000-0000-0000000000F1', :user_b_id, 'owner')
ON CONFLICT DO NOTHING;

-- ============================================================
-- user_B 的 entry_B（跨 family 守门测试目标 · version=1）
-- ============================================================
INSERT INTO entries (id, ledger_id, amount, currency, type, occurred_at, note, created_by, version, client_ref_id)
VALUES ('00000000-0000-0000-0000-00000000EB01',
        '00000000-0000-0000-0000-000000000002',
        9000,
        'CNY',
        'income',
        '2026-05-23T12:00:00.000Z',
        'curl-test entry B',
        :user_b_id,
        1,
        'curl-entry-B')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- 验证（期望 4 行 count=1）
SELECT 'families-B' AS t, count(*) FROM families WHERE id = '00000000-0000-0000-0000-0000000000F1'
UNION ALL SELECT 'ledgers-B',  count(*) FROM ledgers  WHERE id = '00000000-0000-0000-0000-000000000002'
UNION ALL SELECT 'members-B',  count(*) FROM family_members WHERE family_id = '00000000-0000-0000-0000-0000000000F1' AND user_id = :user_b_id
UNION ALL SELECT 'entry-B',    count(*) FROM entries   WHERE id = '00000000-0000-0000-0000-00000000EB01';
SQL
```

**期望输出**：4 行 count=1：

```
     t      | count
------------+-------
 families-B |     1
 ledgers-B  |     1
 members-B  |     1
 entry-B    |     1
```

### 3.4 Pass/Fail

- [ ] Pass（8 行 count=1 · entry_A `EA01` + entry_B `EB01` 已就位）· [ ] Fail（看 SQL 报错：FK 违反 = USER_ID 不对 · 主键冲突 = 无视即可 ON CONFLICT 已处理）

### 3.5 变量速查（后续步骤复用）

| 变量 | 值 | 用途 |
|---|---|---|
| `ENTRY_ID` | `00000000-0000-0000-0000-00000000EA01` | §4 / §5 / §6 步骤 C / C-K3 / D 的 PATCH/DELETE 目标 |
| `ENTRY_B_ID` | `00000000-0000-0000-0000-00000000EB01` | §7 步骤 E 跨 family 守门目标 |
| `TOKEN` | 步骤 B 获取 | user_A 的 JWT |
| `TOKEN_B` | 步骤 3.3 获取 | user_B 的 JWT |

---

## 4. 步骤 C · COSTRA-152 PATCH 主路径

> **事实源**：`server/src/routes/entries.ts:197-245` + `server/test/entries-patch.test.ts` T1~T6

### 4.1 PATCH 成功 → 200 + version 递增 + 字段更新生效

```bash
ENTRY_ID='00000000-0000-0000-0000-00000000EA01'

curl -i -X PATCH "http://127.0.0.1:8080/v1/entries/$ENTRY_ID" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "version": 1,
    "amount": 5000,
    "note": "updated via curl"
  }'
```

**期望响应**：`HTTP/1.1 200 OK`

```json
{
  "id": "00000000-0000-0000-0000-00000000EA01",
  "ledger_id": "00000000-0000-0000-0000-000000000001",
  "amount": 5000,
  "currency": "CNY",
  "type": "expense",
  "category_id": null,
  "account_id": null,
  "to_account_id": null,
  "note": "updated via curl",
  "occurred_at": "2026-05-23T10:00:00.000Z",
  "created_by": "<user_A UUID>",
  "created_at": "...",
  "updated_at": "...",
  "deleted_at": null,
  "version": 2,
  "client_ref_id": "curl-entry-A"
}
```

**断言**：`version=2`（1→2 递增）· `amount=5000`（3000→5000 更新生效）· `note="updated via curl"`（更新生效）· `deleted_at=null`。

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如 version 未递增 / 字段未变：`revise:COSTRA-152 reason:patch-not-applied`）

### 4.2 重复 PATCH 用旧 version=1 → 409 VERSION_CONFLICT

```bash
curl -i -X PATCH "http://127.0.0.1:8080/v1/entries/$ENTRY_ID" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "version": 1,
    "amount": 9999,
    "note": "should conflict"
  }'
```

**期望响应**：`HTTP/1.1 409 Conflict`

```json
{
  "code": "VERSION_CONFLICT",
  "message": "version conflict",
  "trace_id": "<req.id>",
  "details": {
    "server_version": 2
  }
}
```

**断言**：`code=VERSION_CONFLICT` · `details.server_version=2`（当前服务端版本）· 不返回全量实体（client 走 GET 单独拉取 · 与 sync push conflict 体语义统一）。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

### 4.3 PATCH 缺 version → 400 INVALID_ARGUMENT

```bash
curl -i -X PATCH "http://127.0.0.1:8080/v1/entries/$ENTRY_ID" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "amount": 7777,
    "note": "no version field"
  }'
```

**期望响应**：`HTTP/1.1 400 Bad Request`

```json
{
  "code": "INVALID_ARGUMENT",
  "message": "...",
  "trace_id": "<req.id>",
  "details": {
    "field": "version",
    "constraint": "..."
  }
}
```

**断言**：`code=INVALID_ARGUMENT` · Fastify schema 校验失败 · `version` 是 required 字段。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

### 4.4 PATCH 不存在的 entry_id → 404 NOT_FOUND

```bash
curl -i -X PATCH "http://127.0.0.1:8080/v1/entries/00000000-0000-0000-0000-000000009999" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "version": 1,
    "amount": 100
  }'
```

**期望响应**：`HTTP/1.1 404 Not Found`

```json
{
  "code": "NOT_FOUND",
  "message": "...",
  "trace_id": "<req.id>"
}
```

**断言**：`code=NOT_FOUND`。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

---

## 5. 步骤 C-K3 · COSTRA-152 K3 method-override（§LINKAGE 决策 1）

> **事实源**：`server/src/routes/entries.ts:247-263` + `server/test/entries-patch.test.ts` T8 + POST-without-override 测

### 5.1 POST + X-HTTP-Method-Override: PATCH → 等价 PATCH 200 + version 递增

> **前置**：§4.1 已将 entry version 从 1→2 · 本步用 version=2 PATCH · 成功后 version 变为 3

```bash
curl -i -X POST "http://127.0.0.1:8080/v1/entries/$ENTRY_ID" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'X-HTTP-Method-Override: PATCH' \
  -d '{
    "version": 2,
    "amount": 6000,
    "note": "via method-override"
  }'
```

**期望响应**：`HTTP/1.1 200 OK`

```json
{
  "id": "00000000-0000-0000-0000-00000000EA01",
  "ledger_id": "00000000-0000-0000-0000-000000000001",
  "amount": 6000,
  "currency": "CNY",
  "type": "expense",
  "category_id": null,
  "account_id": null,
  "to_account_id": null,
  "note": "via method-override",
  "occurred_at": "2026-05-23T10:00:00.000Z",
  "created_by": "<user_A UUID>",
  "created_at": "...",
  "updated_at": "...",
  "deleted_at": null,
  "version": 3,
  "client_ref_id": "curl-entry-A"
}
```

**断言**：`version=3`（2→3 递增）· `amount=6000`（更新生效）· `note="via method-override"`。行为与 §4.1 PATCH 完全等价。

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如不等价：`revise:COSTRA-152 reason:k3-method-override-broken`）

### 5.2 POST 不带 method-override header → 405 METHOD_NOT_ALLOWED

```bash
curl -i -X POST "http://127.0.0.1:8080/v1/entries/$ENTRY_ID" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "version": 3,
    "amount": 100
  }'
```

**期望响应**：`HTTP/1.1 405 Method Not Allowed`

```json
{
  "error": {
    "code": "METHOD_NOT_ALLOWED",
    "message": "POST /entries/{id} requires X-HTTP-Method-Override: PATCH"
  }
}
```

> **注意**：405 响应体是 K3 handler 直接 `reply.code(405).send(...)` 返回的 · 不经过 errorHandler · 所以结构是 `{ error: { code, message } }` 而非 errorHandler 的顶层 `{ code, message, trace_id }` 格式。这是正常的。

**断言**：`code=METHOD_NOT_ALLOWED` · HTTP 405。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

---

## 6. 步骤 D · COSTRA-153 DELETE 主路径（§LINKAGE 决策 2 query version）

> **事实源**：`server/src/routes/entries.ts:265-290` + `server/test/entries-delete.test.ts` T1~T5

> **前置版本说明**：跑了 §4.1（version 1→2）+ §5.1（version 2→3）后 · entry 当前 version=3 · 所以 §6.1 用 `?version=3`

### 6.1 DELETE 成功 → 204 No Content

```bash
curl -i -X DELETE "http://127.0.0.1:8080/v1/entries/$ENTRY_ID?version=3" \
  -H "authorization: Bearer $TOKEN"
```

**期望响应**：`HTTP/1.1 204 No Content`（无响应体）

**断言**：204 + 空 body。

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如返 200/409/500：`revise:COSTRA-153 reason:delete-not-204`）

### 6.2 GET 验证软删 → deleted_at != null

```bash
curl -i "http://127.0.0.1:8080/v1/entries/$ENTRY_ID" \
  -H "authorization: Bearer $TOKEN"
```

**期望响应**：`HTTP/1.1 404 Not Found`

```json
{
  "code": "NOT_FOUND",
  "message": "...",
  "trace_id": "<req.id>"
}
```

> **说明**：GET /entries/{id} 内部调 `entryService.findById(userId, entryId)` → `entryRepo.findById(entryId, userId)` · 查询条件含 `WHERE e.deleted_at IS NULL`（entries.ts L389）· 软删后行不命中 → 返 null → service 抛 NOT_FOUND → 404。这是**正确行为**——对调用方而言软删 = 不可见。

> **可选 psql 深验证**（更直观验证 deleted_at 字段）：

```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c \
  "SELECT id, deleted_at, version FROM entries WHERE id = '00000000-0000-0000-0000-00000000EA01';"
```

期望：`deleted_at` 是 ISO 时间戳（非 null）· `version=4`（3→4 软删递增）。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

### 6.3 DELETE 缺 version query → 400 INVALID_ARGUMENT

```bash
curl -i -X DELETE "http://127.0.0.1:8080/v1/entries/$ENTRY_ID" \
  -H "authorization: Bearer $TOKEN"
```

**期望响应**：`HTTP/1.1 400 Bad Request`

```json
{
  "code": "INVALID_ARGUMENT",
  "message": "...",
  "trace_id": "<req.id>",
  "details": {
    "field": "version",
    "constraint": "..."
  }
}
```

**断言**：`code=INVALID_ARGUMENT` · `deleteEntryQuerySchema` required:['version'] 校验失败。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

### 6.4 DELETE 重复（已删 entry）→ 404 NOT_FOUND

```bash
curl -i -X DELETE "http://127.0.0.1:8080/v1/entries/$ENTRY_ID?version=3" \
  -H "authorization: Bearer $TOKEN"
```

**期望响应**：`HTTP/1.1 404 Not Found`

```json
{
  "code": "NOT_FOUND",
  "message": "...",
  "trace_id": "<req.id>"
}
```

> **为什么是 404 而不是 409**：`entryRepo.findById` 查询条件含 `WHERE e.deleted_at IS NULL`（L389）· 软删后行不命中 → 返 null → service 抛 NOT_FOUND → 404。不会走到 version 比较逻辑 · 所以不会返 409。这与 `server/test/entries-delete.test.ts` T5 行为一致。

**断言**：`code=NOT_FOUND` · 不返 200 也不返 409。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

---

## 7. 步骤 E · P0 跨 family 越权守门补丁（关键安全验证）

> **事实源**：`server/src/repositories/entryRepo.ts:359-409` + review-tech §守门补丁特别评论 + `server/test/entries-patch.test.ts` T7 + `server/test/entries-delete.test.ts` T6
>
> **背景**：COSTRA-152 R1 附加的 P0 跨 family 守门补丁 · `entryRepo.findById` 加 userId 参数 · JOIN family_members 增加 `fm.user_id = $2 AND fm.left_at IS NULL` 过滤。三处共享守门：GET / PATCH / DELETE 均经 `entryService.findById(userId, entryId)` → `entryRepo.findById(entryId, userId)` 统一守门 · 无旁路。
>
> **实装期反向验证铁证**：临时移除 `fm.user_id = $2` → 3 测全 FAIL（T-CROSS-FAMILY / T7 / T6）→ 恢复 → 70/70 全绿。但 Human curl 实测是真链路最后闸 · 必跑。
>
> **安全优先决策**：跨 family 越权统一返 404 而非 403 · 不泄露 entry 存在性给非 family 成员（review-tech 评论确认语义合理）。

### 7.1 准备：确认 TOKEN_B 已就位

§3.3 已登录 user_B 拿到 `TOKEN_B` + seed 了 entry_B（id=`00000000-0000-0000-0000-00000000EB01`）。

如未保留变量，重跑：

```bash
RESPONSE_B=$(curl -s -X POST http://127.0.0.1:8080/v1/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"test-userB"}')
TOKEN_B=$(echo $RESPONSE_B | jq -r '.access_token')
echo "TOKEN_B=$TOKEN_B"
```

### 7.2 用 user_A 的 TOKEN GET user_B 的 entry_B → 404 NOT_FOUND

```bash
ENTRY_B_ID='00000000-0000-0000-0000-00000000EB01'

curl -i "http://127.0.0.1:8080/v1/entries/$ENTRY_B_ID" \
  -H "authorization: Bearer $TOKEN"
```

**期望响应**：`HTTP/1.1 404 Not Found`

```json
{
  "code": "NOT_FOUND",
  "message": "...",
  "trace_id": "<req.id>"
}
```

**断言**：`code=NOT_FOUND`（不是 200 · 不是 403 · 安全优先不泄露 entry 存在性）。

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如返 200：**P0 安全漏洞** · 立即 `revise:COSTRA-152 reason:cross-family-guard-broken-GET`）

### 7.3 用 user_A 的 TOKEN PATCH user_B 的 entry_B → 404 NOT_FOUND

```bash
curl -i -X PATCH "http://127.0.0.1:8080/v1/entries/$ENTRY_B_ID" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "version": 1,
    "amount": 9999,
    "note": "unauthorized patch attempt"
  }'
```

**期望响应**：`HTTP/1.1 404 Not Found`

```json
{
  "code": "NOT_FOUND",
  "message": "...",
  "trace_id": "<req.id>"
}
```

**断言**：`code=NOT_FOUND`（不是 200 · 不是 403）。

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如返 200：**P0 安全漏洞** · 立即 `revise:COSTRA-152 reason:cross-family-guard-broken-PATCH`）

### 7.4 用 user_A 的 TOKEN DELETE user_B 的 entry_B → 404 NOT_FOUND

```bash
curl -i -X DELETE "http://127.0.0.1:8080/v1/entries/$ENTRY_B_ID?version=1" \
  -H "authorization: Bearer $TOKEN"
```

**期望响应**：`HTTP/1.1 404 Not Found`

```json
{
  "code": "NOT_FOUND",
  "message": "...",
  "trace_id": "<req.id>"
}
```

**断言**：`code=NOT_FOUND`（不是 204 · 不是 403）。

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如返 204：**P0 安全漏洞** · 立即 `revise:COSTRA-153 reason:cross-family-guard-broken-DELETE`）

> **验证后确认**：psql 确认 entry_B 未被删：
> ```bash
> psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c \
>   "SELECT id, deleted_at FROM entries WHERE id = '00000000-0000-0000-0000-00000000EB01';"
> ```
> 期望：`deleted_at` 为 null。

---

## 8. 5 硬断言（H1~H5）

| # | 断言 | 验证方法 | Pass/Fail |
|---|---|---|---|
| **H1** | PATCH 200 + version 严格递增 + 字段更新生效（amount/note 变化）| §4.1：version 1→2 · amount 3000→5000 · note 变化 | [ ] |
| **H2** | 409 体含 `details.server_version`（标准 conflict 体 · 与 sync push 体语义一致）| §4.2：`details.server_version=2` + §6.4 重复删 404（不返 409 · 因 WHERE deleted_at IS NULL 不命中） | [ ] |
| **H3** | K3 method-override 等价行为（POST + X-HTTP-Method-Override: PATCH 与 PATCH 完全等价）| §5.1：200 + version 2→3 · §5.2：无 header → 405 | [ ] |
| **H4** | DELETE 204 + DB deleted_at != null + version+1（软删 · 不是硬删）| §6.1：204 · §6.2 psql 验 deleted_at 非 null + version=4 | [ ] |
| **H5** | 跨 family 三处守门全 404（GET + PATCH + DELETE 三测 · 不返 200 · 安全优先不泄露 entry 存在性）| §7.2/§7.3/§7.4：三测全 404 · psql 确认 entry_B 未被删 | [ ] |

**判定规则**：
- H1~H5 全 Pass → `approve:COSTRA-152 + COSTRA-153`
- 任一 H Fail → `revise:COSTRA-152` 或 `revise:COSTRA-153` + 列具体 FAIL 项 + curl 输出截图

---

## 9. 实测后

- **7 步 A/B/B.5/C/C-K3/D/E 全 Pass + 5 硬断言全 Pass** → 回 `approve:COSTRA-152 + COSTRA-153` 联合双卡同轮 approve（D-024 §2.2 C1 第 4 次实战）
- **任意 Hard FAIL**（H1~H5 任一）→ 回 `revise:COSTRA-152` 或 `revise:COSTRA-153` 列具体 FAIL 项 + curl 输出截图
- **P0 安全漏洞**（§7 任一返 200/204）→ 立即升级 · 阻塞发布
- **某步骤实操不清晰** → 直接问 Orchestrator

---

## 10. 错误诊断指引

| 症状 | 可能原因 | 排查步骤 |
|---|---|---|
| §4.1 返 500 INTERNAL | DB migrations 未跑齐 · entries 表缺 change_seq 列 | 重跑 §0.2 全 6 个 migrations |
| §4.1 返 404 NOT_FOUND | entry EA01 不存在 · psql seed 未跑 | 重跑 §3.2 seed SQL |
| §4.2 返 200 而非 409 | version 乐观锁未生效 | 检查 `entryService.updateWithVersion` 是否传了 baseVersion |
| §5.1 返 405 | X-HTTP-Method-Override header 名拼错 / 大小写错误 | 确认 header 是 `X-HTTP-Method-Override` · 值是 `PATCH`（大小写不敏感 · 代码 `.toUpperCase() === 'PATCH'`）|
| §6.1 返 409 | version 不匹配 · §4/§5 已多次 PATCH version 已变 | 用 psql 查 `SELECT version FROM entries WHERE id = '00000000-0000-0000-0000-00000000EA01'` 确认当前 version · 用当前 version 重试 |
| §6.1 返 404 | entry 已被删（重复跑手册）· 或 seed 未跑 | psql 查 entries 表确认行存在 + `deleted_at IS NULL` |
| §7.2/7.3/7.4 返 200/204 | **P0 安全漏洞** · 跨 family 守门失效 | 立即升级 · 检查 `entryRepo.findById` 是否带 userId 参数 · 检查 JOIN family_members `fm.user_id = $2` 是否存在 |
| §7.2/7.3/7.4 返 403 | 代码改了返 403 · 但本手册期望 404 | 检查 `entryService.findById` 抛的错误码 · 403 语义也可接受但不泄露存在性 · 需与 OpenAPI 对齐 |
| 登录 401 | WX_MOCK_LOGIN 未启用 | 确认启动命令含 `WX_MOCK_LOGIN=1 npm run dev` |
| psql 连接失败 | PG 未启动 / 账号不匹配 | 检查 `postgres://costra:costra_dev_pw@localhost:5432/costra` 连接串 |

---

## 11. 修订记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-05-23 | 初版立档（COSTRA-152 + COSTRA-153 联合双卡 curl 实测手册 · 5 硬断言 · 跨 family 守门验证 · K3 method-override · query version DELETE）|
