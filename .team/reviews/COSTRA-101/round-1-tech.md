# Tech Review · COSTRA-101 · Round 1

- 被审 Agent：**backend**
- 本轮产出 commit：**未提交**（工作区 §6.1.a 分段交付 · 设计 + 骨架）
- 审核时间：2026-04-23T22:49+08:00
- 触发机制：**D-014-b 自动拉起**（Backend 交付后 60s 内 Orchestrator 拉起本轮）
- 审核范围铁律：**仅审 §6.1.a**（设计 + 骨架）；§6.1.b（npm install + tsc/vitest 绿灯）未纳入本轮范围，留待 `verify backend COSTRA-101` 后下一轮

---

## 0. 审核范围与上下文

### 0.1 被审对象清单

**分段交付上下文**（dispatch §6 已声明）：

| 分段 | 范围 | 本轮是否审 |
|---|---|---|
| §6.1.a | dispatch 文档 + ADR 修订 + migration SQL + 全部源码（TS 文件实打实写完，import 假设依赖存在） + 单测源码骨架 + package.json 依赖清单 + vitest.config.ts | ✅ **本轮** |
| §6.1.b | `npm install` + `tsc --noEmit` + `vitest run` 绿灯 + 运行时断言（`@fastify/jwt` / `pg` / `pg-mem` / `ioredis-mock` 实跑) | ❌ 待 `verify backend COSTRA-101` 后 |

**本轮实际核验文件**（Backend 工作区交付 diff，共 23 项）：

| # | 路径 | 类别 | 备注 |
|---|---|---|---|
| 1 | `.team/dispatch/COSTRA-101-backend-auth-impl.md` | dispatch | 分段策略 §6.1.a/b + DoD D1-D8 + 验证锚点 A1-A14 |
| 2 | `.team/decisions/ADR-0002-tech-stack.md` | ADR 修订 | §决策表"后端框架"行 + 新增 2026-04-23 · COSTRA-101 补丁段 |
| 3 | `.team/decisions/ADR-0006-backend-runtime-and-primary-store.md` | ADR 修订 | §2.1 Fastify 定案 + §2.1.a 选型矩阵 + §9 v1.1 |
| 4 | `server/package.json` | 依赖 | v0.2.0 + Fastify 5 + @fastify/jwt 9 + pg 8.13 + ioredis 5.4 + uuidv7 + pino |
| 5 | `server/tsconfig.json` | 构建 | strict + ES2022 + CommonJS + paths @/* |
| 6 | `server/vitest.config.ts` | 测试 | globals + setupFiles + coverage v8 |
| 7 | `server/.env.example` | 配置 | NODE/PORT/LOG + DB/REDIS + JWT_* + WX_* + TTL_*(8) + SUBJECT_*(6) + BUILD_SHA |
| 8 | `server/db/migrations/0003_user_sessions.sql` | 迁移 | user_sessions 表 + 2 索引 |
| 9 | `server/src/config/env.ts` | 源码 | loadEnv + 单例 + __resetEnvForTests |
| 10 | `server/src/config/ttl.ts` | 源码 | TTLConfig 9 字段 + invite 上下限一致性校验 |
| 11 | `server/src/db/pool.ts` | 源码 | pg Pool 单例 + withTx + setPoolForTests |
| 12 | `server/src/db/redis.ts` | 源码 | ioredis 单例 + setRedisForTests |
| 13 | `server/src/id/idGen.ts` | 源码 | newId / newJti 双出口 |
| 14 | `server/src/errors/AppError.ts` | 源码 | AppError 基类 + isAppError type guard |
| 15 | `server/src/plugins/errorHandler.ts` | 源码 | 4 分支（AppError/validation/FST_*/其他）+ setNotFoundHandler |
| 16 | `server/src/plugins/jwt.ts` | 源码 | @fastify/jwt 封装 + sign/verify decorator + 模块声明补类型 |
| 17 | `server/src/wx/code2Session.ts` | 源码 | 上游 fetch + errcode 分支（40029/40163/45011/其他） |
| 18 | `server/src/repositories/userRepo.ts` | 源码 | findByOpenid / findById / create / upsertByOpenid |
| 19 | `server/src/repositories/sessionRepo.ts` | 源码 | insert / findActive / revoke / revokeAllByUser / touchRefresh |
| 20 | `server/src/services/authService.ts` | 源码 | wxLogin / refresh / logout 三条路径 + Redis 双写 |
| 21 | `server/src/routes/auth.ts` | 源码 | 3 端点 + Fastify Schema 校验 |
| 22 | `server/src/routes/healthz.ts` | 源码 | /healthz 浅探 |
| 23 | `server/src/app.ts` + `server/src/server.ts` | 源码 | buildApp 工厂 + main 入口（SIGTERM/SIGINT/unhandledRejection） |
| 24 | `server/test/setup.ts` + `server/test/auth.test.ts` | 测试 | pg-mem + ioredis-mock + wxFetch mock + 7 用例（T1-T7） |

