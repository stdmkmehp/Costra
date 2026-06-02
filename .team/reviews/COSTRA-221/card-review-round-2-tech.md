# Card Review · COSTRA-221 · Round 2 · Tech + Design Landing

- **触发**：`card-review:COSTRA-221-R2`
- **卡 Owner**：backend-dev
- **卡类型**：feature（backend + OpenAPI drift closure）
- **估点**：5
- **审查时间**：2026-06-02T15:30:00+08:00
- **审查对象**：`.team/dispatch/COSTRA-221-backend-family-management-api.md`（R1.x 修订版）
- **设计依据**：`design/ui/design_spec.md`、`design/ui/interaction_flow.md`
- **上轮结论**：R1 `REVISE 22/30` · 3 P0 / 4 P1 / 3 P2 / 2 INFO
- **审查角色**：costra-card-reviewer-tech（只读审查，Orchestrator 物理落盘）

---

## 1. 总评

| 项 | 结论 |
|---|---|
| **Verdict** | `PASS-WITH-FOLLOWUP` |
| **Score** | `29/30` |
| **P0** | 0 |
| **P1** | 0 |
| **P2** | 2 |
| **INFO** | 3 |
| **是否可 start** | 是，R2 通过；Human 可触发 `start:COSTRA-221` |

结论：R1 的 3 个 P0、4 个 P1、3 个 P2 已在 dispatch R1.x 中全部兑现。结合 `design/ui/design_spec.md` 与 `design/ui/interaction_flow.md` 复核后，`COSTRA-221` 的 API 字段足以支撑家庭页、明细页、记账页、统计页中与 family/member/ledger/invite/remove 相关的设计落地。家庭财务 summary 明确归 `COSTRA-222`，不阻塞本卡。

---

## 2. R1 修订兑付表

| R1 编号 | R1 要求 | dispatch R1.x 兑现情况 | 判定 |
|---|---|---|---|
| P0-1 | `PATCH/DELETE /families/{id}` 必做，不得 `x-deferred` | §3.A.3、§3.D、DoD 均明确本卡必做 | ✅ |
| P0-2 | 非 member 返回 403 `FAMILY_NOT_MEMBER` | §3.C 规则 2、T4、DoD 明确 403 | ✅ |
| P0-3 | personal 禁项错误码双轨 | §3.C 规则 8 明确不可删除/移出 owner 用 `FAMILY_PERSONAL_NOT_DELETABLE`，不可邀请用 `BUSINESS_RULE_VIOLATION` | ✅ |
| P1-1 | OpenAPI schema delta 显式列出 | §3.A.4/5/6 列出 `Family`、`FamilyMember`、`FamilyInvite` delta | ✅ |
| P1-2 | Idempotency-Key 范围精确 | §3.E 明确 POST/DELETE 必做，PATCH 走 version 乐观锁 | ✅ |
| P1-3 | shared family 默认 ledger name | §3.C 规则 9 明确 ledger name = family name | ✅ |
| P1-4 | `FU-220-SYNC-USER-ID-CREATED-BY` 交叉依赖 | §3.C 规则 12、§4、§5 明确隔离 | ✅ |
| P2-1 | 登记 member snapshot follow-up | `FU-221-MEMBER-SNAPSHOT-ON-LEFT` 已登记 | ✅ |
| P2-2 | used/repeated invite token 返回 410 | §3.C 规则 7、T7 明确 `INVITE_EXPIRED` | ✅ |
| P2-3 | family active member 上限 10 | §3.C 规则 10、T15 明确 | ✅ |

**兑付结论**：10/10 全额兑现。

---

## 3. 设计落地能力矩阵

| 设计章节 | 设计需求 | 221 API 支撑 | 结论 |
|---|---|---|---|
| `design_spec.md` §1 | 默认单人账本、多家庭协作、账本隔离、全局视图上下文 | `GET /families` 返回 `kind/ledger_id/ledger_name`；`POST /families` 创建 shared family + 默认 ledger | ✅ 充分 |
| `design_spec.md` §6.2 / `interaction_flow.md` §4 | 明细页账本切换 ActionSheet | `GET /families` 提供当前用户可切换账本列表 | ✅ 充分 |
| `design_spec.md` §6.2 | 多人账本成员筛选、Mini 微信头像 | `GET /families/{id}/members` 提供 `user_id/nickname/avatar_url/status` 映射 | ✅ 充分 |
| `design_spec.md` §6.3 / `interaction_flow.md` §3.2 | 记账页按账本 `personal/shared` 动态显示个人/公共支出开关 | `Family.kind` + `ledger_id` 可驱动前端动态表单；`entries.shared_type` 已由 217 提供 | ✅ 充分 |
| `design_spec.md` §6.5 | 单人落地页创建家庭 CTA | `POST /families` 可创建 shared family；`GET /families` 可判断仅 personal 的引导态 | ✅ 充分 |
| `design_spec.md` §6.5 | 多人家庭名展示 / 改名 | `GET /families/{id}` 返回 `name`；`PATCH /families/{id}` 支持改名 | ✅ 充分 |
| `design_spec.md` §6.5 / `interaction_flow.md` §6 | 横向头像区、已退出成员灰化、已退出成员排末尾 | `GET /families/{id}/members` 返回 active + left，含 `status/left_at/avatar_url` | ✅ 充分 |
| `design_spec.md` §6.5 / `interaction_flow.md` §6 | 邀请 `[+]` 拉起微信分享 | `POST /families/{id}/invites` 返回 `invite_token/share_url` | ✅ 充分 |
| `interaction_flow.md` §6 | 创建者移出成员 ActionSheet | `DELETE /families/{id}/members/{user_id}` 设置 `left_at` | ✅ 充分 |
| `design_spec.md` §6.4 / `interaction_flow.md` §5 | 统计页成员维度 swipe | 221 提供 members 基础字段；金额聚合归 222 | ✅ 221 范围充分 |
| `design_spec.md` §6.5 | 公共/个人收支、垫付贡献、分类下钻 | 非 221 范围；归 `COSTRA-222` summary API | ✅ 边界清晰 |

