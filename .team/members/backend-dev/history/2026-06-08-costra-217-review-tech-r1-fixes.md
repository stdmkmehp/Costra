# COSTRA-217 R1.x review-tech Round-1 fixes

> 卡号：COSTRA-217 · 角色：backend-dev · 日期：2026-06-08
> 触发：Orchestrator 派单 · review-tech Round-1 PASS-WITH-FOLLOWUP 29/35

---

## 1 任务摘要

修复 `.team/reviews/COSTRA-217/round-1-tech.md` 中 P1-1/P1-2，顺手处理 P2-2/P2-3。禁止 git add/commit/push/reset/clean。

## 2 修改清单

| # | 级别 | 文件 | 改动 |
|---|---|---|---|
| P1-1 | P1 | `server/src/services/entryService.ts` | `updateWithVersion` 增加 shared_type 对非 expense 的服务层校验：当 `payload.shared_type !== undefined && existing.type !== 'expense'` 时返回 `{ status: 'rejected', error: { code: 'BUSINESS_RULE_VIOLATION', message: 'shared_type is only allowed for expense entries' } }`，不再依赖 DB CHECK 拦截（dispatch §2.B.5 硬约束） |
| P1-2 | P1 | `server/db/migrations/0008_categories_hierarchy_seed.sql` | 头部注释补充 7b~7d 中断态风险说明 + 5 步人工恢复方式 |
| P2-2 | P2 | `server/src/routes/sync.ts` | sync/push payload schema 显式声明 `shared_type: { type: ['string', 'null'], enum: ['personal', 'shared', null] }` |
| P2-3 | P2 | `server/test/sync.test.ts` | 移除 T3 的 `console.log('[T3] ...')` 残留（含 eslint-disable 注释） |

## 3 验证结果

- `npm run typecheck` ✅（0 error）
- `npm run test` ✅（100/100 全绿 · 11 test files · 0 failure）

## 4 未处理 / 不回退

- **P1-3** design/ 目录非本卡变更 → 禁写 · 标记为 pre-existing working tree noise
- **P2-1** 系统分类 seed 数量硬断言未在 pg-mem 验证 → 需真实 PG 或 SQL 验证脚本（后续卡）
- **P2-4** 文娱二级分类 sort_order 跳号建议补注释 → 低优先级

## 5 遗留

- P0：0
- P1：0（P1-1/P1-2 已修 · P1-3 不回退）
- P2：2（P2-1 seed 数量验证 · P2-4 sort_order 跳号注释）→ 均为建议级 · 不阻塞
