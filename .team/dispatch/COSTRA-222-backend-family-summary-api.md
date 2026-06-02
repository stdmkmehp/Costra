# COSTRA-222 · 家庭财务聚合 API（Family Summary API）

> **触发**：`plan-dispatch:COSTRA-222`  
> **派单时间**：2026-06-02 15:16（Orchestrator · Sprint-4 Family Foundation）  
> **状态**：Dispatch-Ready · 等 `card-review:COSTRA-222`  
> **Owner**：`costra-backend-dev`  
> **优先级**：P0  
> **估点**：5  
> **Epic**：Epic-D 家庭共享 / Epic-F 统计口径基础  
> **类型**：backend feature + OpenAPI schema  
> **硬约束**：本 dispatch 只定义卡；未到 `start:COSTRA-222` 前不得写业务代码。

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | 下一步触发：`card-review:COSTRA-222` |
| **Dispatch 修订** | Orchestrator | 如 Card-Review REVISE，则先修订本文件 |
| **R1 实装** | `costra-backend-dev` | 仅在 Card-Review PASS/APPROVE 且 Human `start:COSTRA-222` 后启动 |
| **R1 Review** | `costra-review-tech` | R1 完成后自动拉起 |
| **Human T1 终审** | `approve:COSTRA-222` | review-tech PASS/APPROVE 后 |

---

## §1 背景

### §1.1 当前最高可信事实

当前正式基线已包含：

- `COSTRA-154/150`：sync pull / scheduler / outbox / v1.2 watermark。
- `COSTRA-164/165`：server family bootstrap MVP + miniapp active family context。
- `COSTRA-217`：二级分类 schema + `entries.shared_type`。
- `COSTRA-218`：后端分类 API。
- `COSTRA-219`：前端分类模型 API + cache。
- `COSTRA-220`：明细页真实数据完善。
- `COSTRA-221`：Family Management API 已 Human T1 APPROVED CLOSED。

`COSTRA-222` 是 `COSTRA-221` 之后的 Sprint-4 第二张 P0 后端卡，目标是为家庭页和后续统计页提供统一的财务聚合口径。

### §1.2 本卡直接动因

设计文档中家庭页 `design/ui/design_spec.md §6.5` 要求展示：

- 家庭总支出 / 收入 / 结余；
- 公共支出与成员个人支出拆解；
- 公共支出的垫付贡献比例；
- 成员个人支出列表；
- 公共/个人支出下钻分类排行；
- active/left member 展示信息。

这些不应由小程序本地临时汇总，也不应塞入 `COSTRA-221` family management API。本卡新增专门的 read-only summary API，作为 `COSTRA-223` 家庭页和 `COSTRA-224/225` 统计域的口径基础。

### §1.3 本卡不解决的问题

本卡只做后端聚合 API，不做：

- `COSTRA-223` 家庭页 UI / API 接入；
- `COSTRA-224/225` 完整统计 API / 统计页 UI；
- 年度报表、趋势折线、同环比、日均、最大单笔等完整 stats 能力；
- 预算 / 周期账单 / 订阅消息；
- 审计活动流页面；
- `FU-220-SYNC-USER-ID-CREATED-BY` 字段映射修复；该项仍按 Sprint-4 guardrail 独立处理。

---

## §2 当前代码与契约事实

### §2.1 DB schema

事实源：

- `server/db/migrations/0001_init.sql`
- `server/db/migrations/0008_categories_hierarchy_seed.sql`
- `server/db/migrations/0009_entries_shared_type.sql`

可复用表：

| 表 | 关键字段 | 用途 |
|---|---|---|
| `families` | `id`, `name`, `owner_id`, `kind`, `deleted_at`, `version` | family 维度与 personal/shared 判断 |
| `family_members` | `family_id`, `user_id`, `role`, `joined_at`, `left_at` | active/left member 展示与权限守门 |
| `ledgers` | `id`, `family_id`, `name`, `currency`, `deleted_at` | family:ledger=1:1 产品语义，summary 入口 |
| `entries` | `ledger_id`, `amount`, `type`, `category_id`, `occurred_at`, `created_by`, `deleted_at`, `shared_type` | summary 聚合事实源 |
| `categories` | `id`, `parent_id`, `name`, `type`, `icon`, `sort_order`, `deleted_at` | category rank 展示 |
| `users` | `id`, `nickname`, `avatar_url` | member 展示信息 |

本卡默认不新增 migration。若 card-review 判定现有索引不足，可只新增 migration；否则 R1 以现有索引 `idx_entries_ledger_occurred` + `idx_entries_shared_type` 为基础。

### §2.2 现有实现基础

