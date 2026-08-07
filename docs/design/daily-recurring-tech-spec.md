# 定时记账「每 N 天」周期档位 · 技术设计文档

-卡号占位：COSTRA-5xx（Sprint-4 补丁 · Epic-E 定时记账 ·姊妹于 workday）
- 作者：MiniApp / Backend 联合起草
- 日期：2026-08-07
- 版本：v0.1（首版· 待评审）
- 姊妹文档：
  - `docs/design/recurring-entry-product-spec.md` v0.3.2（六→七档产品定义，本方案将改写 §4.1）
  - `docs/design/recurring-entry-tech-spec.md` v0.2.1（调度器/ 补齐 / bucket 分钟，本方案无需改动）
  - `docs/design/workday-recurring-tech-spec.md`（对偶方案，日历依赖 vs 纯算术）
- 事实源约束：迁移双写（`server/db/migrations/*.sql` + `server/test/setup.ts`内嵌 DDL）· `recurringSchedule.ts` / `recurringFormat.ts` 前后端 byte-level 同源 · CI parity 卡关

> ★ 合并说明（2026-08-07）：功能上线前，本文档原方案的"新增 migration 0013_recurring_daily.sql（两段式）"
> 已与 0011 `recurring_entries.sql`、0012 `workday_calendars.sql` 合并为单一 0011。
> 合并后 daily 与 workday 两档的 enum 值直接在 `CREATE TYPE recurring_period` 时一次性定义，
> `chk_recurring_period_fields` 在 `CREATE TABLE` 时一次性写定 5 分支版本，**不再需要两段式**。
> 本文以下 §3 "新增 migration 0013 / 两段式" 内容作为设计决策留痕保留，不反映最终 migration 落点。

---

## 0. 背景与目标

### 0.1 现状

定时记账当前支持 **4 档周期**：

| UI 面板选项 | DB 枚举 | 间隔 | days 数组要求 |
|---|---|---|---|
| 每 N 周 | `weekly` | `period_interval=N` | `days_of_week` 非空 |
| 每个工作日 | `workday` | 恒为 1 | 全为 NULL（依赖 `workday_calendars`） |
| 每 N 月 | `monthly` | `period_interval=N` | `days_of_month` 非空 |
| 每年 | `yearly` | 恒为 1 | `year_month_days` 非空 |

面板 UI 顺序当前为：每 N 周 → 每 N 月 → 每年 → 每个工作日。

### 0.2 问题

无法直接表达「每 N 天记一笔」这类**纯粹以自然日为节拍**的场景，例如：

- "每天早上定时记账10 元零食"
- "每 3 天扣一次社保"
- "每 10 天理疗一次"

现有档位无一能覆盖：
- **每 N 周不能替代**：`weekly + interval=1 + days_of_week=[1..7]`逻辑上"每天都触发"，但概念污染（用户在编辑页会看到 dow 多选控件，被迫勾满7 天），产品语义与用户心智不符。
- **每个工作日不能替代**：workday 依赖节假日日历，会跳过周末与法定节假日；用户想要的「每天」是无差别的自然日节拍。

### 0.3 目标

在既有周期档位基础上**新增第 5 档 `daily`（每 N 天）**，使能表达：

- "每天执行一次" = `daily + period_interval=1`
- "每 N 天执行一次" = `daily + period_interval=N`

从起始日 `start_date` 起算，`daysDiff % N === 0` 命中即触发。

### 0.4 面板 UI 顺序（用户强约束 · 本次一同调整）

选择面板从上到下重排为：

1. **每 N 天** ← 新增
2. 每个工作日
3. 每 N 周
4. 每 N 月
5. 每年

排序依据："从细粒度到粗粒度、算术档在前、日历档在后"，用户明确指定，不再走别的排序方案。

### 0.5 非目标

- 不引入新数据表、不新增字段列。
- 不做"每 N 天但跳过节假日"等混合语义（如需请另立方案）。
- 不给 `daily` 的 `period_interval` 增加 UI 硬上限；服务端仅保留 `>= 1` 校验，行为与 `weekly` / `monthly` 保持一致。
- 不追加订阅消息 / 待确认队列（继承 v0.2 定时记账非目标）。

---

## 1. 架构总览

```
┌───────────────────────────────────────────────────────────────┐
│  微信小程序   │
│                                                               │
│  components/recurring-period-selector/                │
│    · PeriodType 加'daily'                │
│    · wxml 5 个 .rps__item 按新顺序排布                        │
│    · 新增 dayInterval 输入框（对偶 weekInterval/monthInterval）│
│                                                               │
│  pages-recurring/edit/│
│    · computePeriodLabel/parsePeriodInterval 加 daily 分支     │
│    · _isFormComplete/_validate/_buildSavePayload 加 daily 分支│
│    · daily 时不渲染任何 days-picker（对偶 workday）           │
│                                                               │
│  pages-recurring/list/model.ts                                │
│    · buildPeriodLabel 加 daily · "每天" / "每3天"             │
│                                                               │
│  services/recurringApi.ts                                     │
│    · RecurringPeriod 联合类型加 'daily'                       │
│                                                               │
│  services/recurringSchedule.ts  ★ byte-level 同 server ★     │
│    · Period 加 'daily'                                        │
│    · tryMatchOnDay 加 case 'daily'                            │
│                                                               │
│  services/recurringFormat.ts   ★ byte-level 同 server ★      │
│    · Period 加 'daily'│
│    · formatDaysForSummary 加 case 'daily': return ''          │
└──────────────┬────────────────────────────────────────────────┘
               │ HTTPS · JWT · POST/PATCH /recurring-entries
┌──────────────▼────────────────────────────────────────────────┐
│  Fastify Server                                               │
│                                                               │
│  routes/recurring.ts                                          │
│    · createBodySchema / patchBodySchema period enum 加 daily  │
│                                                               │
│  services/recurringService.ts                                 │
│    · PERIODS 常量数组加 'daily'                │
│    · validateCreate 加 daily 分支                             │
│      · 三个 days 数组必须全NULL（对偶 workday）              │
│      · period_interval 允许 >= 1（与 weekly/monthly 一致）    │
│                                                               │
│  services/recurringSchedule.ts  ★ byte-level 同 miniprogram ★│
│    · tryMatchOnDay case 'daily'                               │
│      · daysDiff = cursor.startOf('day').diff(start.startOf('day'), 'days') │
│      · daysDiff >= 0 && daysDiff % interval === 0 → cursor    │
│                                                               │
│  services/recurringFormat.ts   ★ byte-level 同 miniprogram ★ │
│    · formatDaysForSummary case 'daily': return ''│
│                                                               │
│  repositories/recurringRepo.ts                                │
│    · Period 类型加 'daily'                                    │
└──────────────┬────────────────────────────────────────────────┘
               │
┌──────────────▼────────────────────────────────────────────────┐
│  PostgreSQL                                                   │
│                                                               │
│  migration 0013_recurring_daily.sql                           │
│    第一段（隐式提交）：ALTER TYPE recurring_period ADD VALUE  │
│                IF NOT EXISTS 'daily'│
│    第二段（独立事务）：DROP +重建 chk_recurring_period_fields│
│                        加入 daily 分支（三个 days 数组全 NULL）│
│                                                               │
│  test/setup.ts pg-mem DDL：                                   │
│    period TEXT NOT NULL CHECK (period IN                │
│      ('weekly','monthly','yearly','workday','daily'))         │
└───────────────────────────────────────────────────────────────┘
```

