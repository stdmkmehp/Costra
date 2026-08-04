# 定时记账（Recurring Entry）· 技术方案 v0.2.1

- 卡号占位：**COSTRA-5xx**（Sprint-4 候选）
- 作者：Backend / MiniApp 联合起草
- 日期：2026-07-21
- 配套：`docs/design/recurring-entry-product-spec.md` v0.3.2
- 事实源约束：迁移双写（`server/db/migrations/*.sql` + `server/test/setup.ts` 内嵌 DDL）· 金额分单位 · sync 增量走 `change_seq` · timezone 走 `users.timezone`
- 版本历史：
  - v0.1（2026-07-17）：首版 · 四档周期 · pending 队列 · auto/confirm 双模式 · 订阅消息推送
  - v0.2（2026-07-21）：对齐产品 v0.3.2 全量重写 · 六档 · 全档多选 · 差异化上限 · 每年跨月 · 静默无推送 · 归属跟人不跟账本 · 撤销 pending 表 · 撤销 auto/confirm mode · 撤销存为定时入口
  - **v0.2.1（2026-07-21 · 技术评审后修订）**：① 时段窗口**内缩 30 分钟**避免临界点（06:30~11:29 而非 06:00~11:59）· ② 补偿窗口从 24h 扩到 **7 天** · ③ 单条规则单次 tick **循环补齐所有漏跑日**（不是跳过），每条 entry 用真实历史 `occurred_at`· ④ 明确 advisory lock 的 crash 自动释放语义 · ⑤ 敲定引入 luxon 依赖

> 本文只描述"落地实现"，覆盖技术评审结论 / 风险 / 数据模型 / API 契约 / 调度器 / 幂等 / 时区 / 同步 / 前端集成 / 测试策略 / 回滚。产品交互见配套产品文档。

---

## 0. 技术评审结论（本节即为 v0.3.2 产品方案的技术评估报告）

### 0.1 结论一句话

**技术上完全可行，无需引入新的基础设施依赖，与现有 Fastify + PG + 小程序单实例架构天然对齐；主要新增复杂度集中在"日子数组的边界处理"和"跨月/闰年/月末回落的组合计算"，通过 `computeNextRunAt` 纯函数 + 100+ 单元测试用例可控。**

### 0.2 技术可行性打分（1-5，5 分为最高）

| 维度 | 分数 | 说明 |
|---|---|---|
| 架构复杂度 | 4 | 全部落到现有 Fastify 进程内，`setInterval + pg_try_advisory_lock` 就绪即用 |
| 数据模型 | 3 | PG 数组字段 + partial index + 数组长度 CHECK，需要认真处理 pg-mem 差异 |
| 调度可靠性 | 4 | 幂等键 + `FOR UPDATE SKIP LOCKED` + 补偿窗口，可控 |
| 时区/边界 | 2 | 6 档 × 多选 × 闰年 × 跨月，测试用例爆炸性增长；引入 `luxon` 是硬需求 |
| 前端复杂度 | 3 | 分包内 3 个页面 + 通用分类选择器抽离 + 长按菜单复用；工作量集中在 tag 网格控件 |
| 上线风险 | 4 | feature flag 灰度 · 数据表可保留 · 无破坏性 schema 变更 |
| **综合** | **3.3** | **中等复杂度**，Sprint-4 内 10 人天可完成 |

### 0.3 关键风险清单（P 优先级 · 缓解方案）

| # | 风险 | 概率 | 影响 | 缓解方案 |
|---|---|---|---|---|
| **R1** | `computeNextRunAt` 6 档 × 多选 × 闰年组合，边界 bug 可能长期潜伏 | **高** | 中：漏跑或错跑 | 100+ 单元测试用例矩阵 · 引入 `luxon` 而非自研时区库 · 前后端共享算法（前端预览必须命中同一函数） |
| **R2** | pg-mem 不支持 PG 数组的部分操作（如 `cardinality(arr)` CHECK · `= ANY(arr)` 索引），可能导致测试环境与生产漂移 | 中 | 高：测试通过但生产崩 | 提前跑 spike：写 100 行 DDL 到 pg-mem 验证；实在不行则**在测试 setup 里跳过数组 CHECK**、依靠生产 PG 兜底（与 MEMORY.md 已有的 partial unique index 兜底策略一致） |
| **R3** | Lighthouse 2C2G 上单进程 setInterval，进程崩溃 = 调度停摆 | 低（有 docker restart） | 中：延迟 | docker healthcheck + restart:always；调度器可自恢复；**补偿窗口 ≤ 7 天**兜住（见 §3.4） |
| **R4** | 用户跨时区旅行，规则里的 `timezone` 快照与实际期望产生偏差 | 低 | 低 | timezone 快照在规则表；只在用户主动编辑规则时才重算，避免误伤 |
| **R5** | 生成的 entry 与用户手记 entry 视觉上除了角标外无差异，用户可能对"半夜多出一条 200 元"产生困惑 | 中 | 低：客服成本 | "定"字角标 + audit_log 留痕；上线灰度期观察 |
| **R6** | 一次生成 12 条 entry（每年 12 天场景）会瞬间灌 12 次 `INSERT`，触发 `entries_change_seq` 跳号 | 低 | 无实质影响 | seq 跳号本身无害；用户 sync 拉到的是完整增量 |
| **R7** | 用户创建规则后立即禁用/删除，若 `next_run_at` 已到当前时刻，可能出现"删除瞬间刚好被 tick 命中"的竞态 | 极低 | 低 | `pg_try_advisory_lock` + 事务内二次校验 `status = 'active'`；即使真的生成一条也可由用户删除，无灾难性后果 |
| **R8** | 客户端 `computeNextRunAt` 与后端不同源，预览时间与实际执行时间不一致 | 中 | 中：用户信任问题 | 前后端算法作为**同一份 TypeScript 源码**，前端从 `services/recurringSchedule.ts` import，后端从 `server/src/services/recurringSchedule.ts` import；两处**内容 byte-level 一致**（package.json workspaces 或直接复制脚本 + CI check） |

**结论**：R1/R8 是最重要的，通过"算法源码同源 + 大量单元测试"化解。R2 是新增的落地风险，需要在 Day 1 就做 spike 验证。

### 0.4 v0.1 → v0.2 关键差异

| 领域 | v0.1 | v0.2（对齐 v0.3.2 产品） |
|---|---|---|
| 周期档位 | 4 档（monthly / weekly / yearly / quarterly · 单选 dow/dom） | **6 档**（weekly / biweekly / monthly / bimonthly / trimonthly / yearly · **全档多选**） |
| 上限 | 单选 · 无上限概念 | 差异化：每周 7 · 每月类 14 · 每年 12 |
| 每年 | 单月 + 单日 | **跨月 `(月, 日)` 组合** · 上限 12 |
| 落账模式 | auto + confirm 双模式 | 只有 **auto**（撤销 confirm 队列） |
| pending 表 | ✅ 有 | ❌ **删除** |
| 归属 | 按 ledger 查询 | 按 **created_by** 查询 · 规则跟人不跟账本 |
| 入口 | mine 菜单 + 记账面板"存为定时" | 只有 mine 主菜单 · **撤销存为定时** |
| 待确认条 | ledger 页顶部 | **撤销** |
| 订阅消息 | recurring_confirm + recurring_failed 两个 scene | **撤销所有推送**（除失败告警走内部通道，不推给用户） |
| 明细页 | 长按菜单顶部注入"由...生成"信息条 | **撤销** · 只保留 §6 定义的"定"字角标 |
| 时段 | 4 档精确时点（`00:05 / 09:00 / 12:00 / 20:00`） | **4 档模糊窗口** · 后端错峰分钟 `hash(user_id + rule_id) mod 窗口分钟数` |
| 执行时间字段 | `execute_hour + execute_minute`（用户直接选） | 同字段，但**由后端首次创建时错峰分配写入**，用户不直接看具体分钟 |
| 数据模型 | `day_of_month SMALLINT` · `day_of_week SMALLINT` · `month_of_period SMALLINT` | **数组化**：`days_of_week SMALLINT[]` · `days_of_month SMALLINT[]` · `year_month_days INTEGER[]`（元素编码 month\*100+day） |

