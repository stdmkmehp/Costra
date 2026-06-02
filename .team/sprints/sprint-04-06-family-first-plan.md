# Costra · Sprint 4/5/6 调整规划（Family First）

> 生成时间：2026-06-02 12:02  
> 维护者：Orchestrator  
> 文档性质：后续 Sprint 规划落盘；**不是业务代码派单**，不代表任何卡已正式启动。  
> 适用流程：所有开发仍必须走 Costra 流程：状态对账 → dispatch → card-review → Human 触发 → spawn 对应 Agent → review → Human 终审。

---

## 0. 当前状态与流程约束

### 0.1 当前最高可信基线

以以下文件为当前阶段事实源：

- `.team/HANDOFF-2026-06-02-acceptance-verified.md`
- `.team/HANDOFF-2026-06-01-next-sprints-family-first.md`
- `qa/current-stage-acceptance-family-first-baseline.md`
- `.team/HANDOFF-2026-06-01-ui-refactor.md`

Human 已确认以下验收全部通过：

1. `qa/costra-154-150-joint-smoke.md`
2. `qa/phase-3-prod-realdevice-test.md`
3. `qa/current-stage-acceptance-family-first-baseline.md`

因此当前可视为：**Family First 基线阶段验收通过，可进入下一阶段规划与开发。**

### 0.2 当前正式完成能力

已进入当前基线的能力：

- `COSTRA-154 + COSTRA-150`：sync/pull、syncScheduler、outbox、watermark v1.2 联合实测通过。
- Phase-3 prod 真机链路通过：`https://costra.cloud`、真实 `wx.login`、family bootstrap、family-context、entries/categories/budgets/sync。
- `COSTRA-164/165`：server family bootstrap MVP + miniapp family-context service。
- `COSTRA-217`：分类二级 schema + `entries.shared_type`。
- `COSTRA-218`：后端分类 API。
- `COSTRA-219`：前端分类模型替换 hardcode。
- `COSTRA-220`：明细页真实数据完善。
- UI 重构基线：设计令牌、5 Tab、登录、明细、记账 overlay、安全区、自定义导航、验收 polish。

### 0.3 当前工作区污染说明

截至本规划生成前，工作区存在一批由错误流程产生的 `COSTRA-223` 非正式变更：

```text
M .team/members/miniapp-dev/state.md
M miniprogram/pages/family/index.json
M miniprogram/pages/family/index.ts
M miniprogram/pages/family/index.wxml
M miniprogram/pages/family/index.wxss
?? .team/members/miniapp-dev/history/2026-06-18-costra-223-family-page-ui.md
```

处理原则：

- 这些变更**不得计入正式项目进度**。
- 不得在未走 dispatch/card-review/Human 触发前提交。
- 后续应由 Human 决定：
  - A. 丢弃该 prototype，恢复到 `351d1e3` 后的正式基线；
  - B. 暂存为参考材料，但仍必须重走 `COSTRA-223` 正式流程。

本规划默认建议：**选 A，优先恢复干净基线**。原因：当前 `COSTRA-223` 依赖 `COSTRA-221/222`，先做 UI 会扩大 fallback/mock 债务。

### 0.4 Orchestrator 边界

本规划只做路线与卡片安排，不直接写业务代码。后续每张卡必须走：

```text
状态对账
  → 编写/修订 dispatch
  → card-reviewer-tech / card-reviewer-product 审卡
  → Human 触发 start/run
  → spawn costra-backend-dev / costra-miniapp-dev / qa-planner / devops-ops
  → 自动拉起产物 review
  → Human 终审
  → 单卡 commit / 收口
```

---

## 1. 原 Sprint 4/5/6 规划复原

早期规划分散在 `COSTRA-BLUEPRINT.md`、`docs/charter.md`、`docs/design/user-story-map.md`、`docs/PRD.md`、`.team/backlog.json`。没有找到单独冻结的 Sprint 4/5/6 明细计划。

