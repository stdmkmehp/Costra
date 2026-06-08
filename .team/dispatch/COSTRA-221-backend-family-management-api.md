# COSTRA-221 · 家庭管理 API（Family Management API）

> **触发**：`plan-dispatch:COSTRA-221` → `card-review:COSTRA-221` → `revise-dispatch:COSTRA-221`  
> **派单时间**：2026-06-02 13:55（Orchestrator · Sprint-3 closeout → Sprint-4 入场准备）  
> **R1 修订时间**：2026-06-02 14:42（按 card-review R1 `REVISE 22/30` 修订）  
> **状态**：dispatch revised · 等 `card-review:COSTRA-221-R2`  
> **Owner**：`costra-backend-dev`  
> **优先级**：P0  
> **估点**：5  
> **Epic**：Epic-D 家庭共享 / Family First Foundation  
> **类型**：backend feature + OpenAPI drift closure  
> **硬约束**：本 dispatch 只定义卡；未到 `start:COSTRA-221` 前不得写业务代码。

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | ✅ `REVISE 22/30` · `.team/reviews/COSTRA-221/card-review-round-1-tech.md` |
| **Dispatch R1.x 修订** | Orchestrator | ✅ 本文件已按 3 P0 + 4 P1 + 3 P2 修订 |
| **Card-Review R2** | `costra-card-reviewer-tech` | 下一步触发：`card-review:COSTRA-221-R2` |
| **R1 实装** | `costra-backend-dev` | 仅在 R2 PASS/APPROVE 且 Human `start:COSTRA-221` 后启动 |
| **R1 Review** | `costra-review-tech` | R1 完成后自动拉起 |
| **Human T1 终审** | `approve:COSTRA-221` | review-tech APPROVE 后 |

---

## §1 背景

### §1.1 当前最高可信事实

Human 已确认以下三份测试手册全部 PASS：

- `qa/costra-154-150-joint-smoke.md`
- `qa/phase-3-prod-realdevice-test.md`
- `qa/current-stage-acceptance-family-first-baseline.md`

当前正式基线已包含：

- `COSTRA-154/150`：sync pull / scheduler / outbox / v1.2 watermark。
- `COSTRA-164/165`：server family bootstrap MVP + miniapp family context。
- `COSTRA-217`：二级分类 schema + `entries.shared_type`。
- `COSTRA-218`：后端分类 API。
- `COSTRA-219`：前端分类模型 API + cache。
- `COSTRA-220`：明细页真实数据完善。

### §1.2 本卡直接动因

Sprint-4/5/6 Family First 规划已落盘：`.team/sprints/sprint-04-06-family-first-plan.md`。

其中 `COSTRA-221` 是 Sprint-4 第一张 P0 卡，目标是把当前只有 bootstrap 的 family 域推进到可供后续家庭页、家庭聚合、成员筛选真实接入的后端基础。

当前真实缺口：

1. `server/api/openapi.yaml` 已定义 `/families*` 多个端点，但 server 未注册 `routes/families.ts`，命中 D-025 AP-003 契约-实装漂移。
2. 没有 `server/src/services/familyService.ts`。
3. `familyRepo.ts` 只覆盖 bootstrap / personal 查询 / active family list / softDelete 的部分能力。
4. 没有 invite DAO / member DAO / invite accept / member remove 业务编排。
5. 后续 `COSTRA-222` 家庭财务聚合 API、`COSTRA-223` 家庭页 UI 都依赖真实 family list / members / invite / remove。

### §1.3 本卡不解决的问题

本卡不是家庭页 UI，也不是财务聚合：

- 不做 `COSTRA-222`：家庭财务 summary / 公共支出 / 垫付贡献。
- 不做 `COSTRA-223`：家庭页 UI / 成员头像横向滚动 / 邀请入口前端接入。
- 不做预算、订阅消息、审计活动流页面。
- 不修 `FU-220-SYNC-USER-ID-CREATED-BY`，但必须在卡审中确认它作为 Sprint-4 guardrail 独立处理，不混入本卡业务实现。

