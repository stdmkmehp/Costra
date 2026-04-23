# 任务派单 · COSTRA-101 微信登录服务端实装（后端运行时首次真实立起）

> **派单时刻**：2026-04-23 22:45（Orchestrator · Human 指令 `run backend COSTRA-101` · 22:43 触发）
> **Owner**：Backend-Agent
> **估点**：5（Sprint-1 主线最重卡）
> **依赖**：COSTRA-100（ErrorCode / TTL / id-strategy 契约 · 已 Human approve 22:38）
> **解阻塞目标**：COSTRA-102（MiniApp 登录端到端 · 依赖 `/auth/wx-login` 返回结构稳定）

---

## 0. 本卡的三重含义

这不是一张"加三个 endpoint"的普通卡。从工作区事实看，Backend 侧迄今只落了 3 份 TS 文件（`ErrorCode.ts` / `subject.ts` / migrations）；**没有装任何 npm 依赖、没有 HTTP 框架、没有 JWT 库、没有单测框架、没有启动入口**。本卡同时肩负：

1. **首次真实立起后端运行时**（pkg 装好、启动脚本、typecheck/lint/test 真实替换 echo placeholder）
2. **HTTP 框架定案**（ADR-0006 §2.1 明确"待 COSTRA-101 落定"）
3. **微信登录 + Token 管理三端点实装**（Sprint-1 主线业务）

因此验收要在"可启动 + 契约对齐 + 3 端点工作 + 单测绿"四个维度同时过。

---

## 1. DoD 拆分（与 sprint-01-plan.md §COSTRA-101 对齐并精化）

### D1 HTTP 框架定案：Fastify 5.x

**决策**：采纳 **Fastify 5.x**。

**理由**：

| 维度 | Fastify 5 | Hono 4 | Express 5 |
|---|---|---|---|
| TypeScript 原生支持 | 原生 + JSON Schema 强类型 | 类型系统最强，但后端生态偏薄 | 类型后补，async 错误传播有坑 |
| OpenAPI 契约对齐 | `@fastify/swagger` + `fastify-type-provider-json-schema` 一键校验 | 需自建 | 需自建 |
| 生态成熟度 | `@fastify/jwt` / `@fastify/cors` / `@fastify/sensible` 一把梭 | 相对新 | 最成熟但散 |
| 性能（RPS） | ~76k | ~105k（偏边缘） | ~28k |
| 错误统一 | `setErrorHandler` 单点拦截，契合本项目"Error 统一响应体"约束 | 单点拦截 | 中间件链管理成本高 |
| 启动开销（冷启动） | ~50ms | ~30ms | ~80ms |

**决策记录**：
- 修订 `ADR-0002` §决策表 `后端框架` 行：`REST 优先（HTTP 框架由 COSTRA-101 定案）` → `Fastify 5.x（见 ADR-0006 §2.1 本卡落定）`
- 在 `ADR-0006 §9 修订历史` 追加一行："v1.1 · 2026-04-23 · COSTRA-101 落定 HTTP 框架为 Fastify 5.x"

### D2 Server Bootstrap（零 → 可启动）

- [ ] `server/package.json` 补齐真实依赖（fastify 5.x · @fastify/jwt · @fastify/cors · @fastify/sensible · pg · ioredis · uuidv7 · zod 或 ajv · vitest · tsx · @types/node · typescript · pino · pino-pretty）
- [ ] `server/tsconfig.json` 新建（与根 tsconfig 隔离 · 仅 include `server/src/**/*.ts` · outDir `server/dist` · strict:true · target ES2022 · module CommonJS）
- [ ] `server/.env.example` 扩展：`DATABASE_URL` / `REDIS_URL` / `JWT_SECRET` / `WX_APP_ID` / `WX_APP_SECRET` / `TTL_ACCESS_TOKEN_SEC=7200` / `TTL_REFRESH_TOKEN_SEC=2592000` / `TTL_IDEMPOTENCY_HOURS=24`（复用 ttl-policy.md §4.1）
- [ ] `server/src/app.ts` Fastify 实例工厂（Logger pino · CORS · JWT · errorHandler · healthcheck `/healthz`）
- [ ] `server/src/server.ts` 启动入口（端口 `PORT=8080` · listen host `0.0.0.0`）
- [ ] `server/package.json scripts`：`dev`（tsx watch server/src/server.ts）· `build`（tsc -p server/tsconfig.json）· `start`（node server/dist/server.js）· `typecheck`（tsc --noEmit）· `test`（vitest run）· `test:watch`（vitest）

