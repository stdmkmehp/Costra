# Costra 错误码字典（Error Codes）

> **卡号**：COSTRA-100 · **Owner**：Backend-Agent  
> **事实源**：`server/src/errors/ErrorCode.ts`（TS 枚举）· `server/api/openapi.yaml` components.schemas.ErrorCode  
> **消费方**：MiniApp-Agent（`utils/error-mapper.ts`）/ QA-Agent（断言）/ DevOps-Agent（Grafana 告警规则）  
> **版本**：v1.0（随 OpenAPI v0.1.0-draft 生效）

---

## 0. 设计原则

1. **错误码是契约**：一旦发布，`code` 字符串值**不得改变**语义；新增错误码需小版本号 + 入本表。
2. **HTTP 状态码分层**：`HTTP status` 粗分类，`code` 精分类。客户端**必须以 `code` 判分支**，不得以 HTTP code 判分支。
3. **可恢复性显式标注**：每条错误码标注 `retryable` / `refresh_token` / `user_action`，客户端错误处理器可自动决策。
4. **错误响应统一结构**：所有 4xx/5xx 返回 `Error` schema（`code` / `message` / `trace_id` / `details`）；409 冲突扩展为 `ConflictError`。
5. **message 字段面向开发**：客户端**不得**直接展示 `message` 给终端用户，必须经 `error-mapper.ts` 转译为用户可读文案。
6. **trace_id 必有**：所有 4xx/5xx 服务端必须返回 `trace_id`，便于跨系统排障。
7. **details 可选**：仅 `INVALID_ARGUMENT` / `BUSINESS_RULE_VIOLATION` / `VERSION_CONFLICT` 明确约定结构，其他为自由对象。

---

## 1. 错误响应结构

### 1.1 通用 `Error`

```json
{
  "code": "INVALID_ARGUMENT",
  "message": "field \"amount\" must be > 0",
  "trace_id": "7f4c0e8a-...-a1",
  "details": {
    "field": "amount",
    "value": 0,
    "constraint": "minimum=1"
  }
}
```

### 1.2 扩展 `ConflictError`（仅 `409 VERSION_CONFLICT`）

```json
{
  "code": "VERSION_CONFLICT",
  "message": "entry version mismatch: client=3 server=5",
  "trace_id": "7f4c0e8a-...-a1",
  "details": {
    "entity": "entry",
    "entity_id": "01HX9Z3K7Y2V8W4N6M0Q5R2T1B"
  },
  "server_version": 5,
  "server_record": { "/* 服务端当前实体完整字段 */": "..." }
}
```

---

## 2. 错误码完整字典（共 22 条）

> **字段说明**：
> - `HTTP`：对应 HTTP 状态码  
> - `code`：契约键（服务端 / 客户端都以此判分支）  
> - `category`：粗分类（auth / param / permission / resource / conflict / rate / server）  
> - `retryable`：客户端是否应自动重试（见 §3 重试矩阵）  
> - `user_action`：用户侧是否需要采取动作

### 2.1 400 · 参数 / 请求体

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 1 | `INVALID_ARGUMENT` | param | ❌ | ❌（开发 bug） | 参数校验失败（类型、范围、枚举、正则）。`details.field` / `details.value` / `details.constraint` 三件套 |
| 2 | `MALFORMED_JSON` | param | ❌ | ❌ | 请求体 JSON 解析失败 |
| 3 | `IDEMPOTENCY_KEY_REQUIRED` | param | ❌ | ❌（客户端拦截器 bug） | 写操作未带 `Idempotency-Key` 头 |
| 4 | `UNSUPPORTED_MEDIA_TYPE` | param | ❌ | ❌ | `Content-Type` 非 `application/json` |