### 1.1 Blueprint 原路线

`COSTRA-BLUEPRINT.md` 原里程碑：

| 阶段 | 里程碑 | 主要产物 |
|---|---|---|
| Sprint-1~3 | MVP 内测 | 单人记账 + 云同步可用，体验版二维码内部 Dogfood |
| Sprint-4~5 | 家庭协作 | 邀请码 / 微信群分享卡片 / 订阅消息 / 审计 |
| Sprint-6~7 | 统计与合规 | 年度报告分享页 / 隐私协议 / ICP 备案 / 类目审核 |
| Sprint-8 | 分阶段发布 | 1% → 10% → 50% → 100% |
| Sprint-9 | 正式上线 | 微信搜索可见 / 运营看板 / 值班表 |

### 1.2 Charter 原路线

`docs/charter.md` 原里程碑：

| 里程碑 | Sprint | 内容 |
|---|---|---|
| M2 | Sprint-3~4 | 云同步 + 家庭共享（Epic-C + Epic-D 联调完成） |
| M3 | Sprint-5~6 | 预算 / 账单 / 报表 + 订阅消息（Epic-E + Epic-F） |
| M4 | Sprint-7 | 审核 + 分阶段发布（Epic-G） |

### 1.3 User Story Map 原路线

`docs/design/user-story-map.md` 原 Release Slice：

| Release | Sprint | 目标 |
|---|---|---|
| R1 Alpha 内测 | Sprint-1~3 | 单人记账 + 云同步 + 微信登录 |
| R2 Beta 邀测 | Sprint-4~5 | 家庭共享 + 预算 + 订阅消息 |
| R3 公测上线 | Sprint-6+ | 统计报表 + 审核 + 灰度发布 |

### 1.4 原规划对应 Epic / 卡片

| Epic | 原卡号 | 原内容 | 当前处理 |
|---|---|---|---|
| Epic-D 家庭共享 | `COSTRA-201` | 家庭邀请码 + 微信群分享卡片 | 原号已被 UI 重构占用，改由 `COSTRA-221/223` 承接 |
| Epic-D 家庭共享 | `COSTRA-202` | 成员角色与权限 | 原号已被登录页重做占用，改由 `COSTRA-221` 承接 |
| Epic-D 家庭共享 | `COSTRA-203` | 实时推送 + 订阅消息兜底 | 原号已被明细页占用，后移到 Budget/Notification sprint |
| Epic-D 家庭共享 | `COSTRA-204` | 审计日志 | 原号已被记账 overlay 占用，后续作为 API 内建/审计页独立卡 |
| Epic-E 预算 | `COSTRA-301` | 月度预算 + 超支提醒 | 后移到 Sprint 7+ |
| Epic-E 周期账单 | `COSTRA-302` | 周期账单 + cron + 订阅消息 | 后移到 Sprint 7+ |
| Epic-F 统计 | `COSTRA-401` | 月度饼图 / 趋势折线 | 由 `COSTRA-224/225` 重新映射 |
| Epic-F 年报 | `COSTRA-402` | 年度报告分享页 | 后续独立年报卡，不并入 `224/225` 首轮 |
| Epic-G 上线 | `COSTRA-901` | 隐私协议 + 类目合规 + 提交微信审核 | Sprint 6 起前置，Sprint 8 发布前必须闭环 |
| Epic-G 发布 | `COSTRA-902` | 分阶段发布 | Sprint 8 |
| Epic-G 监控 | `COSTRA-903` | APM + JS 异常监控 | Sprint 6/8 分阶段落地 |

---

## 2. 为什么必须调整 Sprint 4/5/6

### 2.1 卡号冲突

早期 `COSTRA-201~204` 已经被当前 UI 重构系列占用：

