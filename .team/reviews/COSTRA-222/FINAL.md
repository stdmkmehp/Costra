# COSTRA-222 · FINAL（Human T1 APPROVED CLOSED）

> **卡号**：COSTRA-222（Sprint-4 · Family Summary API）  
> **标题**：家庭财务聚合 API（公共/个人/成员/垫付贡献）  
> **裁决**：✅ **APPROVED CLOSED**（Human `approve:COSTRA-222` · 2026-06-02）  
> **收口依据**：review-tech R1 `PASS 33/35` · 0 P0 / 0 P1 · server typecheck ✅ · server tests 141/141 ✅  
> **派单档**：`.team/dispatch/COSTRA-222-backend-family-summary-api.md`  
> **技术审查**：`.team/reviews/COSTRA-222/round-1-tech.md`  
> **实现提交**：`6bf431b feat(backend): implement family summary API`

---

## §1 终审结论

| 项 | 值 |
|---|---|
| **terminal_verdict** | `APPROVED` |
| **review_tier** | T1 |
| **final_decision_at** | `2026-06-02T16:14:00+08:00` |
| **final_decision_path** | `approve:COSTRA-222` |
| **latest_review_tech** | `.team/reviews/COSTRA-222/round-1-tech.md` |
| **latest_review_tech_verdict** | `PASS` |
| **latest_review_tech_score** | `33/35` |
| **blocking_findings** | 0 P0 / 0 P1 |
| **residual_findings** | 2 P2 |
| **implementation_commit** | `6bf431b` |

结论：`COSTRA-222` 已满足 Human T1 终审关闭条件。Family Summary API 已实现并通过技术审查，可作为 Sprint-4 Family Foundation 的财务聚合基线能力进入后续 `COSTRA-223` 家庭页正式接入。

---

## §2 Review 链路

| 阶段 | 文件 | Verdict / 结果 | 备注 |
|---|---|---|---|
| Card-Review R1 | `.team/reviews/COSTRA-222/card-review-round-1-tech.md` | PASS-WITH-FOLLOWUP 27/30 | 0 P0 / 0 P1 / 4 P2 |
| R1 实装历史 | `.team/members/backend-dev/history/2026-06-02-costra-222-family-summary-api.md` | 完成 | Family Summary API + 17 测 |
| Review-Tech R1 | `.team/reviews/COSTRA-222/round-1-tech.md` | **PASS 33/35** | 0 P0 / 0 P1 / 2 P2 |
| Human T1 | 本文件 | **APPROVED CLOSED** | `approve:COSTRA-222` |

---

## §3 验证证据

已通过：

```text
cd server && npm run typecheck
cd server && npm test -- --run test/family-summary.test.ts test/family-summary-advanced.test.ts   # 17/17
cd server && npm test -- --run                                                                  # 141/141
```

---

## §4 进入基线的能力

`COSTRA-222` 本次进入基线的后端能力：

```text
GET /v1/families/{family_id}/summary?month=YYYY-MM&top_n=N
```

进入基线的聚合口径：

- 固定时区：`Asia/Shanghai`，按 `[month_start, next_month_start)` 转 UTC 查询；
- 金额全程 integer cents；
- `shared_type='shared'` expense → 公共支出、公共分类排行、垫付贡献；
- `shared_type='personal'` expense → 成员个人支出、成员个人分类排行；
- income → 只进入 `totals.income` 与 `balance`；
- transfer → 不进入 expense/income/balance/entry_count；
- `shared_type IS NULL` expense → 不进入聚合，计入 `skipped_unclassified_expense_count`；
- left member → 保留历史贡献，status=`left`；
- category rank → top_n、parent category、零值排除、amount DESC；
- member 级计数字段使用 `expense_count`，避免与 totals.entry_count 混淆。

---

## §5 residual follow-up

| FU ID | 来源 | 严重度 | 状态 | 建议处置 |
|---|---|---|---|---|
| `FU-222-REPO-CATEGORY-MAPS-DRY` | review-tech R1 P2 | P2 | open | `familySummaryRepo.ts` 中 category map 构建逻辑可抽私有 helper。 |
| `FU-222-ZERO-PAID-CONTRIBUTION-DISPLAY` | review-tech R1 P2 | P2 | open-observation | `paid_contributions` 当前包含 0 贡献成员，待 `COSTRA-223` 家庭页接入时确认展示策略。 |
| `FU-222-USER-TIMEZONE` | dispatch §7 | P2 | open | R1 固定 Asia/Shanghai，未来用户 timezone 字段落地后切换为用户时区。 |
| `FU-222-SUMMARY-PERF-INDEX` | dispatch §7 | P2 | open-observation | 单月 entries 超过 5000 或 P95 退化时评估复合索引。 |

上述 P2 不阻塞 `COSTRA-222` 关闭，也不阻塞 `COSTRA-223` 派单。

---

## §6 后续影响

`COSTRA-222` 关闭后，后续路线：

1. `plan-dispatch:COSTRA-223` —— 家庭页正式实现 / API 接入；
2. `card-review:COSTRA-223`；
3. Human 再触发 `start:COSTRA-223`。

`COSTRA-223` 应使用 `COSTRA-221` family management API + `COSTRA-222` family summary API，不应再使用 prototype/fallback/mock 数据冒充完成。

---

## §7 收口裁决

```text
terminal_verdict = APPROVED
review_tier = T1
human_final_decision = approve
ai_review = PASS 33/35
p0 = 0
p1 = 0
status = CLOSED
implementation_commit = 6bf431b
```

---

**FINAL 完成 · Orchestrator · 2026-06-02**