### 2.2 401 · 未授权

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 5 | `UNAUTHENTICATED` | auth | ❌ | ✅ 清凭证跳登录 | 未带 `Authorization` 或签名非法 |
| 6 | `TOKEN_EXPIRED` | auth | ✅ 刷新后重试 | ❌（静默） | `access_token` 过期；客户端触发一次 `/auth/refresh` 后重放原请求 |
| 7 | `REFRESH_TOKEN_INVALID` | auth | ❌ | ✅ 跳登录 | `refresh_token` 失效 / 被撤销 / 已登出 |
| 8 | `WX_CODE_INVALID` | auth | ❌ | ✅ 重新 `wx.login()` | `/auth/wx-login` 传入的 `code` 已失效（微信 code 5min 有效） |

### 2.3 403 · 权限

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 9 | `PERMISSION_DENIED` | permission | ❌ | ✅ 提示"权限不足" | 有身份但无权限（如 `viewer` 尝试写 / 非 owner 改家庭） |
| 10 | `FAMILY_NOT_MEMBER` | permission | ❌ | ✅ 跳回家庭首页 | 访问非自己家庭的资源 |
| 10b | `FAMILY_PERSONAL_NOT_DELETABLE` | permission | ❌ | ✅ 提示"不可删除" | 尝试删除个人 family（kind='personal' · ADR-0007 §5.7.3 · COSTRA-164 R1）|

### 2.4 404 · 资源

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 11 | `NOT_FOUND` | resource | ❌ | ✅ 提示"记录已被删除"或刷新列表 | 资源不存在或对当前用户不可见（含软删） |

### 2.5 409 · 冲突

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 12 | `VERSION_CONFLICT` | conflict | ❌（自动合并） | ✅ 可能弹合并 UI | 乐观锁冲突；响应体为 `ConflictError`；客户端按 `conflict-strategy.md` §4 处理 |
| 13 | `DUPLICATE_RESOURCE` | conflict | ❌ | ✅ 提示"已存在" | 唯一约束冲突（如家庭内分类名重复） |
| 14 | `IDEMPOTENCY_KEY_MISMATCH` | conflict | ❌ | ❌（开发 bug） | 同 `Idempotency-Key` 但 body hash 不一致；24h 内同 key 必须同请求体。详见 `id-strategy.md §3.3` |

### 2.6 410 · 已失效

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 15 | `INVITE_EXPIRED` | resource | ❌ | ✅ 提示"邀请已过期，请重新邀请" | 邀请口令过 TTL 或已被使用 |

### 2.7 422 · 业务规则

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 16 | `BUSINESS_RULE_VIOLATION` | param | ❌ | ✅ 文案按 `details.rule` 分支 | 业务规则拒绝。`details.rule` 为枚举：`family_member_limit` / `personal_family_not_invitable` / `category_name_duplicate` / `budget_overlap` / `ledger_archived` / `entry_occurred_at_future` / `currency_mismatch` |

### 2.8 429 · 限流

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 17 | `RATE_LIMITED` | rate | ✅ 按 `Retry-After` 头退避 | ❌（静默 + toast） | 命中令牌桶限流。响应头含 `Retry-After: <seconds>` |

### 2.9 5xx · 服务端

| # | code | category | retryable | user_action | 场景说明 |
|---|---|---|---|---|---|
| 18 | `INTERNAL` | server | ✅ 指数退避 | ❌（5 次失败后提示排障） | 未预期异常；含 `trace_id` |
| 19 | `UNAVAILABLE` | server | ✅ 指数退避 | ❌ | 依赖不可用（DB / Redis / 微信 API） |
| 20 | `TIMEOUT` | server | ✅ 指数退避 | ❌ | 上游超时；客户端重试幂等键不变 |
| 21 | `NOT_IMPLEMENTED` | server | ❌ | ❌（版本回退） | 功能未实装（占位端点） |

---

## 3. 客户端重试 / 刷新矩阵（request.ts 拦截器实装依据）