---

## §2 当前代码与契约事实

### §2.1 DB schema

事实源：

- `server/db/migrations/0001_init.sql`
- `server/db/migrations/0007_families_kind.sql`
- `server/db/migrations/0009_entries_shared_type.sql`

已存在表：

| 表 | 当前关键字段 | 说明 |
|---|---|---|
| `families` | `id`, `name`, `owner_id`, `kind`, `deleted_at`, `version` | `kind` = `personal | shared`，personal 每 owner 最多 1 个 |
| `family_members` | `family_id`, `user_id`, `role`, `joined_at`, `left_at` | PK `(family_id,user_id)`；退出成员用 `left_at` |
| `family_invites` | `id`, `family_id`, `inviter_id`, `invite_token`, `role`, `expires_at`, `used_at`, `used_by` | invite token 唯一 |
| `ledgers` | `id`, `family_id`, `name`, `currency`, `deleted_at`, `version` | 产品语义 family:ledger = 1:1，物理保留 1:N |

本卡默认不新增 migration。若 card-review 判定成员 nickname/avatar 必须做快照字段，则必须在 card-review 阶段明确升 scope 并补 migration；否则 R1 采用 `family_members JOIN users` 返回当前用户昵称/头像，`left_at` 作为退出状态。

### §2.2 现有 repo / service / routes

| 层 | 现状 |
|---|---|
| `familyRepo.ts` | 已有 `createPersonalFamily` / `findById` / `listActiveFamiliesByUser` / `findPersonalFamily` / `softDelete` |
| `ledgerRepo.ts` | 已有 `createDefaultLedger` / `findById` / `findFirstByFamilyId` |
| `authService.ts` | wxLogin/refresh 已返回 `default_family_id` / `default_ledger_id` |
| `categoryService.ts` | 内联 `isUserInFamily`，可作为抽公共 membership guard 的参考 |
| `syncPullService.ts` | 内联 `family_members` 权限守门，可作为抽公共 membership guard 的参考 |
| `routes/families.ts` | 不存在 |
| `app.ts` | `/v1` scope 内未注册 family routes |

### §2.3 OpenAPI 现状

事实源：`server/api/openapi.yaml`。

当前已定义但未实装的 family 端点：

- `GET /v1/families`
- `POST /v1/families`
- `GET /v1/families/{family_id}`
- `PATCH /v1/families/{family_id}`
- `DELETE /v1/families/{family_id}`
- `POST /v1/families/{family_id}/invites`
- `POST /v1/families/invites/accept`
- `DELETE /v1/families/{family_id}/members/{user_id}`

缺口：

- Sprint 规划要求 `GET /v1/families/{family_id}/members`，OpenAPI 当前没有该独立 path。
- Handoff/规划曾提到 `POST /v1/family-invites/{invite_id}/accept`，但 OpenAPI 当前是 token-based `POST /v1/families/invites/accept`。
- `Family` schema 缺 `kind` / `ledger_id` / `ledger_name`，但前端 `FamilyContext` 已需要 `family_kind` / `ledger_name`。
- `FamilyMember` schema 缺 `left_at` / `status`，后续家庭页需要退出成员灰化。
- `ErrorCode` schema 缺 `FAMILY_PERSONAL_NOT_DELETABLE`，而 TS 枚举已有该 code。

---

## §3 Scope（必交）

### A · OpenAPI 契约收敛

必须做：

1. 明确 canonical accept invite 路径：本卡采用现有 OpenAPI 路径 `POST /v1/families/invites/accept`（token-based），不新增 `/family-invites/{invite_id}/accept` 第二套路径，避免双轨。
2. 新增 `GET /v1/families/{family_id}/members` path。
3. `PATCH /v1/families/{family_id}` 与 `DELETE /v1/families/{family_id}` **本卡必做**，不得 `x-deferred`。
4. 更新 `Family` schema，至少包含：
   - `id`
   - `name`
   - `owner_id`
   - `kind: personal | shared`
   - `ledger_id`
   - `ledger_name`
   - `member_count`
   - `created_at`
   - `updated_at`
   - `version`
   - 当前 OpenAPI delta：现有 `Family` 缺 `kind`、`ledger_id`、`ledger_name`、`member_count`、`updated_at`，R1 必须补齐并确保 `GET /families` list 响应同样返回这些字段。