| 层 | 当前事实 |
|---|---|
| `familyService.ts` | `COSTRA-221` 已提供 `assertActiveMember`、`listMembers` 等能力，可复用权限守门与成员展示口径 |
| `familyMemberRepo.ts` | 已能返回 active + left members，并 JOIN users 获取 nickname/avatar_url |
| `entryRepo.ts` | EntryEntity 已含 `sharedType`，金额为 cents 整数 |
| `categories` schema | 已支持二级分类 `parent_id` 与系统分类 seed |
| `openapi.yaml` | 当前无 `/families/{family_id}/summary` path，需要本卡新增 |
| `/reports/monthly` | 已有旧统计占位契约；本卡不要改为家庭页专用，不与 stats sprint 混淆 |

### §2.3 时间口径

当前项目尚无用户 timezone 字段。`/reports/monthly` 契约写“按用户 timezone”，但用户时区能力未落地。

本卡 R1 明确采用：

```text
MVP 固定时区：Asia/Shanghai (+08:00)
month=YYYY-MM 的闭区间/开区间：
  start = 当月 1 日 00:00:00 +08:00
  end   = 下月 1 日 00:00:00 +08:00
SQL 使用 UTC timestamp 比较：[start_utc, end_utc)
```

必须在 OpenAPI description 与测试中写清。后续用户 timezone 作为独立 FU，不混入本卡。

---

## §3 Scope（必交）

### A · OpenAPI 契约新增

新增 path：

```text
GET /v1/families/{family_id}/summary?month=YYYY-MM&top_n=6
```

参数：

| 参数 | 位置 | 必填 | 规则 |
|---|---|---|---|
| `family_id` | path | 是 | UUID |
| `month` | query | 是 | `^\d{4}-\d{2}$`，必须是合法月份 01~12 |
| `top_n` | query | 否 | integer，默认 6，范围 1~20 |

本卡不实现 `dimension=yearly`。年度能力归 `COSTRA-224`。

新增 schema：`FamilySummary`。

建议响应结构：

```ts
interface FamilySummary {
  family_id: string;
  family_name: string;
  family_kind: 'personal' | 'shared';
  ledger_id: string;
  ledger_name: string;
  month: string;                 // YYYY-MM
  timezone: 'Asia/Shanghai';
  range_start: string;           // ISO UTC
  range_end: string;             // ISO UTC, exclusive
  currency: 'CNY';
  totals: {
    expense: number;             // cents, all expense
    income: number;              // cents, all income
    balance: number;             // income - expense, cents, can be negative
    shared_expense: number;      // expense + shared_type='shared'
    personal_expense: number;    // expense + shared_type='personal'
    entry_count: number;         // non-deleted entries in range, income+expense+transfer if present
  };
  members: FamilySummaryMember[];
  segments: FamilySummarySegment[];
  shared: {
    expense: number;
    paid_contributions: FamilyPaidContribution[];
    categories: FamilyCategoryRankItem[];
  };
  personal_by_member: FamilyPersonalExpenseBlock[];
}
```

子结构：

```ts
interface FamilySummaryMember {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  role: 'owner' | 'member' | 'viewer';
  status: 'active' | 'left';
  joined_at: string;
  left_at: string | null;
  personal_expense: number;
  paid_contribution: number;     // 对 shared expense 的付款贡献，按 entries.created_by 聚合
  entry_count: number;           // 该成员本月支出 entry 数，不含 income
}

interface FamilySummarySegment {
  key: 'shared' | `member:${string}`;
  type: 'shared' | 'personal';
  label: string;
  user_id: string | null;
  amount: number;
  ratio_bps: number;             // amount / total expense * 10000，total=0 时为 0
  member_status?: 'active' | 'left';
}

interface FamilyPaidContribution {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  status: 'active' | 'left';
  amount: number;                // cents
  ratio_bps: number;             // amount / shared_expense * 10000，shared_expense=0 时为 0
}

interface FamilyPersonalExpenseBlock {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  status: 'active' | 'left';
  amount: number;
  categories: FamilyCategoryRankItem[];
}

interface FamilyCategoryRankItem {
  category_id: string | null;
  category_name: string;
  parent_category_id: string | null;
  parent_category_name: string | null;
  amount: number;
  entry_count: number;
  ratio_bps: number;
}
```

OpenAPI 必须包含：

- 200 `FamilySummary`；
- 400 `INVALID_ARGUMENT`（非法 month/top_n）；
- 401 `UNAUTHENTICATED`；
- 403 `FAMILY_NOT_MEMBER`；
- 404 `NOT_FOUND`（family 已删除 / ledger 不存在）。

### B · 口径规则

必须严格执行：