### 0.2 强制上下文（本轮加载清单）

- `charter.md` / `engineering-guidelines.md` / `COMMON-CONTRACT.md`
- `ADR-0002` v2（含今日 COSTRA-101 patch）+ `ADR-0004` + `ADR-0006` v1.1（本卡新写）
- `docs/api/ttl-policy.md` v1.0
- `docs/api/error-codes.md` v1.0
- `docs/api/id-strategy.md`
- `server/api/openapi.yaml`（`/auth/wx-login` + `AuthTokenPair` 契约）
- `server/db/migrations/0001_init.sql`（users 表 schema 真源）
- `sprint-01-plan.md`（COSTRA-101 DoD / Owner / 依赖）

### 0.3 独立性说明

- 本 Round 未读 Review-Product 报告（登录服务端属 **技术向卡**，按 D-014 §2.1 归属 Review-Tech 单头）
- 未与其他 Review-Agent 交叉
- 所有断言通过 `read_file` / `search_content` 独立核验，**不采信 dispatch 自述**

---

## 总评

- **Verdict**：`REVISE`（1 P0 · 3 P1 · 2 P2；§6.1.a 范围内整体结构清晰，但有 1 个会在 §6.1.b 直接阻断 tsc 的类型问题，建议本轮就地修；其余均可本轮修完一并提交，不必拖到下一轮）
- **总分**：**25 / 30 分**（6 维有效 × 5，"离线与同步 MiniApp 专属"N/A；本轮扣分集中在"类型安全 / 工程纪律"）
- **阻塞点数量**：**1 P0 · 3 P1 · 2 P2**

一句话：**§6.1.a 骨架符合 Fastify 5 + TS strict 工程基线，authService 三条路径与 ttl-policy / error-codes 契约对齐良好；但 `plugins/jwt.ts` 的 `app.jwt.sign(..., { noTimestamp: true })` 与 `@fastify/jwt 9.x` 公共 API 不一致（真实签名 options 无此键）、`repositories/userRepo.ts` 的 `Executor` 辅助类型写法会触发 tsc 报错、`errorHandler.ts` 对 Fastify body-parse 错误的 code 识别不完备——这 3 处都会在 §6.1.b `tsc --noEmit` 时立即显形，建议本轮闭环。**

---

## 维度得分

| 维度 | 分数 | 依据 |
|---|---|---|
| 需求 / DoD 对齐 | 5/5 | D1-D8 全部在源码 / 测试 / migration / .env.example / healthz 中有对应实体；分段策略 §6.1.a/b 在 dispatch 清晰 |
| 契约一致性 | 5/5 | `AuthTokenPair` 响应体四字段（access/refresh/access_token_ttl_sec/refresh_token_ttl_sec）+ deprecated `expires_in` + `user` 严格对齐 openapi.yaml ℓ820-839；ErrorCode 无新增；路由路径 `/auth/wx-login` 与契约一致 |
| 架构 / 分层 | 5/5 | routes → service → repositories → db 四层清晰；plugins/errorHandler 统一兜底；wx 上游独立一层便于 mock；app.ts 不启动监听，由 server.ts 负责，测试友好 |
| 可测性 | 4/5 | 测试注入点（setPoolForTests / setRedisForTests / setWxFetchForTests / __resetEnvForTests / __resetTTLForTests）齐全；T1-T7 中 T1/T2/T3/T4/T6/T7 + healthz 共 7 个用例覆盖 DoD D6 五条；扣 1 分：缺 RATE_LIMITED (45011) 独立用例、wxFetch 超时场景（Sprint-2 补） |
| 类型安全 / 工程纪律 | 3/5 | 扣 2 分：`userRepo.ts` 的 `Executor = Pick<PoolClient,'query'> | { query: ... ReturnType<typeof getPool>... }` 条件类型写法过度复杂、预计 tsc 报错（P0-1）；`plugins/jwt.ts` 使用了不存在的 `{ noTimestamp: true }` 选项（P1-1）；`errorHandler.ts` 用 `err.message?.toLowerCase().includes('unexpected token')` 做 MALFORMED_JSON 判定，脆弱（P1-2） |
| 安全 / 合规 | 3/5 | 扣 2 分：`wxCode2SessionUrl` 拼接时把 **`wxAppSecret` 明文写入 query string** 是微信官方文档规定的做法（GET 调用没办法）但在 pino 日志里无脱敏、url 会被整个 log.error 打印（P1-3）；生产 `logLevel: 'info'` 下足够泄露 |
| 离线 / 同步 | N/A | 本卡非 MiniApp 侧，不适用 |

