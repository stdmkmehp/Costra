# 定时记账（Recurring Entry）· 任务拆分 v1.0

- 依据：`docs/design/recurring-entry-product-spec.md` v0.3.2 · `docs/design/recurring-entry-tech-spec.md` v0.2.1
- 日期：2026-07-21
- 作者：Orchestrator（起草）
- 卡号占位：本文档使用 T1~T5 内部编号；正式入池时由 PM-Agent 分配 COSTRA-5xx 系列卡号
- 总人天：**11 人天**（后端 5 · 前端 4.5 · QA/DevOps 1.5）· 关键路径 **10 天**

---

## §0 拆分原则

1. **一张卡 = 一个完整可交付单元**：避免"repo 好了但没 service 消费"的中间态
2. **高内聚**：把一个人一口气写完的相关文件合并到同一张卡，减少跨卡集成开销
3. **依赖清晰**：契约冻结（数据模型 + API + 前后端同源函数）作为最前置的独立卡
4. **验收独立可测**：每张卡的 DoD 只依赖自身范围内的产物

---

## §1 卡片总览

| # | 卡片名 | Owner | 人天 | 依赖 | 关键路径 |
|---|---|---|---|---|---|
| **T1** | 前后端同源基础设施 | Backend | 1.5 | 无 | ✅ |
| **T2** | 后端主卡（迁移 + 调度器 + API） | Backend | 3.5 | T1 完成 | ✅ |
| **T3** | 前端主卡（列表页 + 编辑页 + 分包） | MiniApp | 4.0 | T1 + T2 契约冻结 | ✅ |
| **T4** | 明细页"定/公"角标改造 | MiniApp | 0.5 | T2 下发 `source_recurring_id` | 否 |
| **T5** | QA 用例 + 灰度上线 + 观测 | QA + DevOps | 1.5 | T2 + T3 + T4 | ✅ |

**关键路径**：`T1 (1.5d) → T2 (3.5d) ‖ T3 (4d) → T5 (1.5d)` = 10 天

**并行窗口**：
- D2-D5：T2（后端）与 T3（前端）在 T1 契约冻结后完全并行
- D6-D9：T4 明细页角标 与 T5 QA 用例起草 并行

---

## §2 依赖 DAG

```
     ┌───────────────┐
     │  T1  同源基础  │  D0-D1.5
     └───┬───────────┘
         │
         ▼
     ┌───────────────┐          ┌───────────────┐
     │  T2  后端主卡  │──契约───▶│  T3  前端主卡  │  D1.5-D5.5
     └───┬───────────┘  冻结    └───┬───────────┘
         │                          │
         │ source_recurring_id       │
         ▼                          │
     ┌───────────────┐               │
     │  T4  角标改造  │  D6-D6.5     │
     └───┬───────────┘               │
         │        ▼─────────────────┘
         ▼
     ┌───────────────┐
     │  T5  QA 灰度   │  D8.5-D10
     └───────────────┘
```

---

## T1 · 前后端同源基础设施

> **Owner**：`costra-backend-dev`（后端主导，前端配合确认打包尺寸）
> **优先级**：P0 · **估点**：1.5 · **Epic**：Epic-E Sprint-4
> **类型**：backend + miniapp 通用工具库

### §1.1 背景

技术方案 v0.2.1 §7 定义了 `computeNextRunAt` 和 `formatDaysForSummary` 两个纯函数，必须**前后端 byte-level 同源**：
- `computeNextRunAt`：后端调度器 tick 推进 `next_run_at`；前端编辑页预览"预计下次执行"做本地预估
- `formatDaysForSummary`：前后端共享格式化规则（编辑页 `full` · 列表页 `compact`）

两者算法漂移会直接导致"用户看到的预览时间和实际执行时间不一致"（R8 风险）。

### §1.2 需求

1. 引入 `luxon` 依赖（前后端各一份）
2. 实现两个纯函数，前后端两份文件 byte-level 一致
3. 建立 CI 卡关脚本：任一份改动，另一份必须同步

### §1.3 实现规格

