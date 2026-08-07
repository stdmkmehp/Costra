# 定时记账「工作日」支持 · 技术设计文档

> ★ 合并说明（2026-08-07）：功能上线前，原 0012 `workday_calendars` 与 0013 `daily`
> 两个 migration 已合并进 0011 `recurring_entries`。本文档以下提及 "migration 0012" /
> "0012_workday_calendars.sql" 的地方，实际落点为 0011 的 workday_calendars 段。
> 文档内容保留作为设计决策留痕，不再反映最终 migration 文件编号。

## 0. 背景与目标

### 0.1 现有周期

现有定时记账方案在 DB 层有**三档周期枚举**（`weekly` / `monthly` / `yearly`），间隔通过独立的 `period_interval` 列表达（`SMALLINT NOT NULL DEFAULT 1`）。**UI 面板**（`recurring-period-selector` 组件）同样是三档：

| UI 面板选项 | 对应 DB 枚举 | 间隔参数 | 说明 |
|---|---|---|---|
| 每 N 周 | `weekly` | `period_interval=N` | 面板显示数字框，N≥1 任意正整数，DB 存 `period='weekly' + period_interval=N` |
| 每 N 月 | `monthly` | `period_interval=N` | 面板显示数字框，N≥1 任意正整数，DB 存 `period='monthly' + period_interval=N` |
| 每年 | `yearly` | `period_interval`（恒为 1） | 无间隔参数 |

**映射逻辑**（`recurring-period-selector/index.ts`）：
- `parsePeriod`：DB 枚举值 → `{ type, interval }`（三档枚举直接映射，interval 恒为 1；编辑已有规则时从 API 的 `period_interval` 字段读取真实间隔）
- `composePeriod`：面板选择 → DB 枚举值（按 type 返回 `'weekly'` / `'monthly'` / `'yearly'`，间隔经 `onConfirm` 的 `periodInterval` 一并提交）

**`period_interval` 字段**：已在 `recurring_rules` 表（migration 0011）持久化为独立列，全链路（API schema `routes/recurring.ts` → payload `recurringService.ts` → repo → DB → `tryMatchOnDay`）透传。`recurring-period-selector` 组件的 `onConfirm` 方法在提交时同时发送 `value` 和 `periodInterval`。

> 注：早期版本曾用 `biweekly` / `bimonthly` / `trimonthly` 六个枚举值隐式表达间隔（N≤3 时），但因 N>3 时无对应枚举、间隔丢失，导致"每 N 周/月"不生效。功能上线前已完成重构：**移除这三个枚举值，统一由 `period_interval` 列驱动间隔**，后端 `tryMatchOnDay` 直接读取 `period_interval`。

### 0.2 问题

在现有三档周期基础上，无法表达"每个工作日执行"这类需求。国内"工作日"由法定节假日 + 调休补班共同决定，且每年由国务院另行公布，无法用纯算法推算。

### 0.3 目标

在现有三档周期基础上，新增第四档周期 `workday`（每个工作日执行），使能表达以下场景：

- "每个工作日扣社保"
- "每个工作日记一笔通勤开支"

### 0.4 非目标

- 复杂 cron 表达式（如"每月最后一个工作日"）—— 不做，与现有产品方案 §2.2 一致
- 自动从政府网站抓取公告 —— 本期不做，依赖外部数据源（见 §2）
- `period_interval` 对 `yearly` 的支持（间隔恒为 1）—— 不做，产品无此需求

---

## 1. 总体架构

