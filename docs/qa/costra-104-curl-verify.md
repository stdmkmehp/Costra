# COSTRA-104 · Backend `/sync/push` + `/entries` CRUD · Human curl 联调实测手册

> **D-022 v2.0 §4.2 等效 runtime 实测前置铁律** · 本手册 = COSTRA-104 R1 终审前置 · backend 卡非微信 SDK runtime 类 · 但 client/server 协议联调 = 等效 runtime 风险 · 必须 Human curl 实测 5 步 + 3 硬断言全 PASS 才能 T1 终审。
>
> **实测者**：Human Orchestrator + Human 项目负责人
> **预计时间**：~ 15 分钟
> **修订版本**：v1.2 · 2026-05-12 12:55 · COSTRA-104 R1.x.1

---

## 0. 前置准备

### 0.1 实测模式

本手册不依赖 ICP 备案 / 公网 staging · **本地 server + Mock 微信 code2Session**：

```bash
cd server
npm run dev    # 启动本地 server · 默认 http://127.0.0.1:8080（PORT 由 server/.env.example 锁定）
```

**期望终端输出**（pino JSON 格式 · 字段顺序/数量不强制 · 关键看 `msg` 含 listening + port 8080）：

```json
{"level":30,...,"msg":"Server listening at http://127.0.0.1:8080"}
{"level":30,...,"port":8080,"nodeEnv":"development","msg":"costra-server listening"}
```

只要看到 `port: 8080` + `costra-server listening` 即视为启动成功。多接口监听（127.0.0.1 + 局域网 IP + 内网 IP）是预期（`server.ts:55` host: '0.0.0.0'）· 实测时只用 127.0.0.1 即可。

### 0.2 启动 dev WX mock 入口（curl 实测必需）

**问题**：默认 `npm run dev` 用真实腾讯 code2Session · curl 用假 code（如 `test-curl-verify`）会被腾讯返 `40029 invalid code` · 测无法继续。

**解决**：启动期开启 `WX_MOCK_LOGIN=1` · server 注入硬编码 mock fetch · 任意 code 都返成功：

```bash
# 临时启动方式（推荐 · 不污染 .env）
cd server
WX_MOCK_LOGIN=1 npm run dev
```

期望日志额外多一行 warn：

```json
{"level":40,...,"wxMockLogin":true,"msg":"⚠️  WX_MOCK_LOGIN enabled · code2Session mocked · DO NOT enable in production"}
```

**安全保护**：`WX_MOCK_LOGIN=1` 只在 `NODE_ENV=development` 生效 · prod 启动时会被 loadEnv 校验拒绝（throw `[env] WX_MOCK_LOGIN can only be enabled in NODE_ENV=development`）· 永不暴露到生产。

### 0.3 DB migrations 全跑齐（首次实测 / 重建 DB 后必跑）

**关键**：必须把 `server/db/migrations/*.sql` 全部跑齐 · 否则会有列缺失 / 类型缺失 / 表缺失等运行时炸点。

```bash
cd server
for f in db/migrations/*.sql; do
  echo "=== $f ==="
  psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -f "$f"
done
```

期望按文件名顺序跑完 4 个：

| 文件 | 内容 | 备注 |
|---|---|---|
| `0001_init.sql` | 表 schema 全建（users/families/ledgers/family_members/entries/categories/budgets/...）| COSTRA-021 |
| `0002_seed_system_categories.sql` | 12 条系统预设分类 | seed |
| `0003_user_sessions.sql` | user_sessions 表 + 索引 | COSTRA-101 |
| `0004_entries_account_columns.sql` | entries 加 `account_id` + `to_account_id` 列 | **COSTRA-104 R1.x.2** · 修 schema gap |

**已建 DB 重新跑也安全**：所有 migration 都用 `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` 幂等保护。

> **后续治理**：长期应通过 `npm run db:migrate` 脚本自动按序执行（当前脚本仅 echo 提示 · 见 server/package.json）· 立 follow-up `FU-104-DB-MIGRATE-SCRIPT`（Sprint-3 候选 · 与 CI 对账族联动）。

### 0.4 准备一个新终端跑 curl（保留 dev server 终端）