| 当前卡号 | 当前实际含义 |
|---|---|
| `COSTRA-201` | Custom TabBar + 路由重组 + eventBus |
| `COSTRA-202` | 登录页重做 |
| `COSTRA-203` | 明细页全新开发 |
| `COSTRA-204` | 记账 overlay 全新开发 |

后续家庭共享不能再使用旧 `201~204`，统一使用 `COSTRA-221~226` 路线。

### 2.2 当前真实缺口已经变化

早期计划的“家庭协作”是粗粒度大包；当前项目已经具备：

- family bootstrap；
- active family context；
- `entries.shared_type`；
- 分类 API；
- 明细页真实数据。

当前缺口更明确：

1. `/families/*` 契约存在但 routes 未实装，且无 `x-deferred` 标记。
2. 真实 family list / member list / invite / accept / remove 缺失。
3. 家庭页所需公共/个人支出、垫付贡献、成员聚合 API 缺失。
4. 明细页成员头像、退出成员灰化、多账本切换依赖 D2/D3。
5. 统计页必须复用家庭聚合口径，否则会返工。

### 2.3 Human 已裁决 Family First

当前优先级已调整为：

```text
家庭页优先级 > 统计页优先级 > 我的页优先级
```

因此原 Sprint 5/6 中预算、周期账单、订阅消息、年度报告、审核灰度均需后移或拆分，不能抢在家庭域核心闭环之前。

### 2.4 生产环境已进入更真实阶段

Phase-2 prod bootstrap 与 Phase-3 真机已通过，后续 Sprint 不能只按功能排期，还必须纳入：

- prod 安全加固；
- mockLogin 防误开；
- 备份/回滚；
- 监控/告警；
- 隐私合规提前量。

---

## 3. 调整后总路线

```text
Sprint 3（回头讨论）
  ├─ 收口当前非法变更 / 状态对账
  ├─ 确认 Sprint-3 遗留小卡是否保留/延期
  └─ 为 Sprint 4 建正式 dispatch 队列

Sprint 4 · Family Foundation + Prod Guardrails
  ├─ COSTRA-221 家庭管理 API
  ├─ COSTRA-222 家庭财务聚合 API
  ├─ 当前主链路自动化 / CI 回归网
  └─ prod 安全与发布前守门 P0/P1 加固

Sprint 5 · Family Experience
  ├─ COSTRA-223 家庭页正式实现 / API 接入
  ├─ 明细页家庭成员回填
  ├─ Family 端到端 QA
  └─ conflict UI / 小型工程债按容量插入

Sprint 6 · Stats + Mine + Compliance Prep
  ├─ COSTRA-224 月度/年度统计 API
  ├─ COSTRA-225 统计页 UI
  ├─ COSTRA-226 我的页重做
  ├─ COSTRA-901 合规前置
  └─ APM / JS 异常监控前置

Sprint 7 · Budget / Notification / Audit
  ├─ COSTRA-301 月度预算
  ├─ COSTRA-302 周期账单
  ├─ 订阅消息授权与降级红点
  └─ 审计日志查询 / 家庭活动流

Sprint 8 · Release
  ├─ COSTRA-901 完整提审闭环
  ├─ COSTRA-902 分阶段发布
  └─ COSTRA-903 生产监控与日报
```

---

## 4. Sprint 4 详细规划：Family Foundation + Prod Guardrails

### 4.1 Sprint Goal

建立家庭域真实服务端能力，为家庭页和后续统计口径打基础；同时补齐 prod 发布前最关键的安全/自动化守门。

### 4.2 必做卡

#### `COSTRA-221` · 家庭管理 API

- Owner：`backend-dev`
- 优先级：P0
- 类型：backend feature
- 依赖：`COSTRA-164/165`、family/ledger schema、auth middleware
- Review：`card-reviewer-tech` → `costra-backend-dev` → `review-tech` → Human

范围：