```
┌───────────────────────────────────────────────────────────┐
│  外部数据源（节假日数据）                                    │
│  https://www.shuyz.com/githubfiles/china-holiday-calender  │
│    /master/holidayAPI.json                                 │
│    结构：Years["2026"][{ Name, StartDate, EndDate,          │
│         Duration, CompDays, URL, Memo }]                    │
└────────────────┬───────────────────────────────────────────┘
                 │
    ┌────────────▼────────────────────────┐
    │  工具 1：scripts/fetch-holidays.mjs │
    │  fetch + 解析 + 转换格式              │
    │  → server/src/data/workday-cn-     │
    │    {year}.json                       │
    └────────────┬────────────────────────┘
                 │
    ┌────────────▼────────────────────────┐
    │  工具 2：infra/scripts/import-     │
    │  holidays.sh                        │
    │  读 JSON → INSERT workday_         │
    │  calendars 表                        │
    └────────────────┬────────────────────┘
                 │
┌───────────────▼──────────────────────────────────────────┐
│  DB: workday_calendars 表                                 │
│  year │ holidays(TEXT[]) │ workdays(TEXT[]) │ source       │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│  Server · workdayProvider.ts                              │
│  refreshCache()  ←── 每天凌晨触发                          │
│    SELECT → Map<year, {holidays:Set, workdays:Set}>       │
│  isWorkday()  ← 纯同步 · 供 tryMatchOnDay 调用            │
│    Map 有 → 查补班/假日                                   │
│    Map 无 → 降级周一~周五                                 │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│  recurringSchedule.ts · tryMatchOnDay                   │
│  case 'workday':                                        │
│    return isWorkday(year, weekday, monthDay) ? cursor : null │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│  Client API                                              │
│  GET /v1/workday-calendar/:year                          │
│  → { year, holidays: string[], workdays: string[] }      │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│  小程序端 · 编辑页预览                                     │
│  1. wx.getStorage 本地缓存（TTL 24h）                      │
│  2. miss → wx.request API                                │
│  3. API 无数据 → 降级周一~周五                             │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 外部数据源

### 2.1 数据来源

| 来源 | 格式 | 说明 |
|---|---|---|
| **`https://www.shuyz.com/githubfiles/china-holiday-calender/master/holidayAPI.json`** | JSON | 社区维护，2018~2027 已有数据，每年稳定更新 |

### 2.2 数据结构

```jsonc
{
  "Name": "ShuYZ中国节假日",
  "Version": "1.0",
  "Generated": "20251104T235904Z",
  "Timezone": "Asia/Shanghai",
  "Author": "ShuYZ.com",
  "URL": "https://github.com/lanceliao/china-holiday-calender",
  "Years": {
    "2026": [
      {
        "Name": "春节",
        "StartDate": "2026-02-15",
        "EndDate": "2026-02-22",
        "Duration": 8,
        "CompDays": ["2026-02-08", "2026-02-28"],
        "URL": "https://www.gov.cn/zhengce/content/...",
        "Memo": "二、春节：2月15日至22日放假调休..."
      }
    ]
  }
}
```

### 2.3 字段映射

| 外部字段 | 项目用途 | 说明 |
|---|---|---|
| `Years["YYYY"]` | 年份 | 定位数据 |
| `StartDate` ~ `EndDate` | `holidays` | 放假区间展开为每一天，转为 `MM-DD` |
| `CompDays[]` | `workdays` | 调休补班日，提取日期转为 `MM-DD` |
| `Name` | 丢弃 | 仅参考 |
| `URL` | `source_url` | 公告链接，留痕 |

---

## 3. 项目 JSON 格式

### 3.1 文件命名

```
server/src/data/workday-cn-{year}.json
```

按年份分文件，原因：
- 懒加载时只读需要的年份
- git diff 更清晰
- 一个文件出错不影响其他年份

### 3.2 JSON Schema

