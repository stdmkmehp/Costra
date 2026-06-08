# Card Review · COSTRA-221 · Round 1 · Tech

- **触发**：`card-review:COSTRA-221`
- **卡 Owner**：backend-dev
- **卡类型**：feature（backend + OpenAPI drift closure）
- **估点**：5
- **审查时间**：2026-06-02T14:30:00+08:00
- **审查对象**：`.team/dispatch/COSTRA-221-backend-family-management-api.md`
- **审查角色**：costra-card-reviewer-tech（只读审查，Orchestrator 物理落盘）

---

## 1. 总评

| 项 | 结论 |
|---|---|
| **Verdict** | `REVISE` |
| **Score** | `22/30` |
| **P0** | 3 |
| **P1** | 4 |
| **P2** | 3 |
| **INFO** | 2 |
| **是否可 start** | 否，需先修订 dispatch 并过 Round 2 |

结论：当前 dispatch 方向正确，且准确抓住 `/families*` OpenAPI drift 与 Family First 后端基础缺口；但卡定义中仍有 3 个 P0 未裁决项，会导致 backend-dev 在实现时自行选择关键口径。必须先修订 dispatch，再进入 `card-review:COSTRA-221-R2`。

---

## 2. 维度评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| C1 标题与描述 | 4/5 | 标题清晰；描述含背景/目标/范围；但 “OpenAPI drift closure” 与 PATCH/DELETE 可 x-deferred 的分支存在自相矛盾。 |
| C2 DoD 可度量 | 5/6 | 18 条 DoD 大多可验证；但 T4 “403/404 按既有策略”与 T5 “或业务规则错误”不可度量。 |
| C3 依赖识别 | 4/5 | 上游 164/165、下游 222/223 清晰；但 `FU-220-SYNC-USER-ID-CREATED-BY` 的交叉依赖说明不足。 |
| C4 产出物具体 | 4/5 | 文件路径、函数签名、接口 URL 明确；但 PATCH/DELETE 是否实装未最终裁决。 |
| C5 风险与边界 | 3/4 | 风险覆盖主路径；但非 member 403 vs 404、成员快照稳定性未充分量化。 |
| C6 去重 | 3/3 | backlog/board 无重复；Sprint-4 入场唯一 P0 family 管理卡。 |
| C7 估点 | 2/2 | 5 点偏紧但可接受；若 PATCH/DELETE 必做仍可按 5 点推进。 |
| C8 红线 | PASS | 无 secret/主体硬编码；目录边界正确；不修改 miniprogram。 |

---

## 3. Dispatch §7 八问裁决

| Q | 问题 | 裁决 | 依据 |
|---|---|---|---|
| Q1 | 接受邀请 canonical path | 确认 `POST /v1/families/invites/accept`，不新增 `/family-invites/{invite_id}/accept` | OpenAPI 已定义 token-based path；双轨无必要。 |
| Q2 | `PATCH/DELETE /families/{id}` 范围 | **必须本卡实现** | 若 x-deferred，会继续残留 `/families*` AP-003 drift；当前无后续卡承接。 |
| Q3 | member snapshot | R1 不加 migration，先 JOIN `users` | `left_at` 足够表达退出状态；昵称/头像快照稳定性记 P2 follow-up。 |
| Q4 | 非 member 返回码 | **403 `FAMILY_NOT_MEMBER`** | `categoryService` / `syncPullService` 既有范式均为 403。 |
| Q5 | personal 禁项错误码 | 双轨：不可删除/移出 owner 用 `FAMILY_PERSONAL_NOT_DELETABLE`；不可邀请用 `BUSINESS_RULE_VIOLATION` + `details.rule=personal_family_not_invitable` | `FAMILY_PERSONAL_NOT_DELETABLE` 语义过窄，不应覆盖“不可邀请”。 |
| Q6 | Idempotency-Key | `POST /families`、`POST /families/{id}/invites`、`POST /families/invites/accept`、`DELETE /families/{id}` 必做；`PATCH` 由 version 乐观锁保证 | OpenAPI PATCH 当前无 Idempotency-Key；DELETE 有。 |
| Q7 | 222/223 字段充分性 | 基本足够，但必须确保 `Family` list 响应也含 `kind/ledger_id/ledger_name/member_count` | 当前 OpenAPI schema 缺字段，dispatch 已要求补但需更明确 delta。 |
| Q8 | D-025 AP-003 | 本卡结束后不得有 undeferred `/families*` drift | 当前 7 个 `/families*` 端点已定义但未实装；本卡就是闭合卡。 |

