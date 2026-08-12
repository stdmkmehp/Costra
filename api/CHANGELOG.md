# API Changelog

> 事实源：`api/openapi.yaml`（即 `server/api/openapi.yaml`）
> 格式：Keep a Changelog · 逆向时间序
> 破坏性变更必须先改 openapi.yaml + 本文件，再写实现（§2 铁律）

---

## [0.13.0] - 2026-08-12 · 收入分类排行

### Added

- **GET /families/{family_id}/statistics/monthly** 响应新增 `income_category_ranks: StatCategoryRankItem[]`
  - 与 `category_ranks`（支出）并列，语义为"L1 收入分类排行"，一级折叠，金额降序
  - 收入不受 shared_type 约束（允许 NULL）
- **GET /families/{family_id}/statistics/yearly** 响应同上新增 `income_category_ranks`
- **GET /families/{family_id}/statistics/drill-down** 新增 query 参数 `entry_type: 'expense' | 'income'`（可选，默认 `expense`）
  - 'expense'：保持原口径（AND type='expense' AND shared_type IS NOT NULL）
  - 'income'：AND type='income'（无 shared_type 过滤）
  - 老客户端省略视为 `expense`，向后兼容

### Unchanged (显式说明避免误读)

- `YearlyExtremes.top_category_name/amount` 保持支出侧语义不变
- `MonthlyExtremes.max_single_*` 保持支出侧语义不变
- `category_ranks` 字段语义不变（仍为支出侧排行）

---

## [0.12.0] - 2026-07-06 · COSTRA-230 后续

### Changed

- **PATCH /families/{family_id}** 重命名权限由「仅 owner」放开为「任意 active 成员」
  - summary 更新为「更新家庭名称（任意 active 成员均可）」，补充 description
  - service 层 `updateFamily` 去除 `assertOwner`，仅保留 `assertActiveMember`
  - 非破坏性放宽（原 403 场景现返回 200）；version 乐观锁与 ledger_name 同步逻辑不变

---

## [0.11.0] - 2026-06-12 · COSTRA-302

### Added

- **GET /families/{family_id}/summary/drill-down** 协作页家庭汇总三级下钻接口
  - 按一级分类（L1）展开流水明细，口径严格对齐 familySummaryRepo（公共/个人分离）
  - 参数：month/year(xor) + l1_category_id + shared_type + user_id(personal 时必填) + limit
  - 响应：l1_category_id, l1_category_name, l1_amount, items[], total_count, has_more
- **SummaryDrillDownResponse** schema
- **SummaryDrillDownEntryItem** schema

---

## [0.10.0] - 2026-06-11 · COSTRA-301

### Changed

- **GET /families/{family_id}/summary** `month` 参数从 required 改为 optional
- **GET /families/{family_id}/summary** 新增 `year` 参数（optional，与 month 互斥，恰传一个）
- **FamilySummary** schema: `month` 改为 nullable（年度调用时为 null）；新增 `year` 字段（nullable）
- **FamilySummary** schema: `required` 列表移除 `month`（两者都不再无条件 required）
- **FamilySummary** `range_start` / `range_end` description 补充"month 调用为该月，year 调用为整年"
- **FamilyCategoryRankItem** description 补充 L1 一级分类排行语义说明 + ratio_bps 基数规则

---

## [0.9.0] - 2026-06-01 · COSTRA-217

### Added

- **Category** 增加 `parent_id`（UUID nullable）、`is_direct_default`（boolean）、`children_count`（integer）字段
  - `parent_id`：二级分类父级引用，最多 2 级
  - `is_direct_default`：全局二级展示区直选默认归属标记
  - `children_count`：一级分类下二级子分类数量（只读派生）
- **CategoryCreate** 增加 `parent_id` 字段 + 二级约束说明
- **Entry / EntryCreate / EntryUpdate** 增加 `shared_type` 字段（nullable enum: `personal` / `shared`）
  - 仅 `type=expense` 允许有值；`income` / `transfer` 必须为 null
  - 未传时服务端按 family kind 判定默认值（personal family → `personal`，shared family → `shared`）
- **SyncPushRequest** payload 说明补充 `shared_type`

---

## [0.8.0] - 2026-05-27 · COSTRA-164

### Added

- **POST /v1/auth/wx-login** 返回 `default_family_id` / `default_ledger_id` 字段
- **Family** 增加 `kind` 字段（enum: `personal` / `shared`）
- 个人 family 不可删除（`FAMILY_PERSONAL_NOT_DELETABLE`）

---

## [0.7.0] - 2026-05-22 · COSTRA-154 R1.x.2

### Changed

- **GET /v1/sync/pull** watermark 从 ISO 时间戳改为 BIGINT `change_seq`（v1.2 协议升级）
- `SyncPullResponse.server_version` 类型从 `string` (date-time) 改为 `integer` (int64)

---

## [0.6.0] - 2026-05-19 · COSTRA-154 R1

### Added

- **GET /v1/sync/pull** 增量拉取接口（替代 stub 501）

---

## [0.5.0] - 2026-05-22 · COSTRA-152 + COSTRA-153

### Added

- **PATCH /v1/entries/{id}** 部分更新流水
- **DELETE /v1/entries/{id}** 软删除流水
- 乐观锁：PATCH/DELETE 需 `?version=N`，冲突返回 409

---

## [0.4.0] - 2026-05-13 · COSTRA-156

### Changed

- 所有业务路由加 `/v1` 前缀（`/v1/entries`、`/v1/sync/push` 等）
- `GET /healthz` 保留根路径

---

## [0.3.0] - 2026-05-11 · COSTRA-104

### Added

- **POST /v1/sync/push** 同步推送接口
- **POST /v1/entries** 创建流水
- **GET /v1/entries** 查询流水列表
