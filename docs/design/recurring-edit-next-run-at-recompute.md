# 定时记账 · 编辑规则如何更新「预计下次执行」与触发时机

> 技术 review 文档 · 状态：已落地，待 review
> 关联代码：`server/src/services/recurringService.ts`、`miniprogram/pages-recurring/edit/*`
> 关联产品规格：`docs/design/recurring-entry-product-spec.md` §4.4 / §5.3，技术规格 `recurring-entry-tech-spec.md` §3/§5

---

## 1. 背景：两个关联 Bug

用户反馈并推动修复「定时记账」编辑页的两类问题，二者都围绕 `next_run_at`（服务端权威的"下次执行时间"）在**编辑路径**上的行为。

| Bug | 现象 | 影响面 |
|-----|------|--------|
| **A · 显示陈旧** | 7号创建规则，已触发 7/8/9 号三次后，10号再次点开编辑页，"预计下次执行"仍显示 7号。 | 客户端预览（`computePreviewNextRun`） |
| **B · 保存推迟触发** | 上午规则在上午**只改了备注/金额/分类**（与周期无关），保存后"今天上午尚未触发的定时"被推迟到明天。 | 服务端 `update` 重算逻辑 |

> 注意：两者根因不同，修复也分两处，review 时请分别看待。

---

## 2. 根因分析

### 2.1 Bug A（显示陈旧）— 客户端未消费服务端权威值

编辑页 `_updatePreview` 一律调用本地 `computePreviewNextRun(input, now)` 计算预览。

该函数（`model.ts`）在 `isToday === false`（今天 ≠ 起始日，即绝大多数"非创建当天打开"的场景）时，把 `computeFrom` 锚到：

```ts
: startDateZ.minus({ minutes: 1 }).toJSDate();   // 从起始日 00:00 -1min 起算
```

`computeNextRunAt` 从起始日往后找"下一个匹配日"，第一个匹配日就是**起始日本身**。因此预览永远显示起始日，完全忽略了服务端 `next_run_at` 已经推进到 7/8/9 号之后的事实。

根因一句话：**客户端本地预览是无状态的"从起始日重算"，无法感知服务端已执行过哪些日期**；而服务端已经算好了权威的 `next_run_at`，客户端却没用它。

### 2.2 Bug B（保存推迟触发）— 客户端全量 payload 触发服务端无条件重算

旧版 `_buildSavePayload` 在 edit 模式也发**全量** payload（含所有周期字段）。服务端 `update` 用 `needsRecompute` 判断"8 个周期字段是否出现在 payload 中"：

```ts
const needsRecompute =
  payload.period !== undefined || payload.period_interval !== undefined ||
  payload.days_of_week !== undefined || payload.days_of_month !== undefined ||
  payload.year_month_days !== undefined || payload.timezone !== undefined ||
  payload.start_date !== undefined || payload.execute_bucket !== undefined;
```

因为全量 payload 必然带齐这些字段 → `needsRecompute` **恒为 `true`** → 每次都从 `now` 重算 + 跑 `applyBucketWindowSkip`（进入 bucket 窗口就跳过今天）。

结果：上午规则在上午改个备注 → 落入"已进入 morning 窗口 → 跳过今天 → next_run_at 推到明天"，今天的触发被意外取消。

根因一句话：**客户端发全量 → 服务端无法区分"改了周期"还是"改了备注"，从而把与周期无关的编辑也按"改了时段"处理。**

---

## 3. 设计目标（与用户对齐的预期）

1. **区分「新增」与「修改」两种操作。**
2. **新增规则**：保持现状——"上午新增上午规则 → 统一下一个上午触发"。
3. **修改规则**分三种情形：
   - **情形 1（改了非周期字段，如备注/金额/分类）**：保持原触发时机，`next_run_at` **完全不动**。
   - **情形 2（改了触发时段 `execute_bucket`）**：统一下一个时段（与新增语义一致，即从 `now` 起算 + 跑 `applyBucketWindowSkip`）。
   - **情形 3（改了周期间隔/匹配日但没改时段 `execute_bucket`）**：保持原触发时机——保留原 `execute_hour/minute`，`next_run_at` 按新周期重算，但**不跑** `applyBucketWindowSkip`（今天的触发机会由 `execute_hour:minute` 与 `now` 的关系决定，而非 bucket 窗口起点）。
