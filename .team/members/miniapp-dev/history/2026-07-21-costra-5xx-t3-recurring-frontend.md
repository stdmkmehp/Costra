# 2026-07-21 · COSTRA-5xx T3 · 前端主卡（列表页 + 编辑页 + 分包）

## 任务描述

实现 `docs/design/recurring-entry-task-breakdown.md` T3：定时记账前端主卡。范围包括 `pages-recurring` 分包、列表与编辑页、6 个独立组件、8 个 API 封装、离线队列、mine 入口迁移，以及小程序 PATCH method-override 和服务端幂等闭环。

- task_type: feature
- 产品事实源: `docs/design/recurring-entry-product-spec.md` v0.3.2
- 技术事实源: `docs/design/recurring-entry-tech-spec.md` v0.2.1
- 范围边界: 不实施 T4 明细页“定/公”角标

## 主要产出

- `miniprogram/pages-recurring/list/`：空态、启用/禁用分组、摘要、点击编辑、长按复制/修改/禁用启用/删除、离线乐观更新、自定义导航。
- `miniprogram/pages-recurring/edit/`：新增/编辑/复制三模式、三卡片、日期范围、真实时区预览、409 校准、未保存离开保护、保存校验闪烁。
- `miniprogram/components/category-picker/`：按规则所属 family 加载分类，支持跨 type 选择。
- `miniprogram/components/recurring-{period-selector,dow-picker,dom-picker,yearly-picker,bucket-picker}/`：六档周期及差异化选择控件。
- `miniprogram/components/recurring-selection.ts`：多选上限、跨月保留和月份徽标共享纯函数。
- `miniprogram/services/recurringApi.ts`：8 个 recurring endpoint 封装。
- `miniprogram/services/recurringLocal.ts`：SWR 缓存、离线 mutation queue、持久化 Idempotency-Key、瞬时错误保留、连续 version 传播、重放完成事件。
- `miniprogram/services/syncScheduler.ts`：每次登录态同步独立重放 recurring queue，不依赖 active family 或 `SYNC_DONE`。
- `miniprogram/app.json`、`pages/mine`、`pages-family/settings`：分包与入口迁移。
- `server/src/routes/recurring.ts`：POST method-override；全部 mutation 使用 PG 幂等响应缓存，指纹包含 user/params/query/body，TTL 7 天。
- `server/test/recurring-entries.test.ts`：method-override 与 create/update 幂等重放用例。

## 关键决策

1. recurring queue 不硬塞入仅支持 entry/category/budget 的 `/sync/push`，而是复用同一调度触发节奏直接重放。
2. 每个离线 mutation 的 Idempotency-Key 入队时生成并持久化；服务端缓存成功响应，避免“写成功但响应丢失”导致重复 create/copy/update。
3. 分类面板共享 `expense-overlay/categories.ts` 数据层，但不高风险改写现有 expense-overlay UI。
4. 自定义导航统一使用 `getSafeAreaMetrics()`，动态避让微信右上胶囊。
5. 新建规则预览使用 bucket 窗口代表时点；编辑规则沿用服务端精确 hour/minute；日期由 Luxon 按规则 timezone 格式化。
6. 离线 create 不生成可继续编辑的本地临时规则；重放成功后刷新服务端真实规则，因此不存在临时 ID 的 create→update/delete 链。

## 验证

- miniapp typecheck：通过
- miniapp test：25 files / 432 tests
- miniapp lint：0 error（2 条历史 warning）
- parity：PASS
- appjson / tooling / whitelist：通过
- 静态体积：主包 1422.7KB；`pages-recurring` 67.3KB；总计 1505.7KB
- server typecheck：通过
- server test：22 files / 392 tests（recurring e2e 23 条）

## 后续

- T4 独立实施明细页“定/公”角标及跨视图回归。
- 真机验收重点：自定义导航胶囊避让、系统手势返回告警、分类面板滚动、DOM/yearly 上限动效。