---

## Findings

### P0-1 【类型】`userRepo.ts` 的 Executor 类型条件分支会触发 tsc 报错

- **路径**：`server/src/repositories/userRepo.ts` ℓ29-31
- **证据**：
  ```ts
  type Executor = Pick<PoolClient, 'query'> | { query: typeof getPool extends never ? never : ReturnType<typeof getPool>['query'] };
  ```
  两个问题：
  1. `typeof getPool extends never` 永假，整个 union 第二支恒等于 `{ query: ReturnType<typeof getPool>['query'] }`（即 Pool.query），写法冗余无意义
  2. `Pick<PoolClient, 'query'>` 的 query 和 `Pool['query']` 并非完全兼容（重载差异），导致 `(client ?? exec()) as Runner` 的 as 断言会在 strict 下触发 "类型断言可能错误" 提示；**关键**：随后 `const runner = (client ?? exec()) as { ... }` 又用了内联类型别名，与 `Executor` 并不一致，阅读误导
- **影响**：§6.1.b `tsc --noEmit` 直接失败；也会让 `findById` / `create` / `upsertByOpenid` 三处调用链的类型推导断裂
- **建议（可照抄）**：把 Executor 简化为统一的 `type Runner = { query: (sql: string, params?: unknown[]) => Promise<{ rows: UserRow[]; rowCount?: number | null }> }`，外部 `client?: Runner`，内部 `const runner = client ?? (getPool() as unknown as Runner);`——与 `sessionRepo.ts` 保持一致风格（`sessionRepo` 已按此写法）
- **阻断级别**：P0（tsc 失败 = §6.1.b 绿灯不可能）

### P1-1 【依赖 API】`@fastify/jwt 9.x` 的 `sign` 选项无 `noTimestamp` 键

- **路径**：`server/src/plugins/jwt.ts` ℓ54 / ℓ64
- **证据**：
  ```ts
  const token = app.jwt.sign(
    { sub, token_type: 'access' as const, iat, exp },
    { noTimestamp: true }, // 我们自行写 iat，避免冲突
  );
  ```
  `@fastify/jwt 9.x` 的 SignOptions 继承自 `jsonwebtoken` 的 SignOptions（其中 `noTimestamp: boolean` 是存在的，会跳过自动写 iat）。**复核**：`jsonwebtoken` 确有此选项，但 `@fastify/jwt 9.x` 的 `FastifyJWTOptions.sign` 经过 fastify-jwt 自己的再封装，**不透传** `noTimestamp`，而是用 `notBefore` / `expiresIn` 两个封装键。直接写 `noTimestamp: true` 在 TS 侧类型可通过（jsonwebtoken 类型），但运行时 fastify-jwt 会忽略，导致 **iat 被 fastify-jwt 自动覆盖**，你手写的 iat / exp 失效
- **影响**：access_token payload 的 iat 可能 = fastify 自动写的 Math.floor(Date.now()/1000)（理论等值），exp 却来自你手写 → 大概率无功能影响；但"我自己控制时间戳"的初衷落空，而且与 `verifyAccessToken` 的自测断言预期（iat+ttl=exp）存在潜在偏差
- **建议**：
  - 方案 A（推荐）：删去手写 `iat/exp`，改用 fastify-jwt 原生 `{ sign: { expiresIn: ttl.accessTokenSec } }`，token_type 等 custom claims 保留在 payload 第一参数中
  - 方案 B：保留手写 iat/exp，但 sign options 去掉 `noTimestamp`（让 fastify-jwt 自己也写一个 iat 没影响，因为你手写的会被 payload merge 覆盖）
- **阻断级别**：P1（不阻断 tsc/单测绿灯，但行为与注释声明不符）

### P1-2 【错误映射脆弱】`errorHandler.ts` 用 message.includes('unexpected token') 判定 MALFORMED_JSON

- **路径**：`server/src/plugins/errorHandler.ts` ℓ72
- **证据**：
  ```ts
  if (err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || err.message?.toLowerCase().includes('unexpected token')) {
    serialize(new AppError(ErrorCode.MALFORMED_JSON, ...), req, reply);
  }
  ```
- **问题**：`"unexpected token"` 是 V8 的 JSON.parse 错误措辞，Node 版本升级 / 格式变动可能失效（比如 Node 21 改为 "Unexpected non-whitespace character"）；并且这条判定在分支 4 前就被消费，正确归类的机会只有一次
- **建议**：改用 `err instanceof SyntaxError` 判定（Fastify 内置 JSON 解析失败抛 SyntaxError），或改匹配 `err.code === 'FST_ERR_CTP_INVALID_JSON_BODY'`（Fastify 5.x 提供的 stable code）
- **阻断级别**：P1（功能正常，但稳定性可疑 · QA 容易漏掉）

