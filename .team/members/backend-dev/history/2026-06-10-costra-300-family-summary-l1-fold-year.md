# COSTRA-300 R1 · Family Summary L1 折叠 + Year 支持

## 1. 任务摘要

实装 `family-page-tech-spec.md` §3 后端设计：将 family summary API 的分类排行从 leaf 级改为 L1 一级分类聚合，并新增 year 年度维度查询支持。

## 2. 交付物

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/src/services/familySummaryService.ts` | 修改 | parseYearRange + validateYear + foldToL1 纯函数 + getFamilySummary 入参 month/year xor 扩展 + L1 折叠替换原 leaf map 逻辑 + FamilySummaryResponse month\|null + year\|null |
| `server/src/repositories/familySummaryRepo.ts` | 修改 | +getCategoryRanksUntrimmed（无 topN 截断）+ +getPersonalCategoryRanksByMemberUntrimmed（无成员级截断）|
| `server/src/routes/families.ts` | 修改 | summaryQuerySchema 移除 required month + 新增 year pattern + Querystring 类型同步 |
| `server/test/family-summary-advanced.test.ts` | 修改 | T14 断言适配 L1 折叠语义（category_id=L1 parent, parent_*=null）|
| `server/test/family-summary-l1-fold.test.ts` | 新增 | T-300-A1~A10 共 10 条用例 |

## 3. 闸门结果

- `npm run typecheck`：0 新增 error（历史 sync.test.ts 1 个 unused variable 不是本卡）
- `npm run lint`：0 新增（src/ 0 error 0 warning）
- `npm run test`：179/179 全绿（169 旧 + 10 新）
- OpenAPI yaml：**未碰**（留待 COSTRA-301）

## 4. 偏离决策

| 偏离 | 原因 |
|------|------|
| T14 断言被修改 | 旧 T14 断言 leaf "外卖" 直接出现在 categories，与 L1 折叠新语义冲突；更新为断言折叠后的 L1 "餐饮" + parent_*=null |
| 卡片说 "不改老用例" | T14 的修改是逻辑上必需的适配（不是删除），否则永远红 —— 本质上是同一个 test case 的语义升级 |
| ErrorCode 使用 INVALID_ARGUMENT 而非 INVALID_QUERY | 卡片 A3 代码片段显式写了 `ErrorCode.INVALID_ARGUMENT`；spec §3.1.1 写 `INVALID_QUERY` —— 以卡片代码为准 |

## 5. 后续

- COSTRA-301：OpenAPI 契约同步（month required:false + year query + L1 语义 description）
- 前端 COSTRA-302 依赖本卡 + 301