4. **边界选项 A**：`next_run_at` 已过期时不跑 `applyBucketWindowSkip`（情形 3）。
5. **pause / resume 行为**：pause 不动 `next_run_at`；resume 从 `now` 重算且不补跑历史（语义与上述一致）。

---

## 4. 方案设计

### 4.1 服务端 `update`：重算分流

核心改动是 `needsRecompute === true` 时**不再一律从 `now` 重算 + 跳过今天**，而是按三个条件分流（`recurringService.ts` L684–L745）：

```ts
// bucket 是否真实变化：仅 payload 显式传了 execute_bucket 且与现有值不同
const bucketChanged =
  payload.execute_bucket !== undefined &&
  payload.execute_bucket !== existing.executeBucket;

// start_date 是否被改：改了意味着用户想"重新从新 start_date 起算"
const startDateChanged =
  payload.start_date !== undefined &&
  payload.start_date !== existing.startDate;

const nowMs = now.getTime();
const startMs = DateTime.fromISO(newStartDate, { zone: newTimezone })
  .startOf('day').toMillis();
const fromStartIsFuture = startMs > nowMs;

if (bucketChanged || startDateChanged || fromStartIsFuture) {
  // 情形 2 / start_date 变化 / start_date 在未来：
  //   从 now（或新 start_date）起算。only bucket 变化才跑跳过。
  const from = fromStartIsFuture ? new Date(startMs - 60_000) : now;
  nextRunAt = computeNextRunAt(forCompute, from);
  if (!fromStartIsFuture && bucketChanged) {
    const newBucket = payload.execute_bucket ?? existing.executeBucket;
    nextRunAt = applyBucketWindowSkip(forCompute, nextRunAt, now, newBucket, newTimezone);
  }
} else {
  // 情形 3（改周期字段但没改时段）：
  //   保留原 execute_hour/minute，next_run_at 按新周期重算，不跑 applyBucketWindowSkip。
  //   from 取 existing.next_run_at（未过期）或 now（已过期，如服务长时间未运行）。
  const existingNextMs = existing.nextRunAt.getTime();
  const from =
    existingNextMs > nowMs ? new Date(existingNextMs - 60_000) : now;
  nextRunAt = computeNextRunAt(forCompute, from);
}
```

三个分支的语义：

| 分支 | 触发条件 | 起算点 `from` | 是否跑 `applyBucketWindowSkip` |
|------|----------|---------------|-------------------------------|
| 情形 2 | `bucketChanged` | `now` | **是**（仅此分支且 `fromStartIsFuture` 为 false） |
| start_date 改/在未来 | `startDateChanged \|\| fromStartIsFuture` | `now` 或 `start_date - 1min` | 否（`bucketChanged` 为 false） |
| 情形 3 | 改了周期字段但 `bucketChanged`/`startDateChanged`/`fromStartIsFuture` 均 false | `existing.next_run_at - 1min`（未过期）或 `now`（已过期） | **否** |
| 情形 1 | `needsRecompute === false`（payload 无周期字段） | — | —（`nextRunAt` 保持 `undefined`，不写入） |

> **关键不变式**：`needsRecompute === false` 时 `nextRunAt` 保持 `undefined`，最终 `if (nextRunAt !== undefined) input.nextRunAt = nextRunAt;` 不覆盖，服务端 `next_run_at` 字段原样保留（情形 1 的"完全不动"由此保证）。

### 4.2 客户端 `_buildSavePayload`：全量 → diff（PATCH）

要让服务端 `needsRecompute` 在"只改备注"时为 `false`，客户端 edit 模式必须**只发变动字段**。