```jsonc
// server/src/data/workday-cn-2026.json
{
  "year": 2026,
  "holidays": [
    "01-01", "01-02", "01-03",  // 元旦
    "02-15", "02-16", "02-17", "02-18", "02-19", "02-20", "02-21", "02-22", "02-23",  // 春节
    "04-04", "04-05", "04-06",  // 清明
    "05-01", "05-02", "05-03", "05-04", "05-05",  // 劳动节
    "06-19", "06-20", "06-21",  // 端午
    "09-25", "09-26", "09-27",  // 中秋
    "10-01", "10-02", "10-03", "10-04", "10-05", "10-06", "10-07"  // 国庆
  ],
  "workdays": [
    "01-04",  // 周日补元旦
    "02-14",  // 周六补春节
    "02-28",  // 周六补春节
    "05-09",  // 周六补劳动节
    "09-20",  // 周日补国庆
    "10-10"   // 周六补国庆
  ],
  "source": "国务院办公厅关于2026年部分节假日安排的通知",
  "source_url": "https://www.gov.cn/zhengce/content/202511/content_7073354.htm",
  "generated_at": "2025-11-05T10:00:00.000Z"
}
```

### 3.3 格式约定

| 字段 | 类型 | 说明 |
|---|---|---|
| `year` | `number` | 年份，与文件名一致 |
| `holidays` | `string[]` | 放假日，`MM-DD` 格式，不含年份，升序 |
| `workdays` | `string[]` | 调休补班日，`MM-DD` 格式，升序 |
| `source` | `string` | 数据来源描述 |
| `source_url` | `string` | 公告链接 |
| `generated_at` | `string` | JSON 生成时间（ISO 8601） |

### 3.4 为什么用 `MM-DD` 而不是 `YYYY-MM-DD`

- 文件名已包含年份，`year` 字段也有——重复无必要
- 更紧凑
- 不可能出现"年份和文件名不一致"的 bug

---

## 4. DB 数据模型

### 4.1 新表 `workday_calendars`（migration 0012）

> 注：原计划 migration 0013，但早期 `0012_recurring_end_date_inclusive.sql` 已合并进 0011 并删除，故本表落在 0012 保持顺序连续。

```sql
-- server/db/migrations/0012_workday_calendars.sql

CREATE TABLE IF NOT EXISTS workday_calendars (
  year        SMALLINT PRIMARY KEY,
  holidays    TEXT[] NOT NULL,      -- ['01-01', '02-15', ...]  MM-DD 格式
  workdays    TEXT[] NOT NULL,      -- ['02-08', '02-28', ...]  MM-DD 格式
  source      TEXT,                 -- '国务院办公厅关于XXXX年部分节假日安排的通知'
  source_url  TEXT,                 -- 公告链接
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.2 约束

```sql
-- holidays 和 workdays 不能有交集（不能又放假又补班）
ALTER TABLE workday_calendars ADD CONSTRAINT chk_holidays_workdays_disjoint
  CHECK (NOT (holidays && workdays));
```

> `&&` 是 PG 数组重叠运算符。pg-mem 可能不支持，测试环境跳过此 CHECK（与项目现有 `recurring_rules` 的 partial index 兜底策略一致）。

### 4.3 索引

无需额外索引。表行数极少（每年一行），全表扫描足够。

---

## 5. `recurring_rules` 表变更

### 5.1 ENUM 扩展

```sql
-- recurring_period ENUM 增加第四档
ALTER TYPE recurring_period ADD VALUE IF NOT EXISTS 'workday';
```

> 现有 `weekly` / `monthly` / `yearly` 三档枚举值保留不动（间隔统一由 `period_interval` 列表达），本期新增 `workday` 后共四档。

### 5.2 CHECK 约束扩展

现有 `chk_recurring_period_fields` 约束需要放宽，允许 `workday` 时三个 days 数组全为 NULL：

```sql
ALTER TABLE recurring_rules DROP CONSTRAINT chk_recurring_period_fields;