### 0.5 R1 范围声明（重要）

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
curl -i http://127.0.0.1:8080/healthz
```

**期望**：`HTTP/1.1 200 OK` + `{"status":"ok"}`

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如 FAIL：`revise:COSTRA-104 reason:server-not-up`）

---

## 2. 步骤 B · 登录拿 JWT

```bash
RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"test-curl-verify"}')
echo $RESPONSE | jq .
TOKEN=$(echo $RESPONSE | jq -r '.access_token')
echo "TOKEN=$TOKEN"
```

**期望**：`access_token` / `refresh_token` / `user.id` 全 snake_case 返回 · TOKEN 非空 36+ 字符。

**Pass/Fail**：
- [ ] Pass · [ ] Fail

> **注**：dev WX mock 已在 §0.2 启动期注入 · code 任意值都能成功登入。

---

## 2.5 步骤 B.5 · 准备测试数据（首次实测必跑 · psql 手动 seed）

### 2.5.1 为什么需要

COSTRA-104 R1 仅实装 `/entries` CRUD + `/sync/push` · **未实装** `/families` + `/ledgers` CRUD（OpenAPI 已定义 · 路由 0 实装 · scope gap）· 也未实装首登 onboarding 流（COSTRA-101 明示 MVP 不做）· 因此 mock-openid-xxx 用户登录后 DB 没有任何 family/ledger · 直接 POST /entries 会触发 FK 违反 → 500 INTERNAL。

**临时解决**：psql 手动 INSERT 一行 family + ledger + family_members(owner) · 关联到步骤 B 拿 token 的 user.id。

> **后续治理**：本卡 Human 实测后立 `FU-EPIC-FAMILY-LEDGER-CRUD`（Sprint-3 候选 COSTRA-155）· 实装真实 CRUD 后此手动步骤可废弃。

### 2.5.2 取出 user.id

```bash
# 从步骤 B 的 RESPONSE 中提取（如未保留 RESPONSE 重跑步骤 B 即可）
USER_ID=$(echo $RESPONSE | jq -r '.user.id')
echo "USER_ID=$USER_ID"
```

期望：UUID 格式（如 `019e1a8d-2d20-7ac4-8b63-471645e1d6f8`）。

### 2.5.3 连 psql 执行 SQL seed

> **DB 连接串**：`postgres://costra:costra_dev_pw@localhost:5432/costra`（来自 `server/.env.example`）· 你的本地 dev DB 应已用此账号启动。

```bash
# 用 user.id 替换下方 SQL 里的 :user_id（psql -v 注入）
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
  -v user_id="'$USER_ID'" <<'SQL'

BEGIN;

-- 固定 family_id（手册其他步骤复用 · 与 ledger_id 配对）
INSERT INTO families (id, name, owner_id)
VALUES ('00000000-0000-0000-0000-0000000000F0', 'CurlTestFamily', :user_id)
ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id;

-- 关键：ledger_id = 00000000-...-001（手册步骤 C/D/E 全部用此 id）
INSERT INTO ledgers (id, family_id, name)
VALUES ('00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000F0',
        'Main')
ON CONFLICT (id) DO NOTHING;

-- user 必须是 family 的 owner 成员（entries.created_by 走 ledger.family_id → family_members 权限校验）
INSERT INTO family_members (family_id, user_id, role)
VALUES ('00000000-0000-0000-0000-0000000000F0', :user_id, 'owner')
ON CONFLICT DO NOTHING;

COMMIT;

-- 验证
SELECT 'families' AS t, count(*) FROM families WHERE id = '00000000-0000-0000-0000-0000000000F0'
UNION ALL SELECT 'ledgers',  count(*) FROM ledgers  WHERE id = '00000000-0000-0000-0000-000000000001'
UNION ALL SELECT 'members',  count(*) FROM family_members WHERE family_id = '00000000-0000-0000-0000-0000000000F0' AND user_id = :user_id;
SQL
```

**期望输出**：3 行 count=1：

```
    t     | count
----------+-------
 families |     1
 ledgers  |     1
 members  |     1
```

### 2.5.4 Pass/Fail

- [ ] Pass（3 行 count=1 · ledger_id `00000000-...-001` 已就位）· [ ] Fail（看 SQL 报错：FK 违反 = USER_ID 不对 · 主键冲突 = 无视即可 ON CONFLICT 已处理）

### 2.5.5 重置 mock 用户（可选）

`mock-openid-` 后缀是随机的 → 每次重启 server 拿到的 user.id 都不同 → entries 残留旧 user 关联。如需干净起点：

```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c \
  "DELETE FROM users WHERE openid LIKE 'mock-openid-%';"
# 之后重新跑步骤 B + B.5
```

---

## 3. 步骤 C · POST /entries 创建一笔（验 201 + Entry 全字段 snake_case）