### D3 DB Migration 新增（users 已存在 · 补 user_sessions 表）

- [ ] 新建 `server/db/migrations/0003_user_sessions.sql`：

```sql
CREATE TABLE user_sessions (
    jti             UUID PRIMARY KEY,         -- refresh_token jti 索引键
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,      -- issued_at + refresh_token_ttl_sec
    revoked_at      TIMESTAMPTZ,               -- 登出或被踢时写
    client_fp       TEXT,                       -- 可选：UA / 小程序版本 / 设备 fp
    last_refresh_at TIMESTAMPTZ
);
CREATE INDEX idx_user_sessions_user_active
    ON user_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_user_sessions_expires
    ON user_sessions (expires_at) WHERE revoked_at IS NULL;
```

设计点：
- **双写策略**：DB（持久登出证据 + 审计）+ Redis（热路径校验）。DB 是事实源，Redis 是加速；冷启动 Redis 丢数据不影响安全（回退 DB 查）
- `jti` 作主键：refresh_token payload 含 `jti`，校验路径直接 `SELECT ... WHERE jti = $1 AND revoked_at IS NULL AND expires_at > now()`
- 登出 = `UPDATE user_sessions SET revoked_at = now() WHERE jti = $1` + Redis `DEL refresh:{jti}`
- 刷新 = 查有效 → 签新 access_token（refresh_token 沿用旧的，不换发 · ttl-policy §7 "非 MVP"）
- 表不加 `updated_at`（唯一可变字段是 `revoked_at` / `last_refresh_at`，语义不同不合并）；因此迁移不往 `touch_updated_at` trigger 列表加表

### D4 三端点实装

#### `/auth/wx-login` POST

**契约**：`server/api/openapi.yaml` line 61-92 已定（请求 `{code, encrypted_data?, iv?}` · 响应 `AuthTokenPair`）

**流程**：
1. 校验 body（Fastify schema + ajv），`code` 必填
2. 调 `code2Session(code)`：`GET https://api.weixin.qq.com/sns/jscode2session?appid=...&secret=...&js_code=...&grant_type=authorization_code`
   - 网络 fail → `503 UNAVAILABLE`（ErrorCode）
   - 响应含 `errcode != 0`（微信侧错误码 40029/40163/45011 等）→ `401 WX_CODE_INVALID` + 原始 errcode 放 `details.wx_errcode`
3. 拿到 `{ openid, unionid?, session_key }`
4. `INSERT ... ON CONFLICT (wx_openid) DO UPDATE SET updated_at = now() RETURNING *` → upsert users
5. 签 access_token（jwt.sign(`{sub: user.id, token_type: 'access'}`, secret, `{expiresIn: TTL.accessTokenSec}`)）
6. 生成 `jti = uuidv7()`，签 refresh_token（payload 含 `sub`, `jti`, `token_type: 'refresh'`）
7. `INSERT INTO user_sessions (jti, user_id, expires_at)`；`SETEX refresh:{jti} <TTL.refreshTokenSec> <user_id>`
8. Redis 缓存 wx_session_key（3d TTL · key `wx_session:{openid}` · 供后续 `getPhoneNumber` 等解密用，MVP 不解密但存好）
9. 返回 `AuthTokenPair`

