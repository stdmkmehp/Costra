# COSTRA-302 · 协作页家庭汇总三级下钻

## 1. 变更摘要

新增 `GET /v1/families/{family_id}/summary/drill-down` 接口，从 family summary 的 L1 一级分类排行下钻到流水明细。

## 2. 新增/修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/api/openapi.yaml` | 修改 | 新增 path + SummaryDrillDownResponse/SummaryDrillDownEntryItem schema |
| `api/CHANGELOG.md` | 修改 | 新增 v0.11.0 条目 |
| `server/src/repositories/familySummaryRepo.ts` | 修改 | 新增 `listEntriesByL1Category()` 两段式查询 + 类型 |
| `server/src/services/familySummaryService.ts` | 修改 | 新增 `getSummaryDrillDown()` + `SummaryDrillDownResponse` 类型 |
| `server/src/routes/families.ts` | 修改 | 新增路由 + summaryDrillDownQuerySchema |
| `server/test/summary-drill-down.test.ts` | 新增 | T-302-A1~A11 共 11 条测试 |

## 3. 技术要点

- **两段式查询**（pg-mem 兼容）：第一段查 categories (id=$l1 OR parent_id=$l1)，第二段用 IN(...) 查 entries
- **口径对齐**：公共 = `shared_type='shared'`；个人 = `shared_type='personal' AND created_by=userId` — 与 familySummaryRepo getCategoryRanksUntrimmed 完全一致
- **越权守门**：`familyService.assertActiveMember(caller)` + `familyMemberRepo.isMemberIncludingLeft(targetUserId)` 双层防护
- **l1_amount** = SUM(amount) 同条件不分页，通过 count 查询一次性求得
- **has_more** = `items.length < totalCount`

## 4. 测试结果

- typecheck: ✅
- test: 19 files · **212 passed** · 0 failed

## 5. 遗留 / 后续

- 无 P0/P1 遗留
- P2: 如后续需要 offset 分页（前端翻页），repo 可扩展 offset 参数