ALTER TABLE recurring_rules ADD CONSTRAINT chk_recurring_period_fields CHECK (
  (period = 'weekly'
     AND days_of_week IS NOT NULL
     AND days_of_month IS NULL
     AND year_month_days IS NULL) OR
  (period = 'monthly'
     AND days_of_month IS NOT NULL
     AND days_of_week IS NULL
     AND year_month_days IS NULL) OR
  (period = 'yearly'
     AND year_month_days IS NOT NULL
     AND days_of_week IS NULL
     AND days_of_month IS NULL) OR
  (period = 'workday'
     AND days_of_week IS NULL
     AND days_of_month IS NULL
     AND year_month_days IS NULL)
);
```

---

## 6. Server 端实现

### 6.1 `workdayProvider.ts`

```ts
// server/src/services/workdayProvider.ts

interface YearData {
  holidays: Set<string>;   // 'MM-DD'
  workdays: Set<string>;   // 'MM-DD'
}

const cache = new Map<number, YearData>();

/**
 * 刷新缓存 · 从 DB 读取所有年份的节假日数据
 *
 * 调用时机：
 *   1. 服务启动时
 *   2. 每天凌晨（scheduler tick 检测到跨天时触发）
 */
export async function refreshCache(client?: PoolClient): Promise<void> {
  const sql = 'SELECT year, holidays, workdays FROM workday_calendars';
  const result = client
    ? await client.query(sql)
    : await pool.query(sql);
  cache.clear();
  for (const row of result.rows) {
    cache.set(row.year, {
      holidays: new Set(row.holidays),
      workdays: new Set(row.workdays),
    });
  }
}

/**
 * 纯同步 · 判断某天是否为工作日
 *
 * @param year     年份
 * @param weekday  ISO 周几 (1=Mon, 7=Sun)
 * @param monthDay 'MM-DD' 格式
 * @returns true = 工作日, false = 非工作日
 */
export function isWorkday(year: number, weekday: number, monthDay: string): boolean {
  const data = cache.get(year);
  if (!data) {
    // 降级：无数据 → 按周一~周五
    return weekday <= 5;
  }
  // 周末补班日 → 是工作日
  if (data.workdays.has(monthDay)) return true;
  // 节假日放假 → 不是工作日
  if (data.holidays.has(monthDay)) return false;
  // 普通日 → 按周一~五判断
  return weekday <= 5;
}
```

### 6.2 `recurringSchedule.ts` 改动

#### 6.2.1 `Period` 类型

```ts
export type Period =
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'workday';   // ★ 新增
```

#### 6.2.2 `RecurringRuleForCompute` 新增 `period_interval`

```ts
export interface RecurringRuleForCompute {
  period: Period;
  period_interval: number;  // 周期间隔倍数 · 默认 1
  timezone: string;
  start_date: string;
  execute_hour: number;
  execute_minute: number;
  days_of_week: number[] | null;
  days_of_month: number[] | null;
  year_month_days: number[] | null;
}
```

#### 6.2.3 `tryMatchOnDay` 新增 `case 'workday'`

```ts
import { isWorkday } from './workdayProvider.js';

function tryMatchOnDay(
  rule: RecurringRuleForCompute,
  cursor: DateTime,
): DateTime | null {
  const interval = rule.period_interval;  // 三档间隔统一由该字段驱动

  switch (rule.period) {
    case 'weekly': { /* ... 不变 · interval>1 时按周取模 ... */ }
    case 'monthly': { /* ... 不变 · interval>1 时按月取模 ... */ }
    case 'yearly': { /* ... 不变 ... */ }

    // ★ 新增
    case 'workday': {
      const weekday = cursor.weekday;       // 1=Mon...7=Sun (Luxon)
      const monthDay = cursor.toFormat('MM-DD');
      return isWorkday(cursor.year, weekday, monthDay)
        ? cursor : null;
    }
  }
}
```

> `computeNextRunAt` 签名不变。`isWorkday` 是纯同步函数，内部读模块级 `Map`，不碰 IO。
> `weekly` / `monthly` 分支的间隔逻辑由 `period_interval` 驱动（`weeksDiff % interval` / `monthsDiff % interval`），与 workday 无耦合。

### 6.3 `recurringFormat.ts` 改动

```ts
export function formatDaysForSummary(ctx: FormatContext): string {
  switch (ctx.period) {
    case 'weekly':
      return formatDow(ctx.days_of_week ?? [], ctx.mode);
    case 'monthly':
      return formatDom(ctx.days_of_month ?? [], ctx.mode);
    case 'yearly':
      return formatYearMonthDays(ctx.year_month_days ?? [], ctx.mode);

    // ★ 新增
    case 'workday':
      return '每个工作日';
  }
}
```

> 周期前缀（"每 N 周 / 每 N 月"）由 `formatPeriodPrefix(period, period_interval)` 提供，`formatDaysForSummary` 只负责日子部分的格式化，两者解耦。

### 6.4 `recurringService.ts` 改动

`validateCreate` / `validateUpdate` 新增 `workday` 分支：

```ts
const isWorkdayPeriod = p.period === 'workday';