5. 更新 `FamilyMember` schema，至少包含：
   - `user_id`
   - `nickname`
   - `avatar_url`
   - `role`
   - `status: active | left`
   - `joined_at`
   - `left_at`
   - 当前 OpenAPI delta：现有 `FamilyMember` 缺 `nickname`、`avatar_url`、`status`、`left_at`，R1 必须补齐。
6. 更新 `FamilyInvite` schema，至少包含：
   - `id`
   - `family_id`
   - `invite_token`
   - `role`
   - `expires_at`
   - `share_url`
   - 当前 OpenAPI delta：现有 `FamilyInvite` 缺 `id`、`family_id`、部分响应字段完整性，R1 必须补齐。
7. 更新 `ErrorCode` schema，补齐 `FAMILY_PERSONAL_NOT_DELETABLE`；不新增 `FAMILY_PERSONAL_NOT_INVITABLE`。
8. 本卡结束后不得存在未实现且未显式 `x-deferred` 的 `/families*` OpenAPI drift。R1 默认实现本 dispatch 全部 `/families*` 端点，不留下 undeferred drift。

### B · Repo 层补齐

建议新增或扩展：

- `server/src/repositories/familyRepo.ts`
- 可新增 `server/src/repositories/familyMemberRepo.ts`
- 可新增 `server/src/repositories/familyInviteRepo.ts`
- 复用 `server/src/repositories/ledgerRepo.ts`

必备 repo 能力：

1. 创建 shared family：`families.kind = 'shared'`，owner 写入 `family_members(role='owner')`。
2. family list：列出当前 user `left_at IS NULL` 的 families，并附 active ledger 信息和 active member count。
3. family detail：按 family id 取详情，要求调用方是 active member。
4. member list：返回 active + left members，left member 需保留 `left_at`。
5. invite create：写 `family_invites`，生成高熵 token，默认 24h，最长 168h。
6. invite accept：校验 token 未过期、未使用；加入 `family_members`；若历史成员 `left_at IS NOT NULL`，更新为重新加入而非插入冲突。
7. member remove：设置 `left_at = now()`，不物理删除。

禁止：

- 禁止直接字符串拼 SQL，必须参数化。
- 禁止在 route 层直接写 SQL。
- 禁止为绕过 PK `(family_id,user_id)` 删除历史 member 行。

### C · Service 层新增 `familyService.ts`

新增：`server/src/services/familyService.ts`。

必备 service API：

- `listFamilies(userId)`
- `createFamily(userId, payload)`
- `getFamilyDetail(userId, familyId)`
- `listMembers(userId, familyId)`
- `updateFamily(userId, familyId, payload)`（若实现 `PATCH`）
- `deleteFamily(userId, familyId, version)`（若实现 `DELETE`）
- `createInvite(userId, familyId, payload)`
- `acceptInvite(userId, payload)`
- `removeMember(userId, familyId, targetUserId)`
- 公共守门：`assertActiveMember(userId, familyId)` / `assertOwner(userId, familyId)`

业务规则：