- `GET /v1/families`：当前用户可见 family list，含 personal/shared、active ledger 信息。
- `GET /v1/families/{family_id}/members`：成员列表，含 role、status、joined_at、left_at、nickname/avatar 快照。
- `POST /v1/families`：创建 shared family + 默认 ledger。
- `POST /v1/families/{family_id}/invites`：创建邀请，含 24h 过期、角色限制。
- `POST /v1/family-invites/{invite_id}/accept` 或现有 OpenAPI 等价路径：接受邀请。
- `DELETE /v1/families/{family_id}/members/{user_id}`：移出成员 / 成员退出。

必须处理：

- `/families/*` OpenAPI 已定义但 routes 未实装、无 `x-deferred` 标记的 AP-003 漂移。
- Handoff 中 `/family-invites/{id}/accept` 与 OpenAPI 现有路径可能不一致，必须统一。
- personal family 不可邀请、不可删除。
- 非成员不可读成员列表。
- 被移出成员不删除历史流水；成员快照必须满足历史展示。
- owner/admin/member 权限边界。
- audit log 至少服务端记录关键成员操作；“活动流页面”可后置。

DoD：

- OpenAPI 与 routes 一致。
- service 层强制 user/family 守门。
- 单测覆盖 owner/admin/member/非成员/personal family 禁项/邀请过期/重复接受。
- `npm run typecheck`、server tests 全绿。
- 无新增 `x-deferred` 漂移。

#### `COSTRA-222` · 家庭财务聚合 API

- Owner：`backend-dev`
- 优先级：P0
- 类型：backend feature
- 依赖：`COSTRA-221`、`entries.shared_type`
- Review：`card-reviewer-tech` → `costra-backend-dev` → `review-tech` → Human

范围：

- `GET /v1/families/{family_id}/summary?month=YYYY-MM`
- 建议预留 `dimension=monthly|yearly`，但 Sprint 4 可先以 month 为主。
- 返回家庭页所需：
  - total expense / income / balance；
  - shared expense；
  - each member personal expense；
  - member paid contribution；
  - category rank for shared and per member；
  - active/left member display info。

口径：

- `entries.shared_type='shared'` → 公共支出。
- `entries.shared_type='personal'` → 成员个人支出。
- income 不进入“公共收入”概念；收入/结余可作为摘要字段。
- 金额统一 cents 整数。
- 月区间按用户时区或当前项目既定时区口径；若暂不支持用户时区，必须在 dispatch 写清。
- 零值分类严格排除。
- 已退出成员历史贡献仍展示，前端灰化。

DoD：

- OpenAPI schema 明确。
- 单测覆盖 shared/personal/income/left member/empty month/category rank/top N。
- 与明细页本地汇总口径一致。
- 不引入 `shared_scope` 新字段；统一使用 `shared_type`。

### 4.3 Sprint 4 工程/安全守门卡

以下不应压过 `221/222`，但属于 Sprint 4 头部候选：

| 候选 | Owner | 优先级 | 建议处理 |
|---|---|---|---|
| `COSTRA-155` 全量自动化 + CI | qa-planner + miniapp-dev | P1 | 建议拆成“当前基线 99 测 + 家庭 API contract smoke”两段，先补回归网 |
| `FU-PROD-CI-MOCK-GUARD` | devops-ops | P0 | 防 prod 部署脚本含 `WX_MOCK_LOGIN=1` |
| `FU-PROD-FW-AUDIT` | devops-ops | P0 | 防火墙、fail2ban、SSH 非 22、登录失败告警 |
| `FU-PROD-PG-BACKUP` | devops-ops | P1 | pg_dump → COS / 7 日保留 |
| `FU-PROD-CI-DEPLOY` | devops-ops | P1 | CI 自动 deploy + rollback，可延至 Sprint 6/8 |
| `FU-PROD-SCHEMA-MIGRATIONS-TABLE` | devops-ops/backend-dev | P1 | schema_migrations 跟踪，避免重复跑 migration |

