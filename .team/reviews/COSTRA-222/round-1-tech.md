# Tech Review · COSTRA-222 · Round 1

- **触发**：`review-tech:COSTRA-222`
- **被审 Agent**：backend-dev
- **本轮产出 commit**：未提交（工作区 uncommitted changes，基于 `1b0dde0`）
- **审核时间**：2026-06-02T15:38:00+08:00
- **审查对象**：`COSTRA-222` R1 实装当前工作区
- **前置卡审**：`.team/reviews/COSTRA-222/card-review-round-1-tech.md` · `PASS-WITH-FOLLOWUP 27/30`

---

## 1. 总评

| 项 | 结论 |
|---|---|
| **Verdict** | `PASS` |
| **Score** | `33/35` |
| **P0** | 0 |
| **P1** | 0 |
| **P2** | 2 |
| **INFO** | 0 |
| **是否可进入 Human T1 review** | 是 |

结论：`COSTRA-222` R1 已完成 Family Summary API 实装，card-review R1 的 4 个 P2 已吸收，首轮 review-tech 发现的 2 个 P1 已修复。当前 typecheck 与 server 全量测试均通过，可进入 Human T1 review。

---

## 2. 验证结果

- `cd server && npm run typecheck` ✅
- `cd server && npm test -- --run test/family-summary.test.ts test/family-summary-advanced.test.ts` ✅ 17/17
- `cd server && npm test -- --run` ✅ 141/141

---

## 3. 维度评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| C1 契约一致性 | 5/5 | OpenAPI `FamilySummary` schema 与 route/service response 对齐。 |
| C2 架构与分层 | 4/5 | route/service/repo 三层清晰；repo 层 category map 构建存在重复逻辑。 |
| C3 数据与持久化 | 5/5 | 无新 migration；SQL 参数化；shared/personal/income/transfer/null 口径与 dispatch 对齐。 |
| C4 离线与同步 | 5/5 | Backend read-only summary API，离线同步 N/A。 |
| C5 安全与合规 | 5/5 | 无 sensitive log；无 openid/session_key/token 泄漏；无主体/AppID 硬编码。 |
| C6 可测与可观测 | 5/5 | 17 个 summary tests 覆盖 T1~T16 + T10.5，server 141/141 全绿。 |
| C7 工程纪律 | 4/5 | 文件均 ≤ 500 行；无 console.log/TODO/FIXME；存在 P2 DRY 改进空间。 |
| **总分** | **33/35** | **PASS** |

---

## 4. P0 阻塞点

无。

## 5. P1 应改

无。

首轮审查过程发现并已修复：

1. **N+1 查询风险**：`personal_by_member` 分类排行已从按 member 循环查询改为 `getPersonalCategoryRanksByMember` 批量查询。
2. **测试文件超 500 行**：原 `family-summary.test.ts` 已拆为：
   - `server/test/family-summary.test.ts`（413 行）
   - `server/test/family-summary-advanced.test.ts`（305 行）
   - `server/test/helpers/familySummary.ts`（112 行）

---

## 6. P2 建议

### P2-1 · `getCategoryRanks` 与 `getPersonalCategoryRanksByMember` 存在重复 category map 构建逻辑

- **证据**：`server/src/repositories/familySummaryRepo.ts` 两个方法均实现 categoryIds 去重、批量查 categories、构建 parentMap 的流程。
- **影响**：不影响功能；后续维护时可能重复修改。
- **建议**：抽取私有辅助函数，如 `buildCategoryMaps(...)`。
- **FU**：`FU-222-REPO-CATEGORY-MAPS-DRY`。

### P2-2 · `paid_contributions` 零贡献成员策略需后续产品确认

- **证据**：`familySummaryService.ts` 当前返回所有成员 paid contribution，包括 amount=0 的成员。
- **影响**：不影响 API 正确性；前端可按设计选择展示/隐藏。
- **建议**：`COSTRA-223` 家庭页接入时结合设计确认是否过滤 0 贡献成员。
- **FU**：`FU-222-ZERO-PAID-CONTRIBUTION-DISPLAY`。

---

## 7. 关键口径复核

- `shared_type='shared'` expense → `shared_expense` / `shared.categories` / `paid_contributions` ✅
- `shared_type='personal'` expense → `personal_expense` / `personal_by_member` ✅
- income → 只进入 `totals.income` 与 `balance` ✅
- transfer → 不进入 expense/income/balance/entry_count ✅
- `shared_type IS NULL` expense → 不进入聚合，计入 `skipped_unclassified_expense_count` ✅
- left member → 保留历史贡献，status=`left` ✅
- category rank → top_n、parent category、零值排除、amount DESC ✅
- Asia/Shanghai month boundary → `[start,end)` UTC 比较 ✅

---

## 8. 结论

```text
PASS
0 P0 / 0 P1 / 2 P2
```

建议下一步：Human T1 review / `approve:COSTRA-222`。