if (isWorkdayPeriod) {
  if (p.days_of_week != null || p.days_of_month != null || p.year_month_days != null)
    invalid('days_of_week/days_of_month/year_month_days must be null for workday');
}
```

### 6.5 `recurringRepo.ts` 改动

`Period` 类型同步更新（与 `recurringSchedule.ts` 一致）。

### 6.6 刷新时机

在 `recurringScheduler.ts` 的 tick 逻辑中加入：

```ts
// server/src/services/recurringScheduler.ts

let lastRefreshDate = '';

async function tick() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastRefreshDate) {
    await workdayProvider.refreshCache();
    lastRefreshDate = today;
  }
  // ... 正常 tick 逻辑（runDueRules 等）
}
```

每天凌晨的第一次 tick 触发刷新，之后当天不再重复刷新。

---

## 7. Client API

### 7.1 路由

```ts
// server/src/routes/workdayCalendar.ts

export default async function workdayCalendarRoutes(fastify) {
  fastify.get('/v1/workday-calendar/:year', {
    schema: {
      params: {
        type: 'object',
        properties: {
          year: { type: 'integer', minimum: 2020, maximum: 2099 }
        }
      }
    }
  }, async (request, reply) => {
    const year = request.params.year;
    const result = await pool.query(
      'SELECT year, holidays, workdays FROM workday_calendars WHERE year = $1',
      [year]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'no holiday data for this year' });
    }

    const row = result.rows[0];
    return {
      year: row.year,
      holidays: row.holidays,
      workdays: row.workdays,
    };
  });
}
```

### 7.2 OpenAPI 契约

```yaml
# server/api/openapi.yaml · 新增

/v1/workday-calendar/{year}:
  get:
    summary: 获取指定年份的节假日数据
    parameters:
      - name: year
        in: path
        required: true
        schema: { type: integer, minimum: 2020, maximum: 2099 }
    responses:
      '200':
        description: OK
        content:
          application/json:
            schema:
              type: object
              required: [year, holidays, workdays]
              properties:
                year: { type: integer }
                holidays:
                  type: array
                  items: { type: string, pattern: '^\d{2}-\d{2}$' }
                workdays:
                  type: array
                  items: { type: string, pattern: '^\d{2}-\d{2}$' }
      '404':
        description: 该年份无数据
```

---

## 8. 小程序端实现

### 8.1 `workdayApi.ts`

```ts
// miniprogram/services/workdayApi.ts

export interface WorkdayData {
  year: number;
  holidays: string[];
  workdays: string[];
}

const STORAGE_KEY = 'workday_calendar';
const TTL_MS = 24 * 60 * 60 * 1000;  // 24h

/**
 * 获取指定年份的节假日数据
 * 1. 本地缓存 → 2. 请求 API → 3. 降级 null
 */