1. `personal` family：不可邀请、不可删除、不可移出 owner。
2. 非 member 访问 family detail / members / invites：统一返回 403 `FAMILY_NOT_MEMBER`，不返回 404。
3. 只有 owner 可：创建 invite、更新 family、删除 family、移出他人。
4. owner 不可通过 remove member 移出自己；如需解散 shared family，走 `DELETE /families/{family_id}`；remove self 返回 403 `FAMILY_PERSONAL_NOT_DELETABLE`。
5. 已退出 member：`left_at IS NOT NULL`，返回列表时 `status='left'`，后续前端灰化；对 active 权限守门视为非成员。
6. invite role 只允许 `member | viewer`，不允许 invite owner。
7. invite 过期、已使用、重复 accept 均返回 410 `INVITE_EXPIRED`；不要返回 500。
8. personal family 禁项错误码双轨：
   - personal 不可删除 / 不可移出 owner：403 `FAMILY_PERSONAL_NOT_DELETABLE`；
   - personal 不可邀请：422 `BUSINESS_RULE_VIOLATION` + `details.rule = 'personal_family_not_invitable'`。
9. 创建 shared family 必须同步创建默认 ledger；默认 ledger name = family name。
10. shared family active member 上限 10 人（含 owner）；超限 accept 返回 422 `BUSINESS_RULE_VIOLATION` + `details.rule = 'family_member_limit'`。
11. 所有 create/accept/delete/update 涉及多表变更必须使用 `withTx`。
12. 交叉依赖：`FU-220-SYNC-USER-ID-CREATED-BY` 已作为 Sprint-4 guardrail 独立处理，本卡不得修改 `syncPullService.ts` / `miniprogram/services/db.ts`；但新增 family/member response 字段时必须避免再次引入 `user_id` / `created_by` 语义漂移。

### D · Routes 层新增 `routes/families.ts`

新增：`server/src/routes/families.ts`，并在 `server/src/app.ts` 的 `/v1` scope 内注册。

必备 routes：

- `GET /families`
- `POST /families`
- `GET /families/{family_id}`
- `GET /families/{family_id}/members`
- `PATCH /families/{family_id}`（本卡必做）
- `DELETE /families/{family_id}`（本卡必做）
- `POST /families/{family_id}/invites`
- `POST /families/invites/accept`
- `DELETE /families/{family_id}/members/{user_id}`

路线范式：参考 `server/src/routes/categories.ts`：

- route 只做 jwt parse / schema / 调 service / reply。
- jwt 解析错误统一抛 `UNAUTHENTICATED`。
- request body schema `additionalProperties: false`。

### E · 幂等处理

以下 mutating endpoint 必须处理 `Idempotency-Key`：

- `POST /families`
- `POST /families/{family_id}/invites`
- `POST /families/invites/accept`
- `DELETE /families/{family_id}`

`PATCH /families/{family_id}` 不要求 `Idempotency-Key`，由 request body `version` 乐观锁保证幂等与冲突检测。

可复用 `server/src/services/idempotencyService.ts`。如果当前路由层没有通用封装，本卡可在 `routes/families.ts` 内做窄封装，但不得复制大段复杂逻辑。

### F · 测试

新增：`server/test/families.test.ts`。

最低测试矩阵：

| ID | 场景 | 期望 |
|---|---|---|
| T1 | 登录 bootstrap 后 `GET /families` | 返回 personal family + ledger 信息 + `kind=personal` |
| T2 | `POST /families` 创建 shared family | 201；family.kind=shared；owner member；默认 ledger 创建 |
| T3 | 非登录访问 family endpoints | 401 |
| T4 | 非 member 读取 detail/members | 403 `FAMILY_NOT_MEMBER` |
| T5 | personal family 创建 invite | 422 `BUSINESS_RULE_VIOLATION` + `details.rule=personal_family_not_invitable` |
| T6 | shared family owner 创建 invite | 201；token 唯一；expires_at 生效 |
| T7 | invite accept | 新 user 加入 family；重复 accept / used token 返回 410 `INVITE_EXPIRED` |
| T8 | expired invite accept | 410 `INVITE_EXPIRED` |
| T9 | owner remove member | member.left_at 写入；members 返回 `status=left` |
| T10 | removed member 权限 | 不能再读 family detail / members，返回 403 `FAMILY_NOT_MEMBER` |
| T11 | owner remove self | 被拒绝，返回 403 `FAMILY_PERSONAL_NOT_DELETABLE`，不可 500 |
| T12 | `GET /families/{id}/members` 包含 active + left | active 在前，left 有 left_at |
| T13 | `PATCH /families/{id}` | owner 可改名；非 owner 拒绝；version conflict 409 |
| T14 | `DELETE /families/{id}` | shared owner 可软删；personal 拒绝；version conflict 409 |
| T15 | shared family member 上限 | 第 11 个 active member accept 返回 422 `BUSINESS_RULE_VIOLATION` + `details.rule=family_member_limit` |
| T16 | OpenAPI ErrorCode | `FAMILY_PERSONAL_NOT_DELETABLE` 已出现在 OpenAPI enum |