**关键结论**：
1. **零新增表、零新增列**：完全复用 `recurring_period` ENUM + `period_interval` 列这一现有二元组，与 workday 完全对偶。
2. **算法极简**：`daily` 分支仅需3 行 Luxon 代码，无跨月/闰年 / 时区特例（时区已由 `cursor.startOf('day')` 兜住）。
3. **UI 侧改动集中**：主要在 `recurring-period-selector` 组件重排 + 加输入框，`edit/index` 页面加分支 boilerplate。

---

## 2. 语义定义

### 2.1 语义与幂等

- **`daily + period_interval=N`**：从 `start_date` 起算，本地时区（`rule.timezone`）下每 N 个自然日触发一次。
- **起点**：`start_date` 当日（若通过 §5.4 的"今天触发"判定）即触发第一次。
- **幂等键**：沿用 `entries` 表的 `client_ref_id = rec_<rule_id_short8>_<local_YYYY-MM-DD>`，无需改造。
- **N=1 特例**：语义上"每天"，无退化风险。
- **超大 N**（例如 N=365）：合法。`computeNextRunAt` 的 `MAX_COMPUTE_ITER=800` 循环上限仍足够（内层 `case 'daily'` 一次 `daysDiff` 判定即可命中或推进，实际不会撞上限）。

### 2.2 与 `weekly + interval=1 + days=[1..7]` 的差异

| 维度 | `daily + interval=1` | `weekly + interval=1 + days=[1..7]` |
|---|---|---|
| 数据模型 | 三 days 数组均 NULL | `days_of_week=[1,2,3,4,5,6,7]` |
| 编辑页控件 | 不渲染dow-picker | 渲染 dow-picker 且必须勾满7 天 |
| 预览摘要 | `每天` | `每周 每天` |
| 用户心智 | 无差别自然日节拍 | 一周中所有天 |
| 触发结果 | 完全相同 | 完全相同 |
| 结论 | **语义清晰，推荐** | 语义污染，不推荐 |

### 2.3 与 workday 的差异

| 维度 | `daily` | `workday` |
|---|---|---|
| 数据依赖 | 无（纯算术） | `workday_calendars` 表 + JSON 数据文件 |
| 跨年降级 | 无需（纯算术） | 缺失年份数据 → 降级周一~周五 |
| N 支持 | `period_interval` 允许 `>= 1` |恒为 1（`validateCreate` 强制） |
| 跳过节假日 | 否 | 是 |
|跳过周末 | 否 | 是 |
| 编辑页说明 | 可选加一条"每 N 天从起始日起算" | 已有 `.recedit__workday-hint` 说明节假日 |

---

## 3. 数据模型变更

### 3.1 新增 migration `0013_recurring_daily.sql`

**关键约束**：PostgreSQL 不允许在同一事务内 `ALTER TYPE ... ADD VALUE` 后立即在 CHECK 中使用该新值（会报 `unsafe use of new value`）。**必须两段式**，参照 0012 workday 的既有教训。

```sql
--============================================================================
-- Costra · Migration 0013 · Recurring Daily（每 N 天周期档位）
-- ============================================================================
--卡号占位：COSTRA-5xx（Sprint-4 补丁 · Epic-E）
-- 事实源：docs/design/daily-recurring-tech-spec.md §3
--
-- 主要变更：
--   1. `recurring_period` ENUM 增加第五档 `daily`（每 N 天）
--   2. 放宽 `recurring_rules.chk_recurring_period_fields`：允许 daily 时
--      三个 days 数组全为 NULL（与 workday 完全对偶）
--
-- ★硬约定：本 SQL 必须与 `server/test/setup.ts` 的简化 pg-mem DDL 同步
--
-- ★PostgreSQL enum 限制：`ALTER TYPE ... ADD VALUE` 后新值在同一事务内
--   不能被 CHECK 约束等表达式使用（会报 `unsafe use of new value`）。
--   参照 0012_workday_calendars.sql 的两段式做法。
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 第一段：加 enum 值（DDL 隐式提交，不包在 BEGIN/COMMIT 内）
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE recurring_period ADD VALUE IF NOT EXISTS 'daily';

-- ═══════════════════════════════════════════════════════════════════════════
-- 第二段：放宽 chk_recurring_period_fields（独立事务）
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE recurring_rules DROP CONSTRAINT chk_recurring_period_fields;

ALTER TABLE recurring_rules ADD CONSTRAINT chk_recurring_period_fields CHECK (
  (period = 'weekly'
     AND days_of_week    IS NOT NULL
     AND days_of_month   IS NULL
     AND year_month_days IS NULL) OR
  (period = 'monthly'
     AND days_of_month   IS NOT NULL
     AND days_of_week    IS NULL
     AND year_month_days IS NULL) OR
  (period = 'yearly'
     AND year_month_days IS NOT NULL
     AND days_of_week    IS NULL
     AND days_of_month   IS NULL) OR
  (period = 'workday'
     AND days_of_week    IS NULL
     AND days_of_month   IS NULL
     AND year_month_days IS NULL) OR
  (period = 'daily'
     AND days_of_week    IS NULL
     AND days_of_month   IS NULL
     AND year_month_days IS NULL)
);

COMMIT;
```