### 0.5 工作量估算

| 阶段 | 工作量（人天） |
|---|---|
| D1 Spike + Migration + 内嵌 DDL | 1 |
| D2 `computeNextRunAt` 纯函数 + 100+ 单元测试 | 1.5 |
| D3 recurringRepo + service + 六档 CRUD | 1.5 |
| D4 recurringScheduler + 集成测试 + 幂等 | 1 |
| D5-D6 客户端分包 · 列表页 · 编辑页三卡片 | 2 |
| D7 编辑页多选控件（每周/每月/每年三种网格）· 关键动效 | 1.5 |
| D8 明细页"定"字角标 + `.entry-member__badge` 容器化改造 | 0.5 |
| D9 前后端算法一致性 CI + QA 手工用例 | 0.5 |
| D10 灰度 · 观察 · G4/G5 闸门 | 0.5 |
| **合计** | **10 人天** |

Sprint-4 内 1 个后端 + 1 个前端并行 5 天可交付。

---

## 1. 目标与非目标

### 1.1 目标
1. 存储用户的"定时记账模板"（recurring rules），支持 **6 档周期 + 差异化多选上限**（详见产品方案 §4）
2. 后端拥有**可靠 · 幂等 · 可回补 · 单实例安全**的调度器，按用户本地时区推进下一次执行时间，到点后按模板生成 entries；**静默执行，无任何推送**
3. 提供 `/v1/recurring-entries` CRUD 契约，前端接入 mine 主入口 + 分包 `pages-recurring/{list,edit}` 两页
4. 定时生成的 entry 与手动 entry **在 sync 增量协议、audit_log、budget、statistics 中一致对待**；仅在明细页头像右下角显示"定"字角标区分
5. 全链路可观测：调度器每次 tick 打日志、生成 entry 打 audit_log、失败入死信、Prometheus 指标暴露

### 1.2 非目标
- 引入 Kafka / 分布式定时框架（当前 Lighthouse 单机架构，不需要）
- 自研 cron 表达式解析：只支持产品方案 §4 定义的六档，enum 化存储
- 支付 / 汇率 / 多币种转换
- worker 多实例主备切换（当前用 PG advisory lock 兜底即可）
- **订阅消息推送**（v0.1 有，本版本撤销）
- **待确认队列**（v0.1 有，本版本撤销）
- **"存为定时"入口**（v0.1 有，本版本撤销）
- **明细页长按菜单来源信息条**（v0.1 有，本版本撤销）

---

## 2. 架构总览

```
┌───────────────────────────────────────────────────────────────┐
│  微信小程序                                                    │
│   miniprogram/pages-recurring/                                 │
│     list/   · 定时列表页                                        │
│     edit/   · 定时编辑页（三卡片）                              │
│   miniprogram/services/                                        │
│     recurringApi.ts        · CRUD 封装                          │
│     recurringSchedule.ts   · ★ 与后端 byte-level 同源的         │
│                              computeNextRunAt / formatDays      │
│   miniprogram/components/category-picker/  · 从 expense-overlay │
│     抽离的通用分类选择组件（同时服务记账面板 + 定时编辑页）     │
│   miniprogram/pages/ledger/index.wxml                          │
│     .entry-member__badge 容器化改造，支持并排 "定 公"           │
└──────────────┬────────────────────────────────────────────────┘
               │ HTTPS · JWT
┌──────────────▼────────────────────────────────────────────────┐
│  Fastify Server                                                │
│    routes/recurring.ts                CRUD + pause/resume/     │
│                                        run-now                 │
│    services/recurringService.ts       校验 · 事务 · 权限        │
│    services/recurringSchedule.ts      ★ 纯函数 computeNextRunAt│
│    services/recurringScheduler.ts     tick loop · advisory lock│
│    services/entryService.ts           +sourceRecurringId 参数  │
│    repositories/recurringRepo.ts      SQL 访问                 │
└──────────────┬────────────────────────────────────────────────┘
               │
               ▼
        ┌─────────────┐        ┌─────────────────────────┐
        │ PostgreSQL  │◀──────▶│ recurring_rules         │
        │             │        │ entries.source_recurring_id 列│
        └─────────────┘        └─────────────────────────┘
               ▲
               │ pg_try_advisory_lock（单实例互斥）
               │
        ┌──────┴──────┐
        │ scheduler   │  setInterval(60s) · Fastify 内置
        │ tick loop   │  每 tick: 拉 due → 生成 N 条 entry → 推进 next_run_at
        └─────────────┘
```

**关键结论**：
1. **无独立 worker 进程**：调度器嵌入 Fastify 进程，用 `pg_try_advisory_lock` 兜底未来多实例
2. **无 pending 表**：只保留 `recurring_rules` 单表 + `entries.source_recurring_id` 列
3. **前后端算法同源**：`computeNextRunAt` / `formatDaysForSummary` 是两份 byte-level 相同的 TS 文件，CI 校验

---

## 3. 调度器方案

### 3.1 选型（继承 v0.1 结论 · 无变化）

| 方案 | 结论 |
|---|---|
| A. 系统 cron + curl 内网 API | ❌（时区难处理） |
| **B. Fastify 进程内 setInterval + PG advisory lock** | **✅ 采用** |
| C. 独立 Node worker | 二期视规模再切 |
| D. pg_cron 扩展 | ❌（Lighthouse PG 未装） |

### 3.2 Tick 语义

```ts
// server/src/services/recurringScheduler.ts
const TICK_INTERVAL_MS = 60_000;                // 每分钟一次
const ADVISORY_LOCK_KEY = 0x_636F73_74726100n;  // 'costra\0' 前 8 字节

async function tick(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY]);
    if (!rows[0].ok) return;   // 拿不到锁 · 本轮跳过

    try {
      await runDueRules(client);
      // 注：补齐已内嵌到 processOneRule 的 while 循环里（§3.4），
      // 不再需要独立的 runOverdueBackfill 函数
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
```

- 启动挂 `setInterval(tick, TICK_INTERVAL_MS)`，`server.close()` 时清除
- **每条规则独立事务** `try/catch`，一条失败不影响其它
- 单 tick 硬上限 30s，超时 log warn + 下轮继续

### 3.3 拉取 due 规则

```sql
SELECT * FROM recurring_rules
WHERE status = 'active'
  AND (end_date IS NULL OR end_date >= (now() at time zone timezone)::date)
  AND next_run_at <= now()
  AND deleted_at IS NULL
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

对每条规则调用 `processOneRule(rule)`（下节详述）。

### 3.4 单条规则的补齐 loop（v0.2.1 关键修订）

**语义**：一条规则的 `next_run_at` 只是"下一次应该执行的时点"水位。如果 tick 因为宕机 / 长间隔而在多个应执行时点之后才被触发，本方案在**单次 tick 内一次性把所有漏跑的应执行日全部补齐**，直到 `next_run_at` 推进到未来。

```ts
const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   // 7 天补齐窗口
const MAX_BACKFILL_ITER  = 100;                        // 硬上限防死循环