> 注：`prod-bootstrap-compose.md` 已用 docker compose 消除了旧手册里的 Redis 5 与 PG trust 部分风险；仍以 compose 手册为当前推荐路径。

### 4.4 Sprint 4 不做

- 不做预算 / 周期账单。
- 不做统计页 UI。
- 不做年度报告。
- 不做完整发布/灰度。
- 不做 WebSocket 实时推送。
- 不做订阅消息模板下发闭环。
- 不做家庭页大规模 UI，除非 `221/222` 提前完成且走正式 `223` 流程。

---

## 5. Sprint 5 详细规划：Family Experience

### 5.1 Sprint Goal

把家庭域能力变成用户可操作、可验证的前端闭环。

### 5.2 必做卡

#### `COSTRA-223` · 家庭页全新开发 / API 接入

- Owner：`miniapp-dev`
- 优先级：P0
- 依赖：`COSTRA-221/222`
- Review：建议双审
  - `card-reviewer-product`：体验、设计、信息架构；
  - `card-reviewer-tech`：数据接入、缓存、状态、错误处理。

范围：

- 单人账本引导态：创建家庭账本入口、家庭协作价值说明。
- 多人家庭协作态：家庭名、成员横向滚动、成员状态。
- 创建家庭、邀请、接受邀请、移出成员入口接真实 API。
- 已退出成员灰化：头像黑白灰度 + opacity 0.4 + 点击无响应。
- 公共/个人支出拆解。
- 垫付贡献展示。
- 分类排行手风琴，零值排除，Top N 截断。
- 与明细页联动：成员缓存、头像、筛选、退出成员展示。

特别约束：

- 不允许 fallback demo 成员冒充完成。
- 不允许本地把所有支出粗暴归公共后宣称闭环。
- 若 `221/222` 缺字段，必须回到 dispatch/API 层修订，不在前端硬猜。
- UI 以 `design/ui/design_spec.md`、`interaction_flow.md` 为事实源。

#### Family E2E QA 卡

- Owner：`qa-planner`
- 优先级：P0/P1
- 依赖：`221/222/223`

建议覆盖：

1. A 用户创建 shared family。
2. A 生成邀请。
3. B 接受邀请。
4. A/B 分别记个人支出与公共支出。
5. 家庭页展示公共支出、个人支出、垫付贡献。
6. A 移出 B。
7. B 历史流水仍可被家庭视角展示，但头像灰化。
8. 非成员访问 family API 被拒绝。
9. 离线新增后同步回家庭聚合。
10. 月份切换 / 空月份 / 年度入口降级表现。

### 5.3 可选/顺手卡

| 候选 | Owner | 优先级 | 建议 |
|---|---|---|---|
| `COSTRA-151` conflict 合并 UI | miniapp-dev + design-maker | P2 | 若 Family 核心闭环稳定，可排 Sprint 5 末；否则延后 |
| `COSTRA-159` outbox fake timers | miniapp-dev | P2 | 可并入 QA 稳定性批次 |
| `COSTRA-161/163` CI 对账小卡 | devops-ops | P2 | 可批量处理 |
| `COSTRA-162` mockLogin runtime toggle | miniapp-dev | P3 | 不抢主线 |

### 5.4 Sprint 5 不做

- 不做预算超支提醒。
- 不做周期账单。
- 不做年度报告分享页。
- 不做 WebSocket 实时推送；可仅保留 syncScheduler + 手动刷新/页面刷新。
- 不做完整审核提审。

---

## 6. Sprint 6 详细规划：Stats + Mine + Compliance Prep

### 6.1 Sprint Goal

在家庭聚合口径稳定后，完成统计页与我的页，并前置上线合规和可观测性。

### 6.2 必做卡

#### `COSTRA-224` · 月度/年度统计报表 API

- Owner：`backend-dev`
- 优先级：P1
- 依赖：`COSTRA-222`

范围：