### 3.2 pg-mem 内嵌 DDL 同步（`server/test/setup.ts`）

在既有 `recurring_rules` 简化 DDL 中，`period` 列的 CHECK 增加 `'daily'`：

```diff
-      period          TEXT NOT NULL CHECK (period IN
-        ('weekly','monthly','yearly','workday')),
+      period          TEXT NOT NULL CHECK (period IN
+        ('weekly','monthly','yearly','workday','daily')),
```

pg-mem 已按 setup.ts 现有规范省略了 `chk_recurring_period_fields`（复杂 CHECK 由 service 层兜底），无需再改。

### 3.3 生产 PG 兼容性

- PG 15+ 全部支持 `ALTER TYPE ADD VALUE IF NOT EXISTS`。
- 无索引变化。
- 回滚：若极端情况需要撤销，`recurring_period` 枚举值无法直接删除（PG 限制），可通过重建类型方式，但本期不提供 `down` SQL，遵循项目"migration 单向前进"的既有约定。

---

## 4. `recurringSchedule.ts` 改动（前后端 byte-level 同源）

### 4.1 `Period` 类型

```diff
 export type Period =
   | 'weekly'
   | 'monthly'
   | 'yearly'
-  | 'workday';
+  | 'workday'
+  | 'daily';
```

### 4.2 `tryMatchOnDay` 新增 `case 'daily'`

```ts
case 'daily': {
  // 每 N 天：从 start_date 起算，daysDiff % interval === 0 时命中
  // 用 startOf('day') 消除时段偏移（cursor 已 set 到 execute_hour:execute_minute）
  const baseDay = DateTime.fromISO(rule.start_date, {
    zone: rule.timezone,
  }).startOf('day');
  const cursorDay = cursor.startOf('day');
  const daysDiff = Math.round(cursorDay.diff(baseDay, 'days').days);
  if (daysDiff < 0) return null;                    // 早于起始日
  if (daysDiff % interval !== 0) return null;       // 未到节拍
  return cursor;
}
```

**放置位置**：在 `case 'workday'` 之前或之后均可，建议按 UI 顺序放在 `case 'weekly'` 之前，与 `Period` 类型的可读顺序对齐。

### 4.3 双份同源约束

- 后端源：`server/src/services/recurringSchedule.ts`
- 前端源：`miniprogram/services/recurringSchedule.ts`
- 两份文件除第一行 `import` 外必须逐字节一致；`scripts/verify-recurring-schedule-parity.mjs` 会CI 卡关。
- 修改流程：先改 server 端，`cp` 覆盖 miniprogram 端（或反之），本地跑 `npm run parity` 验证。

---

## 5. `recurringFormat.ts` 改动（前后端 byte-level 同源）

### 5.1 `Period` 类型同步（同 §4.1）

### 5.2 `formatDaysForSummary` 新增 `case 'daily'`

```diff
 export function formatDaysForSummary(ctx: FormatContext): string {
   switch (ctx.period) {
     case 'weekly':
       return formatDow(ctx.days_of_week ?? [], ctx.mode);
     case 'monthly':
       return formatDom(ctx.days_of_month ?? [], ctx.mode);
     case 'yearly':
       return formatYearMonthDays(ctx.year_month_days ?? [], ctx.mode);
     case 'workday':
       return '每个工作日';
+    case 'daily':
+      // daily 无日子概念 · 语义已完全由 period 前缀（"每天" / "每 N 天"）表达
+      // 返回空串，让调用方 trim 后拼接不出现多余空格
+      return '';
   }
 }
```

### 5.3 为什么 daily 返回空串而 workday 返回完整字符串

历史原因：workday 只有一种表达（"每个工作日"），产品文案上不需要"每周"这样的前缀承载间隔信息，因此把完整语义塞在 `formatDaysForSummary`。daily 有 `period_interval` 承载 N，语义必须由前缀"每 N 天"表达，`formatDaysForSummary` 的日子部分本就为空。

调用方（`edit/index::_updatePreview` 与 `list/model::toDisplayRule`）已有 `${periodPrefix} ${daysDesc}`.trim() 逻辑，daily 返空串后自动收敛到"每 N 天"单个前缀。

---

## 6. `recurringService.ts` 改动（服务端校验）

### 6.1 `PERIODS` 常量数组

```diff
 const PERIODS: readonly Period[] = [
   'weekly',
   'monthly',
   'yearly',
   'workday',
+  'daily',
 ];
```

### 6.2 `validateCreate` 新增 daily 分支

```diff
   const isWorkday = p.period === 'workday';
+  const isDaily = p.period === 'daily';

   // ... 现有 weekly / monthly / yearly 分支不变 ...

   if (isWorkday) {
     if (p.days_of_week != null || p.days_of_month != null || p.year_month_days != null)
       invalid('days_of_week/days_of_month/year_month_days must be null for workday');
   }

+  if (isDaily) {
+    if (p.days_of_week != null || p.days_of_month != null || p.year_month_days != null)
+      invalid('days_of_week/days_of_month/year_month_days must be null for daily');
+  }
```

### 6.3 `period_interval` 校验梳理

现有 `period_interval` 校验分支：