async function processOneRule(rule) {
  BEGIN TRANSACTION;

  let cursor = rule.next_run_at;
  const generated: Date[] = [];
  const skipped: Date[] = [];
  const nowTs = Date.now();

  for (let iter = 0; iter < MAX_BACKFILL_ITER; iter++) {
    if (cursor > new Date(nowTs)) break;   // 已推进到未来 → 补齐完成

    const cursorTs = cursor.getTime();
    const delta = nowTs - cursorTs;

    if (delta > BACKFILL_WINDOW_MS) {
      // ★ 超过 7 天补偿窗口 · 跳过这一个应执行日
      skipped.push(cursor);
      cursor = computeNextRunAt(rule, /* from = */ cursor);
      continue;
    }

    // ★ 在窗口内 · 真实补齐一条 entry
    const dayLocal = DateTime.fromJSDate(cursor, { zone: rule.timezone })
      .toISODate();  // 'YYYY-MM-DD' in 规则时区
    const clientRefId = `rec_${rule.id.slice(0, 8)}_${dayLocal}`;

    // 关键：entry.occurred_at 用 cursor（应执行的历史时点）
    //      entry.created_at 由触发器写入 now（默认）
    await entryService.createWithIdempotency(
      rule.created_by,
      {
        ...templateFromRule(rule),
        occurred_at: cursor.toISOString(),
      },
      clientRefId,
      { sourceRecurringId: rule.id },
    );
    generated.push(cursor);

    cursor = computeNextRunAt(rule, /* from = */ cursor);
  }

  // 循环退出后：cursor 指向下一个未来匹配日（严格 > now）
  // 若因 MAX_BACKFILL_ITER 提前退出，则 cursor 仍是历史时点，等下轮 tick 继续补
  await repo.updateAfterExecute(rule.id, {
    next_run_at: cursor,
    last_run_at: new Date(),
    last_run_status: 'ok',
    consecutive_failures: 0,
  });

  // audit：分两条留痕
  if (generated.length > 0) {
    await audit(rule, 'execute', { generated_count: generated.length,
                                    generated_dates: generated });
  }
  for (const skip of skipped) {
    await audit(rule, 'skip_out_of_backfill_window', { skipped_at: skip });
  }

  COMMIT;
}
```

#### 补齐语义的四个关键点

1. **循环补齐** — 一轮 tick 内把所有 `next_run_at ≤ cursor ≤ now` 且在补偿窗口内的漏跑日全部生成，直到 `cursor > now`
2. **补的 entry 用真实历史时点作为 `occurred_at`** — 用户在明细页里，补出的记录会出现在**它本该出现的那一天**的分组里，与手工"补记昨天的午饭"体验一致；`created_at`/`updated_at` 自然是 now（系统视角，用于审计）
3. **`client_ref_id` 用 `occurred_at` 的日期** — 保证同一规则同一应执行日的幂等键稳定，任意时候补都不会重
4. **超过 7 天窗口的漏跑日 skip 但仍推进 cursor** — 保证 `next_run_at` 一定能追上 now，避免规则永久卡在过去

#### 你的两个具体场景验证

**场景 A：宕机 48h，规则 "每天下午"（假设分配到 15:23）**
- `next_run_at = 8/1 15:23`，恢复时刻 `now = 8/3 09:00`
- iter 1: cursor=8/1 15:23 · delta=1.7 天 · 在窗口 → 生成 entry(occurred_at=8/1 15:23) · cursor = 8/2 15:23
- iter 2: cursor=8/2 15:23 · delta=0.7 天 · 在窗口 → 生成 entry(occurred_at=8/2 15:23) · cursor = 8/3 15:23
- iter 3: cursor=8/3 15:23 > now(8/3 09:00) → 退出
- 结果：**补齐 2 条**（8/1 下午 + 8/2 下午），`next_run_at = 8/3 15:23`（今天下午还会正常触发）

**场景 B：宕机 15 天，同上规则**
- `next_run_at = 8/1 15:23`，恢复时刻 `now = 8/16 09:00`
- iter 1-7: cursor 8/1 ~ 8/7 · delta 15~9 天 · 全部超过 7 天窗口 → 全部 skip，audit 各留痕，cursor 每步推进 1 天
- iter 8: cursor=8/8 15:23 · delta=7.7 天 · 略超 → skip → cursor=8/9
- iter 9: cursor=8/9 15:23 · delta=6.7 天 · 在窗口 → 生成 entry(occurred_at=8/9 15:23) · cursor=8/10
- ... 8/9 ~ 8/15 各生成一条（7 条）
- iter 16: cursor=8/16 15:23 > now(8/16 09:00) → 退出
- 结果：**补齐 7 条**（近 7 天），前 7 天各 audit 留 skip 记录

### 3.5 错峰分钟分配（v0.2.1 · 内缩边界）

用户创建规则时传入 `execute_bucket ∈ {'dawn','morning','afternoon','night'}`，后端**在 create 事务内**为规则分配具体分钟。分配规则采用**中心内缩策略**：每个 6 小时窗口的**首尾各去掉 30 分钟**，让 hash 只落在窗口中段的 5 小时内，避免用户对"临界点"产生心理落差。

| 用户看到 | 名义窗口 | 实际 hash 落点范围 |
|---|---|---|
| 凌晨 | 00:00-05:59 | **00:30 ~ 05:29** |
| 早上 | 06:00-11:59 | **06:30 ~ 11:29** |
| 下午 | 12:00-17:59 | **12:30 ~ 17:29** |
| 晚上 | 18:00-23:59 | **18:30 ~ 23:29** |

```ts
// server/src/services/recurringSchedule.ts
const BUCKET_WINDOWS = {
  dawn:      { startHour: 0,  endHour: 6  },   // 00:00 ~ 05:59
  morning:   { startHour: 6,  endHour: 12 },   // 06:00 ~ 11:59
  afternoon: { startHour: 12, endHour: 18 },   // 12:00 ~ 17:59
  night:     { startHour: 18, endHour: 24 },   // 18:00 ~ 23:59
} as const;

const INNER_MARGIN_MINUTES = 30;   // ★ 首尾内缩 30 分钟

