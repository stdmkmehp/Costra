# API Changelog

> 事实源：`api/openapi.yaml`（即 `server/api/openapi.yaml`）
> 格式：Keep a Changelog · 逆向时间序
> 破坏性变更必须先改 openapi.yaml + 本文件，再写实现（§2 铁律）

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