```ts
if (p.period_interval !== undefined) {
  if (!Number.isInteger(p.period_interval) || p.period_interval < 1)
    invalid('period_interval must be a positive integer', 'period_interval');
  if (p.period === 'yearly' && p.period_interval > 1)
    invalid('period_interval > 1 is not supported for yearly', 'period_interval');
  if (p.period === 'workday' && p.period_interval > 1)
    invalid('period_interval > 1 is not supported for workday', 'period_interval');
}
```

**结论：无需改动**。daily 自动落入"任何 `>= 1` 的整数"通用校验，与 weekly / monthly 一致。

### 6.4 `create` / `update` / `copy` / `resume` 其它路径

- **create 起点计算**：`fromStart = DateTime.fromISO(payload.start_date, { zone: timezone }).startOf('day').minus({ minutes: 1 }).toJSDate()`，与 period 无关，daily 无需特殊处理。
- **"起始日是今天" bucket 窗口判定**：与 period 无关，daily 沿用现有逻辑。
- **end_date 收敛 / auto_paused / 补齐 loop**：与 period 无关，daily 沿用。
- **copy**：已复制 `period_interval`，无需改动。
- **resume 重算**：`toComputeShape(existing)` 与 period 无关，daily 沿用。

### 6.5 `toComputeShape`

无需改动：`workday_data` 依然注入，daily 分支不消费。

---

## 7. API 契约变更

### 7.1 `server/api/openapi.yaml`（3 处enum）

```diff
   RecurringRule:
     properties:
       period:
         type: string
-        enum: [weekly, monthly, yearly, workday]
-        description: "workday = 每个工作日（按法定节假日+调休补班判定）"
+        enum: [weekly, monthly, yearly, workday, daily]
+        description: |
+          workday = 每个工作日（按法定节假日+调休补班判定）
+          daily = 每 N 天（与 period_interval 组合，从 start_date 起算的纯算术节拍）

   RecurringRuleCreate:
     properties:
       period:
         type: string
-        enum: [weekly, monthly, yearly, workday]
+        enum: [weekly, monthly, yearly, workday, daily]

   RecurringRuleUpdate:
     properties:
       period:
         type: string
-        enum: [weekly, monthly, yearly, workday]
+        enum: [weekly, monthly, yearly, workday, daily]
```

### 7.2 `server/src/routes/recurring.ts`（Fastify schema · 2 处）

```diff
 const createBodySchema = {
   // ...
   properties: {
     // ...
     period: {
       type: 'string',
-      enum: ['weekly', 'monthly', 'yearly', 'workday'],
+      enum: ['weekly', 'monthly', 'yearly', 'workday', 'daily'],
     },
     period_interval: { type: 'integer', minimum: 1 },
     // ...
   },
 } as const;

 const patchBodySchema = {
   // ...
   properties: {
     // ...
     period: {
       type: 'string',
-      enum: ['weekly', 'monthly', 'yearly', 'workday'],
+      enum: ['weekly', 'monthly', 'yearly', 'workday', 'daily'],
     },
     // ...
   },
 } as const;
```

### 7.3 `miniprogram/services/recurringApi.ts`

```diff
 export type RecurringPeriod =
   | 'weekly'
   | 'monthly'
   | 'yearly'
-  | 'workday';
+  | 'workday'
+  | 'daily';
```

### 7.4 `server/src/repositories/recurringRepo.ts`

```diff
 export type Period =
   | 'weekly'
   | 'monthly'
-  | 'yearly';
+  | 'yearly'
+  | 'workday'
+  | 'daily';
```

>注：现网`recurringRepo.ts::Period` 应已在 workday 落地时补齐 `'workday'`，若尚未补齐，本次一并加上。

---

## 8. 客户端 UI 变更

### 8.1 `recurring-period-selector` 组件（★核心 UI 改动）

#### 8.1.1 `index.ts`

**类型与数据**：

```diff
-type PeriodType = 'weekly' | 'monthly' | 'yearly' | 'workday';
+type PeriodType = 'weekly' | 'monthly' | 'yearly' | 'workday' | 'daily';

 function parsePeriod(period: RecurringPeriod): { type: PeriodType; interval: number } {
   switch (period) {
+    case 'daily': return { type: 'daily', interval: 1 };
     case 'weekly': return { type: 'weekly', interval: 1 };
     case 'monthly': return { type: 'monthly', interval: 1 };
     case 'yearly': return { type: 'yearly', interval: 1 };
     case 'workday': return { type: 'workday', interval: 1 };
     default: return { type: 'weekly', interval: 1 };
   }
 }

 function composePeriod(type: PeriodType, _interval: number): RecurringPeriod {
+  if (type === 'daily') return 'daily';
   if (type === 'weekly') return 'weekly';
   if (type === 'monthly') return 'monthly';
   if (type === 'workday') return 'workday';
   return 'yearly';
 }
```

**data 新增**：

```diff
 data: {
   periodType: 'weekly' as PeriodType,
+  dayInterval: 1,
   weekInterval: 1,
   monthInterval: 1,
+  dayIntervalDisplay: '1',
   weekIntervalDisplay: '1',
   monthIntervalDisplay: '1',
 },
```

**`_syncFromProps` 同步逻辑**（对偶 weekInterval / monthInterval）：

```diff
 _syncFromProps() {
   const parsed = parsePeriod(this.properties.value as RecurringPeriod);
   const interval = (this.properties.periodInterval as number) || parsed.interval;

+  const dayInterval = parsed.type === 'daily' ? interval : (this.data.dayInterval || 1);
   const weekInterval = parsed.type === 'weekly' ? interval : (this.data.weekInterval || 1);
   const monthInterval = parsed.type === 'monthly' ? interval : (this.data.monthInterval || 1);

   this.setData({
     periodType: parsed.type,
+    dayInterval,
+    dayIntervalDisplay: String(dayInterval),
     weekInterval,
     weekIntervalDisplay: String(weekInterval),
     monthInterval,
     monthIntervalDisplay: String(monthInterval),
   });
 },
```

**新增两个 input handler**（对偶 `onWeekIntervalInput` / `Blur`）：