| 文件 | 操作 | 说明 |
|---|---|---|
| `server/package.json` | M | 加 `"luxon": "^3.5.0"` + `"@types/luxon": "^3.4.0"` |
| `miniprogram/package.json` | M | 加 `"luxon": "^3.5.0"` |
| `server/src/services/recurringSchedule.ts` | A | `computeNextRunAt` / `formatDaysForSummary` / `assignBucketMinute` / `fnv1a64` |
| `miniprogram/services/recurringSchedule.ts` | A | **byte-level 一致副本** |
| `scripts/verify-recurring-schedule-parity.mjs` | A | CI 校验脚本（sha256 比对） |
| `package.json`（根） | M | `scripts.parity` |
| CI 配置 | M | 加 `npm run parity` 步骤 |
| `*/recurringSchedule.spec.ts`（各一份） | A | 100+ 单元测试用例 |

**关键算法约束**（详见 tech-spec §7）：
- `computeNextRunAt(rule, from)` 返回严格 > `from` 的下一个匹配时点
- 6 档 period 分支：`weekly / biweekly / monthly / bimonthly / trimonthly / yearly`
- 每年跨月：`year_month_days` 元素编码 `month * 100 + day`
- 边界回落：31 → 月末 · 2/29 平年 → 2/28
- `assignBucketMinute` 内缩 30 分钟（tech-spec §3.5 v0.2.1 修订）
- `fnv1a64` 纯 BigInt 实现，无外部依赖

### §1.4 禁止事项

| ID | 禁止 | 原因 |
|---|---|---|
| F1 | 禁止两份文件间任何差异（含注释和空行） | parity CI 会挂 |
| F2 | 禁止 import 业务代码（不能 import repo/service） | 保持纯函数 |
| F3 | 禁止使用 Node 特有 API（Buffer / crypto） | 前端跑不起来 |
| F4 | 禁止自研时区处理 | Luxon 已敲定 |

### §1.5 DoD

- [ ] `npm run parity` 通过 · 故意改一处能挂
- [ ] `cd server && npm test -- recurringSchedule` 全绿（100+ 用例）
- [ ] `cd miniprogram && npm test -- recurringSchedule` 全绿
- [ ] Luxon 后 `pages-recurring/` 首屏 JS ≤ 200KB（gzipped ≤ 60KB）

### §1.6 交付物

- 9 个新增/变更文件 · CI 报告截图

### §1.7 风险

| 风险 | 缓解 |
|---|---|
| Luxon 包体积影响主包 | 单独放 `pages-recurring/` 分包 |
| 两份代码维护成本 | Sprint-5 引入 monorepo shared package；本期靠 parity CI |

---

## T2 · 后端主卡（迁移 + 调度器 + API）

> **Owner**：`costra-backend-dev`
> **优先级**：P0 · **估点**：3.5 · **Epic**：Epic-E Sprint-4
> **类型**：backend feature（schema + service + route + scheduler + audit）
> **依赖**：T1 完成

### §2.1 背景

后端一次性交付定时记账的完整能力。切开成多卡会造成"repo 好了但没 service 消费"的中间态，反而制造集成成本。

### §2.2 需求

1. 数据库迁移（`recurring_rules` 表 + `entries.source_recurring_id` 列 + 索引 + CHECK）
2. Repo / Service / Route 三层
3. 调度器（`setInterval + pg_try_advisory_lock` · 补齐 loop · 7 天窗口）
4. Audit log 事件（10 种 action）
5. OpenAPI 契约更新
6. 集成到 `app.ts`

### §2.3 实现规格

**变更文件（预计 12 个）**：

| 文件 | 操作 | 说明 |
|---|---|---|
| `server/db/migrations/0011_recurring_entries.sql` | A | 建表 · 索引 · CHECK · `entries.source_recurring_id` |
| `server/test/setup.ts` | M | **双写**同步 DDL（项目硬约定） |
| `server/src/repositories/recurringRepo.ts` | A | listByUser / findById / insert / update / findDueRules |
| `server/src/services/recurringService.ts` | A | 6 个 CRUD 方法 + processOneRule 补齐 loop |
| `server/src/services/recurringScheduler.ts` | A | setInterval tick + advisory lock 管理 |
| `server/src/routes/recurring.ts` | A | 8 个 endpoint |
| `server/src/app.ts` | M | 挂载路由 · 启停 scheduler |
| `server/src/services/entryService.ts` | M | 补齐 `createWithIdempotency` 的 `sourceRecurringId` |
| `api/openapi.yaml` | M | 新增 `/v1/recurring-entries` + `RecurringRule` schema |
| `server/src/repositories/recurringRepo.spec.ts` | A | Repo 单测 |
| `server/src/services/recurringService.spec.ts` | A | Service 单测（含补齐 loop 场景 A/B） |
| `server/test/integration/recurring.e2e.spec.ts` | A | 端到端集成测试 |

