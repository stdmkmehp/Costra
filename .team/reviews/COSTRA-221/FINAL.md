# COSTRA-221 · FINAL（Human T1 APPROVED CLOSED）

> **卡号**：COSTRA-221（Sprint-4 · Family Management API）  
> **标题**：家庭管理 API（family list / members / invite / accept / remove）  
> **裁决**：✅ **APPROVED CLOSED**（Human `approve:COSTRA-221` · 2026-06-02）  
> **收口依据**：review-tech R1 `PASS 31/35` · 0 P0 / 0 P1 · server typecheck ✅ · server tests 124/124 ✅  
> **派单档**：`.team/dispatch/COSTRA-221-backend-family-management-api.md`  
> **技术审查**：`.team/reviews/COSTRA-221/round-1-tech.md`

---

## §1 终审结论

| 项 | 值 |
|---|---|
| **terminal_verdict** | `APPROVED` |
| **review_tier** | T1 |
| **final_decision_at** | `2026-06-02T15:07:00+08:00` |
| **final_decision_path** | `approve:COSTRA-221` |
| **latest_review_tech** | `.team/reviews/COSTRA-221/round-1-tech.md` |
| **latest_review_tech_verdict** | `PASS` |
| **latest_review_tech_score** | `31/35` |
| **blocking_findings** | 0 P0 / 0 P1 |
| **residual_findings** | 2 P2 |

结论：`COSTRA-221` 已满足 Human T1 终审关闭条件。Family Management API 已实装并通过技术审查，可作为 Sprint-4 Family Foundation 的首个后端基线能力进入后续 `COSTRA-222`。

---

## §2 Review 链路

| 阶段 | 文件 | Verdict / 结果 | 备注 |
|---|---|---|---|
| Card-Review R1 | `.team/reviews/COSTRA-221/card-review-round-1-tech.md` | REVISE 22/30 | 3 P0 / 4 P1 / 3 P2 |
| Card-Review R2 | `.team/reviews/COSTRA-221/card-review-round-2-tech.md` | PASS-WITH-FOLLOWUP 29/30 | 0 P0 / 0 P1 |
| R1 实装历史 | `.team/members/backend-dev/history/2026-06-02-costra-221-family-mgmt.md` | 完成 | Family Management API 全端点 + T1~T16 |
| Review-Tech R1 | `.team/reviews/COSTRA-221/round-1-tech.md` | **PASS 31/35** | 0 P0 / 0 P1 / 2 P2 |
| Human T1 | 本文件 | **APPROVED CLOSED** | `approve:COSTRA-221` |

---

## §3 验证证据

已通过：

```text
cd server && npm run typecheck
cd server && npm test -- --run test/families.test.ts   # 16/16
cd server && npm test -- --run                         # 124/124
```

---

## §4 进入基线的能力

`COSTRA-221` 本次进入基线的后端能力：

- `GET /v1/families`
- `POST /v1/families`
- `GET /v1/families/{family_id}`
- `PATCH /v1/families/{family_id}`
- `DELETE /v1/families/{family_id}?version=N`
- `GET /v1/families/{family_id}/members`
- `POST /v1/families/{family_id}/invites`
- `POST /v1/families/invites/accept`
- `DELETE /v1/families/{family_id}/members/{user_id}`

已覆盖关键业务规则：

- personal family 不可邀请 / 不可删除；
- 非 member 访问 family 统一 403；
- owner 才能改名、删除、邀请、移除成员；
- invite TTL、重复接受、过期返回 410；
- active member 上限 10；
- left member 保留并排序；
- mutating endpoint 幂等处理；
- family version 乐观锁。

---

## §5 residual follow-up

| FU ID | 来源 | 严重度 | 状态 | 建议处置 |
|---|---|---|---|---|
| `FU-221-MEMBER-SNAPSHOT-ON-LEFT` | card-review R1 P2 | P2 | open-observation | 等 `COSTRA-223` 家庭页真实体验后判断是否补退出成员头像/昵称快照 migration。 |
| `FU-221-PATCH-VERSION-CONFLICT-TEST` | review-tech R1 P2 | P2 | open | 补 PATCH family 过期 version → 409 独立测试。 |
| `FU-221-FAMILY-SERVICE-SPLIT` | review-tech R1 P2 | P2 | open-observation | 后续 invite/member 逻辑增长时拆 `familyInviteService.ts`。 |

上述 P2 不阻塞 `COSTRA-221` 关闭，也不阻塞 `COSTRA-222` 派单。

---

## §6 后续影响

`COSTRA-221` 关闭后，后续路线：

1. `plan-dispatch:COSTRA-222` —— 家庭财务聚合 API；
2. `card-review:COSTRA-222`；
3. Human 再触发 `start:COSTRA-222`。

`COSTRA-223` 家庭页正式实现仍需等待 `COSTRA-222` 口径稳定，不应提前启动。

---

## §7 收口裁决

```text
terminal_verdict = APPROVED
review_tier = T1
human_final_decision = approve
ai_review = PASS 31/35
p0 = 0
p1 = 0
status = CLOSED
```

---

**FINAL 完成 · Orchestrator · 2026-06-02**