```ts
onDayIntervalInput(e: WechatMiniprogram.Input) {
  this.setData({ dayIntervalDisplay: e.detail.value });
},

onDayIntervalBlur(e: WechatMiniprogram.Input) {
  let val = parseInt(e.detail.value, 10);
  if (!val || val < 1) val = 1;
  this.setData({ dayInterval: val, dayIntervalDisplay: String(val) });
},
```

**`onConfirm` 提交逻辑**：

```diff
 onConfirm() {
   const periodType = this.data.periodType as PeriodType;
-  const interval = periodType === 'weekly'
-    ? this.data.weekInterval
-    : periodType === 'monthly'
-      ? this.data.monthInterval
-      : 1;
+  const interval = periodType === 'daily'
+    ? this.data.dayInterval
+    : periodType === 'weekly'
+      ? this.data.weekInterval
+      : periodType === 'monthly'
+        ? this.data.monthInterval
+        : 1;
   const period = composePeriod(periodType, interval);
   this.triggerEvent('change', { value: period, periodInterval: interval });
   this.triggerEvent('close');
 },
```

#### 8.1.2 `index.wxml`（★ 关键：5 个 item 按新顺序重排）

**用户强约束的最终顺序**：每 N 天 → 每个工作日 → 每 N 周 → 每 N 月 → 每年。

完整重写后 `.rps__sheet` 内的 5 个 item：

```wxml
<!-- 1. 每 N 天（新增） -->
<view class="rps__item {{periodType === 'daily' ? 'rps__item--active' : ''}}"
      data-type="daily" bindtap="onSelectType">
  <view class="rps__item-main">
    <text>每</text>
    <input class="rps__interval-input tnum {{periodType === 'daily' ? 'rps__interval-input--active' : 'rps__interval-input--muted'}}"
           type="number"
           value="{{dayIntervalDisplay}}"
           bindinput="onDayIntervalInput"
           bindblur="onDayIntervalBlur" />
    <text>天</text>
  </view>
  <text wx:if="{{periodType === 'daily'}}" class="rps__check">✓</text>
</view>

<!-- 2. 每个工作日（顺序前移） -->
<view class="rps__item {{periodType === 'workday' ? 'rps__item--active' : ''}}"
      data-type="workday" bindtap="onSelectType">
  <view class="rps__item-main">
    <text>每个工作日</text>
  </view>
  <text wx:if="{{periodType === 'workday'}}" class="rps__check">✓</text>
</view>

<!-- 3. 每 N 周 -->
<view class="rps__item {{periodType === 'weekly' ? 'rps__item--active' : ''}}"
      data-type="weekly" bindtap="onSelectType">
  <view class="rps__item-main">
    <text>每</text>
    <input class="rps__interval-input tnum {{periodType === 'weekly' ? 'rps__interval-input--active' : 'rps__interval-input--muted'}}"
           type="number"
           value="{{weekIntervalDisplay}}"
           bindinput="onWeekIntervalInput"
           bindblur="onWeekIntervalBlur" />
    <text>周</text>
  </view>
  <text wx:if="{{periodType === 'weekly'}}" class="rps__check">✓</text>
</view>

<!-- 4. 每 N 月 -->
<view class="rps__item {{periodType === 'monthly' ? 'rps__item--active' : ''}}"
      data-type="monthly" bindtap="onSelectType">
  <view class="rps__item-main">
    <text>每</text>
    <input class="rps__interval-input tnum {{periodType === 'monthly' ? 'rps__interval-input--active' : 'rps__interval-input--muted'}}"
           type="number"
           value="{{monthIntervalDisplay}}"
           bindinput="onMonthIntervalInput"
           bindblur="onMonthIntervalBlur" />
    <text>月</text>
  </view>
  <text wx:if="{{periodType === 'monthly'}}" class="rps__check">✓</text>
</view>

<!-- 5. 每年 -->
<view class="rps__item {{periodType === 'yearly' ? 'rps__item--active' : ''}}"
      data-type="yearly" bindtap="onSelectType">
  <view class="rps__item-main">
    <text>每年</text>
  </view>
  <text wx:if="{{periodType === 'yearly'}}" class="rps__check">✓</text>
</view>
```

#### 8.1.3 `index.wxss`

无新增样式，daily 输入框完全复用 `.rps__interval-input` / `.rps__interval-input--active` / `.rps__interval-input--muted` 三个类。

### 8.2 `pages-recurring/edit/index.ts`

#### 8.2.1 `computePeriodLabel`（用于卡片 2 周期行显示 & 卡片 3 预览主行）

```diff
 function computePeriodLabel(period: RecurringPeriod, interval: number): string {
   if (period === 'yearly') return '每年';
+  if (period === 'daily') {
+    if (interval === 1) return '每天';
+    return `每${interval}天`;
+  }
   if (period === 'weekly') {
     if (interval === 1) return '每周';
     return `每${interval}周`;
   }
   if (period === 'monthly') {
     if (interval === 1) return '每月';
     return `每${interval}月`;
   }
   if (period === 'workday') return '每个工作日';
   return '每周';
 }
```

#### 8.2.2 `parsePeriodInterval`

```diff
 function parsePeriodInterval(period: RecurringPeriod): number {
   switch (period) {
+    case 'daily': return 1;
     case 'weekly': return 1;
     case 'monthly': return 1;
     case 'yearly': return 1;
     case 'workday': return 1;
     default: return 1;
   }
 }
```

#### 8.2.3 `_isFormComplete`

```diff
 _isFormComplete(): boolean {
   if (this.data.amountCents<= 0) return false;
   const { period, daysOfWeek, daysOfMonth, yearMonthDays } = this.data;
   if (period === 'weekly' && daysOfWeek.length === 0) return false;
   if (period === 'monthly' && daysOfMonth.length === 0) return false;
   if (period === 'yearly' && yearMonthDays.length === 0) return false;
-  if (period === 'workday') return true;
+  if (period === 'workday') return true;
+  if (period === 'daily') return true;    // 无日子概念
   return true;
 },
```

