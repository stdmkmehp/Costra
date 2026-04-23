# Costra TTL / 时效策略

> **卡号**：COSTRA-100（D-006 §5 补齐项 #3）· **Owner**：Backend-Agent  
> **事实源**：`server/api/openapi.yaml` + `server/src/config/ttl.ts`（v0.2 实装）  
> **消费方**：MiniApp-Agent / QA-Agent  
> **版本**：v1.0

---

## 0. 目标

把 Costra 全链路中所有"带过期语义"的资源集中归档、统一单位、统一客户端行为，杜绝"某个 TTL 散落在代码里、需要全局 grep 才能改"的情况。

---

## 1. TTL 总览（所有时效字段一张表）

| 资源 | 字段名 | 单位 | MVP 取值 | 服务端配置位 | 客户端感知 |
|---|---|---|---|---|---|
| `access_token` | `access_token_ttl_sec` | 秒 | **7200**（2h） | `TTL_ACCESS_TOKEN_SEC` | 响应字段 `access_token_ttl_sec` + `expires_in` |
| `refresh_token` | `refresh_token_ttl_sec` | 秒 | **2592000**（30d） | `TTL_REFRESH_TOKEN_SEC` | 响应字段 `refresh_token_ttl_sec` |
| 微信 `wx_session_key` | — | — | ~3 天（微信侧） | 不可配 | 不感知（服务端托管） |
| 微信 `code`（wx.login） | — | — | **5 分钟**（微信侧） | 不可配 | `WX_CODE_INVALID` 触发重新 login |
| 家庭邀请口令 | `ttl_hours` | 小时 | **24**（用户可选 1~168） | `TTL_INVITE_DEFAULT_HOURS` / `TTL_INVITE_MAX_HOURS` | 请求体入参 + 响应 `expires_at` |
| `Idempotency-Key` 去重窗口 | — | 小时 | **24** | `TTL_IDEMPOTENCY_HOURS` | 无（服务端维护） |
| 订阅消息一次性凭证 | — | — | 微信侧一次性（发送后失效） | 不可配 | 无 |
| 审计日志热数据 | — | 天 | **180** | `TTL_AUDIT_HOT_DAYS` | 无 |
| 审计日志冷数据归档 | — | — | 永久（对象存储） | — | 无 |
| 游标 `next_cursor` | — | — | 事实上稳定；建议 **72h** | `TTL_CURSOR_HOURS` | 过期后请求返回 `INVALID_ARGUMENT` + `details.field='cursor'` |
| 限流桶（令牌桶窗口） | — | 秒 | **60** | `TTL_RATE_WINDOW_SEC` | `Retry-After` 响应头 |
| 客户端同步水位 `watermark` | — | — | 服务端 `updated_at` 时间戳 | 不可配 | 永不过期 |

---

## 2. OpenAPI 注入（本次 COSTRA-100 必改）

### 2.1 `AuthTokenPair` schema 补齐

**变更前**（现状）：
```yaml
AuthTokenPair:
  type: object
  required: [access_token, refresh_token, expires_in, user]
  properties:
    access_token: { type: string }
    refresh_token: { type: string }
    expires_in:
      type: integer
      description: access_token 有效秒数
      example: 7200
    user: { $ref: '#/components/schemas/User' }
```

**变更后**（本轮落地）：
```yaml
AuthTokenPair:
  type: object
  required: [access_token, refresh_token, access_token_ttl_sec, refresh_token_ttl_sec, user]
  properties:
    access_token: { type: string }
    refresh_token: { type: string }
    access_token_ttl_sec:
      type: integer
      description: access_token 自签发起的有效秒数
      example: 7200
    refresh_token_ttl_sec:
      type: integer
      description: refresh_token 自签发起的有效秒数
      example: 2592000
    expires_in:
      type: integer
      deprecated: true
      description: '【已废弃】等价于 access_token_ttl_sec，保留至 v0.2'
      example: 7200
    user: { $ref: '#/components/schemas/User' }
```

**兼容性**：`expires_in` 作为 deprecated 字段保留一个小版本，v0.2 移除。

### 2.2 `FamilyInvite` 已有 `expires_at`（无需改）
### 2.3 新增 `ErrorCode` 枚举（见 error-codes.md 章节 §2）——OpenAPI 同步注入

---

## 3. 客户端 TTL 行为契约

### 3.1 access_token 续期

```
伪代码（MiniApp request.ts 拦截器）：

request(url, opts) {
  if (now + 300s >= accessTokenExpireAt) {
    await refreshAccessTokenSilently();     // 过期前 5min 静默刷新
  }
  resp = await wx.request(...);
  if (resp.code === 'TOKEN_EXPIRED') {
    await refreshAccessTokenSilently();     // 兜底：真过期了再刷
    resp = await wx.request(...);           // 重放一次（复用原 Idempotency-Key）
  }
  return resp;
}
```