**API 端点**：
```
GET    /v1/recurring-entries
GET    /v1/recurring-entries/:id
POST   /v1/recurring-entries
PATCH  /v1/recurring-entries/:id
POST   /v1/recurring-entries/:id/pause
POST   /v1/recurring-entries/:id/resume
POST   /v1/recurring-entries/:id/copy
DELETE /v1/recurring-entries/:id
```

**关键实现要点**：
- **迁移双写**：`0011.sql` 和 `server/test/setup.ts` DDL 必须完全一致（MEMORY.md 硬约定）
- **pg-mem spike**：D1 上午 30min 验证 `SMALLINT[]` + `cardinality(arr)` CHECK 支持；不支持则测试环境跳过，生产 PG 兜底
- **权限过滤**：`WHERE created_by = $userId AND deleted_at IS NULL` · 匹配不上返 **404**（不返 403）
- **调度器补齐 loop**：严格按 tech-spec §3.4 · `BACKFILL_WINDOW_MS = 7 天` · `MAX_BACKFILL_ITER = 100`
- **测试环境 tick**：`NODE_ENV==='test'` 禁用 setInterval，测试代码手动 `await scheduler.tickOnce()` 触发
- **entry.occurred_at** = cursor（历史时点）· `client_ref_id = 'rec_' + rule.id.slice(0,8) + '_' + occurred_at_date`

### §2.4 契约

**权限**：`created_by = req.user.id`（不看账本 owner/member 关系）
**幂等键**：`entries.client_ref_id = 'rec_<rid8>_<YYYY-MM-DD>'`
**RecurringRule schema**：见 tech-spec §5 完整 YAML

### §2.5 禁止事项

| ID | 禁止 | 原因 |
|---|---|---|
| F1 | 禁止 ON DELETE CASCADE 级联删规则 | 产品 §7.1：账本失效走 `auto_paused` |
| F2 | 禁止 API 返回值暴露 hash 计算细节 | `execute_hour/minute` readOnly |
| F3 | 禁止 patch 接受 `execute_hour/minute` | 只允许 `execute_bucket` |
| F4 | 禁止 push token / 通知字段 | 产品明确无推送 |
| F5 | 禁止跳过所有 CHECK · 只允许跳过 pg-mem 确证不支持的 | 生产 PG 是权威 |
| F6 | 禁止生产环境 setInterval 频率 ≠ 60s | 幂等和补齐 loop 的隐式约束 |

### §2.6 DoD

**Schema**：
- [ ] `npm run migrate` 在开发库执行成功
- [ ] `server/test/setup.ts` DDL 与 `0011.sql` 完全一致
- [ ] pg-mem spike record 到 `docs/spike/pgmem-array-check.md`

**API**：
- [ ] OpenAPI 编译无 error
- [ ] 8 个 endpoint 手工 curl 通过（含 owner 越权返 404）
- [ ] PATCH 乐观锁：错的 version 返 409

**调度器**：
- [ ] 补齐 loop 场景 A（宕机 48h → 补 2 条）
- [ ] 补齐 loop 场景 B（宕机 15 天 → 补 7 条 + 8 条 skip audit）
- [ ] 补齐 loop 边界（宕机恰好 7 天）
- [ ] 跨月 12 天规则一次触发生成 12 条
- [ ] advisory lock 释放（mock 连接断开）
- [ ] Integration：POST → 时间 mock → tick → 断言 entries + next_run_at