**注意**：
- 响应体 required 字段：`access_token` / `refresh_token` / `access_token_ttl_sec` / `refresh_token_ttl_sec` / `user`（openapi line 822 · 以此为准）
- `expires_in` 字段 deprecated 但**必须**保留兼容（line 834）· 等于 `access_token_ttl_sec`
- 不需要 `Idempotency-Key`（id-strategy §3.4 · wx code 一次性）

#### `/auth/refresh` POST

1. 从 body 取 `refresh_token`
2. `jwt.verify` → 拿 `{sub, jti, token_type}`
   - verify 失败 → `401 REFRESH_TOKEN_INVALID`
   - `token_type !== 'refresh'` → `401 REFRESH_TOKEN_INVALID`
3. Redis `GET refresh:{jti}` miss → fallback `SELECT ... FROM user_sessions WHERE jti = $1 AND revoked_at IS NULL AND expires_at > now()`
   - 找不到 → `401 REFRESH_TOKEN_INVALID`
4. 签新 access_token（refresh_token **不**换发，沿用旧的）
5. `UPDATE user_sessions SET last_refresh_at = now() WHERE jti = $1`
6. 返回 `AuthTokenPair`（access_token 新 · refresh_token 原值）

#### `/auth/logout` POST

1. 从 Authorization 头取 access_token，`jwt.verify` 拿到 `sub`
2. body 可选 `refresh_token`；若有 → `jwt.verify` 拿 `jti`（允许 expired，因为要登出已过期 session 也合理）→ `UPDATE user_sessions SET revoked_at = now() WHERE jti = $1 AND user_id = $sub` + `DEL refresh:{jti}`
3. 未携带 refresh_token（OpenAPI 签名允许 · line 116-122 仅需 access）→ 吊销该 user 所有未吊销 session：`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $sub AND revoked_at IS NULL`（MVP 保守策略：logout 即"登出所有端"；若后续支持多端精细控制再拆 `/auth/sessions/:jti`）
4. 返回 `204 No Content`
5. 若 access_token verify 失败 → `401 UNAUTHENTICATED`

### D5 单测（vitest + 至少 7 条 · DoD 说 3 主 + 4 错共 7）

主路径（3 条）：
- T1 `/auth/wx-login` 全新用户：mock `code2Session` 返回 openid → 期望 users 表有 1 条 + user_sessions 有 1 条 + 返回体 required 字段齐 + ttl 字段 = env 配置值
- T2 `/auth/wx-login` 老用户重登：预置 users 里已有 openid → 期望 users 不新增行 + user_sessions 新增 1 条
- T3 `/auth/refresh` 正常刷新：先 login 再 refresh → 新 access_token 可用且 != 旧 · refresh_token == 旧值 · last_refresh_at 被写

错误路径（4 条）：
- T4 `/auth/wx-login` 微信 `errcode=40029`（code 失效）→ 返回 `{code: "WX_CODE_INVALID", details: {wx_errcode: 40029}}` HTTP 401
- T5 `/auth/refresh` 带过期 refresh_token → `{code: "REFRESH_TOKEN_INVALID"}` HTTP 401
- T6 `/auth/refresh` 带已 revoke 的 refresh_token（先 logout 再 refresh）→ 同上 REFRESH_TOKEN_INVALID
- T7 `/auth/logout` + 过期 access_token → `{code: "UNAUTHENTICATED"}` HTTP 401（注意：is NOT TOKEN_EXPIRED；UNAUTHENTICATED 是纯无效）

**Mock 策略**：
- `code2Session` 用依赖注入 `wxAuth.code2Session()`，测试时注入 stub（不走真网络）
- PG 用 `pg-mem`（in-memory PG）或 testcontainers-postgres（docker pull 较重）；**优先 pg-mem**，启动快、无外部依赖；若 pg-mem 不支持 `UUID` 类型或 `gen_random_uuid()` 行为不一致，降级 testcontainers
- Redis 用 `ioredis-mock`