- 续期规则：**过期前 5 分钟**主动续期（900s 容错带）
- 收到 `TOKEN_EXPIRED` → 刷新一次重试；仍失败 → 清凭证跳登录
- 收到 `REFRESH_TOKEN_INVALID` → 直接清凭证跳登录

### 3.2 邀请口令

- 创建时：`ttl_hours` 可选 1~168，默认 24
- 展示：以 `expires_at` UTC → 本地时间展示剩余
- 过期：接受端收到 `410 INVITE_EXPIRED`，UI 按 `error-codes.md §4` 映射

### 3.3 游标（next_cursor）

- 客户端视为不透明串
- 过期：`400 INVALID_ARGUMENT` + `details.field='cursor'` → 客户端清游标、回到首页重拉

---

## 4. 服务端实装要求（v0.2 Sprint-2 落地细节）

### 4.1 集中配置

```ts
// server/src/config/ttl.ts（占位，v0.2 真实落地）
export const TTL = {
  accessTokenSec:        Number(process.env.TTL_ACCESS_TOKEN_SEC  ?? 7200),
  refreshTokenSec:       Number(process.env.TTL_REFRESH_TOKEN_SEC ?? 2592000),
  inviteDefaultHours:    Number(process.env.TTL_INVITE_DEFAULT_HOURS ?? 24),
  inviteMaxHours:        Number(process.env.TTL_INVITE_MAX_HOURS     ?? 168),
  idempotencyHours:      Number(process.env.TTL_IDEMPOTENCY_HOURS    ?? 24),
  auditHotDays:          Number(process.env.TTL_AUDIT_HOT_DAYS       ?? 180),
  cursorHours:           Number(process.env.TTL_CURSOR_HOURS         ?? 72),
  rateWindowSec:         Number(process.env.TTL_RATE_WINDOW_SEC      ?? 60),
} as const;
```

### 4.2 JWT 签发

- `access_token` payload：`{ sub, iat, exp = iat + TTL.accessTokenSec, token_type: 'access' }`
- `refresh_token` payload：`{ sub, iat, exp = iat + TTL.refreshTokenSec, jti, token_type: 'refresh' }`
- `jti` 入 Redis `refresh:{jti}`；登出时删；校验时查
- 响应统一带 `access_token_ttl_sec` / `refresh_token_ttl_sec`

### 4.3 时钟偏移容错

- 允许客户端时钟偏差 ±60s（校验 `exp` / `nbf` 时放宽）
- 所有 `expires_at` 字段服务端赋值（UTC），客户端不得本地计算

---

## 5. 配置覆盖方式

| 环境 | 覆盖方式 |
|---|---|
| 本地开发 | `server/.env`（已在 `.env.example` 列出所有 `TTL_*` 键） |
| 预发布 | 腾讯云 CVM `/etc/costra/ttl.env` |
| 生产 | 腾讯云密钥管理（KMS）+ docker secrets（D-007 §部署） |

**只读约束**：`TTL_*` 启动时加载一次，运行时变更需重启进程。

---

## 6. QA 断言

| 用例 ID | 断言 |
|---|---|
| `smoke_ttl_01` | 登录响应体含 `access_token_ttl_sec=7200` 且 `refresh_token_ttl_sec=2592000` |
| `smoke_ttl_02` | 把 access_token 手工改签一个 exp=now-1 的 → 调任意端点返回 `401 TOKEN_EXPIRED` |
| `smoke_ttl_03` | 创建邀请 `ttl_hours=1` → 等 65min 后 accept → `410 INVITE_EXPIRED` |
| `smoke_ttl_04` | 同 Idempotency-Key 25h 后重发 → 视为新请求（不返回缓存） |

---

## 7. 调优空间（非 MVP）

- **滑动刷新**：refresh_token 每次 refresh 同时换发新的（当前方案为固定 30d，不换发）
- **多端 session 管理**：`/auth/sessions` 列出 / 吊销（未立项）
- **短 TTL + 黑名单**：把 access 降到 15min + 服务端黑名单 —— 安全收益高但实现成本高，Sprint-2+ 评估

---

## 8. 版本演进

| 动作 | 破坏性 | 要求 |
|---|---|---|
| 调整 MVP 取值（如 access 改 1h） | ❌ | `.env` 改 + 周知前端 |
| 新增 TTL 字段 | ❌ | 本表更新 + OpenAPI 增字段 |
| 缩短 refresh_token TTL | ⚠️ | 需提前一个周期周知客户端，避免大面积掉线 |
| 废弃 `expires_in` | ✅ 已标记 deprecated | v0.2 随小版本号移除 |