export async function getWorkdayData(year: number): Promise<WorkdayData | null> {
  const cached = wx.getStorageSync(STORAGE_KEY);
  if (cached && cached.year === year && Date.now() - cached.timestamp < TTL_MS) {
    return cached.data;
  }

  try {
    const res = await request({
      method: 'GET',
      path: `/workday-calendar/${year}`,
    });
    const data = res as WorkdayData;
    wx.setStorageSync(STORAGE_KEY, { year, data, timestamp: Date.now() });
    return data;
  } catch {
    return null;
  }
}
```

> `isWorkdaySync` 不放在本文件：为满足 `recurringSchedule.ts` 的 **byte-level 前后端同源约束**（server 与 miniprogram 必须逐字节一致），`isWorkdaySync` 作为纯同步函数下沉到共享的 `recurringSchedule.ts`（见 §8.2），本文件只负责「获取 + 缓存」。

### 8.2 前端 `recurringSchedule.ts` 改动

前端 `computeNextRunAt` 需要在 `tryMatchOnDay` 中处理 `workday` 分支。由于前端是异步获取数据，预览逻辑如下：

```ts
// miniprogram/services/recurringSchedule.ts

// isWorkdaySync 定义在本文件内（与 server 端 byte-level 一致 · 见 §6.2.3）
// RecurringRuleForCompute 新增 workday_data 字段（无数据时降级周一~周五）

function tryMatchOnDay(rule, cursor) {
  switch (rule.period) {
    // ... 现有三档不变（间隔由 period_interval 驱动）...

    case 'workday': {
      const weekday = cursor.weekday;      // 1=Mon...7=Sun (Luxon)
      const monthDay = cursor.toFormat('MM-dd'); // ★ Luxon 两位日期用小写 dd
      // workday_data 由编辑页预先加载并传入
      return isWorkdaySync(rule.workday_data, cursor.year, weekday, monthDay)
        ? cursor : null;
    }
  }
}
```

> 与 server 端 `recurringSchedule.ts` 保持 **byte-level 同源**：`isWorkdaySync` 定义在两份共享文件中，`workday_data` 由调用方（server `recurringService` 从 `workdayProvider` 缓存、miniprogram 编辑页从 `workdayApi` 加载）传入，保证 `computeNextRunAt` 是纯同步函数。

### 8.3 编辑页预览加载

编辑页 `onLoad` 时调用 `getWorkdayData`：

```ts
// miniprogram/pages-recurring/edit/index.ts

