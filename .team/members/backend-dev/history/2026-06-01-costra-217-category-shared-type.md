# COSTRA-217 R1.x 收尾 · 清理 + 补齐 + 修复

> 卡号：COSTRA-217 · Owner：backend-dev · 日期：2026-06-01
> 事实源：Orchestrator cleanup 派单

---

## §1 任务摘要

上一轮 R1 实装未返回 final，遗留 5 个临时调试测试文件 + 3 项 P1 未补齐（docs/db/schema.md、api/CHANGELOG.md、shared_type 默认规则确认）。本轮完成清理和补齐。

## §2 产出文件清单

### 删除文件
| 文件 | 说明 |
|---|---|
| `server/test/debug-sync.test.ts` | 临时调试文件（非交付产物） |
| `server/test/debug-sync2.test.ts` | 临时调试文件（非交付产物） |
| `server/test/debug-sync3.test.ts` | 临时调试文件（非交付产物） |
| `server/test/debug-sync4.test.ts` | 临时调试文件（非交付产物） |
| `server/test/debug-sync5.test.ts` | 临时调试文件（非交付产物） |

### 新增文件
| 文件 | 说明 |
|---|---|
| `api/CHANGELOG.md` | API 变更日志（记录 v0.3~v0.9 所有 API 变更 · 含 COSTRA-217 shared_type + categories 层级） |

### 修改文件
| 文件 | 变更说明 |
|---|---|
| `docs/db/schema.md` | 升级到 v1.2：categories 表加 color/is_direct_default 列 + 更新索引说明 + 约束说明 · entries 表加 shared_type 列 + CHECK 约束 + 索引 + 默认规则 · 预置数据章节升级为二级分类体系 · 迁移表补充 0008/0009 |
| `server/test/sync.test.ts` | 修复 pg-mem ON CONFLICT DO NOTHING bug：去掉 INSERT 语句的 ON CONFLICT DO NOTHING（pg-mem 在某些场景下静默吞掉 INSERT 不报错） |
| `server/test/entries.test.ts` | 同上修复 |
| `server/test/entries-patch.test.ts` | 同上修复 |
| `server/test/entries-delete.test.ts` | 同上修复 |
| `server/test/sync-pull.test.ts` | 同上修复 |

## §3 验证结果

| 验证项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过（0 错误） |
| `npm run test` | ✅ 100/100 通过（11 文件 · 0 失败） |

## §4 关键发现

1. **pg-mem `ON CONFLICT DO NOTHING` bug**：pg-mem 在某些场景下（特别是通过 Pool 适配器执行参数化 INSERT 时），`ON CONFLICT DO NOTHING` 会静默跳过 INSERT 操作，不报错但也不插入行。这导致 `resolveDefaultSharedType` 查不到 family，expense entry 创建返回 rejected。修复方案：测试中改用不带 `ON CONFLICT` 的 INSERT（因为 `resetPgMem` 在 `beforeEach` 中清空了所有数据，不会有冲突）。
2. **shared_type 默认规则已实装**：上一轮 history §5 P1-4 标记"未实现"，但实际代码中 `entryService.resolveDefaultSharedType` 已完整实现（通过 ledger→family kind 判定），只是测试因 pg-mem bug 无法验证。修复 pg-mem bug 后测试全绿，确认规则正确工作。

## §5 遗留问题

### P0（阻塞）
- 无

### P1（需跟进）
1. **系统分类 seed 数量硬断言**：dispatch DoD-2 要求 11 一级/62 二级/73 总计/55 is_direct_default=true，这些断言需在真实 PG 环境验证（pg-mem 不执行 0008 seed）
2. **Category API 路由**：当前未实现 GET /categories 返回 parent_id/is_direct_default/children_count 的查询逻辑（B3 范围），本卡只完成数据层铺垫

### P2（建议）
1. **pg-mem gen_random_uuid() 不支持**：测试文件中所有 UUID 改为 JS randomUUID() 参数化传入
2. **0008 migration 幂等性**：ON CONFLICT DO NOTHING 策略依赖唯一索引，重跑时 7b 临时重命名步骤可能跳过