---

## §4 不在本卡范围

- 不做 `GET /families/{family_id}/summary`，归 `COSTRA-222`。
- 不做家庭页 UI，归 `COSTRA-223`。
- 不做微信分享卡片前端 scene 解析；本卡只返回 `share_url` / `invite_token` 的后端字段。
- 不做实时推送 / 订阅消息。
- 不做审计活动流页面。
- 不做预算 / 周期账单。
- 不做 `FU-220-SYNC-USER-ID-CREATED-BY`，但本卡 review 必须确认它已进入 Sprint-4 guardrail，不被遗忘。

---

## §5 工作区边界

### 可写

- `server/src/repositories/familyRepo.ts`
- `server/src/repositories/ledgerRepo.ts`
- `server/src/repositories/familyMemberRepo.ts`（如新增）
- `server/src/repositories/familyInviteRepo.ts`（如新增）
- `server/src/services/familyService.ts`
- `server/src/routes/families.ts`
- `server/src/app.ts`
- `server/src/errors/ErrorCode.ts`（仅当需要补错误码）
- `server/api/openapi.yaml`
- `docs/api/error-codes.md`（若错误码变化）
- `server/test/families.test.ts`
- `.team/members/backend-dev/state.md`
- `.team/members/backend-dev/history/*.md`

### 不可写

- `miniprogram/` 业务代码。
- `design/ui/`。
- `infra/`。
- `server/src/services/syncPullService.ts` / `miniprogram/services/db.ts` 中 `FU-220-SYNC-USER-ID-CREATED-BY` 的修复（独立 guardrail）。
- `.codebuddy/`。

---

## §6 验证命令