- 月度/年度总支出、收入、结余。
- 趋势数据：月度日粒度、年度月粒度。
- 分类排行：一级/二级，零值排除，Top N 截断。
- 成员维度筛选：全部/自己/成员。
- 公共/个人支出口径复用 `COSTRA-222`。
- 空态和低数据量场景。

边界：

- `COSTRA-224` 是统计页 API，不包含年度报告海报生成。
- 年度报告分享页另立卡，承接旧 `COSTRA-402`。

#### `COSTRA-225` · 统计页全新开发

- Owner：`miniapp-dev`
- 优先级：P1
- 依赖：`COSTRA-224`

范围：

- 月度 / 年度切换。
- 单色趋势图或极简趋势表达。
- 摘要网格。
- 排行榜 + 手风琴 + 零值排除。
- 成员横向切换。
- 空态文案与低数据量表现。
- 与 `design/ui/design_spec.md §6.4` 对齐。

#### `COSTRA-226` · 我的页重做

- Owner：`miniapp-dev`
- 优先级：P2

范围：

- 极简用户名片。
- 记账天数。
- 宏观数据总览。
- iOS/WeUI 分组菜单。
- 账号、隐私、关于入口。
- 为后续订阅消息授权、隐私指引、注销账号预留入口。

#### `COSTRA-901-prep` · 合规提审前置

- Owner：`pm-writer + qa-planner`
- 优先级：P1

范围：

- 微信隐私保护指引现状盘点。
- `requiredPrivateInfos` 检查。
- 类目“生活服务 → 记账工具”自查。
- 家庭数据二次同意文案。
- 分享文案合规：禁止诱导分享。
- `qa/checklists/wechat-review.md` 从占位骨架升级为可执行清单。

#### `COSTRA-903-prep` · APM / JS 异常监控前置

- Owner：`devops-ops`
- 优先级：P1/P2

范围：

- 微信小程序后台 JS 异常监控接入方案。
- server 关键接口错误率、P99 指标定义。
- 日报/告警渠道设计。
- 先产出监控方案或最小接入，不要求 Sprint 6 内完成全量运营看板。

### 6.3 Sprint 6 不做

- 不做完整 `COSTRA-902` 分阶段发布。
- 不做年度报告海报生成，除非 `224/225/901-prep` 全部提前完成。
- 不做预算 / 周期账单，放到 Sprint 7。
- 不做 WebSocket 实时协作，除非 Family E2E 已稳定且有余量。

---

## 7. Sprint 7+ 占位规划

### 7.1 Sprint 7 · Budget / Notification / Audit

建议承接早期 Epic-E 与部分 Epic-D：

| Card | Owner | 内容 |
|---|---|---|
| `COSTRA-301` | backend-dev + miniapp-dev | 月度总预算 / 分类预算 / 超支提醒 |
| `COSTRA-302` | backend-dev + miniapp-dev + devops-ops | 周期账单、cron、待确认流水 |
| `COSTRA-303` | pm-writer + miniapp-dev | 订阅消息授权、7 天失效、红点降级、通知设置入口 |
| `COSTRA-204-new` 或新号 | backend-dev + miniapp-dev | 审计日志查询 / 家庭活动流 |

### 7.2 Sprint 8 · Release

建议承接 Epic-G：

| Card | Owner | 内容 |
|---|---|---|
| `COSTRA-901` | pm-writer + qa-planner + miniapp-dev | 隐私协议、类目合规、提审包 |
| `COSTRA-902` | devops-ops + qa-planner | 1% → 10% → 50% → 100% 灰度发布 |
| `COSTRA-903` | devops-ops | APM、JS 异常监控、日报、告警 |
| 年度报告卡 | backend-dev + miniapp-dev | 旧 `COSTRA-402`，可视发布节奏后置 |

---

## 8. 依赖图