| HTTP / code | 自动行为 | 次数 | 退避 | 失败后 fallback |
|---|---|---|---|---|
| `401 TOKEN_EXPIRED` | 调 `/auth/refresh` 后重放 | 1 次 | 立即 | 清凭证 + 跳登录 |
| `401 UNAUTHENTICATED` | 无 | — | — | 清凭证 + 跳登录 |
| `401 REFRESH_TOKEN_INVALID` | 无 | — | — | 清凭证 + 跳登录 |
| `401 WX_CODE_INVALID` | 重新 `wx.login()` | 1 次 | 立即 | 引导用户关闭重开 |
| `409 VERSION_CONFLICT` | 交给业务层（合并 UI 或静默） | — | — | 见 `conflict-strategy.md` |
| `409 IDEMPOTENCY_KEY_MISMATCH` | 无（开发 bug） | — | — | 报错 + 上报 Sentry |
| `429 RATE_LIMITED` | 按 `Retry-After` 退避 | 3 次 | 服务端指定 | Toast "操作过于频繁" |
| `500/502/503/504 INTERNAL/UNAVAILABLE/TIMEOUT` | 指数退避 | 3 次 | 1s / 4s / 16s | Toast "网络异常，请稍后再试" + 上报 |
| 其他 4xx | 无（交业务层） | — | — | 按 `error-mapper.ts` 映射 |

> **幂等约束**：所有重试**必须**复用原 `Idempotency-Key`；离线 outbox 重试保留原 `client_ref_id`（见 `sync-protocol.md` §5）。

---

## 4. 客户端文案映射（`utils/error-mapper.ts` 契约）

客户端 **不得**直接展示后端 `message`。统一走 `mapError(code, details?, ctx?)` 函数返回 `{ title, desc, action? }`。

### 4.1 默认映射（MVP）

| code | title | desc | action |
|---|---|---|---|
| `INVALID_ARGUMENT` | 输入有误 | 请检查后重试 | — |
| `UNAUTHENTICATED` | 登录已失效 | 请重新登录 | 跳登录 |
| `TOKEN_EXPIRED` | （静默） | — | — |
| `PERMISSION_DENIED` | 权限不足 | 仅家庭创建者可执行此操作 | — |
| `FAMILY_NOT_MEMBER` | 无法访问 | 该家庭已移除你的身份 | 返回首页 |
| `FAMILY_PERSONAL_NOT_DELETABLE` | 不可删除 | 个人账本是默认账本 · 不可删除 | — |
| `NOT_FOUND` | 记录不存在 | 可能已被删除 | 刷新 |
| `VERSION_CONFLICT` | 数据冲突 | 该条记录已被其他成员修改 | 查看差异 |
| `DUPLICATE_RESOURCE` | 已存在 | 该名称已被使用，请换一个 | — |
| `INVITE_EXPIRED` | 邀请已过期 | 请联系家庭成员重新邀请 | — |
| `BUSINESS_RULE_VIOLATION` | （按 `details.rule` 分支） | — | — |
| `RATE_LIMITED` | 操作过于频繁 | 请稍后再试 | — |
| `INTERNAL` / `UNAVAILABLE` / `TIMEOUT` | 网络异常 | 请稍后再试 | — |

### 4.2 `BUSINESS_RULE_VIOLATION` 分支（`details.rule`）

| rule | 用户文案 |
|---|---|
| `family_member_limit` | 该家庭成员已达上限（MVP = 10） |
| `personal_family_not_invitable` | 个人账本不可邀请成员，请先创建家庭账本 |
| `category_name_duplicate` | 分类名称已存在 |
| `budget_overlap` | 该月份已存在相同分类的预算 |
| `ledger_archived` | 该账本已归档，无法继续记账 |
| `entry_occurred_at_future` | 记账时间不能晚于当前时间 1 小时以上 |
| `currency_mismatch` | 流水币种与账本不一致 |

---

## 5. 服务端实装要求

### 5.1 抛错方式

```ts
// server/src/errors/AppError.ts（本次不落代码，仅约束契约）
throw new AppError(ErrorCode.INVALID_ARGUMENT, 'field "amount" must be > 0', {
  field: 'amount', value: 0, constraint: 'minimum=1'
});
```

### 5.2 中间件统一落盘