1. 只统计 `entries.deleted_at IS NULL`。
2. 只统计 `entry.occurred_at >= range_start_utc AND entry.occurred_at < range_end_utc`。
3. 只统计当前 family 的默认 ledger：`ledgers.family_id = family_id AND ledgers.deleted_at IS NULL`。
4. `type='expense' AND shared_type='shared'` → 公共支出。
5. `type='expense' AND shared_type='personal'` → 成员个人支出。
6. `type='income'` → 只进入 `totals.income` 和 `totals.balance`；不进入公共/个人支出、分类排行、成员个人支出。
7. `type='transfer'` → R1 不进入 expense/income/balance；只计入 `entry_count` 是否计入需在实现中明确，推荐不计入 `entry_count`，避免无 UI 入口数据污染。
8. `shared_type IS NULL` 的 expense：理论上 `COSTRA-217` 后不应出现；R1 按 `personal` 兜底还是排除必须二选一。推荐：排除聚合并登记 `details.skipped_unclassified_expense_count`，但不阻断接口。
9. 金额全程用 integer cents，不得使用 float 参与金额计算。
10. ratio 使用 `basis points` 整数（0~10000），四舍五入；允许总和因 rounding 不等于 10000。
11. 分类排行严格排除金额为 0 的分类。
12. 分类排行按 `amount DESC`，同金额按 `category_name ASC`，最多 `top_n` 条。
13. left member 仍展示历史贡献；展示信息来自 `family_members JOIN users`，状态为 `left`。
14. active members 排在 left members 前；left members 排序沿用 `COSTRA-221` 成员列表口径。
15. personal family 也可调用 summary；其 `shared_expense=0`，`segments` 只含 owner personal 支出（若有）。
16. 非 active member 调用 summary 返回 403 `FAMILY_NOT_MEMBER`。

### C · Repo 层

建议新增：

- `server/src/repositories/familySummaryRepo.ts`

必备 repo 能力：

1. `getFamilySummaryRows(familyId, ledgerId, rangeStart, rangeEnd)`：一次或少量 SQL 读取目标区间 entry 聚合所需原始 rows。
2. `getExpenseCategoryRanks(...)`：按 shared block / member personal block 取分类排行。
3. SQL 必须参数化，禁止字符串拼接。
4. 不在 route 层写 SQL。
5. 查询必须 JOIN family/ledger/member 做 family 边界，不能只信客户端 ledger_id。

可接受实现策略：

- R1 数据量小，可先用 2~4 个聚合 SQL + service 内组装；
- 不要求单 SQL 巨型 CTE；
- 但禁止 N+1：不能对每个 member、每个 category 串行查库。

### D · Service 层

新增：

- `server/src/services/familySummaryService.ts`

必备 service API：

```ts
getFamilySummary(userId: string, input: {
  familyId: string;
  month: string;
  topN?: number;
}): Promise<FamilySummaryResponse>
```

service 责任：

1. 校验 `month` 合法性。
2. 校验 `topN` 范围。
3. 通过 `familyService.assertActiveMember(userId, familyId)` 做权限守门。
4. 获取 family + ledger + members。
5. 计算 Asia/Shanghai 月区间并转 UTC。
6. 调 repo 获取聚合数据。
7. 组装 `FamilySummary` wire response。
8. 保证空月份返回全 0 与空排行，不返回 404。
9. 保证 left member 有历史数据时仍展示在 `members` / `personal_by_member` / `segments` 中。
10. 保证无 entry 时仍返回 family/members 基础信息。

### E · Routes 层

新增或扩展：

- 推荐直接扩展 `server/src/routes/families.ts`。

新增 route：

```text
GET /families/:family_id/summary
```

要求：

- 在 `/v1` scope 下注册，最终路径为 `/v1/families/{family_id}/summary`。
- JWT 解析范式复用 `families.ts` / `entries.ts`。
- query schema：`month` required，`top_n` optional。
- `additionalProperties: false`。
- route 只做参数解析和响应，不写业务 SQL。

### F · 错误与安全

必须满足：

1. 未登录 → 401 `UNAUTHENTICATED`。
2. 非 member / left member 调用 → 403 `FAMILY_NOT_MEMBER`。
3. family 不存在或已删除 → 404 `NOT_FOUND`。
4. family 无 active ledger → 404 `NOT_FOUND` 或 503 `UNAVAILABLE`；推荐 404 + details `ledger_missing`。
5. month 非法 → 400 `INVALID_ARGUMENT` + details `{ field: 'month' }`。
6. top_n 非法 → 400 `INVALID_ARGUMENT` + details `{ field: 'top_n' }`。
7. 不输出 openid / session_key / refresh token。
8. 不记录敏感日志。

---

## §4 测试矩阵（必交）

新增：