```text
当前基线
  ├─ Auth / Family bootstrap: COSTRA-164/165 ✅
  ├─ Sync: COSTRA-154/150 ✅
  ├─ Category + shared_type: COSTRA-217/218/219 ✅
  └─ Ledger integration: COSTRA-220 ✅

Sprint 4
  ├─ COSTRA-221 家庭管理 API
  │   └─ unblock: family list / members / invite / remove
  └─ COSTRA-222 家庭财务聚合 API
      └─ unblock: family dashboard / stats public-personal口径

Sprint 5
  └─ COSTRA-223 家庭页 UI + API 接入
      ├─ unblock: 明细页成员头像/灰化/筛选回填
      └─ unblock: Family E2E QA

Sprint 6
  ├─ COSTRA-224 统计 API
  │   └─ depends on: COSTRA-222 聚合口径
  ├─ COSTRA-225 统计页 UI
  │   └─ depends on: COSTRA-224
  └─ COSTRA-226 我的页
      └─ provides: 隐私/通知/关于/设置入口

Sprint 7+
  ├─ COSTRA-301/302 Budget + recurring bills
  ├─ 订阅消息授权/降级红点
  └─ 审计日志查询 / 家庭活动流

Sprint 8+
  └─ COSTRA-901/902/903 审核 / 灰度 / 监控
```

---

## 9. 风险与缓解

| 风险 | 严重度 | 影响 | 缓解 |
|---|---|---|---|
| 非正式 `COSTRA-223` 变更污染状态 | P0 | 后续计划基于非法产物 | Sprint 3 先处理：回滚或转 prototype，不计正式进度 |
| `/families/*` OpenAPI 与 routes 漂移 | P1 | 前后端联调失败 | `COSTRA-221` 首项处理契约对齐；必要时补 `x-deferred` |
| `shared_type` 口径被前端误写成 `shared_scope` | P1 | 聚合与 UI 不一致 | `COSTRA-222` 明确唯一字段 `entries.shared_type` |
| 家庭页先于 API 做 fallback | P1 | 技术债扩大 | `COSTRA-223` 必须依赖 `221/222`；禁止 demo 数据冒充完成 |
| 预算/订阅消息过早插入 | P2 | 打断 Family First | Sprint 7 前不启动 `301/302`，除非 Human 重新裁决 |
| 统计页未复用家庭聚合口径 | P1 | 二次返工 | `COSTRA-224` 强依赖 `222`，统计 API 复用 public/personal 口径 |
| 微信审核隐私合规滞后 | P1 | 发布延期 | Sprint 6 做 `901-prep`，不等 Sprint 8 才补 |
| prod 安全/备份不足 | P1 | 发布风险 | Sprint 4 插入 P0/P1 guardrail：mock guard、FW audit、backup |
| 自动化回归不足 | P1 | Family 改动破坏已验收基线 | Sprint 4/5 补 `COSTRA-155` 或拆分为当前基线回归网 |

---

## 10. 卡号与命名治理

### 10.1 废弃旧含义

旧 PRD 中 `COSTRA-201~204` 的家庭共享含义已废弃，原因是这些号已被 UI 重构实际占用。

后续文档中如引用旧号，必须标注：

```text
旧 PRD 编号，已重编号到 COSTRA-221+ 系列，不得直接派单。
```

### 10.2 新编号建议

| 新卡 | 含义 | 替代旧规划 |
|---|---|---|
| `COSTRA-221` | 家庭管理 API | 旧 `201/202` 的服务端基础 |
| `COSTRA-222` | 家庭财务聚合 API | 家庭页/统计页共同口径 |
| `COSTRA-223` | 家庭页 UI | 旧家庭面板/协作页 |
| `COSTRA-224` | 统计报表 API | 旧 `401` 后端部分 |
| `COSTRA-225` | 统计页 UI | 旧 `401` 前端部分 |
| `COSTRA-226` | 我的页重做 | 新增 UI 收尾卡 |
| `COSTRA-301/302` | 预算/周期账单 | 保留原号，后移 Sprint 7 |
| `COSTRA-901/902/903` | 审核/灰度/监控 | 保留原号，Sprint 6 前置、Sprint 8 闭环 |

