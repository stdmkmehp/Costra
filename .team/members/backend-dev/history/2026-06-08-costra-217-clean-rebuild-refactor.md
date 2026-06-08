# COSTRA-217 R1.x Clean Rebuild 重构

> 卡号：COSTRA-217 · 日期：2026-06-08 · Owner：backend-dev
> 触发：Human 新准则（开发期 DB clean rebuild，不兼容旧数据）+ Round-3 policy review REVISE

---

## 1. 任务摘要

按 Human 2026-06-01 新准则和 Round-3 policy review 的 2 个 P0 / 2 个 P1，重写 `0008_categories_hierarchy_seed.sql` 为 clean rebuild 策略，删除所有旧分类 ID 保留兼容逻辑。

## 2. 变更清单

| # | 文件 | 变更 |
|---|---|---|
| 1 | `server/db/migrations/0008_categories_hierarchy_seed.sql` | **重写**：删除旧 ID 保留策略（7b~7d `__migrate__*` 临时重命名 + 中断态恢复 + 旧 entry 外键兼容）→ 改为 `DELETE FROM categories WHERE is_system = true AND family_id IS NULL` + 全量 INSERT 11 一级 + 62 二级分类。433 行 → ~250 行 |
| 2 | `docs/db/schema.md` | §4.1 "旧预置分类"改为"已被 0008 清空"；§4.2 删除"旧 12 条 ID 保留迁移"改为"clean rebuild"；迁移表 0008 描述同步 |
| 3 | `server/test/entries.test.ts` | 删除 pre-existing `console.error`（Round-2 P2-1 遗留） |

## 3. 删除的兼容逻辑

1. **旧 12 条分类 ID 保留策略**（原 7b~7d）：`__migrate__*` 临时重命名 → 同名一级插入 → 恢复原名 + 设 parent_id。全部删除。
2. **中断态风险注释**（原头部 40~48 行）：7b~7d 中断态人工恢复步骤。全部删除。
3. **ON CONFLICT DO NOTHING 幂等策略**：改为 DELETE + INSERT，更简洁且语义明确。
4. **旧 entry 外键兼容假设**：不再假设存在引用旧 category_id 的 entries。

## 4. 验证结果

- `cd server && npm run typecheck` ✅
- `cd server && npm run test` ✅ 100/100 测全绿
- 分类数量验证：11 一级 + 62 二级 = 73 条 ✅
- is_direct_default=true 数量：44 支出 + 11 收入 = 55 条 ✅
- 0009 / OpenAPI / service / repo 中 shared_type 实现无兼容冗余，未改动 ✅

## 5. 遗留

- P0：无
- P1：无
- P2：
  1. pg-mem 不执行 0008 migration seed，73 条 / 55 条硬断言需真实 PG 集成测试验证（与 R1 相同 · 非 clean rebuild 引入）
  2. `0002_seed_system_categories.sql` 仍会先插入旧 12 条扁平分类，但被 0008 DELETE 清空使其无害化。若未来要彻底清理 0002，可单独处理。