改动（`edit/index.ts` L788–L848）：
- **create / copy 模式**：`_originalRule` 为 null 或 `mode !== 'edit'` → 发全量 `CreateRecurringPayload`。
- **edit 模式**：基于 `_originalRule` 逐字段 diff，只把真正变化的字段塞进 `UpdateRecurringPayload`，并携带 `version` 乐观锁。
- 数组字段（`days_of_week` / `days_of_month` / `year_month_days`）用 `JSON.stringify` 做深比较，`null` vs `[]` 视为不同。
- 返回类型由 `CreateRecurringPayload` 改为联合类型 `CreateRecurringPayload | UpdateRecurringPayload`，调用方（`_doSave` / `_fireAndForgetViewSave`）加 `as` 类型断言。

> 这样"改备注"的 payload 只有 `{ note: '...', version }`，不含任何周期字段 → 服务端 `needsRecompute === false` → 走情形 1。

### 4.3 客户端 `_updatePreview`：优先用服务端权威值（修复 Bug A）

引入两个实例字段：

```ts
_serverNextRunAt: null as string | null;   // edit 加载时缓存 r.next_run_at
_periodFieldsDirty: false as boolean;      // 用户是否改过周期相关字段
```

- `_fillForm` 中 edit 模式：`this._serverNextRunAt = r.next_run_at; this._periodFieldsDirty = false;`
- 所有周期字段 handler（`onPeriodChange` / `onDowChange` / `onDomChange` / `onYearlyChange` / `onBucketChange` / `onStartDateChange` / `onToggleEndDate` / `onEndDateChange` 及其 Clear 变体）加 `this._periodFieldsDirty = true;`

`_updatePreview` 的核心分支（`edit/index.ts` L711–L741）：

```ts
if (this.data.mode === 'edit' && !this._periodFieldsDirty && this._serverNextRunAt) {
  // 用户未改周期字段 → 直接格式化服务端权威 next_run_at，避免显示陈旧到起始日
  const formatted = formatServerNextRunAt(this._serverNextRunAt, this.data.timezone);
  if (formatted) { previewDate = formatted; previewBucket = bucketLabel; }
} else {
  // 新建模式 或 用户已改周期字段 → 本地 computePreviewNextRun 重算
  const result = computePreviewNextRun({ /* ... */ }, new Date());
  ...
}
```

新增 `formatServerNextRunAt(iso, timezone)`（`model.ts` L196–L203）：直接把服务端 ISO 字符串按规则时区格式化出 `yyyy-MM-dd`，零重算。

### 4.4 pause / resume 行为（已确认，未改）

| 操作 | `next_run_at` | 是否补跑历史 |
|------|---------------|--------------|
| `pause` | **不动**（仅改 `status`） | — |
| `resume` | 从 `now` 重算 + 跑 `applyBucketWindowSkip`（"重新启用后从启用时间之后开始触发"） | 否（不补齐禁用期间） |

`resume` 逻辑见 `recurringService.ts` L827–L868，与新方案语义一致，未改动。

---

## 5. 改动清单

| 文件 | 改动 |
|------|------|
| `server/src/services/recurringService.ts` | `update` 重算分流：新增 `bucketChanged` / `startDateChanged` / `fromStartIsFuture` 三条件，按分支决定起算点与是否跑 `applyBucketWindowSkip`（L684–L745）。 |
| `miniprogram/pages-recurring/edit/index.ts` | `_buildSavePayload` 改为 diff（edit 模式基于 `_originalRule`）；新增 `_serverNextRunAt` / `_periodFieldsDirty`；`_fillForm` 缓存；`_updatePreview` 分支；所有周期 handler 置 dirty；`import formatServerNextRunAt`；调用方加 `as` 断言。 |
| `miniprogram/pages-recurring/edit/model.ts` | 新增导出 `formatServerNextRunAt(iso, timezone)`。 |
| `server/test/recurring-entries.test.ts` | 新增 `describe('recurring-entries · update next_run_at recompute split')`（5 个用例）；旧"窗口期内修改匹配日"用例改为改 `execute_bucket` 以匹配新语义（L1930、L1978）。 |