- `server/test/family-summary.test.ts` 或合并进 `server/test/families.test.ts`（推荐独立文件，避免 `families.test.ts` 继续膨胀）。

至少覆盖：

| 编号 | 场景 | 断言 |
|---|---|---|
| T1 | 未登录访问 summary | 401 `UNAUTHENTICATED` |
| T2 | 非 member 访问 shared family summary | 403 `FAMILY_NOT_MEMBER` |
| T3 | 非法 month：`2026-13` / `abc` | 400 `INVALID_ARGUMENT` |
| T4 | 非法 top_n：0 / 21 | 400 `INVALID_ARGUMENT` |
| T5 | 空月份 | 200；totals 全 0；members 返回；rank 为空 |
| T6 | personal family summary | shared_expense=0；owner personal expense 正确 |
| T7 | shared expense 聚合 | `shared_type='shared'` 进入 shared_expense / shared categories |
| T8 | personal expense 按 created_by 聚合 | member personal_expense 正确 |
| T9 | income 只进入 income/balance | 不进入 shared/personal/category rank |
| T10 | balance 口径 | balance = income - expense，可为负 |
| T11 | paid contribution | shared expense 按 `created_by` 贡献聚合 |
| T12 | left member 历史贡献 | left member 仍展示，status=left，金额保留 |
| T13 | category rank top_n | 只返回 top_n，amount DESC，零值排除 |
| T14 | 二级分类 parent 信息 | category item 含 parent_category_id/name |
| T15 | 月边界 Asia/Shanghai | 月初/月末边界正确，[start,end) |
| T16 | server 全量回归 | `npm test -- --run` 全绿 |

验证命令：

```bash
cd server && npm run typecheck
cd server && npm test -- --run test/family-summary.test.ts
cd server && npm test -- --run
```

---

## §5 DoD

### 功能 DoD

- [ ] 新增 `GET /v1/families/{family_id}/summary?month=YYYY-MM&top_n=N`。
- [ ] OpenAPI path + schema + error responses 完整。
- [ ] 权限守门复用 family membership，非 active member 403。
- [ ] shared / personal / income / balance 口径符合 §3.B。
- [ ] left member 历史贡献保留。
- [ ] category rank 排序、top_n、零值排除符合设计。
- [ ] 空月份返回稳定结构，不抛错。
- [ ] 金额全程 integer cents，不用 float。
- [ ] 不引入 `shared_scope`，只使用 `entries.shared_type`。

### 工程 DoD

- [ ] route / service / repo 分层清晰。
- [ ] route 层无 SQL。
- [ ] SQL 参数化。
- [ ] 单文件不超过 500 行；若超过需拆分。
- [ ] 无 `console.log` / TODO / FIXME 残留。
- [ ] 不改 `miniprogram/`。
- [ ] 不混入 `COSTRA-223` UI 或 `COSTRA-224` 完整统计。
- [ ] `server` typecheck 通过。
- [ ] `server` 相关测试与全量测试通过。
- [ ] backend-dev state/history 同步。
- [ ] 完成后自动拉起 `review-tech:COSTRA-222`。

---

## §6 明确禁止

- 禁止直接启动业务实现；必须先 `card-review:COSTRA-222`。
- 禁止改小程序页面。
- 禁止引入 `shared_scope` 字段。
- 禁止把年度统计、趋势图、同环比、预算、订阅消息塞入本卡。
- 禁止用 float 计算金额。
- 禁止对每个 member/category 做 N+1 查询。
- 禁止绕过 family membership 守门。
- 禁止返回已删除 entry / 已删除 ledger 数据。

---

## §7 Residual / Follow-up

本卡完成后可能新增或确认以下 FU：

| FU | 说明 |
|---|---|
| `FU-222-USER-TIMEZONE` | 当前 R1 固定 Asia/Shanghai；未来用户 timezone 字段落地后改为用户时区。 |
| `FU-222-YEARLY-DIMENSION` | 年度聚合归 `COSTRA-224`，不在本卡做。 |
| `FU-222-SUMMARY-PERF-INDEX` | 若真实数据量增长，评估 `(ledger_id, occurred_at, type, shared_type, created_by)` 复合索引。 |
| `FU-222-UNCATEGORIZED-RANK-LABEL` | `category_id IS NULL` 当前用“未分类”；后续可接入默认分类兜底。 |

---

## §8 下一步

```text
card-review:COSTRA-222
```

Card Review 必须重点审：

1. summary response 是否足以支撑 `design_spec.md §6.5` 家庭页；
2. 是否与后续 `COSTRA-224/225` 统计域边界清晰；
3. Asia/Shanghai 固定时区是否可接受；
4. category rank / paid contribution 口径是否无歧义；
5. T1~T16 测试矩阵是否足够。