#### 8.2.4 `_validate`

无需新增分支：现有代码只对 `weekly`/`monthly`/`yearly` 校验 days 数组非空，`daily` 自然落到 else 分支通过。为了可读性可以加一条注释：

```ts
// weekly / monthly / yearly 需要 days 数组；daily / workday 无日子校验
```

#### 8.2.5 `_buildSavePayload`

现有三行 `days_of_* = this.data.period === 'X' ? (...) : null` 已经保证非匹配 period 时数组为 null，daily 会自动落到 null 分支，**无需改动**。

#### 8.2.6 `_updatePreview`

```diff
   const daysDesc = formatDaysForSummary(ctx);
-  // workday 的 daysDesc 已是完整描述（"每个工作日"）· 前缀留空避免重复
-  const periodPrefix = period === 'workday' ? '' : periodLabel;
+  // workday 的 daysDesc 已是完整描述（"每个工作日"）· 前缀留空避免重复
+  // daily 的 daysDesc 为空 · 前缀由 computePeriodLabel 提供"每 N 天"
+  const periodPrefix = period === 'workday' ? '' : periodLabel;
   const parts = [`${periodPrefix} ${daysDesc}`.trim(), bucketLabel, ledgerName].filter(Boolean);
```

**注**：daily 走 `periodPrefix = periodLabel = '每 N 天'`，`daysDesc = ''`，`.trim()` 后 = `每 N 天`，无多余空格。逻辑天然正确，改动仅为加注释。

### 8.3 `pages-recurring/edit/index.wxml`

在既有 `<view wx:if="{{period === 'workday'}}" class="recedit__workday-hint">...</view>` 的**下方**追加一条 daily 的说明栏（对偶 workday，避免用户困惑）：

```wxml
<!-- 工作日说明（既有） -->
<view wx:if="{{period === 'workday'}}" class="recedit__workday-hint">
  依据国务院办公厅发布的节假日安排，自动跳过法定节假日及周末，包含调休补班日。
</view>

<!-- 每 N 天说明（新增） -->
<view wx:if="{{period === 'daily'}}" class="recedit__workday-hint">
  从起始日起算，每 {{periodInterval}} 天自动执行一次，不区分工作日与节假日。
</view>
```

**样式复用**：`.recedit__workday-hint` 已足够（灰绿色小字提示），无需新增 CSS 类。若要与 workday 视觉区分，可另加 `.recedit__daily-hint` 复用完全相同的样式，但本方案倾向保持简洁不新增类名。

### 8.4 `pages-recurring/edit/model.ts::shouldClearDaysOnPeriodChange`

对偶 workday 的既有分支：

```diff
 export function shouldClearDaysOnPeriodChange(
   oldPeriod: RecurringPeriod,
   newPeriod: RecurringPeriod,
 ): boolean {
   if (oldPeriod === newPeriod) return false;
   const oldInWeek = WEEK_GROUP.includes(oldPeriod);
   const newInWeek = WEEK_GROUP.includes(newPeriod);
   if (oldInWeek && newInWeek) return false;

   const oldInMonth = MONTH_GROUP.includes(oldPeriod);
   const newInMonth = MONTH_GROUP.includes(newPeriod);
   if (oldInMonth && newInMonth) return false;

-  // 切换进/出 workday → 跨组 · 清空已选日子（workday 本身无日子概念）
-  if (oldPeriod === 'workday' || newPeriod === 'workday') return true;
+  // 切换进/出 workday / daily → 跨组 · 清空已选日子（两档均无日子概念）
+  if (oldPeriod === 'workday' || newPeriod === 'workday') return true;
+  if (oldPeriod === 'daily' || newPeriod === 'daily') return true;

   return true;
 }
```

### 8.5 `pages-recurring/list/model.ts::buildPeriodLabel`

```diff
 export function buildPeriodLabel(period: RecurringPeriod, periodInterval?: number): string {
   const interval = periodInterval || 1;
   if (period === 'yearly') return '每年';
+  if (period === 'daily') {
+    return interval === 1 ? '每天' : `每${interval}天`;
+  }
   if (period === 'weekly') {
     return interval === 1 ? '每周' : `每${interval}周`;
   }
   if (period === 'monthly') {
     return interval === 1 ? '每月' : `每${interval}月`;
   }
   if (period === 'workday') return '每个工作日';
   return '';
 }
```

`toDisplayRule` 的 `periodPrefix` 逻辑无需改动：daily 时 `dayDesc = ''`，`${periodPrefix} ${dayDesc}`.trim() = `每 N 天`。

---

## 9. 测试策略

### 9.1 `server/test/recurringSchedule.test.ts` 新增 daily 组（约 12 例）

在既有 8 大组（weekly / biweekly / monthly / bimonthly / trimonthly / yearly / timezone / boundary）之后追加**第 9 组**，同时更新文件头 doc 注释的组数与总例数。

```ts
describe('computeNextRunAt · daily (12 cases)', () => {
  it('daily · interval=1 · from Sun before execute → today Sun', () => { /* ... */ });
  it('daily · interval=1 · from Sun after execute → next Mon', () => { /* ... */ });
  it('daily · interval=1 · from exact execute moment → strictly next day', () => { /* ... */ });
  it('daily · interval=3 · start=2026-01-01 · from 2026-01-01 after → 2026-01-04', () => { /* ... */ });
  it('daily · interval=3 · start=2026-01-01 · from 2026-01-03 → 2026-01-04', () => { /* ... */ });
  it('daily · interval=7 · start=2026-01-01 · cross-month → 2026-02-05', () => { /* ... */ });
  it('daily · interval=2 · cross-year 2026-12-31 → 2027-01-02', () => { /* ... */ });
  it('daily · interval=1 · start_date in future → first execution on start_date', () => { /* ... */ });
  it('daily · interval=30 · long interval sanity', () => { /* ... */ });
  it('daily · execute at 00:00 boundary', () => { /* ... */ });
  it('daily · timezone Asia/Shanghai (no DST) sanity', () => { /* ... */ });
  it('daily · timezone America/New_York DST forward day boundary', () => { /* ... */ });
});
```

