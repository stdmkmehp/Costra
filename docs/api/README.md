# Costra API 契约说明

> **事实源**：`server/api/openapi.yaml` （镜像 `api/openapi.yaml`）
> **版本**：v0.1.0-draft · **阶段**：G3 契约评审前置草案
> **Owner**：Backend-Agent · **消费方**：MiniApp-Agent / QA-Agent

---

## 1. 命名与类型约定

| 维度 | 规则 | 来源 |
|---|---|---|
| 字段命名 | JSON 一律 `snake_case` | engineering-guidelines §3 |
| 客户端字段 | MiniApp 映射为 `camelCase`（`request.ts` 层适配） | ADR-0004 |
| 金额 | `int64`，单位**分**，不使用浮点 | ADR-0004 §金额 |
| 时间 | ISO-8601 UTC 字符串 | ADR-0004 §时区 |
| UUID | 服务端实体主键 **v7**（时间有序）；`client_ref_id` / `Idempotency-Key` 为 **v4** | `id-strategy.md` |
| 分页 | 游标分页（`cursor` + `next_cursor`） | 统一 |
| 乐观锁 | 每个可变实体含 `version: int` | 见冲突策略 |
| 幂等 | 所有写操作需 `Idempotency-Key: <uuid>` 请求头 | 全链路 |

---

## 2. 鉴权

- **方式**：`Authorization: Bearer <access_token>`（JWT）
- **access_token**：2h 有效
- **refresh_token**：30 天有效，仅用于 `/auth/refresh`
- **刷新策略**：客户端在 access 过期前 5 分钟静默刷新；401 时触发一次自动刷新，失败清理凭证跳登录
- **登出**：调用 `/auth/logout` 使 refresh 失效

---

## 3. 错误响应模型

所有非 2xx 返回统一结构（`components.schemas.Error`）：

```json
{
  "code": "INVALID_ARGUMENT",
  "message": "字段 amount 必须 > 0",
  "trace_id": "7f4c...a1",
  "details": { "field": "amount" }
}
```

### 标准错误码（精简视图）

> **完整字典（21 条）+ 重试策略 + QA 断言**见 [`error-codes.md`](./error-codes.md)。
> 本节仅保留高频 HTTP 段落速查，**若两表冲突以 `error-codes.md` 为准**。

| HTTP | code | 场景 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | 参数校验失败 |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | 写操作未带幂等键 |
| 401 | `UNAUTHENTICATED` | 未登录或 access 无效 |
| 401 | `TOKEN_EXPIRED` | 访问令牌过期 |
| 403 | `PERMISSION_DENIED` | 有身份但无权限（如非 owner 改家庭） |
| 404 | `NOT_FOUND` | 资源不存在或对当前用户不可见 |
| 409 | `VERSION_CONFLICT` | 乐观锁冲突（详见冲突策略） |
| 409 | `IDEMPOTENCY_KEY_MISMATCH` | 同 `Idempotency-Key` 但 body hash 不一致 |
| 410 | `INVITE_EXPIRED` | 邀请口令过期或已使用 |
| 422 | `BUSINESS_RULE_VIOLATION` | 业务规则（如分类名称家庭内重复） |
| 429 | `RATE_LIMITED` | 命中限流 |
| 500 | `INTERNAL` | 未预期错误，含 `trace_id` |
| 503 | `UNAVAILABLE` | 依赖不可用 |

> **客户端处理建议**：参考 MiniApp `utils/error-mapper.ts`（COSTRA-030 产出），做用户可读文案映射。

---

## 4. 分页规约

- 请求：`?cursor=<opaque_string>&limit=20`
- 响应：`{ items: [...], next_cursor: string | null }`
- `next_cursor=null` 表示已到尾页
- 游标为服务端生成的不透明字符串（内部为 `updated_at + id` 复合键，base64url 编码）；客户端不得解析

---

## 5. 幂等键（Idempotency-Key）

- 所有 `POST` / 写入型 `PATCH` / `DELETE` **必须**带 `Idempotency-Key`
- 值为 UUID v4，**24h 内**同 key + 同 endpoint + 同 body hash 返回首次结果
- 不匹配时服务端返回 **409** + `code=IDEMPOTENCY_KEY_MISMATCH`（详见 [`id-strategy.md §3.3`](./id-strategy.md)）
- 客户端实现：在 `request.ts` 拦截器里自动为写操作注入 UUID 并持久化到本地缓冲（用于重试）

---

## 6. 审计

所有写操作由服务端在响应后异步写 `audit_logs`，详见 [`./audit-log.md`](./audit-log.md)。

---

## 7. 版本演进

- **破坏性变更**：改字段名 / 改类型 / 删字段 / 改状态码语义 → 必须 ADR + G3 双签 + 小版本号（0.x → 0.y）
- **非破坏性**：新字段 / 新端点 → 直接升 `0.1.0-draft → 0.1.x`
- CI 在 PR 阶段用 `openapi-diff` 检测 breaking change，阻断合并

---

## 8. 相关文档

- [`error-codes.md`](./error-codes.md) · 错误码字典（21 条）+ 客户端重试矩阵 + QA 断言
- [`ttl-policy.md`](./ttl-policy.md) · access/refresh/invite/幂等窗口等全链路 TTL
- [`id-strategy.md`](./id-strategy.md) · 服务端 UUIDv7 · `client_ref_id` · `Idempotency-Key`
- [`sync-protocol.md`](./sync-protocol.md) · `/sync/push` + `/sync/pull` 完整批协议
- [`conflict-strategy.md`](./conflict-strategy.md) · 409 冲突场景与客户端处理
- [`audit-log.md`](./audit-log.md) · 审计字段与留存
- [`../db/schema.md`](../db/schema.md) · DB 结构映射
- ADR-0004 · MiniApp 运行时细则（分包 / Token / 金额 / 时区 / 灰度）
