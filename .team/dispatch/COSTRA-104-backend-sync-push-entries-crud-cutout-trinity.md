# COSTRA-104 · Backend `/sync/push` 主通道 + `/entries` POST/GET + 切出去 3 件套铁律（PRD AC-4 server 侧落地）

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech`（D-014-a · 审查档第 5 次实战 · D-022 v2.0 评分） | 等 Orchestrator 触发 |
| **R1 实装** | `costra-backend-dev`（**首次实战** · SBAI v1.1 装扮档第 8 次冒烟） | 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-014-b 自动拉起 · 审查档第 5 次 · **D-022 v2.0 评分表第 2 次实战**） | 等 R1 实装完 |
| **Human 实测前置** | curl/Postman 联调（5 步 + 3 硬断言 · D-022 §4.2 等效 runtime 实测） | 等 R1 Review APPROVE |
| **Human T1 终审** | `approve:COSTRA-104` | 等 Human 实测全 PASS |

---

## §1 背景

### 1.1 PRD 锚点

PRD AC-4 离线优先架构最后一公里 server 侧：「无网也能保存 → 写入本地队列 → 联网后**自动上传**」· 客户端 outbox（COSTRA-103 R1 已完工）需要 server `/sync/push` 端点接收 batch 重放 + 三态消费（ok/conflict/rejected）+ 24h 强幂等。

### 1.2 上游依赖（已 CLOSED）

- **COSTRA-021** DB Schema v1（entries / idempotency_keys / audit_logs · ADR-0006 PG + Redis）
- **COSTRA-100** OpenAPI G3 协议事实源（含 5 个 endpoint 完整定义）
- **COSTRA-101** Auth 路由 + JWT + 错误处理 + DB 连接池（route → service → repo 分层范式建立）
- **COSTRA-103** 客户端 outbox 多 key 分片 + payload snake_case + idempotency_key 持久化（R1 实装 + 5 步实测全 PASS · APPROVE 38/40）

### 1.3 下游解锁

- COSTRA-105 单人记账闭环冒烟（含离线弱网）
- FU-103-CLIENT-SYNC-SCHEDULER（Sprint-3 候选 COSTRA-150 · client 调度器需要 server stable）
- FU-103-CONFLICT-MERGE-UI（Sprint-3 候选 COSTRA-151 · 合并 UI 需要 server 返回 conflict）

---

## §2 Scope（7 项交付 · "切出去 3 件套铁律"首次实战 · 净增 ~ 1100 行）

### 2.1 主交付（实装 3 个 endpoint）

#### A `server/src/routes/sync.ts`（新建 · ~120 行）

POST `/sync/push` · 协议事实源 `server/api/openapi.yaml:639-655` + `docs/api/sync-protocol.md` §2

**请求体**：`SyncPushRequest` `{ ops: [{ op, entity, client_ref_id, base_version, payload }] }`（≤ 200 ops · ≤ 8KB/op · 协议 §7）

**响应体**：`SyncPushResponse` `{ results: [{ client_ref_id, status, server_id, server_version, error }] }`（status ∈ {ok, conflict, rejected}）

**业务流程**：

1. JWT 鉴权 + 解析 user_id（`@fastify/jwt` plugin · COSTRA-101 已就位）
2. 校验 `Idempotency-Key` 头存在 + 24h 内重复 = 直接返回缓存 response（hit ratio 由 idempotency_keys 表索引）
3. 校验 ops batch（≤ 200 / payload ≤ 8KB / entity ∈ {entry, category, budget}）→ 不通过 400 INVALID_ARGUMENT
4. 逐条处理 ops（**不开 batch transaction · 每条独立事务**）：
   - `op=create entity=entry`：调用 service `entryService.createWithIdempotency(user_id, payload, client_ref_id)` → 返回 `{ status: 'ok', server_id, server_version: 1 }` · 或 `{ status: 'rejected', error: { code: 'INVALID_ARGUMENT', ... } }`
   - `op=update entity=entry`：调用 service `entryService.updateWithVersion(...)` → 乐观锁 `WHERE version = base_version` → 不匹配 `{ status: 'conflict', server_version, error: { code: 'VERSION_CONFLICT' } }`
   - `op=delete entity=entry`：软删（set `deleted_at = now()`）+ version+1 + 同样乐观锁
   - `category` / `budget`：本卡**不实装**（属 PRD Epic-B 后续卡 · 未来 COSTRA-122/123 接管）→ 返回 `{ status: 'rejected', error: { code: 'NOT_IMPLEMENTED', message: 'category/budget op deferred to later cards' } }`
5. 写入 idempotency_keys 表（key, endpoint='/sync/push', request_hash sha256(body), response_status=200, response_body=results, expires_at=now()+24h）
6. 返回 200 + results

#### B `server/src/routes/entries.ts`（新建 · ~140 行）

POST `/entries` · GET `/entries`（实装）+ `/entries/{id}` PATCH/DELETE（**stub 501 · 切出去 3 件套**）

**POST `/entries`**：直接同步创建 entry（与 sync push 路径并行 · 客户端在线模式可直接用）· 协议 §entries-create

**GET `/entries`**：游标分页（cursor + limit · 默认 20 · 上限 100）· 支持 ledger_id / from / to / category_id / type 过滤 · 协议 §entries-list

**PATCH `/entries/{entry_id}` 切出去 stub**：
```ts
app.patch('/entries/:entry_id', async (req, reply) => {
  reply.code(501).send({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'PATCH /entries/{id} deferred to COSTRA-152',
      details: { deferred_card: 'COSTRA-152', followup: 'FU-104-ENTRIES-PATCH' },
    },
  });
});
```

**DELETE `/entries/{entry_id}` 切出去 stub**：同上 · `deferred_card: 'COSTRA-153'` + `FU-104-ENTRIES-DELETE`

**GET `/sync/pull` 切出去 stub**（在 sync.ts 中）：同上 · `deferred_card: 'COSTRA-154'` + `FU-104-SYNC-PULL`

#### C `server/src/services/entryService.ts`（新建 · ~150 行）

业务编排层（参照 `authService.ts` 范式 · ~208 行规模）：

- `createWithIdempotency(user_id, payload, client_ref_id)`：写 entries 表 + 防重（`UNIQUE (ledger_id, client_ref_id)` 约束 · 撞库返回 conflict）
- `updateWithVersion(user_id, entry_id, payload, base_version)`：乐观锁 update + version+1
- `softDelete(user_id, entry_id, base_version)`：软删 + 乐观锁
- `list(user_id, filter, cursor, limit)`：游标分页查询（`updated_at DESC, id ASC` 复合 cursor）
- `findById(user_id, entry_id)`：详情（含权限校验：`ledger.family_id` 属 user · 协议 §7 安全校验）

#### D `server/src/repositories/entryRepo.ts`（新建 · ~130 行）

DB 访问层（参照 `userRepo.ts` 范式 · ~140 行规模）：

- `insertEntry(client, payload)`：原始 INSERT 语句
- `updateEntryByVersion(client, entry_id, payload, base_version)`：原始 UPDATE WHERE version = base_version
- `softDeleteEntry(client, entry_id, base_version)`：原始 UPDATE SET deleted_at = now()
- `findEntriesByLedger(client, filter, cursor, limit)`：原始 SELECT + 游标分页
- `findByIdAndUser(client, entry_id, user_id)`：原始 SELECT + family/ledger join 权限校验

#### E `server/src/services/idempotencyService.ts`（新建 · ~80 行 · 协议 §2.5 24h 强幂等）

- `checkAndGet(client, key, endpoint, request_hash)`：查表 → 命中且 hash 同 → 返回缓存 response · 命中但 hash 不同 → 抛 `IDEMPOTENCY_KEY_MISMATCH` · 未命中 → null
- `save(client, key, endpoint, request_hash, response_status, response_body, ttl_hours=24)`：写表
- `cleanup(client)`：定期清理 expires_at < now() 的过期记录（cron 调用 · 但本卡仅留 stub 函数 · 真正 cron 调度留给 DevOps · FU-104-IDEMPOTENCY-CRON）

### 2.2 切出去 3 件套铁律（首次实战 · Sprint-2 范式建立）

#### F OpenAPI x-deferred 标记（修 server/api/openapi.yaml · 3 处 · ~9 行追加）

在 PATCH/DELETE/sync-pull 三个 path 加 `x-deferred` 扩展字段：

```yaml
  /entries/{entry_id}:
    patch:
      x-deferred:
        owner_card: COSTRA-152
        followup_id: FU-104-ENTRIES-PATCH
        deferred_at: 2026-05-11
        deferred_reason: COSTRA-104 范围切分（Q1 选项 b · 推荐方案 C 切出去 3 件套铁律）
        sprint_target: sprint-3
      tags: [entries]
      ...

    delete:
      x-deferred:
        owner_card: COSTRA-153
        followup_id: FU-104-ENTRIES-DELETE
        ...

  /sync/pull:
    get:
      x-deferred:
        owner_card: COSTRA-154
        followup_id: FU-104-SYNC-PULL
        ...