**关键断言**：`daysDiff % interval === 0` 命中 + 严格 `next > from` + 时区偏移下 `startOf('day')` 正确对齐。

### 9.2 `server/test/recurring-entries.test.ts` 新增 E2E 用例（约 5 例）

```ts
describe('POST /recurring-entries · daily', () => {
  it('creates a daily rule with interval=1 and null days arrays', async () => { /* ... */ });
  it('creates a daily rule with interval=3', async () => { /* ... */ });
  it('rejects daily rule with days_of_week != null (400)', async () => { /* ... */ });
  it('rejects daily rule with days_of_month != null (400)', async () => { /* ... */ });
});

describe('PATCH /recurring-entries/:id · daily', () => {
  it('switches from weekly to daily · clears days_of_week', async () => { /* ... */ });
});
```

### 9.3 `miniprogram/pages-recurring/edit/model.spec.ts` 新增

```ts
describe('shouldClearDaysOnPeriodChange · daily', () => {
  it('weekly → daily = true', () => { /* ... */ });
  it('daily → daily = false', () => { /* ... */ });
  it('daily → workday = true', () => { /* ... */ });
  it('daily → monthly = true', () => { /* ... */ });
  it('daily → weekly = true', () => { /* ... */ });
});
```

### 9.4 `miniprogram/pages-recurring/list/model.spec.ts` 新增

```ts
describe('buildPeriodLabel · daily', () => {
  it('interval=1 → "每天"', () => { /* ... */ });
  it('interval=3 → "每3天"', () => { /* ... */ });
});
```

### 9.5 CI parity 卡关

- `scripts/verify-recurring-schedule-parity.mjs`：无需改动，byte-level sha256 校验自动生效。
- `scripts/verify-workday-parity.mjs`：与 daily 无关，无需改动。

### 9.6 QA 手工用例（追加到 `qa/recurring-entry-manual-cases.md`）

- 新建"每 3 天 · 早上 · 10 元早餐"规则，起始日 = 今天 07:00 之前，预期今天早上生成 1 条 entry，3天后再生成 1 条。
- 从"每周一"规则编辑改为"每天"，预期 days_of_week 被清空，保存后列表页显示"每天 · ..."。
- "每 30 天扣款" · 起始日在未来 · 预期首次触发在起始日当天。
- "每天"规则暂停 5 天后启用，预期不补跑历史（由 resume 逻辑保证）。

**基线要求**：server 单测 ≥ 216（现有 204 + 12 daily）· miniprogram 单测 ≥ 187（现有 180 + 至少 7 daily 相关）。

---

## 10. 文档更新

### 10.1 `docs/design/recurring-entry-product-spec.md`

需要修订的章节（下一版记为 v0.3.3）：

- **§4.1 支持档位**：表格从"六档"扩为"七档"，新增 daily 行。产品视角描述："从起始日起算，每 N 天自动记一笔。适用于无规律周期、需要固定天数间隔的场景（如每 10 天理疗）。"
- **§4.2 差异化上限**：daily 无日子概念，不参与"多选上限"表格；`period_interval` 无 UI 硬上限。
- **§5.3.3 (a) 周期档位选择器**：面板顺序改为 daily → workday → weekly → monthly → yearly，即用户明确指定的排序。
- **§5.3.4 预览自然语言模板**：daily 行 = `每 N 天 · <时段> · <账本名>`（例：`每 3 天 · 早上 · 我的家庭`）。
- **§9 版本与迭代计划**：v1.0 "六档" → "七档 = 六档 + daily"。

### 10.2 `docs/design/recurring-entry-tech-spec.md`

- **§0.4 v0.1→ v0.2 关键差异表**：追加"v0.2.x → v0.2.2 daily 姊妹补丁"一行。
- **§4.1 ENUM**：`recurring_period` 枚举值从 6 变 7（含 workday + daily）。
- **§7 next_run_at 计算算法**：`Period` 类型和 `tryMatchOnDay` 加daily 分支示例。
- 或另行留一句"详见 `docs/design/daily-recurring-tech-spec.md`"作为交叉引用。

### 10.3 `docs/design/workday-recurring-tech-spec.md`

在 §0.1 现状表格追加 daily 一行（可选，作为姊妹方案的横向参照）。

### 10.4 `MEMORY.md` 长期记忆

在"定时记账「工作日」支持（2026-08-06 新增）"段末尾追加：

```markdown
- **每 N 天档位（2026-08-07 补· Sprint-4 补丁）**：`recurring_period` ENUM 追加 `'daily'`，
  语义与 workday 对偶——三个 days 数组均NULL，`period_interval` 承载 N。计算走
  `daysDiff = cursor.startOf('day').diff(start_date.startOf('day'), 'days')`,
  `daysDiff >= 0 && daysDiff % interval === 0` 命中，与 workday 的节假日判定完全独立、
  不消费 workday_data。migration 0013 沿用 0012 的两段式（ALTER TYPE ADD VALUE 隐式提交
  + 独立事务重建 chk_recurring_period_fields），面板 UI 顺序固化为
  「每 N 天 / 每个工作日 / 每 N 周 / 每 N 月 / 每年」。
```

---

## 11. 交付里程碑

| Day | 交付 | 负责 |
|---|---|---|
| **D0** | 本方案（v0.1）+ product-spec v0.3.3 冻结 · G3 契约闸门 | PM + Backend + MiniApp |
| **D1** | migration 0013 + `test/setup.ts` 双写 · `recurringSchedule.ts` case 'daily' + 12 单测 · byte-level 同步到 miniprogram | Backend |
| **D2** | `recurringService.validateCreate` + `recurringRepo` 类型 + OpenAPI + Fastify schema · 5 例 E2E 集成测试 | Backend |
| **D3** | `recurring-period-selector` 组件重排+ dayInterval 输入框 · edit 页5 处 boilerplate 分支 · list 页 buildPeriodLabel · edit-hint 说明栏 | MiniApp |
| **D4** | model.spec 补daily 分支 · 手动 QA 4 例 · npm run parity + npm test 全绿 | QA + Full |
| **D5** | Human G4 →灰度 → G5 全量 | Human + DevOps |