**工程质量**：
- [ ] `typecheck` + `test` 全绿（基线 148 → 220+）
- [ ] `npm run parity` 通过
- [ ] audit_logs 出现 10 种预期 action

### §2.7 交付物

12 个新增/变更文件 · pg-mem spike 报告 · 迁移 SQL diff · OpenAPI diff（G3 契约闸门材料）

### §2.8 风险

| 风险 | 缓解 |
|---|---|
| pg-mem 不支持 array CHECK | D1 spike · 不支持则测试跳过，生产 PG 兜底 |
| 调度器测试的时钟 mock | `vi.useFakeTimers()` + `scheduler.tickOnce(mockNow)` 显式驱动 |

---

## T3 · 前端主卡（列表页 + 编辑页 + 分包）

> **Owner**：`costra-miniapp-dev`
> **优先级**：P0 · **估点**：4 · **Epic**：Epic-E Sprint-4
> **类型**：miniapp feature（新分包 + 2 页面 + 6 组件）
> **依赖**：T1 完成（同源函数）+ T2 契约冻结（OpenAPI + schema）

### §3.1 背景

按产品方案 v0.3.2 §5，前端要交付列表页 + 编辑页 + mine 入口迁移。工作量大但技术复杂度不高，一人一口气写完最省事：状态管理、路由、分包配置共用，切开只会重复搭骨架。

### §3.2 需求

1. 新增分包 `pages-recurring/` · 主包不动
2. 列表页（Inset Grouped 卡片 + 长按菜单 + 启用/禁用分组）
3. 编辑页（三卡片：模板 + 规则 + 预览）
4. 六档周期控件（recurring-*-picker 系列）
5. mine 页入口 · 设置页占位移除
6. Service 层 API 封装 + 分类面板抽出

### §3.3 实现规格

**变更文件（预计 25 个）**：

| 类别 | 文件 | 操作 |
|---|---|---|
| 分包 | `miniprogram/app.json` | M · 加 `subPackages` |
| 入口迁移 | `miniprogram/pages-family/settings/index.{ts,wxml}` | M · 移除占位 |
| 入口迁移 | `miniprogram/pages/mine/index.{ts,wxml}` | M · 加"定时记账"菜单项 |
| 列表页 | `pages-recurring/list/index.{ts,wxml,wxss,json}` + `.spec.ts` | A |
| 编辑页 | `pages-recurring/edit/index.{ts,wxml,wxss,json}` + `.spec.ts` | A |
| 通用抽出 | `components/category-picker/*` | A · 从 expense-overlay 抽出 |
| 通用抽出 | `components/expense-overlay/*` | M · 引用 category-picker |
| 周期控件 | `components/recurring-period-selector/*` | A · action-sheet 六档 |
| 周期控件 | `components/recurring-dow-picker/*` | A · 每周多选（上限 7） |
| 周期控件 | `components/recurring-dom-picker/*` | A · 每月类多选（上限 14） |
| 周期控件 | `components/recurring-yearly-picker/*` | A · 每年跨月（上限 12） |
| 周期控件 | `components/recurring-bucket-picker/*` | A · 四段时段 |
| Service | `miniprogram/services/recurringApi.ts` | A · 8 个 API 封装 |
| Service | `miniprogram/services/recurringLocal.ts` | A · IndexedDB 缓存 |

### §3.4 关键实现要点

**视觉严格对齐产品方案 v0.3.2 §5.0 色板**：
- 底 `#f1f2ec` · 主字 `#1c1b1a` · 卡片白 · 圆角 24rpx · 无阴影
- 选中态苔绿 `#8AA98F` · 警示陶土红 `#C08A7B` · 提醒琥珀 `#C2A56A` · 弱信息灰绿 `#A0A69C`
- 严格按 §5.4.2 动效时长表

**状态摘要条**（编辑页 dom / yearly 控件顶部）：
- 完整明确列出所有已选（编辑页不省略）
- `-webkit-line-clamp: 2 + ellipsis` 兜底超宽
- 清空按钮触发 `wx.showModal` 二次确认

**编辑页跨字段联动**（产品 §5.3.2）：
- 分类跨 type 选择：选中 income 分类 → 顶部 tab 切 income → 归属胶囊 `160ms fade-out` 消失
- 周期档位切换：小档互切保留日子（每周↔每两周保 dow）；跨大档清空 + toast