---

## 4. 维度评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| C1 标题与描述 | 5/5 | 标题、背景、目标、边界清晰；R1 矛盾已消除。 |
| C2 DoD 可度量 | 6/6 | DoD + T1~T16 可验证；返回码、PATCH/DELETE、幂等均明确。 |
| C3 依赖识别 | 5/5 | 上游 164/165/217~220、下游 222/223、FU-220 交叉依赖均明确。 |
| C4 产出物具体 | 5/5 | 文件、service API、routes、OpenAPI delta、测试矩阵均具体。 |
| C5 风险与边界 | 3/4 | 剩余 left member 排序与 nickname/avatar 快照稳定性为 P2 设计联动后续，不阻塞。 |
| C6 去重 | 3/3 | 无重复卡；221 是唯一 family management API 卡。 |
| C7 估点 | 2/2 | 5 点偏紧但仍符合 INVEST；未混入 222/223。 |
| C8 红线 | PASS | 无 secret/主体硬编码；工作区边界正确；不改 `miniprogram/`。 |

**总分：29/30**。

---

## 5. P0 阻塞点

无。

## 6. P1 应改

无。

---

## 7. P2 建议

### P2-1 · left member 排序规则未显式量化

- **证据**：dispatch 要求返回 active + left members，T12 要求 active 在前、left 有 `left_at`。
- **设计依据**：`design_spec.md` §6.5、`interaction_flow.md` §6 要求已退出成员排列在活跃成员之后、邀请 `[+]` 前。
- **建议**：实装时固定排序：active members 按 `joined_at ASC`；left members 按 `left_at DESC`，并在接口测试中断言 active 在前。该项不阻塞卡定义。

### P2-2 · 退出成员头像/昵称快照稳定性留观察

- **证据**：dispatch R1.x 明确 R1 不新增 migration，先 `JOIN users` 返回 nickname/avatar；已登记 `FU-221-MEMBER-SNAPSHOT-ON-LEFT`。
- **设计影响**：家庭页/明细页/统计页要求已退出成员灰化展示；若用户退出后改头像/昵称，JOIN 当前 users 会变化。
- **建议**：不阻塞 221。待 `COSTRA-223` 真实 UI 与 Human 体验后，若需要退出时快照，再补 migration。

---

## 8. INFO

### INFO-1 · OpenAPI ErrorCode enum 当前仍缺 `FAMILY_PERSONAL_NOT_DELETABLE`

dispatch 已将其列为 R1 必做与 DoD。实装时必须同步 `server/api/openapi.yaml`，否则 `COSTRA-161` guardrail 会继续捕获漂移。

### INFO-2 · `GET /families/{id}/members` 是新增 path

当前 OpenAPI 尚无该 path；dispatch 已明确要求新增，且该 path 是设计落地家庭页成员区的关键基础。

### INFO-3 · 221 不承接财务聚合是正确边界

家庭页公共/个人支出、垫付贡献、分类排行、统计页成员报表均依赖 `COSTRA-222`，不应塞入 221。

---

## 9. D-025 反模式扫描

| ID | 反模式 | 结论 | 说明 |
|---|---|---|---|
| AP-001 | 字符串代理判定 | 未命中 | `kind` 使用 enum；错误码走枚举；`details.rule` 仅作细分业务规则。 |
| AP-002 | 概率极低就接受 | 未命中 | 成员上限、invite 过期/已使用、owner 移出自己均有明确规则与测试。 |
| AP-003 | 契约-实装漂移 | 命中但本卡闭合 | 本卡目标就是闭合 `/families*` drift；R1.x 已要求 PATCH/DELETE 必做，不再 x-deferred。 |
| AP-004-X | 红字反模式 | 未命中 | 无 secret/主体硬编码；无错误响应直出要求。 |

---

## 10. 结论与下一步

`COSTRA-221` R2 卡定义审查结论：

```text
PASS-WITH-FOLLOWUP 29/30
0 P0 / 0 P1 / 2 P2 / 3 INFO
```

可进入下一阶段：

1. Human 触发 `start:COSTRA-221`。
2. `costra-backend-dev` 按 dispatch R1.x 实装。
3. 实装完成后自动拉起 `review-tech:COSTRA-221`。
4. 221 闭环后再进入 `plan-dispatch:COSTRA-222`。

**约束**：虽然 R2 已通过，但仍必须由 Human 明确触发 `start:COSTRA-221`，Orchestrator 不得直接启动开发。