- 全局 `errorHandler` 捕获 `AppError` → 序列化为 `Error` schema
- 未捕获异常 → 兜底为 `INTERNAL` + 必须有 `trace_id`
- 5xx 同时写 `audit_logs`（`action='error'`）+ Grafana metric `costra_api_error_total{code=...}`

### 5.3 日志脱敏

- `details` 中禁止出现 `note` / `nickname` / 手机号等用户明文
- `trace_id` 格式：UUID v4，贯穿整条请求链路

---

## 6. QA 断言钩子

| 用例 ID | 断言 |
|---|---|
| `smoke_err_01` | `POST /entries` 不带 `Idempotency-Key` → 400 + `code=IDEMPOTENCY_KEY_REQUIRED` |
| `smoke_err_02` | `PATCH /entries/{id}` 传过期 `version` → 409 + `code=VERSION_CONFLICT` + `server_version` 字段 |
| `smoke_err_03` | 过期 access token 请求 → 客户端自动刷新一次，最终 200 |
| `smoke_err_04` | 分类名重复创建 → 409 + `code=DUPLICATE_RESOURCE` |
| `smoke_err_05` | 邀请口令超 TTL → 410 + `code=INVITE_EXPIRED` |

---

## 7. DevOps 告警规则

| Metric | 告警阈值 | 严重度 |
|---|---|---|
| `costra_api_error_total{code="INTERNAL"}` 5min 增量 | > 20 | 🔴 P0 |
| `costra_api_error_total{code="UNAVAILABLE"}` 5min 增量 | > 5 | 🔴 P0 |
| `costra_api_error_total{code="VERSION_CONFLICT"}` 占比 | > 2% | 🟠 P1（用户感知冲突率超阈） |
| `costra_api_error_total{code="RATE_LIMITED"}` 5min 增量 | > 50 | 🟡 P2 |

---

## 8. 版本与演进

| 动作 | 是否破坏性 | 要求 |
|---|---|---|
| 新增 `code` | ❌ | 直接 PR，文档 + OpenAPI 枚举同步更新 |
| 修改 `code` 字符串值 | ✅ 破坏性 | ADR + G3 双签 + 小版本号（0.x → 0.y） |
| 修改 `code` 对应 HTTP 状态码 | ✅ 破坏性 | 同上 |
| 修改 `retryable` 语义 | ⚠️ 半破坏 | 客户端需同步升级 |
| 修改 `user_action` 文案 | ❌ | 直接改 `error-mapper.ts` 即可 |

---

## 9. 交叉引用

- OpenAPI Schema：`server/api/openapi.yaml` `components.schemas.ErrorCode`（见 §enum 定义）
- TS 枚举：`server/src/errors/ErrorCode.ts`（本次同步交付）
- 客户端映射：`miniprogram/utils/error-mapper.ts`（COSTRA-102 内落地）
- 冲突策略：`./conflict-strategy.md`
- 同步协议：`./sync-protocol.md`（**反向约束**见下）
- 审计落盘：`./audit-log.md`
- TTL 策略：`./ttl-policy.md`

### 9.1 `/sync/push` results 条目级 code 白名单（契约反向登记）

`sync-protocol.md §2.4` 定义的 `results[i].status` 三态在 `rejected` 分支下，`error.code` **必须且仅可**为以下集合之一：

| status | 允许的 code 集合 |
|---|---|
| `conflict` | `VERSION_CONFLICT` / `IDEMPOTENCY_KEY_MISMATCH`（其他 409 级冲突由本表 §2.5 登记） |
| `rejected` | `NOT_FOUND` / `PERMISSION_DENIED` / `BUSINESS_RULE_VIOLATION` / `INVALID_ARGUMENT` |

> 其他 code（如 `RATE_LIMITED` / 5xx 系列）**不得**以条目级出现在 push.results 中，应以整批级 HTTP 状态返回。
> 此白名单是 contract test 必须覆盖的断言之一（QA 钩子见本文件 §10、`sync-protocol.md` §4）。