**每年月份 tab 上标徽标**（产品 §5.3.3 (d)）：
- 苔绿圆点 28rpx · 白字 22rpx · 位置 `translate(60%, -30%)`
- 内容 = 该月已选天数（1 或 2 位）
- 切 tab 不清除任何已选（跨月保留是核心特性）

**上限拦截四步反馈**（产品 §5.3.3 (c/d)）：
- tag 抖动 `translateX ±8rpx · 180ms · 3 帧`
- 陶土红 flash `120ms`
- `wx.vibrateShort({ type: 'light' })`
- toast `最多可选 N 天`

**列表页长按菜单**：复用明细页 `ctx-menu` 视觉容器 + 暖光高亮，共享交互模式

**Service 层要点**：
- `recurringApi.ts` 8 个方法对应 T2 的 8 个 endpoint
- 乐观锁：patch 时携带 `version`，409 → 拉最新覆盖本地
- 网络错误：暂存 outbox，与其它 outbox 项同优先级

**分包尺寸**：预算首屏 JS ≤ 200KB（gzipped ≤ 60KB） · Luxon 计入分包不计入主包

### §3.5 契约

- 消费 T2 的 8 个 endpoint
- 消费 T1 的 `formatDaysForSummary('compact')`（列表页副行）+ `computeNextRunAt`（编辑页预览）

### §3.6 禁止事项

| ID | 禁止 | 原因 |
|---|---|---|
| F1 | 禁止在记账 overlay 里加"存为定时"按钮 | 产品 v0.2 明确撤销 |
| F2 | 禁止在明细页长按菜单加"来源信息条" | 产品 v0.3.1 明确撤销（角标已够） |
| F3 | 禁止直接改 `execute_hour/minute` 表单 | 产品要求模糊时段，后端错峰分配 |
| F4 | 禁止编辑页保存后跳转到其它非明确路径 | 一律 `navigateBack` 回列表 |
| F5 | 禁止把 pages-recurring 挪进主包 | Luxon 会撑爆主包 |
| F6 | 禁止在角标位置用非莫兰迪色 | 视觉一致性 |
| F7 | 禁止把周期控件写成一个大文件 · 必须拆成独立子组件 | 未来复用（如"目标提醒"）|

### §3.7 DoD

**功能闭环**：
- [ ] mine 页首页出现"定时记账"入口 · settings 页占位消失
- [ ] 列表页三态：空 / 全启用 / 有禁用 · 分组标题正确
- [ ] 长按菜单四项：复制 / 修改 / 禁用启用 / 删除
- [ ] 编辑页六档周期 · 差异化上限（7/14/12）拦截正确
- [ ] 每年跨月控件：切月不清已选 · 上标徽标随已选变化
- [ ] 状态摘要条：数值苔绿加粗 · 已选列表按 §5.3.4 格式化规则
- [ ] 预览卡片："下次执行时间"用 44rpx tabular-nums 突出
- [ ] 保存按钮：置灰态可点 · 逐条 toast · 未通过卡片外框陶土红闪
- [ ] 复制/禁用/启用/删除操作闭环 · 状态就地更新

**工程质量**：
- [ ] `npm run typecheck` + `lint` + `test` 全绿
- [ ] 主包尺寸不增 · 分包 gzipped ≤ 60KB
- [ ] 关键交互单测：dow-picker 上限拦截 · yearly-picker 跨月保留 · 分类跨 type 反推 tab

**设计还原**：
- [ ] 视觉稿评审通过（Design-Agent）
- [ ] 无阴影 · 圆角 24rpx · 卡片间距 32rpx
- [ ] 动效时长与 §5.4.2 表一致（手动录屏对比）

### §3.8 交付物

25 个新增/变更文件 · 视觉稿评审 record · 分包尺寸报告

### §3.9 风险

| 风险 | 缓解 |
|---|---|
| category-picker 抽出破坏 expense-overlay 现有测试 | 抽出后先跑一遍 overlay 的 spec，确保不回退 |
| 六档周期控件视觉一致性 | 抽公共 wxss 变量 · Design-Agent 一起过视觉稿 |
| Luxon 冷启动性能 | 分包首屏懒加载，用户点到 mine → 定时记账才拉分包 |