---

## 4. P0 阻塞点

### P0-1 · PATCH/DELETE 必须本卡实现，不得 x-deferred

- **证据**：dispatch §3.D 写“若不实现，必须 x-deferred”；§7 Q2 又写“默认建议实现”。
- **问题**：如果 `PATCH/DELETE /families/{id}` 走 x-deferred，`COSTRA-221` 不能宣称 `/families*` drift closure；且没有后续 owner_card 承接这两个端点。
- **依据**：D-025 AP-003；dispatch §3.A.7；COSTRA-104 切出去三件套范式。
- **修订要求**：dispatch 改为 `PATCH/DELETE /families/{id}` 本卡必做；T13/T14 从“若实现”改为必做测试。

### P0-2 · 非 member 返回码必须裁决为 403

- **证据**：dispatch T4 写“403/404 按既有不泄露策略，必须一致”，但未指定一致对象。
- **问题**：实现 Agent 会自行选择 403 或 404，导致 family API 与 `categoryService` / `syncPullService` 不一致。
- **依据**：`ErrorCode.FAMILY_NOT_MEMBER → 403`；`categoryService`、`syncPullService` 均采用 member guard 403。
- **修订要求**：业务规则和 T4 改为“非 member 读取 detail/members/invites 返回 403 `FAMILY_NOT_MEMBER`”。

### P0-3 · personal family 禁项错误码策略必须明确

- **证据**：dispatch Q5 写“默认建议复用现有 code”；T5 写“`FAMILY_PERSONAL_NOT_DELETABLE` 或业务规则错误”。
- **问题**：“或”字未裁决；`FAMILY_PERSONAL_NOT_DELETABLE` 语义不能覆盖“不可邀请”。
- **依据**：ErrorCode 语义；D-025 AP-001 枚举语义代理风险。
- **修订要求**：采用双轨：
  - personal 不可删除 / 移出 owner：403 `FAMILY_PERSONAL_NOT_DELETABLE`；
  - personal 不可邀请：422 `BUSINESS_RULE_VIOLATION` + `details.rule='personal_family_not_invitable'`；
  - 不新增错误码。

---

## 5. P1 应改

### P1-1 · OpenAPI schema delta 需显式列出

当前 dispatch 列了目标字段，但没有明确当前缺口。需在 §3.A 增加 delta：

- `Family` 当前缺：`kind`、`ledger_id`、`ledger_name`、`member_count`、`updated_at`。
- `FamilyMember` 当前缺：`nickname`、`avatar_url`、`status`、`left_at`。
- `FamilyInvite` 当前缺：`id`、`family_id`、`role`、`expires_at` 等完整性字段。

### P1-2 · Idempotency-Key 范围需精确

修订为：

- 必须实现：`POST /families`、`POST /families/{family_id}/invites`、`POST /families/invites/accept`、`DELETE /families/{family_id}`。
- 不要求：`PATCH /families/{family_id}`，由 `version` 乐观锁保证。

### P1-3 · 创建 shared family 默认 ledger name 需裁决

dispatch 目前写“family name 或 `家庭账本`，需 card-review 确认”。本轮裁决：

```text
shared family 默认 ledger name = family name
```

原因：用户创建 shared family 时已输入家庭名；复用 family name 可减少 UI 认知差异。