### D6 错误统一响应

- `server/src/errors/appError.ts`：`class AppError extends Error { code: ErrorCode; details?: object }`
- `app.setErrorHandler` 拦截：
  - `AppError` → 序列化 `{code, message, trace_id, details?}` + 查 `ErrorHttpStatus[code]` 设置 HTTP status
  - Fastify 内置 validation error → 转 `INVALID_ARGUMENT` + `details: {field, constraint}`
  - JWT verify throw → 转 `UNAUTHENTICATED` / `TOKEN_EXPIRED` / `REFRESH_TOKEN_INVALID`（按 err.code 区分）
  - 未分类 error → `INTERNAL`（打日志含 stack）
- 契约源：`server/src/errors/ErrorCode.ts`（已就位，COSTRA-100 产物）

### D7 OpenAPI 同步（如有 schema 微调）

本卡预计**不**触发 openapi.yaml 破坏性变更（所有接口已由 COSTRA-020/100 定好）。若实装中发现字段缺失必须补（例如 `wx_errcode` 放入 `details` 结构），走"非破坏性增字段"路径，同步 api/openapi.yaml 镜像（已是 $ref 关系 · 自动同步）。

### D8 健康检查 + 启动自检

- `GET /healthz` → `{status: "ok", db: "ok", redis: "ok", build: <git_sha>}`（db/redis 用 5s 超时 ping）
- 启动期：加载 ErrorCode coverage assertion（已在 ErrorCode.ts line 160 实装）+ 加载 subject.ts（已有 loadSubjectConfig · 会 throw 如缺 env）
- 启动日志打出 `[costra-server] listening on :8080` + 当前 TTL 配置值（便于排障）

---

## 2. 验收断言（Review-Tech 可核验 anchor）

| # | 断言 | 核验方法 |
|---|---|---|
| A1 | `server/package.json` 安装了 fastify 5.x（非 4.x 非 3.x） | `cat server/package.json \| jq '.dependencies.fastify'` → `^5.x` |
| A2 | `server/tsconfig.json` strict=true 且 target=ES2022 | grep |
| A3 | `server/src/app.ts` + `server/src/server.ts` 存在且能 `tsc --noEmit` 过 | `cd server && npx tsc --noEmit` |
| A4 | `server/db/migrations/0003_user_sessions.sql` 存在且包含 `jti UUID PRIMARY KEY` | grep |
| A5 | `/auth/wx-login` 返回体含 `access_token_ttl_sec` / `refresh_token_ttl_sec` / `expires_in`（三字段同时在） | 单测 T1 断言 + grep 响应 serializer |
| A6 | `/auth/logout` 登出后对同 refresh_token 调 `/auth/refresh` 返回 `REFRESH_TOKEN_INVALID` | 单测 T6 |
| A7 | ErrorCode 枚举 100% 有 `ErrorHttpStatus` 映射 | 启动期 coverage assertion（已有） |
| A8 | `ADR-0002` 后端框架行已修订为 Fastify | grep `ADR-0002-tech-stack.md` 是否含 "Fastify 5" |
| A9 | `ADR-0006 §9` 修订历史追加 v1.1（框架定案） | grep |
| A10 | `.env.example` 新增 `JWT_SECRET` + `TTL_ACCESS_TOKEN_SEC` + `TTL_REFRESH_TOKEN_SEC` + `WX_APP_ID/SECRET` | grep |
| A11 | `npm test`（server 目录）7 条单测全绿 | `cd server && npm test` |
| A12 | `/healthz` 返回 `{status:"ok", ...}` | 本地 docker-compose up + curl |
| A13 | 未引入 gRPC / protobuf 依赖（ADR-0006 §2.1 约束） | `grep -r "@grpc\|protobufjs" server/package.json` 为空 |
| A14 | subject.ts 在启动期被 require（通过 `app.ts` 导入），缺 env 时启动 throw | 预期行为断言（cfg 引用路径可追） |