R1 完成后必须运行：

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run check:appjson
```

后端定向建议：

```bash
npx vitest run server/test/families.test.ts --run
npx vitest run server/test/auth-family-bootstrap.test.ts --run
```

若新增/改 OpenAPI：

```bash
npm run check:openapi || true
npm run check:whitelist || true
```

说明：若当前项目尚无 `check:openapi` / `check:whitelist` 脚本，开发 Agent 应报告“脚本不存在”，不得临时绕过；后续由 `COSTRA-161` 处理静态对账。

---

## §7 Card-Review 必审问题

`card-review:COSTRA-221-R2` 必须确认以下 R1 裁决已落地：

1. **Q1 路径统一**：接受邀请 canonical path 为 `POST /v1/families/invites/accept`，不新增 `/family-invites/{invite_id}/accept`。
2. **Q2 PATCH/DELETE 范围**：`PATCH/DELETE /families/{id}` 本卡必须实现，不得 `x-deferred`。
3. **Q3 成员快照**：R1 不新增 migration，先 `JOIN users` 返回 nickname/avatar；若后续家庭页需要退出时快照，登记 `FU-221-MEMBER-SNAPSHOT-ON-LEFT`。
4. **Q4 权限返回码**：非 member 访问 family detail/members/invites 统一返回 403 `FAMILY_NOT_MEMBER`。
5. **Q5 personal family 禁项错误码**：personal 不可删除/移出 owner 用 403 `FAMILY_PERSONAL_NOT_DELETABLE`；personal 不可邀请用 422 `BUSINESS_RULE_VIOLATION` + `details.rule=personal_family_not_invitable`；不新增错误码。
6. **Q6 idempotency**：`POST /families`、`POST /families/{id}/invites`、`POST /families/invites/accept`、`DELETE /families/{id}` 必须实现 `Idempotency-Key`；`PATCH` 不要求，走 version 乐观锁。
7. **Q7 COSTRA-222/223 依赖**：`Family` list/detail 响应必须含 `kind`、`ledger_id`、`ledger_name`、`member_count`；`FamilyMember` 必须含 `status/left_at/nickname/avatar_url`。
8. **Q8 D-025 AP-003**：本卡结束后不得存在 undeferred `/families*` OpenAPI drift。

---

## §8 DoD

本卡 Done 需要同时满足：

- [ ] `routes/families.ts` 存在并注册到 `/v1`。
- [ ] `familyService.ts` 存在，route 层无业务 SQL。
- [ ] `GET /families` 可返回当前用户 active families，含 personal/shared 与 ledger 信息。
- [ ] `POST /families` 创建 shared family + owner member + 默认 ledger，事务一致。
- [ ] `GET /families/{family_id}/members` 返回 active + left members，含 role/status/joined_at/left_at/nickname/avatar。
- [ ] `POST /families/{family_id}/invites` 仅 shared owner 可用，personal 拒绝。
- [ ] `POST /families/invites/accept` 可加入新成员，过期/已使用正确失败。
- [ ] `DELETE /families/{family_id}/members/{user_id}` 设置 `left_at`，不物理删历史。
- [ ] `PATCH/DELETE /families/{id}` 已实现并测试，不得 `x-deferred`。
- [ ] `FAMILY_PERSONAL_NOT_DELETABLE` 已同步 OpenAPI ErrorCode enum。
- [ ] personal family 不可邀请返回 422 `BUSINESS_RULE_VIOLATION` + `details.rule=personal_family_not_invitable`。
- [ ] 非 member 访问 family detail/members/invites 返回 403 `FAMILY_NOT_MEMBER`。
- [ ] `POST /families`、`POST /families/{family_id}/invites`、`POST /families/invites/accept`、`DELETE /families/{family_id}` 的幂等行为有测试。
- [ ] `server/test/families.test.ts` 覆盖 T1~T16。
- [ ] `npm run typecheck` PASS。
- [ ] `npm run lint` PASS。
- [ ] `npm test -- --run` PASS。
- [ ] `npm run check:appjson` PASS。
- [ ] 交付 history 写入 `.team/members/backend-dev/history/`。
- [ ] 不修改 `miniprogram/` 业务代码。

---

## §9 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---:|---|
| `/families*` OpenAPI drift 继续残留 | P1 | 本卡必须实现全部当前 `/families*` 端点；PATCH/DELETE 不得 `x-deferred` |
| invite path 双轨 | P1 | 统一采用 OpenAPI 现有 token-based `/families/invites/accept` |
| 成员退出后历史展示不稳定 | P2 | R1 用 `left_at` + join users；登记 `FU-221-MEMBER-SNAPSHOT-ON-LEFT`，后续按家庭页真实需求决定是否加 snapshot migration |
| owner 移除自己导致 orphan family | P1 | service 明确禁止 remove self；解散 shared family 走 DELETE |
| personal family 被邀请/删除 | P1 | `kind='personal'` 守门 + 双轨错误码 + 单测 |
| 幂等遗漏导致重复家庭/重复邀请 | P2 | 复用 `idempotencyService.ts`，POST/DELETE mutating endpoint 必审 |
| 与 `FU-220-SYNC-USER-ID-CREATED-BY` 混卡 | P2 | 明确不在本卡范围，独立 guardrail；本卡只避免新增字段语义漂移 |

---

## §10 下一步

1. Human 触发：`card-review:COSTRA-221-R2`。
2. R2 PASS/APPROVE 后，Human 再触发：`start:COSTRA-221`。
3. `COSTRA-221` 通过后，进入：`plan-dispatch:COSTRA-222` / `start:COSTRA-222`。

**派单档结束。**