---

## 11. Sprint 3 回头讨论时的议题清单

本规划完成后，回到 Sprint 3 时建议只讨论以下问题，不直接进入 Sprint 4 开发：

1. 是否回滚非正式 `COSTRA-223` prototype 变更。
2. 是否将该 prototype 另存为参考，还是彻底丢弃。
3. `.team/board.md`、`.team/backlog.json`、`.team/STATE` 如何同步到 Family First 验收后状态。
4. Sprint-3 遗留卡如何处理：
   - `COSTRA-151`
   - `COSTRA-155`
   - `COSTRA-159`
   - `COSTRA-161`
   - `COSTRA-162`
   - `COSTRA-163`
   - `COSTRA-114`
5. `COSTRA-221` dispatch 是否立即创建。
6. `COSTRA-221` 是否需要先由 `pm-writer`/`backend-dev` 做 API 口径对账，再进入 card-review。
7. Sprint 4 容量如何分配：家庭后端 vs prod guardrail vs 自动化。

---

## 12. 推荐 Human 触发顺序

建议后续由 Human 依次触发：

```text
1. discard-invalid:COSTRA-223-prototype
   或 confirm-keep-prototype:COSTRA-223-reference-only

2. sync-state:family-first-baseline

3. plan-dispatch:COSTRA-221

4. card-review:COSTRA-221

5. start:COSTRA-221

6. plan-dispatch:COSTRA-222

7. start:COSTRA-222

8. plan-dispatch:COSTRA-223
```

其中第 1~2 步属于 Sprint 3 收尾/状态治理；第 3 步之后才进入 Sprint 4 正式准备。

---

## 13. 本规划不做的事

- 不修改业务代码。
- 不提交 git commit。
- 不把当前非正式 `COSTRA-223` 变更视为正式完成。
- 不直接启动任何 Agent 开发任务。
- 不替代正式 dispatch。
- 不替代 card-review。

---

## 14. 文件证据索引

| 文件 | 用途 |
|---|---|
| `.team/HANDOFF-2026-06-02-acceptance-verified.md` | 当前验收通过交接 |
| `.team/HANDOFF-2026-06-01-next-sprints-family-first.md` | Family First 优先级裁决与 `221~226` 初版拆分 |
| `.team/HANDOFF-2026-06-01-ui-refactor.md` | UI 重构完成范围与后续 Phase B/C/D/E 路线 |
| `qa/current-stage-acceptance-family-first-baseline.md` | 当前基线验收范围、遗留、后续路线 |
| `COSTRA-BLUEPRINT.md` | 早期 Sprint 4~9 里程碑 |
| `docs/charter.md` | 早期 M2/M3/M4 路线与指标采集起点 |
| `docs/design/user-story-map.md` | R1/R2/R3 Release Slice |
| `docs/PRD.md` | Epic-D/E/F/G 原始 AC 与旧卡号 |
| `.team/backlog.json` | 旧 backlog 卡号来源 |
| `infra/prod-bootstrap-compose.md` | prod compose 路线与 Sprint 4 加固 FU |
| `infra/prod-bootstrap.md` | 旧 prod 手册与部分安全 FU 来源 |

---

## 15. 结论

Sprint 4/5/6 必须从早期“家庭协作 → 预算订阅 → 统计合规”的粗路线，调整为更贴合当前事实的 Family First 路线：

```text
Sprint 4：家庭后端基础 + prod guardrails
Sprint 5：家庭页真实接入 + Family E2E
Sprint 6：统计页 + 我的页 + 合规/监控前置
```

预算、周期账单、订阅消息、审计活动流、年度报告、正式灰度发布均后移到 Sprint 7+ / Sprint 8，避免压过当前最关键的家庭域闭环。