---

## 3. 风险 / 边界

| 风险 | 影响 | 缓解 |
|---|---|---|
| 微信 `code2Session` 无真实 AppID/Secret 联调 | 本地启动后 `/auth/wx-login` 真调会 401 | 测试全走 mock；真实联调等 COSTRA-102（MiniApp 有真实 `wx.login`）· 同时可以用 wx 官方示例 AppID 跑通烟囱 |
| pg-mem 不支持 `gen_random_uuid()` 或 `CITEXT` 扩展 | 单测失败 | 降级 testcontainers-postgres（需 docker daemon），或把测试 migration 改为应用层 `uuidv7()` 注入 id |
| JWT 选 lib（`jsonwebtoken` vs `jose` vs `@fastify/jwt` 底层）导致 verify 行为差异 | 错误映射难对齐 | 采用 `@fastify/jwt`（底层 `fast-jwt`），捕获 `TokenExpiredError` → `TOKEN_EXPIRED`，`TokenError` → `REFRESH_TOKEN_INVALID`，`UnauthorizedError` → `UNAUTHENTICATED` |
| D-014-b 产出 Review 首轮自动拉起 | 交付即触发 Review-Tech Round 1，若产出残留 typecheck error 会被扣 P0 | 交付前本地跑通 `npx tsc --noEmit` + `npm test` + `/healthz` curl，确保三个绿灯再交 |
| HTTP 框架定案波及 ADR-0002 | ADR 改动属决策变更 | 按 D-014 §2.1（DevOps/QA/决策类豁免卡定义 Review）· 本卡 Owner 是 Backend，但决策章节走 ADR 修订流程，不受卡定义 Review 约束；**但产出 Review 会审 ADR 修订质量** |

---

## 4. 交付清单（本卡产出预期）

| 路径 | 类型 | 说明 |
|---|---|---|
| `server/package.json` | 修改 | 加入真实依赖 + scripts |
| `server/package-lock.json` | 新增 | npm install 副产物 |
| `server/tsconfig.json` | 新增 | 独立 server 编译配置 |
| `server/.env.example` | 新增 / 扩展 | 启动所需全部 env 样本 |
| `server/src/app.ts` | 新增 | Fastify 实例工厂 |
| `server/src/server.ts` | 新增 | 启动入口 |
| `server/src/config/env.ts` | 新增 | env 加载 + 校验 |
| `server/src/config/ttl.ts` | 新增 | ttl-policy §4.1 的占位终于落地 |
| `server/src/db/pool.ts` | 新增 | pg Pool 单例 |
| `server/src/db/redis.ts` | 新增 | ioredis 单例 |
| `server/src/errors/AppError.ts` | 新增 | 业务异常基类 |
| `server/src/plugins/errorHandler.ts` | 新增 | 统一错误响应 |
| `server/src/plugins/jwt.ts` | 新增 | @fastify/jwt 封装 |
| `server/src/wx/code2Session.ts` | 新增 | 微信登录上游 |
| `server/src/routes/auth.ts` | 新增 | 3 端点 handler |
| `server/src/services/authService.ts` | 新增 | 业务编排 |
| `server/src/repositories/userRepo.ts` | 新增 | users 表 DAO |
| `server/src/repositories/sessionRepo.ts` | 新增 | user_sessions 表 DAO |
| `server/src/id/idGen.ts` | 新增 | uuidv7 生成器（id-strategy §1.5 落地） |
| `server/db/migrations/0003_user_sessions.sql` | 新增 | D3 新表 |
| `server/test/auth.test.ts` | 新增 | 7 条单测 |
| `server/test/setup.ts` | 新增 | 测试启动钩子（mock wx + pg-mem + ioredis-mock） |
| `server/vitest.config.ts` | 新增 | vitest 配置 |
| `.team/decisions/ADR-0002-tech-stack.md` | 修订 | 后端框架行 + 修订历史 |
| `.team/decisions/ADR-0006-backend-runtime-and-primary-store.md` | 修订 | §2.1 + §9 v1.1 |

