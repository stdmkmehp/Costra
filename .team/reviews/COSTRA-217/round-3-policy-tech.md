# Tech Review · COSTRA-217 · Round 3 · Policy-focused

- 被审 Agent：backend
- 本轮产出 commit：未提交（工作区 dirty · 等 Human 明确提交指令）
- 审核时间：2026-06-08T19:00:00+08:00
- 上轮结论：PASS · 33/35 · 0 P0 / 0 P1 / 2 P2
- 本轮性质：Human 新准则复审：开发阶段不考虑历史兼容，DB 按清空重建维护

## 总评

- **Verdict**：`REVISE`
- **总分**：27/35 分
- **阻塞点**：2 个 P0 / 2 个 P1 / 3 个 P2

## 核心判断

Human 明确：Costra 当前处于开发阶段，未对外上线；测试阶段会清理 DB、重建表格。因此当前阶段不需要考虑历史负担/旧版本兼容。DB migration/schema/seed 不应为了兼容旧数据而引入冗余复杂逻辑，应按 clean rebuild 思路维护。

基于此准则，当前 `0008` migration 中存在大量旧分类 ID 保留兼容逻辑，应删除并简化为 clean rebuild。

## P0 阻塞点

### P0-1 `0008` migration 旧分类 ID 保留策略应删除，改为 clean rebuild

- **证据**：`server/db/migrations/0008_categories_hierarchy_seed.sql:14-48, 127-281`
- **问题**：`7b~7d` 是保留旧 12 条分类 ID、避免破坏已有 `entries.category_id` 的兼容策略。新准则下没有需要保护的旧 entry 数据，应删除临时重命名、中断态恢复、旧 ID 保留逻辑。
- **建议**：`DELETE FROM categories WHERE is_system = true AND family_id IS NULL;` 后全量插入 11 个一级 + 62 个二级分类。

### P0-2 dispatch 中旧 ID 保留要求需更新

- **证据**：`.team/dispatch/COSTRA-217-backend-category-hierarchy-shared-type.md` §2.A.4 / §2.E.2 / §4.DoD-3
- **问题**：派单仍要求“保留旧 ID”“已有 entry 外键不失效”，与新准则冲突。
- **建议**：Orchestrator 先修订 dispatch 为 clean rebuild 语义，再派 backend-dev 重构。

## P1 应改

1. `0002_seed_system_categories.sql` 仍会先插入旧 12 条扁平分类；建议在 `0008` 开头清空旧系统分类，使 `0002` 无害化。
2. `docs/db/schema.md` 中“旧 12 条 ID 保留迁移”描述需改为 clean rebuild。

## P2 建议

1. `0008` 删除兼容逻辑后预计可从 433 行降至约 250 行。
2. 测试应增加 clean rebuild 后 seed 数据完整性断言。
3. `entries.test.ts:36` pre-existing `console.error` 后续顺手清理。

## 回执指令

先由 Orchestrator 更新 dispatch，再派 `backend-dev`：

1. 重写 `server/db/migrations/0008_categories_hierarchy_seed.sql`：删除旧 ID 保留、中断态恢复、`__migrate__*` 临时重命名逻辑；改为清空旧系统分类 + 全量插入新 seed。
2. 更新 `docs/db/schema.md`：删除“旧 12 条 ID 保留迁移”表述，改为 clean rebuild。
3. 更新测试：删除旧 ID 保留/旧 entry category_id 兼容断言，验证 73 条 seed / 55 条 direct default。
4. `0009` / OpenAPI / service / repo 中 shared_type 实现无需因本准则调整。

## 自我反思

- 审核耗时：约 45 分钟
- 置信度：高