async onLoad() {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  await Promise.all([
    getWorkdayData(currentYear),
    getWorkdayData(nextYear),
  ]);
  // 数据加载后预览自动刷新
}
```

---

## 9. 工具脚本

### 9.1 工具 1：`scripts/fetch-holidays.mjs`

从外部数据源拉取指定年份的节假日数据，转换为项目 JSON 格式。

```js
#!/usr/bin/env node
/**
 * Costra · 节假日数据抓取脚本
 *
 * 从 https://www.shuyz.com/githubfiles/china-holiday-calender
 *   /master/holidayAPI.json 解析指定年份的节假日信息，
 * 输出为项目标准 JSON 格式。
 *
 * 用法：
 *   node scripts/fetch-holidays.mjs                  # 当前年 + 明年
 *   node scripts/fetch-holidays.mjs 2025 2026 2027   # 指定年份
 *
 * 输出：
 *   server/src/data/workday-cn-{year}.json
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_URL = 'https://www.shuyz.com/githubfiles/china-holiday-calender/master/holidayAPI.json';

async function main() {
  const args = process.argv.slice(2);
  const years = args.length > 0
    ? args.map(Number)
    : [new Date().getFullYear(), new Date().getFullYear() + 1];

  const resp = await fetch(SOURCE_URL);
  const data = await resp.json();

  for (const year of years) {
    const yearData = data.Years?.[String(year)];
    if (!yearData) {
      console.warn(`⚠ ${year} 年节假日数据未找到，跳过`);
      continue;
    }

    const holidays = new Set();
    const workdays = new Set();
    let sourceUrl = '';

    for (const holiday of yearData) {
      // 放假区间展开
      const start = new Date(holiday.StartDate);
      const end = new Date(holiday.EndDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        holidays.add(toMonthDay(d));
      }

      // 调休补班日
      if (holiday.CompDays) {
        for (const compDay of holiday.CompDays) {
          workdays.add(toMonthDay(new Date(compDay)));
        }
      }

      if (holiday.URL) sourceUrl = holiday.URL;
    }

    // 校验：holidays 和 workdays 无交集
    for (const d of holidays) {
      if (workdays.has(d)) {
        throw new Error(`${year} 年 ${d} 同时出现在 holidays 和 workdays 中`);
      }
    }

    const json = {
      year,
      holidays: [...holidays].sort(),
      workdays: [...workdays].sort(),
      source: '国务院办公厅关于' + year + '年部分节假日安排的通知',
      source_url: sourceUrl,
      generated_at: new Date().toISOString(),
    };

    const outputPath = join(process.cwd(), 'server/src/data/workday-cn-' + year + '.json');
    writeFileSync(outputPath, JSON.stringify(json, null, 2) + '\n');
    console.log(`✓ ${outputPath} · ${holidays.size} holidays, ${workdays.size} workdays`);
  }
}

function toMonthDay(date) {
  return String(date.getMonth() + 1).padStart(2, '0') + '-' +
         String(date.getDate()).padStart(2, '0');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

### 9.2 工具 2：`infra/scripts/import-holidays.sh`

读取项目 JSON 文件，导入到 `workday_calendars` 表。

> **设计决策**：本脚本操作线上数据库，遵循 `infra/scripts` 运维规范（source `lib/common.sh`、通过 `docker exec` 操作容器、密码从 `server.env` 读取、prod 强制 confirm），而非 Node.js 直连 `DATABASE_URL`。旧版 `scripts/import-holidays.mjs` 已废弃删除。

```bash
#!/usr/bin/env bash
# 读取 server/src/data/workday-cn-*.json，导入到 workday_calendars 表。
#
# 用法：
#   # 默认对 verify 容器跑（隔离）
#   ./import-holidays.sh
#   ./import-holidays.sh 2026 2027
#
#   # 对 prod 跑（高危 · 必 confirm + 建议先 backup）
#   ./import-holidays.sh --target prod
#   ./import-holidays.sh --target prod 2026
#
#   # 一路 yes（搭配 prod 也跳 confirm · 慎用）
#   ./import-holidays.sh --target prod -y
#
#   # 只看会跑什么不执行
#   ./import-holidays.sh --dry-run
#
# 语义：
#   - INSERT ... ON CONFLICT (year) DO UPDATE（upsert · 幂等 · 可重复执行）
#   - 导入前用 jq 校验 JSON schema（year / 数组 / MM-DD / 升序 / 无交集）
#   - 密码来源：verify → lib/common.sh VERIFY_PG_PW · prod → /data/conf/server.env PG_COSTRA_PW
```

完整实现见 `infra/scripts/import-holidays.sh`。

---

## 10. 降级策略

### 10.1 何时降级

| 场景 | 触发条件 | 降级行为 |
|---|---|---|
| DB 无某年数据 | `workday_calendars` 表无该年行 | `isWorkday` 返回按周一~周五 |
| API 请求失败 | 网络错误 / 服务不可用 | 前端 `getWorkdayData` 返回 null → `isWorkdaySync` 按周一~周五 |
| JSON 文件缺失 | `fetch-holidays` 未跑过该年 | 不影响（数据已入 DB） |

### 10.2 降级的影响

降级期间该规则按周一~周五执行，**不保证节假日准确性**：
- **会漏**调休补班的周六周日（该记的没记）
- **会多记**放假的周一~周五（不该记的记了）

### 10.3 可观测

降级时打日志 + 暴露指标：

```
costra_workday_data_missing_total{year}   counter
```

运营通过该指标发现"哪个年数据缺失了"，及时跑 `fetch-holidays` + `import-holidays`。

---

## 11. 年度维护 SOP

```
每年 10~11 月（国务院发布下一年放假安排后）：

1. node scripts/fetch-holidays.mjs 2026 2027
   → 从外部数据源拉取 → 生成 workday-cn-2026.json, workday-cn-2027.json
   → review JSON 内容（人工核对几个关键节日：春节、国庆）

2. ./infra/scripts/import-holidays.sh --target prod
   → 导入 DB → 验证（建议先跑 ./backup-db.sh）

3. git commit + push + PR

4. CI 自动验证：
   - JSON schema 校验
   - 前后端 parity 校验（recurringSchedule.ts / recurringFormat.ts）
   - holidays ∩ workdays = ∅

5. Merge + 部署 → 服务下次凌晨自动刷新缓存 → 生效

全程无需重启服务、无需发客户端版本。
```

---

## 12. 文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `server/db/migrations/0012_workday_calendars.sql` | 新增 | 建表 + 约束 |
| `server/src/services/workdayProvider.ts` | 新增 | 内存缓存 + isWorkday + refreshCache |
| `server/src/services/recurringSchedule.ts` | 修改 | `Period` 加 `'workday'`；`tryMatchOnDay` 加 `case 'workday'` |
| `server/src/services/recurringFormat.ts` | 修改 | `formatDaysForSummary` 加 `case 'workday'` |
| `server/src/routes/workdayCalendar.ts` | 新增 | `GET /v1/workday-calendar/:year` |
| `server/src/repositories/recurringRepo.ts` | 修改 | `Period` 类型加 `'workday'` |
| `server/src/services/recurringService.ts` | 修改 | `validateCreate`/`validateUpdate` 加 `workday` 分支 |
| `server/src/services/recurringScheduler.ts` | 修改 | tick 逻辑加每天凌晨刷新 |
| `server/api/openapi.yaml` | 修改 | 新增 `/v1/workday-calendar/{year}` 路径 |
| `miniprogram/services/recurringSchedule.ts` | 同步 | 与 server 端 byte-level 一致 |
| `miniprogram/services/recurringFormat.ts` | 同步 | 与 server 端 byte-level 一致 |
| `miniprogram/services/workdayApi.ts` | 新增 | 客户端 API 调用 + 本地缓存 + isWorkdaySync |
| `miniprogram/pages-recurring/edit/index.ts` | 修改 | `onLoad` 预加载节假日数据 |
| `scripts/fetch-holidays.mjs` | 新增 | 工具 1：外部数据源解析 |
| `infra/scripts/import-holidays.sh` | 新增 | 工具 2：JSON → DB 导入（prod 运维版 · source common.sh） |
| `server/src/data/workday-cn-{year}.json` | 新增 | 节假日数据 JSON 文件 |
| `scripts/verify-workday-parity.mjs` | 新增 | CI 校验：JSON schema + 前后端一致性 |

---

## 13. 风险清单

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| **W1** | 外部数据源不可用（GitHub 仓库被删 / 改名） | 低 | 高：无法抓取新数据 | 抓取脚本加缓存兜底：优先用本地已有 JSON；并提供手动录入入口 |
| **W2** | 国务院公告延迟发布（罕见 · 2020 年因疫情发生过） | 极低 | 中：该年数据缺失 | 降级策略兜底；公告发布后补上数据并部署 |
| **W3** | 外部数据源数据有误（节假日遗漏） | 低 | 中 | 人工 review + 交叉验证（可用 `NateScarlet/holiday-cn` 备选） |
| **W4** | 前后端 `recurringSchedule.ts` byte-level 漂移 | 中 | 中：预览与实际执行不一致 | 现有 CI parity 校验已覆盖 |
| **W5** | `workday_calendars` 表数据被误删 | 极低 | 中：当年降级 | DB 备份 + JSON 文件仍在，可重新 import |