```

#### G FU 立件 + 3 张占位卡号（修 .team/follow-ups/README.md + .team/backlog.json）

新增 3 条 FU + 3 张占位卡号（COSTRA-152 PATCH · COSTRA-153 DELETE · COSTRA-154 sync pull）· 状态 `open` · 候选 Sprint-3。

### 2.3 测试（新建 server/test/sync.test.ts + entries.test.ts · ≥ 10 测）

参照 `server/test/auth.test.ts` 范式 + pg-mem + ioredis-mock：

| 测试 | 覆盖点 |
|---|---|
| T1 sync.test.ts: POST /sync/push 单条 ok | 创建 entry 成功 · 返回 server_id + server_version=1 |
| T2 POST /sync/push 单条 conflict | base_version 不匹配 · 返回 status=conflict + server_version |
| T3 POST /sync/push 单条 rejected (NOT_IMPLEMENTED) | entity=category · 返回 rejected + error.code=NOT_IMPLEMENTED |
| T4 POST /sync/push idempotency 24h | 同 Idempotency-Key + 同 body 二次请求 · 返回缓存 response |
| T5 POST /sync/push idempotency mismatch | 同 Idempotency-Key + 不同 body · 返回 IDEMPOTENCY_KEY_MISMATCH |
| T6 POST /sync/push batch limit | 201 ops · 返回 400 INVALID_ARGUMENT |
| T7 entries.test.ts: POST /entries ok | 直接创建 |
| T8 GET /entries 游标分页 | 25 条 entries · cursor + limit=20 · 返回 next_cursor |
| T9 PATCH /entries/{id} stub | 返回 501 + deferred_card=COSTRA-152 |
| T10 DELETE /entries/{id} stub | 返回 501 + deferred_card=COSTRA-153 |
| T11 GET /sync/pull stub | 返回 501 + deferred_card=COSTRA-154 |
| T12 entries 鉴权 | 无 JWT · 返回 401 UNAUTHENTICATED |

### 2.4 Human curl 联调实测手册（新建 docs/qa/costra-104-curl-verify.md · ~200 行）

D-022 v2.0 等效 runtime 实测前置（5 步 + 3 硬断言）：

| 步骤 | 操作 | 硬断言 |
|---|---|---|
| A 启动 server | `cd server && npm run dev` | server log 含 `routes registered: /sync/push, /entries, /entries/:id, /sync/pull` |
| B 跑 1 个 sync push（ok）| curl 一笔合法 op · payload 含 amount/ledger_id/...所有 snake_case | H1: 返回 200 + results[0].status=ok + server_id 是 UUID v7 |
| C 重发同一 Idempotency-Key | curl 同 body + 同 key | H2: 返回 200 + 与 B 完全相同（缓存命中 · 不重复入库）|
| D 触发 conflict | 改 base_version 后重发 update op | H3: 返回 200 + results[0].status=conflict + server_version |
| E 验证切出去 stub | curl PATCH /entries/{id} | 返回 501 + error.code=NOT_IMPLEMENTED + deferred_card=COSTRA-152 |

### 2.5 Sprint-2 范式沉淀（修 .team/follow-ups/README.md 追加段或新建 .team/decisions/D-023）

> 本卡为"切出去 3 件套铁律"首次实战 · 落盘后写一段 100~150 字的"治理范式"沉淀在 `.team/follow-ups/README.md` 头部（或简短 D-023 决议 · Q4 已默认选 b · 由 Orchestrator 在终审时决定形式）：
>
> ```
> 切出去 3 件套铁律：协议契约切出某 path 时必须 3 件套同步落地：
> ① OpenAPI x-deferred + owner_card + followup_id 标记
> ② FU README 立件 + backlog.json 占位卡号
> ③ route stub 返回 501 NOT_IMPLEMENTED + deferred_card
> ```

---

## §3 工作区权限（D-018 SBAI 边界）

### 3.1 可写区

- `server/src/routes/`（新建 sync.ts + entries.ts）
- `server/src/services/`（新建 entryService.ts + idempotencyService.ts）
- `server/src/repositories/`（新建 entryRepo.ts）
- `server/test/`（新建 sync.test.ts + entries.test.ts）
- `server/src/server.ts`（注册新路由）
- `server/api/openapi.yaml`（**仅追加 x-deferred 扩展字段** · 不动既有路径定义）
- `docs/qa/costra-104-curl-verify.md`（新建）
- `.team/follow-ups/README.md`（追加）
- `.team/backlog.json`（追加 3 张占位卡）
- `.team/members/backend-dev/state.md`（新建或追写 · 首次实战）
- `.team/members/backend-dev/history/2026-05-11-costra-104-r1-implement.md`（新建）

### 3.2 禁写区（绝对边界）

- `miniprogram/`（COSTRA-103 已 closed · 跨域）
- `docs/api/sync-protocol.md`（G3 锁定事实源 · 不可改 · 改即 P0）
- `docs/api/id-strategy.md`（同上）
- `docs/api/error-codes.md`（除非新增枚举 · 但本卡 NOT_IMPLEMENTED 已存在 · 不改）
- `server/db/migrations/*.sql`（DB schema 锁定 · 0 migration · Q6 决策）
- `.team/decisions/D-001~D-022`（既有决议禁改）
- `.team/board.md` / `.team/HANDOFF.md`（Orchestrator 边界）

---

## §4 DoD（10 条 · 含可度量验收）

- (a) **协议 100% 对齐**：`/sync/push` request/response 字段全 snake_case + entity ∈ {entry, category, budget} + status ∈ {ok, conflict, rejected} + ErrorCode 全部使用枚举（不硬编码字符串）
- (b) **3 endpoint 实装完整**：POST /sync/push + POST /entries + GET /entries 全部返回 200/201 + 协议字段完备
- (c) **3 endpoint stub 切出去 3 件套**：PATCH /entries/{id} + DELETE /entries/{id} + GET /sync/pull · 各返回 501 + error.code=NOT_IMPLEMENTED + deferred_card 字段
- (d) **24h 幂等键**：idempotency_keys 表写读 + request_hash 校验 + 命中返回缓存 + 不匹配返回 IDEMPOTENCY_KEY_MISMATCH
- (e) **乐观锁 conflict 三态**：update 走 `WHERE version = base_version` · 不匹配返回 status=conflict + server_version 字段
- (f) **测覆盖 ≥ 10 测**：含 ok/conflict/rejected 三态 + 3 个 stub 路由 501 + 幂等命中/不匹配 + batch limit + JWT 鉴权
- (g) **闸门全绿**：`npm run typecheck` 0 错 · `npm run test` ≥ 10 测 + 现 auth 测 = 全绿 · `npm run lint`（COSTRA-117 deferred · echo 退出 0 · 不强制 lint）
- (h) **Sprint-2 范式沉淀**：FU README 头部追加"切出去 3 件套铁律"段（100~150 字）
- (i) **3 张占位卡 backlog 入队**：COSTRA-152 PATCH · COSTRA-153 DELETE · COSTRA-154 sync pull · 各 1 点 P1 + sprint=null（Sprint-3 候选）+ status=Backlog
- (j) **Human curl 实测手册落盘**：5 步 + 3 硬断言齐全（D-022 v2.0 等效 runtime 实测前置）

---

## §5 闸门（commit 前自跑 · 全 exit 0）

- `cd server && npm run typecheck`
- `cd server && npm run test`（含本卡新增 ≥ 10 测 + 既有 auth 测 = 全绿）
- `cd server && npm run lint`（echo 退出 0 · COSTRA-117 deferred）
- 反向 grep 4 段（保 0 命中）：
  - `grep -rn "amountCents\|categoryId\|occurredAt" server/src/` → 0（payload 必须全 snake_case）
  - `grep -rn "throw new Error\(" server/src/routes/sync.ts server/src/routes/entries.ts server/src/services/entryService.ts` → 0（必须用 AppError + ErrorCode 枚举）
  - `grep -rn "x-deferred" server/api/openapi.yaml | wc -l` → 3（PATCH + DELETE + sync-pull）
  - `grep -rn "deferred_card" server/src/routes/entries.ts server/src/routes/sync.ts | wc -l` → ≥ 3（3 个 stub 路由都有标记）
- DB schema 不改：`git diff --name-only HEAD -- server/db/migrations/` → 空
- miniprogram 不改：`git diff --name-only HEAD -- miniprogram/` → 空
- 协议事实源 doc 不改：`git diff --name-only HEAD -- docs/api/` → 空（仅修 server/api/openapi.yaml 加 x-deferred · docs/api 是另一目录）
- 决议不改：`git diff --name-only HEAD -- .team/decisions/D-001*.md ... D-022*.md` → 空

---

## §6 commit（D-016 同轮兑现 · 单卡拆 2 commit）

**commit 1**（feat · 范围：server/）：

```
feat(server): sync/push + entries crud + 3 stub routes (COSTRA-104 R1)

- new: src/routes/sync.ts (POST /sync/push 主通道 · 三态消费 · 幂等 24h)
- new: src/routes/entries.ts (POST/GET /entries 实装 · PATCH/DELETE/pull stub 501)
- new: src/services/entryService.ts (业务编排 · 乐观锁 · 软删)
- new: src/services/idempotencyService.ts (idempotency_keys 24h 强幂等)
- new: src/repositories/entryRepo.ts (DB 访问层)
- new: test/sync.test.ts + test/entries.test.ts (>= 10 测 · 三态 + stub)
- update: src/server.ts (注册新路由)
- update: api/openapi.yaml (3 处 x-deferred 标记 · 切出去 3 件套铁律首次实战)

协议 100% 对齐: sync-protocol.md (payload/entity/status/idempotency-key/重试)
0 migration · 0 docs/api 改动 · 0 miniprogram 改动

Refs: COSTRA-104, COSTRA-100, COSTRA-103, sync-protocol.md, COSTRA-152, COSTRA-153, COSTRA-154
```

**commit 2**（chore · 范围：.team/ + docs/qa/）：

```
chore(repo): costra-104 follow-ups + curl verify + state/history (COSTRA-104)

- new: docs/qa/costra-104-curl-verify.md (5 步 + 3 硬断言 · d-022 v2.0 等效 runtime 实测)
- update: .team/follow-ups/README.md
  + 切出去 3 件套铁律段 (sprint-2 范式沉淀)
  + fu-104-entries-patch / fu-104-entries-delete / fu-104-sync-pull (3 条)
- update: .team/backlog.json (3 张占位卡 costra-152/153/154 sprint-3 候选)
- new: .team/members/backend-dev/state.md (首次实战)
- new: .team/members/backend-dev/history/2026-05-11-costra-104-r1-implement.md

Refs: COSTRA-104, FU-104-ENTRIES-PATCH, FU-104-ENTRIES-DELETE, FU-104-SYNC-PULL
```

**Subject 全小写** · footer Refs 大写。

---

## §7 验收（review-tech R1 阶段触发）

- 净增 ≥ 1100 行（routes 260 + services 230 + repos 130 + tests ~ 250 + docs/qa 200 + .team 元数据 ~ 100）
- 0 行 miniprogram/ 改动
- 0 行 docs/api/ 改动
- 0 行 db/migrations/ 改动
- 0 行 既有 D-001~D-022 决议改动
- 协议 100% 对齐（review-tech 自跑 grep 验证）
- D-022 v2.0 评分 ≥ 36（APPROVE 阈值）

---

## §8 时间预算

≤ 150 min（7 点卡 · backend 体量比 103 略大 · 测试 + DB 集成成本）。若超 200 min 仍未完工 · 立即 BLOCKED + final message 报 `type=blocker`。

---

## §9 硬约束（不可违反）

1. **0 行 G3 协议事实源改写**：禁止改 `docs/api/sync-protocol.md` / `docs/api/id-strategy.md` / `docs/api/error-codes.md`
2. **0 行 miniprogram 改写**：跨域 · COSTRA-103 已 closed
3. **0 行 db migrations 改写**（Q6 决策 · 已建表全部够用）
4. **协议 100% 对齐**：payload 全 snake_case + entity ∈ {entry, category, budget} + status ∈ {ok, conflict, rejected} + ErrorCode 全用枚举（**不硬编码字符串**）
5. **三证铁律（D-021 v3）**：实装前必须三证 git log + ls-files + git show HEAD:server/src/routes/auth.ts head 30 行（学习现有路由风格）· history §1 落盘
6. **D-016 / D-020 同轮兑现**：本卡 7 项交付 + state/history + 双 commit 同 tool call 循环兑现
7. **切出去 3 件套铁律完整性**：3 个 stub endpoint 必须 3 件套同步（OpenAPI x-deferred + FU 立件 + route stub 501）· 缺一即 P0
8. **Subject 全小写** + footer Refs 大写 + footer body 每行 ≤ 100 字符
9. **Bash 写命令限定**：仅允许 git add / commit / npm run / jq · **禁止** `git push --force` / `git reset --hard` / `rm -rf server/` / `npm publish`
10. **stub 路由不静默**：必须返回 501 + 完整 error 对象（含 deferred_card + followup_id 字段）· 禁止返回 200 / 空响应

---

## §10 强制阅读清单（按顺序 · D-021 v3 三证后开工）

### 强制 git 三证（D-021 v3 · 必跑前置）

```bash
git log --oneline -10
git ls-files server/src/routes/ server/src/services/ server/src/repositories/
git show HEAD:server/src/routes/auth.ts | head -30
```

跑完三证记录在 history 文件 §1。

### 必读（按顺序）

1. `.team/dispatch/COSTRA-104-backend-sync-push-entries-crud-cutout-trinity.md`（必读 · 任务定义）
2. `server/api/openapi.yaml`（必读 · 协议事实源 · 重点 §entries-create / §SyncPushRequest / §SyncPushResponse / §Entry schema）
3. `docs/api/sync-protocol.md`（必读 · §2 push 三态 / §6 一致性 / §7 安全校验）
4. `docs/api/id-strategy.md`（必读 · 三种 ID 严禁混用 · client_ref_id / Idempotency-Key / 服务端 id v7）
5. `docs/api/error-codes.md`（必读 · ErrorCode 全枚举 · 不硬编码字符串）
6. `server/src/errors/ErrorCode.ts`（必读 · NOT_IMPLEMENTED 已存在 · IDEMPOTENCY_KEY_MISMATCH 已存在）
7. `server/src/errors/AppError.ts`（必读 · throw new AppError(ErrorCode.X, ...)）
8. `server/src/routes/auth.ts`（必读 · 路由层范式参考 · 88 行简洁版）
9. `server/src/services/authService.ts`（必读 · service 层范式 · 208 行）
10. `server/src/repositories/userRepo.ts`（必读 · repo 层范式 · 140 行）
11. `server/src/plugins/jwt.ts`（必读 · @fastify/jwt 验证机制）
12. `server/src/plugins/errorHandler.ts`（必读 · AppError → HTTP response 映射）
13. `server/src/db/pool.ts`（必读 · pg pool 配置 · transaction helpers）
14. `server/src/db/redis.ts`（按需 · Redis 在本卡可能不用 · 幂等用 PG）
15. `server/db/migrations/0001_init.sql`（必读 · entries / idempotency_keys 表结构）
16. `server/test/auth.test.ts`（必读 · vitest + pg-mem 测试范式）
17. `.team/decisions/D-022-review-tech-runtime-dimension.md`（必读 · 你被审的 v2.0 评分表）
18. `.team/decisions/D-021-d-017-v3-cross-version-precheck.md`（必读 · 三证铁律来源）
19. `.team/reviews/COSTRA-103/FINAL.md`（按需 · client outbox 协议对接参考）

### 按需读

- `miniprogram/services/outbox.ts`（不写权 · 仅参考 client 端如何发起 push）
- `.team/agents/02-backend-agent.md`（你的角色规则源 · 装扮档 inline）
- `server/src/repositories/sessionRepo.ts`（按需 · 复杂 SQL 范式）

---

## §11 dispatch 元数据

| 字段 | 值 |
|---|---|
| 卡号 | COSTRA-104 |
| 标题 | Backend `/sync/push` 主通道 + `/entries` POST/GET + 切出去 3 件套铁律 |
| 估点 | **7 点**（原 6 点 + 切出去 3 件套铁律 +1 点 · 紧急 buffer 内 · Q1.4 范式沉淀首次实战）|
| 优先级 | P0 |
| Sprint | Sprint-2 主线第 3 张 |
| Owner | Backend-Agent / `costra-backend-dev` 装扮 subagent（首次实战 · SBAI 第 8 次冒烟）|
| 依赖 | COSTRA-021 ✅ / COSTRA-100 ✅ / COSTRA-101 ✅ / COSTRA-103 ✅ |
| 解锁 | COSTRA-105 单人冒烟 · COSTRA-150 client 调度器 · COSTRA-151 conflict 合并 UI |
| Review 类型 | T2 + Human curl 实测前置（D-022 §4.2 等效 runtime · 非微信 SDK runtime · client/server 协议联调风险）|
| review-tech 第 2 次实战 | D-022 v2.0 评分表（首次 = COSTRA-103 38/40）|
| 创建时间 | 2026-05-11 12:55 |
| 创建者 | Orchestrator |

---

**dispatch 单结束 · 落盘后等 Card-Review R1 触发。**