---

## T4 · 明细页"定/公"角标改造

> **Owner**：`costra-miniapp-dev`
> **优先级**：P1 · **估点**：0.5 · **Epic**：Epic-E Sprint-4
> **类型**：miniapp visual refactor（跨页面）
> **依赖**：T2 下发 `source_recurring_id`（entries API 返回）

### §4.1 背景

按产品方案 v0.3.2 §6，明细页流水的头像/图标右下角要显示四种状态：
- 非公非定 → 无
- 公非定 → 单个"公"（现状 `#6B9B8F`）
- 非公定 → 单个"定"（新增 `#A88A5E`）
- 公+定 → "定 公"并排（定在左）

现有 `.entry-member__badge` 只承载单字，需要改造为"字容器"。

### §4.2 需求

1. `.entry-member__badge` 从单字改造为 flex 容器支持并排 2 字
2. 新增 `.entry-member__badge-text--recurring` 样式（砂棕 `#A88A5E`）
3. 渲染逻辑读取 `entry.source_recurring_id != null`
4. 影响面回归：明细页 · 家庭视图 · 统计视图 · 任何 entry 列表

### §4.3 实现规格

| 文件 | 操作 | 说明 |
|---|---|---|
| `miniprogram/pages/ledger/index.wxml` | M | `.entry-member__badge` 改容器 · 条件渲染 2 字 |
| `miniprogram/pages/ledger/index.wxss` | M | 新增 `.entry-member__badge-text--recurring` · flex + gap |
| `miniprogram/pages-family/family/index.wxml` + `.wxss` | M | 同步改造 |
| `miniprogram/pages/stats/*`（若有 entry 列表） | M | 同步改造 |
| `miniprogram/utils/entryBadges.ts` | A | 抽 `computeBadges(entry): { showShared, showRecurring }` 纯函数 |

**关键代码模式**：
```wxml
<view wx:if="{{entry.isRecurring || entry.isShared}}" class="entry-member__badge">
  <text wx:if="{{entry.isRecurring}}" class="entry-member__badge-text entry-member__badge-text--recurring">定</text>
  <text wx:if="{{entry.isShared}}" class="entry-member__badge-text entry-member__badge-text--shared">公</text>
</view>
```

```wxss
.entry-member__badge { display: flex; gap: 2rpx; /* 保持 position/right/bottom */ }
.entry-member__badge-text--recurring {
  color: #A88A5E;
  /* 字号/字重/投影与 --shared 完全一致 */
}
```

**顺序固定"定 公"**（定在左），不因用户勾选顺序而变。

### §4.4 禁止事项

| ID | 禁止 | 原因 |
|---|---|---|
| F1 | 禁止把并排顺序改成"公 定" | 全 App 一致性 |
| F2 | 禁止改"公"字现有色 `#6B9B8F` | 历史既成事实 |
| F3 | 禁止在长按菜单加"来源信息条" | 产品 v0.3.1 撤销 |
| F4 | 禁止字号/字重/投影和"公"字不一致 | 姊妹样式 |

### §4.5 DoD

- [ ] 4 态视觉正确（非公非定 / 公非定 / 非公定 / 公+定）
- [ ] "定"字色 `#A88A5E` 砂棕 · 与"公"字同字号/字重/投影
- [ ] 并排顺序全 App 一致 = 定在左
- [ ] 明细页 · 家庭视图 · 统计视图三处回归通过
- [ ] `computeBadges` 单测覆盖 4 态
- [ ] 现有明细页测试无回退

### §4.6 交付物

5 个新增/变更文件 · 4 态视觉稿对比截图

### §4.7 风险

| 风险 | 缓解 |
|---|---|
| 并排 badge 撑出遮挡头像 | 双字宽 ≈ 22rpx，绝对定位 right:-6rpx 向左展开不遮挡（视觉稿评审确认） |
| stats 页 entry 列表未收敛为公共组件 | 未收敛则两处独立改；同时提 tech-debt 记入 MEMORY.md |