---

## 5. 后续联动（本卡不在范围内但要周知）

- **COSTRA-102 解阻塞**：本卡绿灯后 MiniApp 侧可开工 `utils/request.ts` + `pages/login` 接入真实 `/auth/wx-login`
- **COSTRA-104 部分解阻塞**：`/entries` 相关接口需要 `middleware/auth.ts`（从 access_token 注入 `req.user`），本卡已把 `@fastify/jwt` 装好，middleware 的接入口由 104 卡完成
- **DevOps-COSTRA-114**：开发服务器 bootstrap 会在本卡基础上部署（需要 `server/Dockerfile` · 由 114 卡落，不在 101 范围）

---

## 6. 本轮交付范围与验证边界（本卡关键执行约束）

### 6.1 分段策略

本卡涉及大量代码 + 依赖安装 + 单测运行。**一轮对话内 Agent 真实运行 `npm install` 存在以下风险**：拉取依赖大（~200+ transitive deps · Fastify + pg + vitest + mocks）、lockfile 变更量大、网络不确定性、`package-lock.json` 首次生成会与后续 DevOps Dockerfile 基线联动。

因此本卡分为**两段交付**：

| 段 | 范围 | 触发 | Review-Tech 视角 |
|---|---|---|---|
| **§6.1.a 设计 + 骨架**（本轮） | dispatch 文档 + ADR 修订 + migration SQL + 全部源码（TS 文件实打实写完，import 引用假设依赖存在） + 单测源码骨架 + package.json 依赖清单 + vitest.config.ts | `run backend COSTRA-101`（本 Human 指令已触发） | 审：**设计 / 契约对齐 / 错误码映射 / schema 覆盖 / 安全边界 / ADR 修订质量**；A1-A10 / A13 / A14 本轮可断言；**A11 / A12 标 "待 §6.1.b 段验证"** |
| **§6.1.b 装依赖 + 绿灯**（下轮） | `npm install`（server 目录）+ `npx tsc --noEmit` + `npm test` + `docker compose up -d` + `curl /healthz` | 待 Human 发 `verify backend COSTRA-101` | 补验 A11 / A12；若失败走 D-011 Revise |

**设计一致性保证**：§6.1.a 段的代码必须满足"**import 语句不臆造 API · 只用真实 library 的 public API**"——Agent 写代码时按 fastify 5.x / @fastify/jwt / ioredis / pg 的文档 API 写，不杜撰函数名。Review-Tech 审此段时按"若依赖能正常安装，代码是否合理"判断。

### 6.2 流程归属

- **卡定义 Review**：**豁免**。COSTRA-101 定义于 2026-04-22 16:50（Sprint-1 计划起草时），**早于** D-014 立案时间 2026-04-23 22:26 → D-014 §2.1 历史卡豁免
- **产出 Review**：**走 D-014-b**（2026-04-23 22:26 后交付）→ 交付后 60 秒内 Orchestrator 自动拉起 Review-Tech Round 1，**审 §6.1.a 范围**
- **档位**：**D-013 T1 准入 Review**（Sprint-1 主线后端根基 · 解阻塞 102/104）→ AI-Review §6.1.a 通过 + §6.1.b 绿灯后，Human 终审 approve
- **D-012**：单卡交付即提交（§6.1.a 段一次 commit；§6.1.b 段一次 commit）
- **D-011**：若 §6.1.a Review-Tech Round-1 判 REVISE，环内自动拉起 Backend-Fix（无需 Human 触发）

---

_派单人：Orchestrator（Backend-Agent 角色）· 2026-04-23 22:45_