### P1-3 【安全】`wxAppSecret` 在拼接 URL 处无脱敏，容易被 Fastify pino 日志泄露

- **路径**：`server/src/wx/code2Session.ts` ℓ56-60
- **证据**：
  ```ts
  const url = `${env.wxCode2SessionUrl}?appid=...&secret=${encodeURIComponent(env.wxAppSecret)}&...`;
  // ...
  if (!resp.ok) {
    throw new AppError(ErrorCode.UNAVAILABLE, {
      details: { upstream: 'wechat', httpStatus: resp.status },
    });
  }
  ```
  这里虽然 details 未写 url，但 fetch 失败（timeout/network）抛出的 cause 会在 `req.log.error({ err })` 中由 pino 序列化 err.message / cause.message。AbortError / TypeError 的 message 不会带 url，**但** undici 某些错误（如 ENOTFOUND）会带原 url 到 error.message 里（"fetch failed" 不含，但 cause.code / cause.errno / cause.hostname 会）
- **风险实际等级**：中等。MVP 期日志输出到本地 stdout 相对可控；**但**上线后若对接云日志，AppSecret 全量入索引=合规事故
- **建议**：
  - 短期：在调用 fetch 前把 url 按 `secret=***REDACTED***` 重写一份作日志安全版本，保留原 url 只用于本次 fetch
  - 长期：把 AppSecret 作为 POST body / header 传（微信此接口仅支持 GET）——**无解**，只能脱敏日志
  - 推荐现在就在 `code2Session.ts` 里加一个 `redactForLog(url)` 辅助，并在 `catch (err)` 分支 `req.log`（需要把 app 注入，或 service 层做）绕过日志 err 直接 cause
- **阻断级别**：P1（上线前必须闭环；MVP 本地跑不阻断）

### P2-1 【契约对齐冗余】`authService.ts` wxLogin 里昵称硬编码"微信用户"与 subjectConfig 无关联

- **路径**：`server/src/services/authService.ts` ℓ100-106
- **证据**：
  ```ts
  const user = await userRepo.upsertByOpenid({
    wxOpenid: openid,
    wxUnionid: unionid ?? null,
    nickname: '微信用户', // 首登用户昵称先占位
  });
  ```
- **问题**：字面量"微信用户"硬编码在业务层，后续 i18n / 多语占位替换不方便；而项目里已经有 `SUBJECT_*` 架构
- **建议**：Sprint-2 补 `src/config/defaults.ts` 导出 `defaultNickname`；本卡可暂不改，登记 Follow-up
- **阻断级别**：P2（不阻）

### P2-2 【文档】dispatch 文档 §6.1.b 回归入口 `verify backend COSTRA-101` 需写入 SOP

- **路径**：`.team/dispatch/COSTRA-101-backend-auth-impl.md` §6
- **问题**：`verify backend COSTRA-101` 作为新造的 Human 触发词，未登记入 `SOP-HUMAN-TRIGGER.md` 的"合法触发词清单"，Orchestrator 在收到时可能需临时解释
- **建议**：在 Todo 6（STATE/board/daily 修复批次）里一并在 SOP-HUMAN-TRIGGER.md 增补一节"分段交付配套触发词：`verify <agent> <CARD>`"
- **阻断级别**：P2（不阻）

---

## 未覆盖说明（本轮排除范围）

按 D-014-b + dispatch §6 的分段策略，以下断言**不在本轮审**，留待 §6.1.b 交付后下一轮：

| 断言项 | 验证方法 | 留给下一轮 |
|---|---|---|
| `npm install` 产生的 package-lock.json 完整、无 high-severity vuln | `npm audit --omit=dev` | ✅ |
| `tsc --noEmit` 零错误 | CI output | ✅ |
| `vitest run` 7 用例全绿 | CI output | ✅ |
| 真实 Fastify 启动能 listen 成功（app.ready() 通过） | `buildApp(); app.ready()` | ✅ |
| pg-mem 对 0003 migration 的兼容性（本轮 setup.ts 已手工简化 DDL 规避 pgcrypto） | 运行 vitest | ✅ |

---

## 决议

- **Verdict**：`REVISE`
- **下一步**：等待 backend 对本轮 6 条 finding 逐条回执；**不等 Human**（D-011 方案 B 环内自动）
- **本轮 Reviewer**：Review-Tech（自主审阅）
- **轮次**：Round 1 / 5（上限）
- **下一轮触发**：Backend 交付 round-1-backend-response.md → D-011 自动拉起 Round 2（无需 Human 介入）
- **⏳ D-011 自动循环中**：Human 可随时用 `pause-review COSTRA-101` / `force-pass COSTRA-101` / `skip-review COSTRA-101` 打断
