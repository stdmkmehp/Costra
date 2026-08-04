# Spike · pg-mem 对 SMALLINT[] / INTEGER[] + cardinality CHECK 支持验证

- 卡号占位：COSTRA-5xx（T2 D1 上午 · Sprint-4 · Epic-E）
- 日期：2026-07-21
- 目的：验证 tech-spec §4.5 中列出的 pg-mem 短板清单，确定测试环境 DDL 的适配方案
- 脚本：`server/test/spike-pgmem-arrays.ts`（跑法：`cd server && npx tsx test/spike-pgmem-arrays.ts`）

## 结论一览

| # | 特性 | pg-mem 结果 | 应对 |
|---|---|---|---|
| 1 | `SMALLINT[]` 列 INSERT/SELECT | ✅ 完美支持 | 测试 DDL 保持 `SMALLINT[]` 类型不变 |
| 2 | `INTEGER[]` 列 INSERT/SELECT | ✅ 完美支持 | 测试 DDL 保持 `INTEGER[]` 类型不变 |
| 3 | `cardinality(arr)` 函数 | ❌ 不支持 | 测试 DDL **跳过 cardinality CHECK**，交由 service 层校验；生产 PG 兜底 |
| 4 | `CHECK (cardinality(arr) BETWEEN X AND Y)` | ❌ 建表即报错 | 同 3 |
| 5 | `TEXT + CHECK (col IN (...))` 替代 ENUM | ✅ CHECK 生效 | 测试 DDL 用 TEXT 替代 `recurring_period` / `recurring_bucket` / `recurring_status` 三个 ENUM |
| 6 | `pg_try_advisory_lock()` | ❌ 不支持（预期） | scheduler `tickOnce` 里 `if (isTestEnv) skip lock`；或直接 mock 函数返 true |
| 7 | `unnest(arr)` | ❌ 不支持 | 应用层用 JS Array 处理，不下推到 SQL |

## 具体输出（脚本运行结果）

```
1_smallint_array_insert_select      : OK: got [1,3,5]
2_integer_array_insert_select       : OK: got [101,214,1225]
3_cardinality_function              : FAIL: function cardinality(integer[]) does not exist
4_check_cardinality                 : FAIL creating table (cardinality unsupported)
5_text_check_enum                   : OK: illegal value rejected
6_advisory_lock                     : EXPECTED_FAIL: pg_try_advisory_lock(integer) does not exist
7_unnest                            : FAIL: unnest is not supported
```

## 影响 T2 的实施决策

### migration `0011_recurring_entries.sql`（生产）
- 保留完整 ENUM `recurring_period / recurring_bucket / recurring_status`
- 保留 `CHECK (cardinality(days_of_week) BETWEEN 1 AND 7)` 等长度约束
- 保留 `chk_recurring_period_fields` 复合 CHECK
- 保留 `pg_try_advisory_lock` 调用

### `server/test/setup.ts`（pg-mem 简化）
- 三个 ENUM → `TEXT + CHECK (col IN (...))`
- 数组列的长度 CHECK → **省略**（service 层已有 `validateCreate` 做长度校验，是权威事实源）
- 复合 CHECK `chk_recurring_period_fields` → **省略**（service 层 `validateCreate` 兜底）
- 元素范围 CHECK（如 dom ∈ [1,31]）→ **省略**（service 层校验）
- Advisory lock：scheduler 检测到 `NODE_ENV === 'test'` 时跳过 lock 调用，直接进入 tick 主体

### scheduler 单测策略
- **不启动 setInterval**（`NODE_ENV === 'test'` 时静默不启动）
- 暴露 `scheduler.tickOnce(mockNow)` 让测试代码显式驱动
- Advisory lock 走 mock 分支（永远 return true）

### 与项目现有兜底策略一致（MEMORY.md）
本方案与项目已有的两条硬约定完全对齐：
1. 迁移双写：`server/db/migrations/*.sql` + `server/test/setup.ts` DDL 同步
2. pg-mem 兼容：不支持的能力（ENUM / partial CHECK / trigger）用 TEXT + CHECK / 应用层校验 / 显式代码替代

## 未列入本 spike 的短板

- **`FOR UPDATE SKIP LOCKED`**：需要在 T2 集成测试时验证；若 pg-mem 不支持 SKIP LOCKED 关键字，scheduler 测试用普通 `FOR UPDATE`（本期单实例调度，等价）
- **`ORDER BY next_run_at ... LIMIT`**：应支持（基础排序）
- **partial index `WHERE status = 'active'`**：项目已知 pg-mem 对 `WHERE col = 'literal'` 谓词的 partial index 有边界 bug，本卡的 next_run_at 索引 partial WHERE 也要 spike 一次（列在 T2 集成测试首日）

## 保留：`server/test/spike-pgmem-arrays.ts`

Spike 脚本保留在仓库，未来若升级 pg-mem 版本，可重跑一次快速回归。