---

## T5 · QA 用例 + 灰度上线 + 观测

> **Owner**：`costra-qa-planner` + `costra-devops-ops`
> **优先级**：P0 · **估点**：1.5 · **Epic**：Epic-E Sprint-4
> **类型**：qa + devops
> **依赖**：T2 + T3 + T4 全部完成

### §5.1 背景

上线前的最后一公里：QA 起草完整用例、DevOps 配置灰度开关和观测面板、真机验证、正式发布。

### §5.2 需求

1. QA 用例集（产品方案 §10 验收清单全覆盖）
2. `COSTRA_RECURRING_ENABLED` env flag（前后端各一份）
3. 观测面板（Grafana / 日志聚合）
4. 灰度 3 阶段：内部 → 5% → 20% → 100%
5. 回滚方案（关 flag 一步回到零打扰状态）

### §5.3 实现规格

| 文件 | 操作 | 说明 |
|---|---|---|
| `qa/recurring-entry-testcases.md` | A | 用例集（5 大类 · 详见 §5.4） |
| `qa/recurring-entry-testrun-report.md` | A | 灰度期回归报告模板 |
| `server/src/config/features.ts` | A/M | `RECURRING_ENABLED = process.env.COSTRA_RECURRING_ENABLED === 'true'` |
| `server/src/app.ts` | M | flag 关时不启动 scheduler · 路由返 404 |
| `miniprogram/config/features.ts` | A/M | 客户端 flag · 隐藏 mine 入口 |
| `infra/docker-compose.yml` | M | 环境变量 `COSTRA_RECURRING_ENABLED` |
| `infra/observability/dashboards/recurring.json` | A | Grafana：tick 时长 / 生成数 / audit 分布 / auto_paused 数 |
| `docs/release/recurring-entry-rollout.md` | A | 灰度 checklist |

### §5.4 QA 用例集大纲（5 大类 · 约 85 条）

| 类别 | 条数 | 覆盖点 |
|---|---|---|
| **入口 & 列表** | 8 | mine 入口 · 空态 · 启用/禁用分组 · 长按菜单 · 越权 404 |
| **编辑页 · 三卡片** | 35 | 六档周期 × 差异化上限 × 摘要条 × 预览 × 校验 × 分类跨 type × 保存置灰交互 |
| **执行 & 调度** | 20 | 补齐 loop 场景 A/B · 边界日（31→月末 · 2/29 平/闰）· 幂等 · 权限过滤 · 错峰分钟稳定 |
| **明细页角标** | 8 | 4 态 × 明细/家庭/统计三视图 · 顺序固定 · 颜色对比 |
| **权限 & 边界** | 14 | 单人/owner/member 各设 · 家庭移出/账本删/分类删的自动降级 · 灰度 flag 关时的表现 |

### §5.5 灰度阶段

| 阶段 | 用户范围 | 观测点 | 通过条件 |
|---|---|---|---|
| **G0** 内部 | 团队 5 人 dogfooding | tick 时长 / 生成 entry 正确性 / 补齐 loop 正常 | 无 auto_paused · 无 P0/P1 bug |
| **G1** 5% | 白名单 5% 用户 | 同上 + 用户反馈渠道 | 观测 48h · auto_paused 率 < 1% · 无投诉 |
| **G2** 20% | 20% 用户 | 同上 + Grafana 面板指标 | 观测 72h · tick p99 < 3s · scheduler stall 无告警 |
| **G3** 100% | 全量 | 同上 | 稳定 1 周后关闭 flag（内嵌到代码逻辑） |

### §5.6 回滚方案

**一键回滚**：设 `COSTRA_RECURRING_ENABLED=false` + `docker compose up -d` → 服务端 scheduler 停摆、路由返 404、客户端 mine 入口隐藏

**数据不回滚**：`recurring_rules` 表和 `entries.source_recurring_id` 保留（无破坏 schema 变更）。用户已生成的历史 entry 不受影响（正常 entry）。恢复 flag 后规则从原水位继续跑（`next_run_at` 落在过去会自动进入补齐 loop）。

### §5.7 禁止事项