```bash
curl -i -X POST http://127.0.0.1:8080/entries \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{
    "ledger_id": "00000000-0000-0000-0000-000000000001",
    "amount": 12345,
    "currency": "CNY",
    "type": "expense",
    "occurred_at": "2026-05-11T10:00:00.000Z",
    "note": "curl test 1",
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
curl -i -X POST http://127.0.0.1:8080/sync/push \
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
curl -i -X PATCH "http://127.0.0.1:8080/entries/00000000-0000-0000-0000-000000000001" \
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
curl -i -X DELETE "http://127.0.0.1:8080/entries/00000000-0000-0000-0000-000000000001" \
  -H "authorization: Bearer $TOKEN"
```

**期望**：`501` + `deferred_card: COSTRA-153` + `followup_id: FU-104-ENTRIES-DELETE`

```bash
# GET /sync/pull stub
curl -i "http://127.0.0.1:8080/sync/pull?since=1970-01-01T00:00:00.000Z" \
  -H "authorization: Bearer $TOKEN"
```

**期望**：`501` + `deferred_card: COSTRA-154` + `followup_id: FU-104-SYNC-PULL`

**Pass/Fail**：
- [ ] Pass · [ ] Fail（如 stub 静默 / 缺 deferred_card：`revise:COSTRA-104 reason:stub-silent`）

---

## 5. 步骤 E · 重发同 Idempotency-Key 验证幂等

```bash
# 完全重发步骤 4.1 命令（同 idempotency-key + 同 body）
curl -i -X POST http://127.0.0.1:8080/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 11111111-1111-1111-1111-111111111111' \
  -d '<同步骤 4.1 body>'
```

**期望**：`HTTP/1.1 200 OK` · response 与第一次**完全一致**（不会重复入账 · 24h 内）。

```bash
# 同 idempotency-key 改 body 验证 mismatch
curl -i -X POST http://127.0.0.1:8080/sync/push \
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
- v1.1 · 2026-05-12 12:40 · Human 实测发现端口/日志格式瑕疵 → 修订（Orchestrator · D-017 §2.4 E1 例外路径）
  - §0.1 端口：3000 → 8080（与 `server/.env.example` PORT=8080 + `server.ts:55 env.port` 对齐）
  - §0.1 日志格式：固定示例 → pino JSON 实情 + 启动成功语义判定（不规定字段数量/顺序）
  - 全文 11 处 curl 命令端口同步更新
- v1.2 · 2026-05-12 12:55 · Human curl 实测发现真实腾讯 code 阻塞 → 加 dev WX mock 入口（D-017 §2.4 E1 例外路径 + R1.x.1 实装支持）
  - §0.2 新增 dev WX mock 启动方式（WX_MOCK_LOGIN=1）+ 安全保护说明
  - 配套实装：env.ts wxMockLogin + parseBool + dev-only 校验 + server.ts 启动期 setWxFetchForTests 注入 + .env.example 注释样例
- v1.3 · 2026-05-12 13:10 · Human 实测发现步骤 C 500（FK 违反 · ledger 不存在）→ 加 §2.5 步骤 B.5 psql 手动 seed family/ledger/family_members
  - 根因：families/ledgers CRUD 端点 OpenAPI 定义但路由 0 实装（scope gap）+ COSTRA-101 wx-login 不做 onboarding
  - 临时方案：psql 手动 INSERT 关联 mock 用户 · 后续真业务 CRUD 上线可废弃
  - §2 步骤 B 末尾 mock 注释指向 §0.2（去掉过时的"wx_fetch mock 已注入"措辞）
- v1.4 · 2026-05-12 13:23 · Human curl 实测步骤 C 暴露 schema gap（entries 缺 account_id / to_account_id 列 · PG 42703）→ 加 §0.3 DB migrations 全跑齐 + 配套实装 0004 migration（commit 929942f · R1.x.2）
  - 根因：协议 OpenAPI 含字段（COSTRA-020 R2 P0-1 新增）但 0001_init.sql 漏建列 · 测因 pg-mem 自定义 schema 巧合对齐而掩盖 BUG
  - §0.3 新增 4 条 migrations 全跑步骤（0001/0002/0003/0004 · 幂等可重跑）
  - §0.3/0.4/0.5 编号顺延（原 §0.3 → §0.4 / §0.4 → §0.5）
  - 后续审计议题（Sprint-2 末 Retro 候选）：G3 闸门 OpenAPI vs DB schema 列对账 CI（COSTRA-115/116 CI 对账族第 4 张）+ test/setup.ts 反模式（维护两套 schema 真相）+ FU-104-DB-MIGRATE-SCRIPT