export function assignBucketMinute(
  userId: string, ruleId: string, bucket: PeriodBucket,
): { hour: number; minute: number } {
  const w = BUCKET_WINDOWS[bucket];
  const windowTotalMinutes = (w.endHour - w.startHour) * 60;   // 360
  const usableMinutes = windowTotalMinutes - INNER_MARGIN_MINUTES * 2;  // 300
  // FNV-1a 64bit（避免依赖 crypto，纯函数、跨端可复现）
  const h = fnv1a64(`${userId}|${ruleId}`);
  const offset = Number(h % BigInt(usableMinutes));  // [0, 300)
  const totalMinutes = w.startHour * 60 + INNER_MARGIN_MINUTES + offset;
  return {
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  };
}
```

**属性**：
- 同一 `(userId, ruleId)` → 稳定分钟点（用户对"我的定时就是凌晨 3:12"的稳定预期）
- 用户切换 bucket → 重新分配并覆盖 `execute_hour/minute`
- 客户端不能直接指定 `execute_hour/minute`；`create/patch` 请求 body 只带 `execute_bucket`
- **绝不落在整点 hh:00 或整点前一分钟 hh:59** · 也**绝不跨窗口边界**

### 3.6 优雅停机

`server.close()` 前：
- `clearInterval(tickHandle)`
- 等当前 tick 结束（最多 30s）
- 显式 `pg_advisory_unlock`（虽然 PG 会 `ON DISCONNECT` 自动释放，但显式让日志更干净）

### 3.7 Advisory lock 的所有权与自动释放（v0.2.1 新增 · 回应"crash 会不会永久持锁"）

**结论：不会永久持锁**。`pg_try_advisory_lock` 的锁是 **session-level**，绑定在 PG 连接上，session 断开即释放。

#### 自动释放的三条路径

| 场景 | 释放时机 |
|---|---|
| **A. 正常关停**（SIGTERM / server.close） | `server.close()` 显式调用 `pg_advisory_unlock`，然后 pool.end() 关连接 |
| **B. Fastify 进程 crash（未捕获异常 / OOM）** | pg 客户端 socket 关闭 → PG 立即释放该 session 的所有 advisory lock |
| **C. 进程被 SIGKILL / 硬 crash（半连接）** | PG 靠 `tcp_keepalives_idle` 检测（生产已配 300s），最坏 5 分钟内释放 |

场景 C 是唯一有窗口期的路径，最坏情况：**旧进程死了、TCP 半开、新进程重启后 5 分钟内拿不到锁 → tick 停摆 5 分钟 → 5 分钟后新进程拿到锁开始 tick → 该跑的规则被 `next_run_at ≤ now` 自然拉到并处理**。整个过程无数据丢失，只是延迟。

#### 保守兜底（本期不实现，仅记录）

若未来发现场景 C 频繁发生（比如 K8s 频繁 pod OOM kill），可以引入：
- Session 级 `SET idle_in_transaction_session_timeout = 60s`（应用有 pending 事务时 60s 强制断连）
- 或改用 `pg_advisory_xact_lock`（**事务级锁**，事务结束就释放，但不适合我们跨越整个 tick 的场景）

本期采用最简方案：**session-level lock + 依赖 PG 的自动释放**，crash 恢复窗口最长 5 分钟，可接受。

---

## 4. 数据模型

新增 migration：`server/db/migrations/0011_recurring_entries.sql`。**同时更新 `server/test/setup.ts` 内嵌 DDL**（项目硬约定，见 MEMORY.md）。

### 4.1 新表 `recurring_rules`（v0.2 · 数组化）

```sql
-- ═══ ENUM ═══════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE recurring_period AS ENUM (
    'weekly',      -- 每周
    'biweekly',    -- 每两周
    'monthly',     -- 每月
    'bimonthly',   -- 每两月
    'trimonthly',  -- 每三月（与旧 v0.1 'quarterly' 语义不同，命名区分）
    'yearly'       -- 每年
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE recurring_bucket AS ENUM (
    'dawn', 'morning', 'afternoon', 'night'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE recurring_status AS ENUM (
    'active',   -- 正常运行
    'paused',   -- 用户手动禁用
    'ended',    -- 达到 end_date 后自然停止
    'auto_paused'  -- 系统兜底禁用（如账本失效、连续失败 3 次）
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══ 主表 ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS recurring_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id       UUID NOT NULL REFERENCES ledgers(id) ON DELETE RESTRICT,
    -- ★ RESTRICT 而非 CASCADE：账本被删时不联动删规则，而是走 auto_paused 状态
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 模板字段（透传给生成的 entry）
  type            entry_type NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'CNY',
  category_id     UUID REFERENCES categories(id),
  account_id      UUID,
  to_account_id   UUID,
  note            TEXT CHECK (char_length(COALESCE(note, '')) <= 200),
  shared_type     entry_shared_type,
  CONSTRAINT chk_recurring_shared_type_scope CHECK (
    shared_type IS NULL OR type = 'expense'
  ),

  -- 周期配置（v0.2 · 数组化）
  period          recurring_period NOT NULL,

  -- 每周 / 每两周：1=周一 ... 7=周日（对齐 ISO-8601 · 与国内周历习惯一致）
  days_of_week    SMALLINT[],
    -- 用于每周 / 每两周；其它 period 时 NULL

  -- 每月 / 每两月 / 每三月：1..31
  days_of_month   SMALLINT[],
    -- 用于 monthly / bimonthly / trimonthly；其它 period 时 NULL

  -- 每年：编码为 month*100 + day，如 1/1 → 101, 12/25 → 1225
  year_month_days INTEGER[],
    -- 用于 yearly；其它 period 时 NULL

  -- 时段（v0.2 新增）
  execute_bucket  recurring_bucket NOT NULL,
  execute_hour    SMALLINT NOT NULL CHECK (execute_hour   BETWEEN 0 AND 23),
  execute_minute  SMALLINT NOT NULL CHECK (execute_minute BETWEEN 0 AND 59),
    -- ★ execute_hour/minute 由后端 assignBucketMinute() 首次创建时写入 · 客户端不可直接指定

  timezone        TEXT NOT NULL,

  -- 生命周期
  start_date      DATE NOT NULL,
  end_date        DATE,
  status          recurring_status NOT NULL DEFAULT 'active',
  next_run_at     TIMESTAMPTZ NOT NULL,
  last_run_at     TIMESTAMPTZ,
  last_run_status TEXT,           -- 'ok' | 'ok_with_skipped'（本次有部分漏跑日超窗口 skip）
                                  -- | 'failed_ledger_deleted' | 'failed_user_left_family'
                                  -- | 'auto_paused_after_3_failures'
  consecutive_failures SMALLINT NOT NULL DEFAULT 0
                  CHECK (consecutive_failures >= 0),
    -- 连续失败计数 · 3 次转 auto_paused（见 §11.3）

  -- 审计 / 版本
  change_seq      BIGINT NOT NULL DEFAULT nextval('entries_change_seq'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  version         INTEGER NOT NULL DEFAULT 1,

  -- ═══ 完整性 CHECK ══════════════════════════════════════════
  -- 六档 period 与字段的互斥关系
  CONSTRAINT chk_recurring_period_fields CHECK (
    (period IN ('weekly', 'biweekly')
       AND days_of_week IS NOT NULL
       AND days_of_month IS NULL
       AND year_month_days IS NULL) OR
    (period IN ('monthly', 'bimonthly', 'trimonthly')
       AND days_of_month IS NOT NULL
       AND days_of_week IS NULL
       AND year_month_days IS NULL) OR
    (period = 'yearly'
       AND year_month_days IS NOT NULL
       AND days_of_week IS NULL
       AND days_of_month IS NULL)
  ),

  -- 数组长度上限（差异化 · 对应产品 §4.2）
  CONSTRAINT chk_recurring_days_of_week_len CHECK (
    days_of_week IS NULL OR
    (cardinality(days_of_week) BETWEEN 1 AND 7)
  ),
  CONSTRAINT chk_recurring_days_of_month_len CHECK (
    days_of_month IS NULL OR
    (cardinality(days_of_month) BETWEEN 1 AND 14)
  ),
  CONSTRAINT chk_recurring_year_month_days_len CHECK (
    year_month_days IS NULL OR
    (cardinality(year_month_days) BETWEEN 1 AND 12)
  )

  -- 注：数组元素范围 CHECK（如 days_of_week 元素 ∈ [1,7]）用 partial CHECK 表达
  -- 会让 pg-mem 失败（不支持复杂子查询）；改由 service 层校验，DB 层只做长度上限
);

-- ═══ 索引 ═══════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_recurring_rules_next_run
  ON recurring_rules (next_run_at)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_rules_created_by
  ON recurring_rules (created_by)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_rules_ledger
  ON recurring_rules (ledger_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_rules_change_seq
  ON recurring_rules (change_seq);

-- ═══ 触发器 ═══════════════════════════════════════════════
CREATE TRIGGER trg_recurring_rules_updated_at
  BEFORE UPDATE ON recurring_rules
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

### 4.2 `entries` 表新增列

```sql
ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS source_recurring_id UUID
    REFERENCES recurring_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_entries_source_recurring
  ON entries (source_recurring_id)
  WHERE source_recurring_id IS NOT NULL AND deleted_at IS NULL;
```

- `ON DELETE SET NULL`：删除规则时**保留历史 entry**，只把外键清空（与产品 §8.2 "历史 entry 不受影响"一致）
- entryService.create 支持 opts.sourceRecurringId 参数（详见 §6.1）

### 4.3 撤销的表（v0.1 → v0.2）

- **删除 `recurring_pending_entries` 表**（不再有 confirm 模式）
- **删除 `recurring_pending_status` ENUM**
- **删除 `recurring_mode` ENUM**（`auto` 是唯一模式，无需 ENUM）

### 4.4 幂等键设计

**核心幂等约束**：同一规则同一"应生成日"最多产生一条 entry。

- 借用 `entries.uq_entries_ledger_client_ref`（已有）：
  - `client_ref_id = 'rec_<rule_id_short8>_<YYYY-MM-DD>'`
  - 例：规则 id 前 8 字符 = `a1b2c3d4`，日期 `2026-08-05` → `rec_a1b2c3d4_2026-08-05`
- 单条规则同一天多次触发（tick 重跑）自动被 unique 约束拦截
- `run-now`（手动立即执行）用不同 key 域：`rec_<rule_id_short8>_manual_<epoch_ms>`，与常规触发不冲突

### 4.5 pg-mem 适配（v0.2 · 风险 R2）

**pg-mem 已知短板**（需 Day 1 spike 验证）：
| 特性 | pg-mem 是否支持 | 生产 PG | 应对 |
|---|---|---|---|
| `SMALLINT[]` / `INTEGER[]` 列 | 部分支持 · 可以 INSERT/SELECT | ✅ | 主流程 OK |
| `cardinality(arr) BETWEEN X AND Y` CHECK | 待验证 | ✅ | 若不支持则**测试环境跳过该 CHECK**，只保留生产 PG，与 partial unique index 兜底策略一致 |
| `= ANY(arr)` 索引优化 | 待验证 | ✅ | 测试环境接受表扫，规则量小无性能问题 |
| `unnest(arr)` | 支持 | ✅ | OK |
| `pg_try_advisory_lock()` | ❌ 不支持 | ✅ | 测试环境用 mock，跳过锁调用（在 scheduler 里加 `if (isTestEnv) return true`） |
| ENUM 类型 | 部分支持 · 已知项目里都用 TEXT + CHECK 替代 | ✅ | pg-mem 里的 recurring_period 用 `TEXT CHECK (period IN (...))` 替代 |

**Spike 计划**：D1 上午 30 分钟：把 `recurring_rules` DDL 直接跑到 pg-mem，验证 CHECK / array / index。失败则调整策略。

### 4.6 生产 PG 兼容性

生产 PG 15+ · 全部支持上述特性。**PG 数组索引**（GIN on `= ANY(arr)`）本期**不建**：规则量小（预计 < 10k），线性扫足够。

---

## 5. API 契约

新增到 `server/api/openapi.yaml`。所有路径挂 `/v1` 前缀，鉴权走现有 JWT。

### 5.1 数据结构

```yaml
components:
  schemas:
    RecurringRule:
      type: object
      required:
        - id
        - ledger_id
        - created_by
        - type
        - amount
        - currency
        - period
        - execute_bucket
        - execute_hour
        - execute_minute
        - timezone
        - start_date
        - status
        - next_run_at
        - created_at
        - updated_at
        - version
      properties:
        id: { type: string, format: uuid }
        ledger_id: { type: string, format: uuid }
        created_by: { type: string, format: uuid }

        type: { type: string, enum: [income, expense, transfer] }
        amount: { type: integer, minimum: 1, description: "单位:分" }
        currency: { type: string, default: CNY }
        category_id: { type: string, format: uuid, nullable: true }
        account_id: { type: string, format: uuid, nullable: true }
        to_account_id: { type: string, format: uuid, nullable: true }
        note: { type: string, maxLength: 200, nullable: true }
        shared_type: { type: string, enum: [personal, shared], nullable: true }

        period:
          type: string
          enum: [weekly, biweekly, monthly, bimonthly, trimonthly, yearly]

        days_of_week:
          type: array
          items: { type: integer, minimum: 1, maximum: 7 }
          minItems: 1
          maxItems: 7
          nullable: true
          description: "1=周一, 7=周日"
        days_of_month:
          type: array
          items: { type: integer, minimum: 1, maximum: 31 }
          minItems: 1
          maxItems: 14
          nullable: true
        year_month_days:
          type: array
          items: { type: integer, minimum: 101, maximum: 1231 }
          minItems: 1
          maxItems: 12
          nullable: true
          description: "元素 = month*100 + day. 例: 1/1 → 101, 12/25 → 1225"

        execute_bucket: { type: string, enum: [dawn, morning, afternoon, night] }
        execute_hour:   { type: integer, minimum: 0, maximum: 23, readOnly: true }
        execute_minute: { type: integer, minimum: 0, maximum: 59, readOnly: true }
        timezone:       { type: string, example: "Asia/Shanghai" }

        start_date: { type: string, format: date }
        end_date:   { type: string, format: date, nullable: true }
        status:
          type: string
          enum: [active, paused, ended, auto_paused]
          readOnly: true    # 客户端通过 pause/resume endpoint 切换

        next_run_at:     { type: string, format: date-time, readOnly: true }
        last_run_at:     { type: string, format: date-time, nullable: true, readOnly: true }
        last_run_status: { type: string, nullable: true, readOnly: true }

        created_at: { type: string, format: date-time, readOnly: true }
        updated_at: { type: string, format: date-time, readOnly: true }
        deleted_at: { type: string, format: date-time, nullable: true, readOnly: true }
        version:    { type: integer, minimum: 1, readOnly: true }

    RecurringRuleCreate:
      # 由 RecurringRule 派生，去除所有 readOnly · status 也不接受用户指定
      type: object
      required:
        - ledger_id
        - type
        - amount
        - period
        - execute_bucket
        - timezone
        - start_date
      # ... 其余字段同 RecurringRule 非 readOnly 部分
```

### 5.2 路径（v0.2 · 撤销 pending 系列）

```yaml
paths:
  /v1/recurring-entries:
    get:
      summary: 列出当前用户创建的定时（跟人不跟账本）
      description: |
        始终按 created_by = 当前用户 过滤 · 不接受 ledger_id 参数
      parameters:
        - name: status
          in: query
          schema: { type: string, enum: [active, paused, ended, auto_paused, all] }
          description: 默认 all（列表页需要一并显示禁用规则）
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { $ref: '#/components/schemas/RecurringRule' }

    post:
      summary: 新建定时
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/RecurringRuleCreate' }
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/RecurringRule' }
        '403': { $ref: '#/components/responses/Forbidden' }

  /v1/recurring-entries/{id}:
    get:    { summary: 详情 · 只能取自己创建的 }
    patch:
      summary: 编辑（需带 version · 乐观锁）
      requestBody:
        content:
          application/json:
            schema:
              allOf:
                - $ref: '#/components/schemas/RecurringRuleCreate'
                - type: object
                  required: [version]
                  properties: { version: { type: integer, minimum: 1 } }
      responses:
        '200': { description: OK }
        '409': { description: 版本冲突 }
    delete:
      summary: 软删除（不动历史 entry）
      parameters:
        - name: version
          in: query
          required: true
          schema: { type: integer, minimum: 1 }
      responses:
        '204': { description: No Content }

  /v1/recurring-entries/{id}/pause:
    post: { summary: 手动禁用 · status → paused }

  /v1/recurring-entries/{id}/resume:
    post: { summary: 手动启用 · status → active + 重算 next_run_at }

  /v1/recurring-entries/{id}/copy:
    post:
      summary: 复制规则
      description: 服务端创建一条与该规则字段完全相同的新规则，返回新规则
      responses:
        '201': { description: Created, content: { application/json: { schema: { $ref: '#/components/schemas/RecurringRule' } } } }
```

**撤销的路径**（v0.1 → v0.2）：
- `/v1/recurring-entries/{id}/run-now`（**撤销** · 产品未提及"手动立即执行一次"）
- `/v1/recurring-pending*`（全部撤销）

### 5.3 权限规则（v0.2 · 收敛到 created_by）

- **所有写操作**（POST/PATCH/DELETE/pause/resume/copy）：仅 `created_by === userId` 允许，其它一律 403
- **GET list / GET detail**：仅返回 `created_by = 当前用户` 的规则，其它用户看不到（即使是同一家庭账本的 owner 也看不到别人的定时列表）
- 与产品 §3 "跟人不跟账本"完全对齐

### 5.4 校验规则（服务层）

`recurringService.validateCreate(payload)` 必须校验：

| 字段 | 规则 |
|---|---|
| `type = 'expense'` | `shared_type` 必填 |
| `type ∈ ('income','transfer')` | `shared_type` 必须为 null |
| `period ∈ ('weekly','biweekly')` | `days_of_week` 非空 · 长度 1~7 · 每元素 ∈ [1,7] · 无重复 |
| `period ∈ ('monthly','bimonthly','trimonthly')` | `days_of_month` 非空 · 长度 1~14 · 每元素 ∈ [1,31] · 无重复 |
| `period = 'yearly'` | `year_month_days` 非空 · 长度 1~12 · 每元素满足 `month ∈ [1,12] AND day ∈ [1, daysInMonth(month)]`（2 月放开到 29） · 无重复 |
| `start_date` | `≥ 今日 - 1 天`（用户时区） |
| `end_date` | 若非 null，则 `> start_date` |
| `execute_bucket` | 枚举合法 |
| `ledger_id` | 归属于**当前用户**（`assertUserOwnsLedger(userId, ledgerId)`：检查用户是否是该 ledger 所属 family 的 active member） |

**验证失败**：返回 400 + 具体字段路径，前端 toast。

### 5.5 服务端在 create/patch 时自动填充的字段

用户不能直接设置以下字段，由 service 层计算填入：

- `execute_hour / execute_minute`：`assignBucketMinute(userId, ruleId, bucket)` 见 §3.5
- `timezone`：快照自 `users.timezone`
- `next_run_at`：`computeNextRunAt(rule, start_date at execute_hour:execute_minute in timezone)` 见 §7
- `status`：默认 `active`
- `version`：默认 `1`
- `consecutive_failures`：默认 `0`

---

## 6. 与既有系统的耦合

### 6.1 entryService 复用（v0.1 → v0.2 无变化）

```ts
// server/src/services/entryService.ts · 新增可选参数
async createWithIdempotency(
  userId: string,
  payload: CreateEntryPayload,
  clientRefId: string,
  opts?: { sourceRecurringId?: string },
): Promise<{ status: 'ok' | 'duplicate'; serverId: string }>;
```

- 内部 INSERT 时写 `source_recurring_id`
- audit_log 里 diff 包含 `source_recurring_id`

### 6.2 Sync 增量协议（v0.1 → v0.2 微调）

- `recurring_rules` **不参与 pull sync**（低频对象，前端列表页每次 GET 独立获取）
- **生成的 entries** 天然通过 `entries_change_seq` 进入 sync
- 客户端 outbox：定时规则的写操作**不入 outbox**，弱网时报错让用户重试（用户设定时场景必在线）

### 6.3 audit_log（v0.2 · 撤销 pending 相关事件）

- `entity='recurring_rule', action ∈ {create, update, pause, resume, delete, copy, execute, execute_failed, skip_out_of_backfill_window, auto_paused_after_3_failures}`
  - `execute` · diff 附 `{ generated_count, generated_dates[] }`
  - `skip_out_of_backfill_window` · diff 附 `{ skipped_at }` · 补偿窗口 = 7 天（见 §3.4 `BACKFILL_WINDOW_MS`）
  - `auto_paused_after_3_failures` · diff 附 `{ last_error }`
- 生成的 entry 的 audit 里 `client.reason = 'recurring'`，便于运营侧统计

### 6.4 订阅消息（v0.1 → v0.2 全部撤销）

产品 §2.1 明确：**本期不做任何推送**。

- 不申请新模板 ID
- 执行失败不推给用户，只写内部 log + audit + 连续 3 次转 `auto_paused`
- 二期若有反馈再评估是否加"上次定时执行失败"的红点提示

### 6.5 明细页角标（`ledger/index.wxml` 改造）

现有：
```wxml
<view wx:if="{{entry.isShared}}" class="entry-member__badge">
  <text class="entry-member__badge-text">公</text>
</view>
```

改造为容器化，支持并排"定 公"：
```wxml
<view wx:if="{{entry.isRecurring || entry.isShared}}" class="entry-member__badge">
  <text wx:if="{{entry.isRecurring}}"
        class="entry-member__badge-text entry-member__badge-text--recurring">定</text>
  <text wx:if="{{entry.isShared}}"
        class="entry-member__badge-text">公</text>
</view>
```

CSS 新增：
```css
.entry-member__badge {
  display: flex;
  gap: 2rpx;
  /* 其余保持不变 */
}
.entry-member__badge-text--recurring {
  color: #A88A5E;   /* 莫兰迪砂棕 · 产品 §6.3 定稿 */
  /* text-shadow 复用 base 类 */
}
```

`entry.isRecurring` 由 `_buildDisplay` 从 `source_recurring_id != null` 计算，`entriesApi.ts` 的 `toLocalEntry` 需要新增该字段透传。

---

## 7. next_run_at 计算算法（v0.2 · 数组遍历）

统一封装在 `server/src/services/recurringSchedule.ts` + `miniprogram/services/recurringSchedule.ts`（**同源双份**）。

### 7.1 依赖选型：Luxon

**决定引入 `luxon`**（3.5+，MIT），理由：
- Node/浏览器双端可用（前后端同源硬需求）
- 内置 IANA 时区 · 无需 tzdata 额外维护
- API 简单，`DateTime.fromObject({...}, { zone })` 直接产出 zoned datetime
- 体积可控：小程序端 gzip 后 ~40KB（Luxon 主包含 zone data ~200KB，但可 tree-shake 只留核心）

**替代方案排除**：
- 自研：闰年 + 时区 + 跨月，60 行是拿不下的
- Temporal polyfill：仍是提案 stage，不稳定
- date-fns：无 timezone 一等公民支持
- dayjs + timezone plugin：可行但 API 不如 luxon 精准

### 7.2 语义

```ts
export function computeNextRunAt(rule: RecurringRuleForCompute, from: Date): Date;
```

- 输入 `from`：起点。初次为 `start_date at execute_hour:execute_minute in rule.timezone`；后续为上一次 `next_run_at`
- 输出：**严格大于** `from` 的下一次匹配时点（in `rule.timezone`），返回 UTC `Date`
- 若返回值 > `end_date at 23:59:59 in timezone`：由 caller 决定置规则 `status='ended'`

### 7.3 通用算法（伪代码）

```ts
import { DateTime } from 'luxon';

export function computeNextRunAt(rule: RecurringRuleForCompute, from: Date): Date {
  const tz = rule.timezone;
  const fromZ = DateTime.fromJSDate(from, { zone: tz });

  // 起点：from 之后的第一个候选（with execute_hour:execute_minute）
  let cursor = fromZ.plus({ minutes: 1 }).set({
    hour: rule.execute_hour,
    minute: rule.execute_minute,
    second: 0,
    millisecond: 0,
  });
  // 若 cursor 反而小于 from（因 set 回退到当天早点），推进到下一天
  if (cursor <= fromZ) cursor = cursor.plus({ days: 1 });

  // 循环：找到第一个匹配 rule 定义日的时点
  // 因为周期有上限（每周最坏推 7 天 · 每年最坏推 365 天），循环次数有硬上限，防死循环
  const MAX_ITER = 800;   // 每年最坏 366 + buffer
  for (let i = 0; i < MAX_ITER; i++) {
    const match = tryMatchOnDay(rule, cursor);
    if (match) return match.toJSDate();
    cursor = cursor.plus({ days: 1 });
  }
  throw new Error('computeNextRunAt: no match within 800 days · rule 配置异常');
}
```

### 7.4 tryMatchOnDay：核心匹配函数

```ts
function tryMatchOnDay(
  rule: RecurringRuleForCompute,
  cursor: DateTime  // 已经 set 到 execute_hour:execute_minute
): DateTime | null {

  switch (rule.period) {
    case 'weekly':
      // ISO weekday: 1=Mon..7=Sun · Luxon 的 .weekday 恰好一致
      return rule.days_of_week!.includes(cursor.weekday as number)
        ? cursor : null;

    case 'biweekly': {
      // 需要计算 cursor 是否在"活跃周"
      // 基准周 = start_date 所在自然周（周一为一周开始）
      const baseMonday = DateTime.fromISO(rule.start_date, { zone: rule.timezone })
        .startOf('week');  // Luxon 默认 startOfWeek = 周一
      const cursorMonday = cursor.startOf('week');
      const weeksDiff = Math.round(cursorMonday.diff(baseMonday, 'weeks').weeks);
      if (weeksDiff % 2 !== 0) return null;
      return rule.days_of_week!.includes(cursor.weekday as number)
        ? cursor : null;
    }

    case 'monthly':
    case 'bimonthly':
    case 'trimonthly': {
      // 是否在活跃月
      const baseMonth = DateTime.fromISO(rule.start_date, { zone: rule.timezone })
        .startOf('month');
      const cursorMonth = cursor.startOf('month');
      const monthsDiff = Math.round(
        cursorMonth.diff(baseMonth, 'months').months
      );
      const step = rule.period === 'monthly' ? 1
                 : rule.period === 'bimonthly' ? 2
                 : 3;
      if (monthsDiff % step !== 0) return null;

      // 展开当次周期应命中的日子（含 31→月末回落）
      return matchDayOfMonth(cursor, rule.days_of_month!);
    }

    case 'yearly': {
      // year_month_days 已编码 · 拆出所有 (month, day) 命中当前 cursor 的 (M, D)
      const M = cursor.month;
      const D = cursor.day;
      const daysInThisMonth = cursor.daysInMonth!;
      for (const encoded of rule.year_month_days!) {
        const eM = Math.floor(encoded / 100);
        const eD = encoded % 100;
        if (eM !== M) continue;
        // 2/29 平年落 2/28
        const targetD = (eM === 2 && eD === 29 && daysInThisMonth === 28) ? 28 : eD;
        if (targetD === D) return cursor;
      }
      return null;
    }
  }
}

// 关键辅助：每月类的 31/30/29 回落
function matchDayOfMonth(
  cursor: DateTime,
  days: number[],
): DateTime | null {
  const dim = cursor.daysInMonth!;
  const D = cursor.day;

  // 展开 days 到本月实际生效日集合（回落到月末）
  const effective = new Set<number>();
  for (const d of days) {
    effective.add(Math.min(d, dim));
  }
  return effective.has(D) ? cursor : null;
}
```

### 7.5 前后端一致性保障（v0.2 新增 · 对应风险 R8）

- 后端源：`server/src/services/recurringSchedule.ts`
- 前端源：`miniprogram/services/recurringSchedule.ts`
- 两份文件**内容除了 import 路径外必须 byte-level 完全一致**
- CI 添加 `scripts/verify-recurring-schedule-parity.mjs`：
  ```mjs
  // 读两个文件，去掉第一行 import，剩余部分做 sha256 hash，不一致则 fail
  ```
- 修改一处必须同时修另一处，否则 CI 拒绝合并
- 未来 Sprint 若引入 monorepo shared package 可以彻底解决，本期先用 CI 校验

### 7.6 单元测试用例矩阵（v0.2 · 100+ 场景）

按周期档位分组，每档必测：正常周期推进 · 边界（月末/闰年）· 极端（起始日=今天/时段已过） · 端到端（跨年）：

| 组 | 用例数 | 关键场景 |
|---|---|---|
| weekly | 15 | 单选/多选/全周 · 跨周 · 起始日今日+时段未过 · 时段已过 |
| biweekly | 12 | 基准周判定 · W0/W1/W2 · start_date 是周日 · 暂停后恢复 |
| monthly | 20 | 单选/多选 · 31 号在 2/4/6/9/11 月回落 · 15+31 组合 · 闰年 2/29 |
| bimonthly | 8 | 基准月判定 · M0/M1/M2 · 3 月/5 月 |
| trimonthly | 8 | 基准月判定 · 每 3 月推进 · 跨年 |
| yearly | 25 | 单个 (M,D) · 12 天跨月 · 2/29 平年闰年 · 12/31 跨年推进 |
| 时区 | 10 | Asia/Shanghai · America/New_York · UTC · DST 切换（针对未来国际化） |
| 边界 | 5 | end_date 到期 · 长循环上限（连续 800 天不命中应 throw） |
| **合计** | **100+** | |

### 7.7 时区变更策略（v0.1 保留）

- `users.timezone` 变更时**不主动重算** `recurring_rules.timezone` 快照
- 用户在编辑规则时手动改 timezone → 保存时重算 next_run_at

---

## 8. 客户端设计

### 8.1 目录（v0.2 · 撤销 pending 目录 + 撤销 expense-overlay 存为定时按钮）

```
miniprogram/
  pages-recurring/                      # 独立分包
    list/
      index.ts / wxml / wxss / json     # 定时列表页
    edit/
      index.ts / wxml / wxss / json     # 定时编辑页（三卡片）
  components/
    category-picker/                    # ★ 从 expense-overlay 抽出的通用分类选择器
      index.ts / wxml / wxss / json
    tag-grid/                           # ★ 新增：通用 tag 网格控件（7/31/12 三种模式）
      index.ts / wxml / wxss / json
  services/
    recurringApi.ts                     # /v1/recurring-entries CRUD 封装
    recurringSchedule.ts                # ★ 与后端 byte-level 同源的算法
  pages/
    ledger/index.wxml + wxss            # 明细页 badge 容器化 · 支持 "定 公" 并排
    mine/index.wxml + ts                # 首页菜单新增 "定时记账" 入口
  pages-family/settings/                # 撤销原设置页的"定时记账"占位入口
    index.wxml
```

- 分包名 `pages-recurring`
- 预计代码量 ~55KB（比 v0.1 的 40KB 略大，主要是 tag 网格控件 + 摘要条 + 三种控件形态切换逻辑）
- 主包 ≤ 2MB 无压力

### 8.2 通用分类选择器 `category-picker` 抽离

现状：`expense-overlay/index.ts` 内嵌了完整的 category swiper（COSTRA-228 引入），耦合了记账面板本身的 keypad 动效。

抽离方案：
1. 在 `expense-overlay/categories.ts` 保留数据加载函数（复用）
2. 把 `expense-overlay/index.wxml` 的 `<swiper class="category-swiper">…</swiper>` 部分单独提为 `components/category-picker/`
3. 新组件接受 `props: { value: CategoryId, onSelect: (cat) => void, allowCrossType: boolean }`
4. `expense-overlay` 内嵌 `<category-picker :allow-cross-type="false" />`
5. 定时编辑页嵌 `<category-picker :allow-cross-type="true" />` 允许跨 type 选择

**成本估计**：0.5 人天。风险：需要小心保留 COSTRA-228 的横滑跟手 + auto-height 适配。

### 8.3 通用 tag 网格控件 `tag-grid`

抽出通用 tag 多选控件，一个组件三种模式：

```ts
type TagGridMode =
  | { kind: 'dow', maxSelected: 7 }               // 每周/每两周
  | { kind: 'dom', maxSelected: 14, dim: number } // 每月类 · dim=31
  | { kind: 'year-month-day', maxSelected: 12 }   // 每年 · 内部自管月份 tab
```

Props：
```ts
{
  mode: TagGridMode;
  value: number[] | Record<number, number[]>;  // year-month-day 用 { [month]: number[] }
  onChange: (next) => void;
  onOverLimit: (attemptedTag) => void;  // 上限拦截钩子，由控件消费者决定 toast/震动/抖动
}
```

单一组件覆盖所有档位，减少三份 UI 代码重复。

### 8.4 SWR 缓存

- `recurringApi.list()`：storage key `recurring:list:<user_id>`（**跟人不跟账本**，与产品 §3 归属模型对齐）
- TTL 2 min
- 列表页 onShow：先渲染缓存 → 后台 refetch
- SYNC_DONE 事件失效缓存（因 SYNC 会带来新 entry，用户想立即看到"上次执行状态"）

### 8.5 撤销的客户端改造（v0.1 → v0.2）

- **撤销** `expense-overlay` 的"存为定时"按钮
- **撤销** ledger 页顶部"待确认" 提示条
- **撤销** 明细页长按菜单顶部"由...生成"信息条
- **撤销** `pages-recurring/pending/` 目录

### 8.6 表单校验（v0.2 · 差异化上限）

前端本地 zod-like schema，与后端 openapi 手工同步（沿用项目现状 · 无 codegen）：

```ts
const daysOfWeekSchema = z.array(z.number().int().min(1).max(7))
  .min(1).max(7).refine(a => new Set(a).size === a.length);

const daysOfMonthSchema = z.array(z.number().int().min(1).max(31))
  .min(1).max(14).refine(a => new Set(a).size === a.length);

const yearMonthDaysSchema = z.array(z.number().int().min(101).max(1231))
  .min(1).max(12)
  .refine(a => new Set(a).size === a.length)
  .refine(a => a.every(encoded => {
    const m = Math.floor(encoded / 100);
    const d = encoded % 100;
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonthWithLeap(m);
  }));
```

### 8.7 前端 computeNextRunAt 的调用

编辑页卡片 3 "预计下次执行" 每次用户改字段就重算：
```ts
// 无 luxon 时把 luxon 打进分包也可行（分包体积 ~200KB · 可接受）
// 或用 tree-shake 只保留核心（DateTime + Zone）
import { computeNextRunAt } from '../../services/recurringSchedule';

previewNextRun() {
  if (!this.isFormValid()) return '—';
  try {
    const next = computeNextRunAt(this.buildRule(), new Date());
    return this.formatPreviewDate(next);
  } catch { return '—'; }
}
```

---

## 9. 可观测

### 9.1 日志

- 每次 tick 结束：`{ event: 'recurring.tick.done', processed, skipped, failed, took_ms }`
- 每条规则执行：`{ event: 'recurring.execute', rule_id, entries_created, success }`
- 失败：`{ event: 'recurring.execute_failed', rule_id, reason, consecutive_failures }`
- 自动禁用：`{ event: 'recurring.auto_paused', rule_id, reason }`

### 9.2 Prometheus 指标

```
costra_recurring_active_rules{}                    gauge
costra_recurring_tick_duration_seconds             histogram
costra_recurring_executed_total{status}            counter
                                    # status ∈ {ok, failed, skipped_overdue}
costra_recurring_auto_paused_total                 counter
costra_recurring_entries_created_total             counter
```

### 9.3 告警（企微机器人）

- 单 tick > 30s 连续 3 次
- `costra_recurring_executed_total{status="failed"}` 5min 增量 > 5
- `costra_recurring_auto_paused_total` 24h 增量 > 3（说明有多个规则真的连续失败了）

---

## 10. 测试策略

### 10.1 单元测试

- `computeNextRunAt`：§7.6 表中 100+ 场景（每档 padded 到独立文件 · `recurringSchedule.weekly.spec.ts` 等）
- `assignBucketMinute`：稳定性验证（同 userId+ruleId → 同 hour/minute）· 窗口内均匀分布验证
- `matchDayOfMonth`：31 号在 2/4/6/9/11 月的回落
- `recurringService.validateCreate`：字段互斥 · 数组长度 · 元素范围 · 无重复
- `recurringService.assertUserOwnsLedger`：跨用户越权阻断

### 10.2 集成测试

- 端到端场景：`POST` 创建 → mock 时间到 next_run_at → 调 tick → 断言 `entries` 表出现记录 → 断言 `next_run_at` 已推进
- 跨月 12 天场景：一次触发生成 12 条 entry · 全部 `client_ref_id` 不同 · sync change_seq 连续
- 幂等：同一 next_run_at 两次 tick 只生成一条
- **补齐场景 A**（宕机 48h · 每天下午规则）：tick 一次生成 2 条历史 entry · `occurred_at` 分别是漏跑日的下午 · `next_run_at` 指向今天下午
- **补齐场景 B**（宕机 15 天 · 每天下午规则）：tick 一次生成 7 条历史 entry（最近 7 天）· 8 条 skip audit 记录 · `next_run_at` 追平到今天
- **补齐窗口边界**（宕机恰好 7 天）：验证 `delta ≤ 7 天` 的分界处理，同一天补/skip 决定符合预期
- 每周多选：一个规则生成 3 条 entry（周一 + 周三 + 周五）
- **占卜 hash 均匀性**：随机 1000 个 (userId, ruleId) 分配到 morning bucket → 分布区间严格在 [06:30, 11:29] · 无 06:00~06:29 与 11:30~11:59 落点
- **Advisory lock 释放**：mock 连接断开 → 下轮 tick 能成功拿到锁

**基线要求**：148 → 220+，全部绿灯。

### 10.3 前后端算法一致性

`scripts/verify-recurring-schedule-parity.mjs` CI 卡关：
- 读 `server/src/services/recurringSchedule.ts` 和 `miniprogram/services/recurringSchedule.ts`
- 去掉第一行 import 后做 sha256
- 不一致 → CI red

### 10.4 QA 手工用例

产品方案 §10 验收清单 → `qa/recurring-entry-manual-cases.md`。

---

## 11. 回滚与容灾

### 11.1 上线开关

- 环境变量 `COSTRA_RECURRING_ENABLED=1`，默认 `0`
- 关闭时：调度器不启动 · CRUD 路由返回 `501 Not Implemented`
- 前端根据 `/v1/features` 端点决定是否显示 mine 入口

### 11.2 回滚步骤

1. `COSTRA_RECURRING_ENABLED=0` 重启 API · 调度器停 · 已生成的 entry 保留
2. 前端 flag 立即隐藏入口（避免用户困惑）
3. 极端情况 → `0011_recurring_entries.down.sql`：
   ```sql
   -- 保留 entries.source_recurring_id 列不删（避免断链）
   DROP TABLE IF EXISTS recurring_rules;
   UPDATE entries SET source_recurring_id = NULL WHERE source_recurring_id IS NOT NULL;
   ```

### 11.3 单条规则的降级策略

- 生成 entry 失败 → 事务回滚 · `consecutive_failures + 1` · 下轮 tick 重试
- 连续 3 次失败 → `status = 'auto_paused'` · `last_run_status='auto_paused_after_3_failures'` · 写 audit · 内部日志（不推给用户）
- 用户看到列表页里该规则头顶红字："⚠ 最近执行失败，请检查规则"，可手动 resume

### 11.4 账本失效的处理

- 用户被移出家庭 / 账本被删 → 后端**懒检测**：tick 前先查 `ledger + membership`
- 失效则 `status = 'auto_paused'` · `last_run_status = 'ledger_deleted' | 'user_left_family'` · 写 audit
- 不主动扫全表纠错，避免调度器变复杂

---

## 12. 交付里程碑（对齐 Sprint-4）

| Day | 交付 | 负责 |
|---|---|---|
| **D0** | 本方案（v0.2.1）+ 产品方案（v0.3.2）冻结 · G3 契约闸门 | PM + Backend + MiniApp |
| **D1 上** | **pg-mem spike**：验证 array + cardinality CHECK | Backend |
| D1 下 | migration + `test/setup.ts` 双写 + 引入 luxon | Backend |
| **D2** | `computeNextRunAt` + `assignBucketMinute` + 100 单测 | Backend |
| **D3** | `recurringRepo` + `recurringService`（校验/权限）+ CRUD 路由 | Backend |
| **D4** | `recurringScheduler` + 集成测试（时钟 mock + 幂等 + 补偿）+ CI parity 校验脚本 | Backend |
| **D5** | 客户端分包骨架 + `recurringApi` + list 页 | MiniApp |
| **D6** | edit 页三卡片 · `tag-grid` 控件 · 三种模式 | MiniApp |
| **D7** | `category-picker` 抽离 · 明细页 badge 容器化 · mine 入口 | MiniApp |
| **D8** | 埋点 + Prometheus + 告警规则 · dashboard 面板 | DevOps |
| **D9** | QA 手工验收 + `qa/recurring-entry-manual-cases.md` | QA |
| **D10** | Human G4 → 灰度 10% → 观察 24h → G5 全量 | Human + DevOps |

---

## 附：契约 diff 清单（G3 闸门材料）

**新增**：
- `server/db/migrations/0011_recurring_entries.sql`
- `server/api/openapi.yaml`：新增 `/v1/recurring-entries` 5 个路径 + `RecurringRule` schema
- `server/src/repositories/recurringRepo.ts`
- `server/src/services/recurringService.ts`
- `server/src/services/recurringSchedule.ts`（纯函数 · 前后端同源）
- `server/src/services/recurringScheduler.ts`（tick loop）
- `server/src/routes/recurring.ts`
- `miniprogram/services/recurringApi.ts`
- `miniprogram/services/recurringSchedule.ts`（byte-level 同 server 端）
- `miniprogram/pages-recurring/**`（list / edit 两页）
- `miniprogram/components/category-picker/**`（从 expense-overlay 抽离）
- `miniprogram/components/tag-grid/**`
- `scripts/verify-recurring-schedule-parity.mjs`

**变更**：
- `server/test/setup.ts` DDL 内嵌（同步 0011）
- `server/src/services/entryService.ts`（新增可选 `sourceRecurringId`）
- `server/src/app.ts`（挂载 scheduler + 优雅停机）
- `server/package.json`（+ luxon 依赖）
- `miniprogram/components/expense-overlay/**`（内嵌 `category-picker` · 撤销"存为定时"）
- `miniprogram/pages/ledger/index.wxml + wxss`（badge 容器化 · 支持 "定 公" 并排）
- `miniprogram/pages/mine/index.wxml + ts`（首页菜单增加"定时记账"入口）
- `miniprogram/pages-family/settings/index.wxml`（撤销"定时记账"占位）
- `miniprogram/app.json`（subpackages 追加 `pages-recurring`）

**撤销**（v0.1 → v0.2）：
- 无独立 pending 系列路径 / 表 / repo / service
- 无 `expense-overlay` 的"存为定时"按钮
- 无 ledger 页顶部待确认条
- 无长按菜单信息条注入
- 无 `run-now` 端点