**工作量估算**：约 1.5~2 人天（1 后端 + 1 前端并行 1 天 + 半天联调）。

---

## 12. 风险清单

| # | 风险 | 概率 | 影响 |缓解 |
|---|---|---|---|---|
| **D1** | migration 0013 未拆两段 · 真实 PG 报 `unsafe use of new value` | **中**（已有 0012 教训不复犯） | 高：上线迁移失败 | 严格按 §3.1 两段式；code review 必看 |
| **D2** | pg-mem DDL 未同步 · 单测通过但生产漂移 | 低 | 中| §3.2 diff 明确 · setup.ts CHECK 列表比对 |
| **D3** | `recurringSchedule.ts` / `recurringFormat.ts` 前后端 byte-level 漂移 | 中 | 中：预览与实际执行不一致 | CI `verify-recurring-schedule-parity.mjs` 卡关 · 每次修改运行 `npm run parity` |
| **D4** | `shouldClearDaysOnPeriodChange` 漏加 daily 分支 · monthly → daily 时 days_of_month 未清空 · 保存后 payload 里带脏值 · 服务端 400 | 低 | 低（保存失败但不落库） | §8.4 diff + model.spec 覆盖 5 例 |
| **D5** | 用户设`period_interval` 过大（如 99999）· `computeNextRunAt` 800 天上限 throw | 极低 | 低（保存前 preview 会显示 '—'） | 沿用现有 weekly/monthly 的处理策略，不专门为 daily 加软上限 |
| **D6** | `recurring-period-selector` 面板顺序错乱（wxml 5 个 item 顺序错） | 低 | 低（视觉问题） | Code review 必对照 §8.1.2 逐一核对 |
| **D7** | copy 规则时 daily 的 period_interval 未复制（对偶 workday 老 bug） | 低 | 低 | copy 已 `period_interval: existing.periodInterval`，回归测试覆盖 |

---

## 13. 附：契约 diff 清单（G3 闸门材料）

**新增**：
- `server/db/migrations/0013_recurring_daily.sql`
- `docs/design/daily-recurring-tech-spec.md`（本文档）

**变更**：
- `server/test/setup.ts`（period CHECK 加 `'daily'`）
- `server/api/openapi.yaml`（3 处 enum）
- `server/src/routes/recurring.ts`（2 处 Fastify schema enum）
- `server/src/repositories/recurringRepo.ts`（`Period` 类型）
- `server/src/services/recurringSchedule.ts`（byte-level 同源）
- `server/src/services/recurringFormat.ts`（byte-level 同源）
- `server/src/services/recurringService.ts`（PERIODS 数组 + validateCreate 分支）
- `miniprogram/services/recurringApi.ts`（`RecurringPeriod` 联合类型）
- `miniprogram/services/recurringSchedule.ts`（byte-level 同 server）
- `miniprogram/services/recurringFormat.ts`（byte-level 同 server）
- `miniprogram/components/recurring-period-selector/index.ts`（PeriodType / parsePeriod / composePeriod / dayInterval / onConfirm 分派+ 两个 handler）
- `miniprogram/components/recurring-period-selector/index.wxml`（★ 5 个 item 按新顺序重排 + 新增每N 天 item）
- `miniprogram/pages-recurring/edit/index.ts`（computePeriodLabel / parsePeriodInterval / _isFormComplete / _updatePreview 注释）
- `miniprogram/pages-recurring/edit/index.wxml`（新增 daily-hint 说明栏）
- `miniprogram/pages-recurring/edit/model.ts`（shouldClearDaysOnPeriodChange daily 分支）
- `miniprogram/pages-recurring/list/model.ts`（buildPeriodLabel daily 分支）
- `docs/design/recurring-entry-product-spec.md`（v0.3.3 · §4.1 / §5.3.3 (a) / §5.3.4 / §9）
- `docs/design/recurring-entry-tech-spec.md`（交叉引用本文档）
- 各 spec 测试文件（recurringSchedule.test.ts / recurring-entries.test.ts / edit.model.spec.ts / list.model.spec.ts）

**撤销**：无。

---

## 14. 附：changed files 树（供code review 一眼概览）

```
docs/design/
  daily-recurring-tech-spec.md                 [新增]
  recurring-entry-product-spec.md              [改· v0.3.3]
  recurring-entry-tech-spec.md                [改 · 交叉引用]

server/
  api/openapi.yaml                             [改 · 3 处 enum]
  db/migrations/
    0013_recurring_daily.sql                   [新增]
  src/
    routes/recurring.ts                        [改 · 2 处 schema enum]
    repositories/recurringRepo.ts              [改 · Period 类型]
    services/
      recurringSchedule.ts                     [改 · byte-level同源]
      recurringFormat.ts                       [改 · byte-level 同源]
      recurringService.ts                      [改 · PERIODS + validateCreate]
  test/
    setup.ts                                   [改 · period CHECK]
    recurringSchedule.test.ts[改 · +daily 组 12 例]
    recurring-entries.test.ts                  [改 · +5 例 E2E]

miniprogram/
  services/
    recurringApi.ts                            [改 · RecurringPeriod]
    recurringSchedule.ts                       [改 · byte-level 同 server]
    recurringFormat.ts                         [改 · byte-level 同 server]
  components/recurring-period-selector/
    index.ts                                   [改 · +daily]
    index.wxml                                 [★ 重排 + 新增 item]
  pages-recurring/
    edit/
      index.ts                                 [改 · 5 处分支]
      index.wxml                               [改 · +daily-hint]
      model.ts                                 [改 · shouldClearDaysOnPeriodChange]
      model.spec.ts                            [改 · +daily 用例]
    list/
      model.ts                                 [改 · buildPeriodLabel]
      model.spec.ts                            [改 · +daily 用例]
```