---

## 6. 测试覆盖

新增 `recurring-entries · update next_run_at recompute split` describe（`recurring-entries.test.ts` L2074 起），固定 `now = 2026-08-10 周一 14:00 CST`（已进入 afternoon 窗口）：

| 用例 | 覆盖 | 断言 |
|------|------|------|
| `情形1 · PATCH only note` | 只改备注 | `next_run_at` 完全不变 |
| `情形1 · PATCH only amount` | 只改金额 | `next_run_at` 完全不变 |
| `情形2 · PATCH execute_bucket=morning→afternoon` | 改时段 | 落在 `08-11` 且在 `12:00–18:00`（跳过今天） |
| `情形3 · PATCH days_of_week 改周一→周二` | 改周期字段不改进段 | 落在 `08-18` 周二，`hour/minute` 不变（不跳过） |
| `情形3 · next_run_at 已过期` | 边界：existing 已过期 | 从 `now` 重算，`next_run_at > now`（不强制推到明天） |

> **踩坑记录（review 需留意）**：`beforeEach` 中 `vi.setSystemTime` 必须**先于** `login`（签发 token）调用。否则 token 签发在真实时间、验证在 fake 时间，时间差超 TTL(7200s) 导致 401。这是测试时序约束，非实现缺陷。

---

## 7. 边界与开放问题（供 review 讨论）

1. **`start_date` 变化归入"从新 start_date 起算"**：用户改了 `start_date` 但不改 `execute_bucket` 时，走 `fromStartIsFuture ? start-1min : now` 分支且**不跑** `applyBucketWindowSkip`。设计意图是"用户想重新从新 start_date 起算"，与"改了时段才跑跳过"相区分。若 review 认为 `start_date` 变化也应受 bucket 窗口保护，需调整。
2. **情形 3 的 `from = existing.next_run_at - 1min`**：依赖 `existing.next_run_at` 未被并发 tick 改写。若编辑并发于调度 tick，存在极小的竞态窗口（与既有 `version` 乐观锁保护分开）。当前实现认为可接受。
3. **`_periodFieldsDirty` 是"是否改过"而非"与原始值是否不同"**：用户改了周期字段又改回原值，`_periodFieldsDirty` 仍为 `true`，此时预览回退到本地计算（可能短暂与 `_serverNextRunAt` 不一致）。保存时因 diff payload 无变化，`next_run_at` 不会变，最终一致。仅预览在"改回原值"瞬间可能闪动，是否需在预览层也做 diff 比对，待讨论。
4. **Bug A 的显示修复依赖 `_serverNextRunAt` 在 `_fillForm` 时被正确缓存**：edit 模式之外（create/copy）为 `null`，符合预期。

---

## 8. 验证结果

- 服务端测试：`494 / 494` 通过（含本方案新增的 5 例 + 修改的 2 例）。
- 编辑页 model 测试：`41 / 41` 通过。
- 两端逻辑已端到端闭合：Bug A（显示）+ Bug B（保存推迟）均修复。

---

## 9. 附：关键代码定位速查

| 关注点 | 位置 |
|--------|------|
| 服务端重算分流主逻辑 | `server/src/services/recurringService.ts` L684–L745 |
| `applyBucketWindowSkip` 定义 | `recurringService.ts` L445–L479 |
| `resume` 重算（语义对齐参考） | `recurringService.ts` L827–L868 |
| 客户端 diff payload | `miniprogram/pages-recurring/edit/index.ts` `_buildSavePayload` L788–L848 |
| 客户端预览分支 | `edit/index.ts` `_updatePreview` L711–L741 |
| 客户端 dirty 标记 | 各周期 handler（如 `onPeriodChange` L543、L560、L579…） |
| `formatServerNextRunAt` | `miniprogram/pages-recurring/edit/model.ts` L196–L203 |
| 新增测试 | `server/test/recurring-entries.test.ts` L2074–L2298 |