### P1-4 · `FU-220-SYNC-USER-ID-CREATED-BY` 交叉依赖需显式标注

dispatch 已说明“不混入”，但应补充：

- `FU-220-SYNC-USER-ID-CREATED-BY` 是 Sprint-4 guardrail；
- 若该 FU 先于或并行于 221 完成，family/member 相关字段命名需避免再次产生 `user_id` / `created_by` 漂移；
- 本卡不修改 `syncPullService.ts` / `miniprogram/services/db.ts`。

---

## 6. P2 建议

### P2-1 · 成员退出后 nickname/avatar 不稳定应登记 follow-up

R1 不加 snapshot migration 合理，但需登记：

```text
FU-221-MEMBER-SNAPSHOT-ON-LEFT
```

触发条件：家庭页灰化退出成员时发现头像/昵称需保持退出时快照。

### P2-2 · invite accept 重复 token 返回码应固定为 410

T7 中“410/409”应改为：

```text
重复 accept / used token 返回 410 INVITE_EXPIRED
```

### P2-3 · 家庭最大人数上限未提及

建议新增业务规则：

```text
shared family active member 上限 10 人（含 owner）；超限 accept 返回 422 BUSINESS_RULE_VIOLATION details.rule=family_member_limit
```

---

## 7. INFO

### INFO-1 · `check:openapi` / `check:whitelist` 的 `|| true` 可接受

dispatch 已说明脚本不存在时需要报告、不得绕过；与 `COSTRA-161` guardrail 对齐。

### INFO-2 · T15 可与 DoD ErrorCode 同步项合并

T15 与 DoD “`FAMILY_PERSONAL_NOT_DELETABLE` 已同步 OpenAPI enum”重复，可合并降低测试矩阵冗余。

---

## 8. D-025 反模式扫描

| ID | 反模式 | 结论 | 说明 |
|---|---|---|---|
| AP-001 | 字符串代理判定 | 未命中 | dispatch 未使用字符串代理业务语义；错误码走枚举。 |
| AP-002 | 概率极低就接受 | 未命中 | 未用“概率极低”接受边界缺陷。 |
| AP-003 | 契约-实装漂移 | 命中，需本卡闭合 | 当前 `/families*` OpenAPI 端点已定义但未实装；若 PATCH/DELETE x-deferred 会残留。 |
| AP-004-X | 红字反模式 | 未命中 | 未发现 secret/主体硬编码/错误响应直出。 |

---

## 9. 给卡作者的修订清单

必须修订 P0：

1. §3.D 删除“若不实现”条件分支，`PATCH/DELETE /families/{id}` 改为本卡必做；T13/T14 改为必做测试。
2. §3.C 业务规则 2 + DoD T4 统一为：非 member 返回 403 `FAMILY_NOT_MEMBER`。
3. §3.C / DoD T5 明确 personal 禁项双轨错误码：不可邀请用 422 `BUSINESS_RULE_VIOLATION`，不可删除/移出 owner 用 403 `FAMILY_PERSONAL_NOT_DELETABLE`。

建议同步修订 P1：

4. §3.A 显式列出 OpenAPI schema delta。
5. §3.E 精确 Idempotency-Key 范围，PATCH 不要求。
6. 裁决 shared family 默认 ledger name = family name。
7. 补 `FU-220-SYNC-USER-ID-CREATED-BY` 交叉依赖说明。

P2 可追加：

8. 登记 `FU-221-MEMBER-SNAPSHOT-ON-LEFT`。
9. used invite token 固定返回 410 `INVITE_EXPIRED`。
10. 补 family active member 上限 10 人规则。

---

## 10. 下一步

1. Orchestrator 修订 `.team/dispatch/COSTRA-221-backend-family-management-api.md`。
2. 触发 `card-review:COSTRA-221-R2`。
3. 只有 R2 `APPROVE` 或明确允许的 `PASS-WITH-FOLLOWUP` 后，才可 Human 触发 `start:COSTRA-221`。