| ID | 禁止 | 原因 |
|---|---|---|
| F1 | 禁止用 down migration 回滚 schema | 无破坏变更 · 只需 env flag |
| F2 | 禁止灰度期跳过任何一档观测周期 | 稳定性优先 |
| F3 | 禁止在灰度期修改产品/技术方案 | G3 契约冻结后只做 bug fix |

### §5.8 DoD

- [ ] 用例集完成并交给 human 评审
- [ ] Grafana 面板可访问 · 关键指标有数据
- [ ] `COSTRA_RECURRING_ENABLED=false` 场景验证通过（4 点：调度器不启动 / 路由 404 / mine 入口隐藏 / 现有功能无回退）
- [ ] G0 内部 dogfooding 48h 无 P0/P1 bug
- [ ] G1 灰度 5% 用户 48h 观测报告归档
- [ ] G2 灰度 20% 用户 72h 观测报告归档
- [ ] G3 100% 上线后 1 周稳定性报告归档

### §5.9 交付物

8 个新增/变更文件 · 3 份灰度观测报告 · Grafana 面板截图

### §5.10 风险

| 风险 | 缓解 |
|---|---|
| 灰度期发现 R1（computeNextRunAt 边界 bug） | 立即 patch + 补测；影响范围小（受影响用户 ≤ 5%） |
| Grafana 无历史数据基线 | G0 期先跑 24h 建立基线 |
| flag 关闭后被遗忘 | Sprint-5 D1 review flag 状态；上线满 30 天后 PR 移除 flag |

---

## §4 关键决策记录（供后续追溯）

| # | 决策 | 依据 |
|---|---|---|
| D1 | 5 张卡而非 10 张 | 用户明确要求"更紧凑" · 高内聚 |
| D2 | T1 独立成卡而非并入 T2 | 前后端都依赖 · 必须最先冻结 · parity CI 需要单独引入 |
| D3 | T4 明细页角标独立成卡 | 跨多个页面（明细/家庭/统计）· 独立便于回归验证 |
| D4 | 分包 `pages-recurring/` 而非主包 | Luxon 会撑爆主包 |
| D5 | Env flag `COSTRA_RECURRING_ENABLED` 双端存在 | 单端 flag 会出现"服务端关但客户端能点进空白页" |

---

## §5 与 backlog.json 的对接

**本文档不修改 `.team/backlog.json`**。正式入池时由 PM-Agent 完成以下映射：

| 本文 ID | 建议 COSTRA 卡号 | 建议 Epic |
|---|---|---|
| T1 | COSTRA-5xx（下一个可用号） | Epic-E |
| T2 | COSTRA-5xx | Epic-E |
| T3 | COSTRA-5xx | Epic-E |
| T4 | COSTRA-5xx | Epic-E |
| T5 | COSTRA-5xx | Epic-E |

每张卡的详细内容（§1~§5）可直接拷进 `.team/dispatch/COSTRA-5xx-*.md` 走标准派单流程。

---

## §6 附：整体时间线

```
D0        D1  D2       D3      D4      D5      D6      D7      D8      D9      D10
│         │   │        │       │       │       │       │       │       │       │
├─ T1 ────┤   │        │       │       │       │       │       │       │       │
│         │   │        │       │       │       │       │       │       │       │
│         ├── T2 (后端主卡) ────────────┤       │       │       │       │       │
│         │                              │       │       │       │       │       │
│         ├── T3 (前端主卡) ──────────────────────┤       │       │       │       │
│         │                                      │       │       │       │       │
│         │                                      ├─ T4 ──┤       │       │       │
│         │                                              │       │       │       │
│         │                                              ├─ T5 (QA+灰度) ────────┤
│         │                                              │                       │
│         │ ← G3 契约冻结                                  │ ← G4 合入 main         │ ← G5 灰度→全量
```

**关键节点**：
- **D1.5**：T1 完成 · G3 契约冻结（OpenAPI + schema + parity CI）
- **D5.5**：T2 完成
- **D5.5**：T3 完成（与 T2 并行）
- **D6**：T4 完成
- **D8.5**：T5 用例 + Grafana 就绪
- **D10**：G5 灰度 → 全量

