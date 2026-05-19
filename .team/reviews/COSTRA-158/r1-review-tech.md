# Tech Review · COSTRA-158 · Round 1 · D-022 v2.0 第 6 次实战

> **审查档声明**：D-018 SBAI v1.1 审查 subagent · 物理只读 · 报告仅通过 final message 返回 Orchestrator 落盘 · 审查档第 10 次实战 · **D-022 v2.0 评分表第 6 次实战**（首次 = 103 38/40 · 第 2 次 = 104 36/40 · 第 3 次 = 105 40/40 · 第 4 次 = 156 40/40 · 第 5 次 = 157 38/40 · 本卡 = 158）。

---

## §1 元数据

| 字段 | 值 |
|---|---|
| 卡号 | COSTRA-158 |
| 标题 | /users/me 完整实装 + has_completed_profile 严格资料判定 |
| 估点 | 5 点 |
| Owner / 被审 Agent | `costra-backend-dev`（A~G' 8 项第 1 段）+ `costra-miniapp-dev`（H~K 3+2 项第 2 段 · 单卡双装扮档 Q4-A） |
| 审核人 | `costra-review-tech-COSTRA-158-r1`（一次性装扮 · 第 10 次审查档实战） |
| 审核时间 | 2026-05-19T11:05+08:00（独立复核耗时 ~30 分钟） |
| 轮次 | Round 1 / 5 |
| 上轮结论 | Card-Review R1 PASS 27/30（P1-1 + P1-2 + P2-1~3 + INFO-1~3 · 0 P0 · C8 红线 0 命中） |
| 本轮 Verdict | **APPROVE** 🏆 |
| 本轮总分 | **38 / 45**（D-022 v2.0 45 分制 · C9 N/A 不计分母） |
| R1 commit | `c7ea7f7` · 19 files · +664/-63 行 |

---

## §0 结论速览

- **Verdict**：`APPROVE`（≥ 36/45 · 80% 档）
- **总分**：**38/45**（D-022 v2.0 45 分制 · C9 N/A 不计 · 实际分母 45）
- **阻塞点**：**0 P0 / 1 P1 / 3 P2 / 2 INFO**
- **上轮 Card-Review P1 兑现率**：**2/2（100%）**
  - P1-1 client 消费策略 ✅ dispatch §2.4 显式声明 MVP 不调 GET /users/me · updateLocalUserProfile 实装 + 测试
  - P1-2 拆卡损益分析 ✅ dispatch §5.2 补完整损益分析 · 结论不拆
- **上轮 Card-Review P2 兑现率**：**3/3（100%）**
  - P2-1 DB migration 幂等 ✅ SQL 改用 `ADD COLUMN IF NOT EXISTS`（0005:10）
  - P2-2 K3 已知未知 ✅ dispatch §5.3 补"COSTRA-152 是否升级 K1"· Sprint-2 末 Retro 议题候选
  - P2-3 mockExchange 注释 ✅ auth.ts:242-244 双行注释标注覆盖缺口 + Human 实测路径

---

## §2 D-022 v2.0 十维度评分

| 维度 | 满分 | 得分 | 一句话 |
|---|---|---|---|
| C1 契约对齐 | 5 | 4 | OpenAPI User schema + required 追加 + PATCH path 实装齐全 ✅ · ErrorCode 枚举正确使用 ✅ · 扣 1 分：POST K3 兜底 405 响应的 `METHOD_NOT_ALLOWED` 不在 ErrorCode 枚举也不在 error-codes.md · 手工构造 JSON 绕过了统一错误处理链路 |
| C2 代码质量 | 5 | 5 | userRepo.updateProfile 三态语义 CASE 表达式正确 ✅ · avatar_url undefined→COALESCE / value→更新 / null→NULL ✅ · $4::BOOLEAN 类型转换正确 ✅ · handlePatch 抽取复用 ✅ · FastifyReply 类型用于 handlePatch 签名合理（因独立函数需显式类型 · entries.ts 内联不需） |
| C3 架构合理 | 5 | 5 | repo/service/route 三层职责清晰 ✅ · K3 兜底位置（users.ts POST handler 委托 handlePatch）最小作用域 ✅ · authService 不改 token 仅改 toUserView 入参/返回映射 ✅ · updateLocalUserProfile 仅更新 raw.user 子对象不改 token ✅ |
| C4 数据完整 | 5 | 5 | has_completed_profile = TRUE 单调性（SQL 直接 SET TRUE · 应用层保证不可降级）✅ · DB DEFAULT FALSE ✅ · IF NOT EXISTS 真幂等 ✅ · 不 backfill 决策记录在 migration COMMENT ✅ · pg-mem setup.ts 同步 ✅ · 软删用户禁更新（WHERE deleted_at IS NULL）✅ |
| C5 安全 | 5 | 5 | auth middleware jwtVerify 校验 ✅ · 不信任 client userId（从 JWT claims.sub 取）✅ · body schema additionalProperties:false ✅ · X-HTTP-Method-Override 仅 users 路由识别 ✅ · session_key/openid 无日志泄漏 ✅ · D-008 主体字样 0 命中 ✅ · AppID 未入打包源码 ✅ |
| C6 可测性 | 5 | 4 | users.test.ts 10 测含 K3 T9 正例 + T10 反例 ✅ · auth.test.ts has_completed_profile=false 断言 ✅ · home.spec.ts 5+2 测 ✅ · auth.spec.ts updateLocalUserProfile 2 测 ✅ · 扣 1 分：T1 GET 401 响应断言 body.code 但 PATCH 401（T3）仅断 statusCode 未断 body.code · 不对称断言 |
| C7 纪律 | 5 | 5 | INVEST small 5pt 守住 ✅ · D-016 同轮兑现 ✅ · D-018 双装扮档单 commit ✅ · commit footer 双 Co-Authored-By ✅ · commit subject 全小写 ✅ · body 行长 ≤ 100 ✅ · 0 文件 > 500 行 ✅ · 0 TODO/FIXME/console.log ✅ |
| C8 runtime 加载性 | 5 | 4 | DB migration IF NOT EXISTS 真幂等 ✅ · app.ts register 顺序 auth→entries→sync→legal→users 无 race ✅ · client TokenRaw 类型匹配 ✅ · K3 委托 runtime 行为正确 ✅ · 扣 1 分：K3 405 响应绕过 errorHandler 走 reply.code(405).send() · 无 trace_id · 响应结构与统一 Error schema 不一致 |
| C9 性能 | N/A | N/A | 不适用（无 hot path · users 调用频率低） |
| C10 SBAI 流程合规 | 5 | 5 | 双装扮档严守工作区铁律 ✅ · backend-dev history 5 段齐全 ✅ · miniapp-dev history 5 段齐全 ✅ · state.md §2 §3 §7 同步 ✅ · follow-ups README FU-COMMON-MINIAPP-PATCH-LIMIT + FU-102 boundary risk 关闭准确 ✅ |

**总分 = 4+5+5+5+5+4+5+4+0(N/A)+5 = 38 / 45**

**百分比 = 38/45 = 84.4% → ≥ 80% → APPROVE 档**

---

## §3 问题清单

### P0：0 项 ✅

### P1：1 项

#### P1-1 · K3 405 响应绕过统一错误处理链路 · 无 trace_id · 响应结构不一致

- **维度**：C1 契约对齐 + C8 runtime 加载性
- **证据**：`server/src/routes/users.ts:130-137` — POST handler 无 override 时直接 `reply.code(405).send({ error: { code: 'METHOD_NOT_ALLOWED', message: '...' } })` · 绕过了 `AppError` + `errorHandler` 中间件链路
- **问题**：
  1. `METHOD_NOT_ALLOWED` 不在 `ErrorCode` 枚举（`server/src/errors/ErrorCode.ts:14-53` 无此值）· 也不在 `docs/api/error-codes.md` · 属未登记错误码
  2. 响应结构 `{ error: { code, message } }` 与统一 Error schema `{ code, message, trace_id }` 不一致 · 缺 `trace_id`
  3. `errorHandler` 中间件会自动注入 `trace_id`（`server/src/plugins/errorHandler.ts`）· 但 `reply.code(405).send()` 绕过了此中间件
  4. client `error-mapper.ts` 不识别 `METHOD_NOT_ALLOWED` · 会走兜底文案 `"网络异常"` · 语义偏差（应为"请求方式不支持"）
- **依据**：D-022 C1 "错误码是否用 ErrorCode 枚举 · 禁止新造" + C8 "runtime 行为正确" + error-codes.md §0.6 "trace_id 必有"
- **修复建议**：
  - **方案 A（推荐 · 最小改动）**：将 405 路径改为 `throw new AppError(ErrorCode.PERMISSION_DENIED, { message: 'POST /users/me requires X-HTTP-Method-Override: PATCH' })` · 映射 HTTP 403 · 虽非精确语义但走统一链路 · client error-mapper 已覆盖 PERMISSION_DENIED
  - **方案 B（精确语义）**：在 ErrorCode 枚举新增 `METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED'` · 同步 error-codes.md + openapi.yaml + client error-mapper · 预估 0.5 点 · Sprint-3 补
  - **方案 C（折中）**：用现有 `ErrorCode.BUSINESS_RULE_VIOLATION` + details.rule='method_override_required' · 不造新码但语义可辨
  - 不阻断 · P1 留 Sprint-3 补 · 当前 client login/index.ts catch 吞掉此错误 · 实际不会触达用户

### P2：3 项

#### P2-1 · T3 PATCH 401 仅断言 statusCode · 未断言 body.code · 与 T1 GET 401 断言不对称

- **维度**：C6 可测性
- **证据**：`server/test/users.test.ts:95-103` T3 仅 `expect(res.statusCode).toBe(401)` · 无 body.code 断言 · 而 T1（:66-69）同时断言 `body.code === 'UNAUTHENTICATED'`
- **问题**：若 errorHandler 改为返回不同错误码（如 TOKEN_EXPIRED）· T3 不会失败 · 覆盖力弱于 T1
- **依据**：D-022 C6 "关键路径是否有单测覆盖"
- **修复建议**：T3 补 `const body = res.json() as { code: string }; expect(body.code).toBe('UNAUTHENTICATED');` · 1 行改动

#### P2-2 · K3 POST handler header 读取未考虑多值场景

- **维度**：C2 代码质量
- **证据**：`server/src/routes/users.ts:126-128` — `const override = req.headers['x-http-method-override']` · 检查 `typeof override === 'string'` · 但 HTTP header 可以是数组（虽极罕见）· 若为数组则 `override.toUpperCase()` 会 throw
- **问题**：Fastify 的 `req.headers[key]` 类型为 `string | string[] | undefined` · 当 client 或 proxy 重复发送 `X-HTTP-Method-Override` header 时类型为数组 · 当前代码 `typeof override === 'string'` 检查会跳过数组 · 不 crash 但也不识别 · 可能导致误返回 405
- **依据**：D-022 C2 "类型安全"
- **修复建议**：改为 `const override = req.headers['x-http-method-override']; const val = Array.isArray(override) ? override[0] : override; if (typeof val === 'string' && val.toUpperCase() === 'PATCH')` · 或更简洁：`if (String(override ?? '').toUpperCase() === 'PATCH')` · 2 行改动

#### P2-3 · updateLocalUserProfile 用 wx.setStorageSync 而非 async setItem · 与 COSTRA-125 迁移方向不一致

- **维度**：C3 架构合理
- **证据**：`miniprogram/services/auth.ts:267` — `wx.setStorageSync(TOKEN_KEY, { ... })` · 而全文件其他 storage 操作（initAuth/clearToken/doWxLogin/refreshToken）均走 `await setItem/removeItem/getItem`（COSTRA-125 async 迁移产物）
- **问题**：COSTRA-125 明确将所有 `wx.getStorageSync/setStorageSync` 迁移为 async `getItem/setItem` · updateLocalUserProfile 回退到同步 API 是倒退 · 虽然当前调用上下文（login flow try 块内）同步写入保证 home onShow gate 立即可读 · 但破坏了 COSTRA-125 建立的统一 async 约束
- **依据**：COSTRA-125 dispatch §3(b) "async 对齐" · miniapp-dev history 记录 "全链 async 对齐"
- **修复建议**：改为 `await setItem(TOKEN_KEY, { raw: current.raw, access_expires_at: current.access_expires_at, refresh_expires_at: current.refresh_expires_at })` · 与 clearToken 等方法一致 · 调用方 login/index.ts 已在 async onTapLogin 内 · 可以 await · 但需确认 storage API setItem 接受的参数类型与 TokenStored 一致 · 预估 0.5 点

### INFO：2 项

#### INFO-1 · OpenAPI PATCH /users/me body schema 未标注 avatar_url nullable · 与 server patchBodySchema 不完全对齐

- **维度**：C1 契约对齐
- **说明**：`server/api/openapi.yaml:149` avatar_url 定义为 `{ type: string, format: uri }` · 未标注 `nullable: true` · 而 `server/src/routes/users.ts:65` 的 `patchBodySchema` 标注了 `nullable: true` · 代码更正确（允许传 null 清空头像）· OpenAPI 遗漏 · 不影响运行（Fastify schema validation 以代码为准）· 但 OpenAPI 契约与代码不一致 · 建议 Sprint-3 补 `nullable: true` 到 OpenAPI

#### INFO-2 · dispatch §5.3 K3→K1 升级时机 Retro 议题已标注 · 但 follow-ups/README.md 未为此条单立 FU

- **维度**：C10 SBAI 流程合规
- **说明**：dispatch §5.3 写"留 follow-up（不立 FU · 在 Sprint-2 末 Retro 议题候选内已纳入）"· 但 COSTRA-152 实装时需要此决策 · 若 Retro 未讨论则 COSTRA-152 dispatch 需重新决策 · 当前处理方式合理（不阻本卡）· 但建议 Sprint-2 末 Retro 时显式议入 · 若决议 K1 则立 FU-COMMON-METHOD-OVERRIDE-GLOBAL

---

## §4 实装与 dispatch §2.1 11 项 + §2.4 对账表

| # | dispatch 项 | 产出文件 | 状态 | 偏差说明 |
|---|---|---|---|---|
| A | DB migration 0005 | `server/db/migrations/0005_users_has_completed_profile.sql` | ✅ | IF NOT EXISTS 已采纳 P2-1 |
| B | userRepo 字段映射 + updateProfile | `server/src/repositories/userRepo.ts` | ✅ | 三态语义 + 乐观锁 + 单调性 + 软删过滤 全符合 |
| C | authService.toUserView 加字段 | `server/src/services/authService.ts` | ✅ | AuthTokenPair.user + toUserView 入参/返回 双加 |
| D | routes/users.ts 新建 | `server/src/routes/users.ts` | ✅ | GET + PATCH + POST K3 兜底 · 139 行 ≤ 150 行上限 |
| E | app.ts 注册 users 路由 | `server/src/app.ts:30+77` | ✅ | import + register 2 行 |
| F | OpenAPI User schema 加字段 | `server/api/openapi.yaml:877+883-885` | ✅ | required 追加 + 字段定义 |
| G | users.test.ts ≥ 10 测 | `server/test/users.test.ts` | ✅ | 10 测（T1~T10）· 含 K3 正例 + 反例 |
| G' | auth.test.ts 修订 | `server/test/auth.test.ts:66` | ✅ | 1 行追加 `has_completed_profile === false` |
| H | TokenRaw + mockExchange | `miniprogram/services/auth.ts:27+242-246` | ✅ | 含 P2-3 覆盖缺口注释 |
| I | computeHasProfile 严格判定 | `miniprogram/utils/profile.ts` | ✅ | 完全改写 · 三段注释 |
| J | home.spec.ts 修订 | `miniprogram/pages/home/index.spec.ts` | ✅ | 删边界 + 加新 4+1 测 |
| §2.4 J' | login/index.ts updateLocalUserProfile | `miniprogram/pages/login/index.ts:7+83` | ✅ | import + PATCH 成功后调用 |
| §2.4 G' | auth.spec.ts updateLocalUserProfile 测 | `miniprogram/services/auth.spec.ts:67-107` | ✅ | 2 测：成功更新 + null 安全 |
| 隐含 | setup.ts pg-mem DDL 追加 | `server/test/setup.ts:70` | ✅ | backend-dev history P2 记录 · 测试基础设施必要改动 |
| 隐含 | follow-ups README FU 关闭 | `.team/follow-ups/README.md` | ✅ | 2 条 FU 关闭 + 注释 |
| 隐含 | backend-dev state + history | `.team/members/backend-dev/state.md + history/` | ✅ | §2 §3 §7 同步 |
| 隐含 | miniapp-dev state + history | `.team/members/miniapp-dev/state.md + history/` | ✅ | §2 §3 §7 同步 |

**结论**：11 项主交付 + §2.4 追加 2 项 + 隐含 4 项 = 17 项全部对齐 · 无遗漏 · 无超 scope

---

## §5 反向交叉核查结果

| # | 核查项 | 命令/方法 | 结果 |
|---|---|---|---|
| 1 | git show --stat 文件改动列表 vs dispatch | `git show c7ea7f7 --stat` | 19 文件 · 与 dispatch §2.1 11 项 + §2.4 + 隐含项完全对账 ✅ |
| 2 | typecheck + lint + test 闸门 | `npm run typecheck && npm run lint && npm run test`（server + root 双跑） | server: typecheck ✅ lint ✅ test 35/35 ✅ · root: typecheck ✅ lint ✅ test 43/43 ✅ |
| 3 | G8 users 路由 grep ≥ 2 | `grep -E "registerUsersRoutes\|/users/me" server/src/app.ts \| wc -l` | 2 ✅（import + register） |
| 4 | G14 OpenAPI User schema required 含 has_completed_profile | `grep -A 3 "required:" server/api/openapi.yaml \| grep has_completed_profile` | `required: [id, nickname, has_completed_profile, created_at]` ✅ |
| 5 | follow-ups README FU 关闭准确性 | 读 `.team/follow-ups/README.md` | FU-COMMON-MINIAPP-PATCH-LIMIT `closed @ COSTRA-158` ✅ · FU-102-PROFILE-REFUSE-UI boundary risk 子项 `closed @ COSTRA-158` ✅ · 闭合条件 + 根因更正 + 人类否决记录 ✅ |

---

## §6 与 Card-Review R1 P1/P2 修订采纳情况对账

| Card-Review 项 | 要求 | 实装情况 | 兑现 |
|---|---|---|---|
| P1-1 client 消费策略 | dispatch 补 §2.4 MVP 不调 GET /users/me + updateLocalUserProfile 实装 | dispatch §2.4 已补 · auth.ts:257-272 updateLocalUserProfile 实装 · auth.spec.ts 2 测 · login/index.ts:83 调用 | ✅ 100% |
| P1-2 拆卡损益分析 | dispatch §5.2 补完整损益分析 | dispatch §5.2 补"拆卡损益分析"段 · 结论不拆 · 理由：双域耦合度高 + 拆卡时间成本 > 收益 | ✅ 100% |
| P2-1 DB migration 幂等 | SQL 改用 IF NOT EXISTS | `0005_users_has_completed_profile.sql:10` → `ADD COLUMN IF NOT EXISTS` | ✅ 100% |
| P2-2 K3 已知未知标注 | dispatch §5.3 补"COSTRA-152 是否升级 K1" | dispatch §5.3 已补 · Sprint-2 末 Retro 议题候选 | ✅ 100% |
| P2-3 mockExchange 注释 | 补覆盖缺口注释 | `auth.ts:242-244` 双行注释 · "mock 下无法验证完善资料入口 · 由 §9 步骤 2 Human 实测覆盖" | ✅ 100% |

**P1 兑现率：2/2（100%）** · **P2 兑现率：3/3（100%）**

---

## §7 项目沉淀建议（Sprint-2 末 Retro 候选）

1. **K3→K1 升级时机评估**：COSTRA-152 PATCH /entries 实装前评估是否将 users 路由的局部 K3 升级为全局 K1 middleware · dispatch §5.3 已标注
2. **POST 405 统一错误处理**：当前 K3 405 响应绕过 errorHandler · 建议在 Sprint-3 补 `METHOD_NOT_ALLOWED` ErrorCode 枚举（或用 PERMISSION_DENIED 替代）· 确保所有 4xx/5xx 走统一链路
3. **OpenAPI nullable 一致性**：avatar_url 在 server patchBodySchema 标注 `nullable: true` 但 OpenAPI 遗漏 · 建议纳入 Sprint-3 CI 对账规则 E（openapi paths vs fastify register 一一对应 · 扩展到 schema nullable 对账）
4. **COSTRA-125 async 约束回退防护**：updateLocalUserProfile 用 `wx.setStorageSync` 回退到同步 API · 建议在 engineering-guidelines 或 COMMON-CONTRACT 加"storage 操作统一走 async setItem/getItem/removeItem · 禁止新引入 wx.setStorageSync/getStorageSync"
5. **代理判定反模式**：COSTRA-157 的 `nickname !== defaultNickname` → COSTRA-158 的 `has_completed_profile` 严格字段 · 议入"代码评审反模式清单"（dispatch §8 已标注）

---

## §8 关键技术决策评议

### K3 Method-Override 局部兜底

**实装**：users.ts POST handler 内识别 `X-HTTP-Method-Override: PATCH` → 委托 handlePatch · 仅 users 路由 · 不全局。

**评议**：K3 是当前最小作用域兼容方案 · 正确选择。唯一关注是 P1-1 标注的 405 响应绕过统一错误处理链路 · 不阻断但应 Sprint-3 补。COSTRA-152 实装时需决策是否升级 K1 · dispatch §5.3 已标注。

### avatar_url 三态语义（undefined/value/null）

**实装**：`CASE WHEN $3::TEXT IS NULL AND $4::BOOLEAN THEN NULL ELSE COALESCE($3, avatar_url) END` · 双参数（$3=value + $4=isExplicitNull flag）。

**评议**：SQL 层面处理三态语义的成熟模式 · 验证通过：
- `undefined` → `$3=null, $4=false` → COALESCE(null, avatar_url) = avatar_url（不更新）✅
- 非空字符串 → `$3='url', $4=false` → COALESCE('url', avatar_url) = 'url'（更新）✅
- `null` → `$3=null, $4=true` → CASE WHEN null IS NULL AND true THEN NULL → NULL（清空）✅

`$3::TEXT IS NULL` 依赖 PostgreSQL 类型转换 · 当 $3=null 时 `null::TEXT IS NULL` 为 TRUE · 正确。

### has_completed_profile 单调性

**实装**：SQL 直接 `has_completed_profile = TRUE` · 一旦 TRUE 不可降级。

**评议**：单调性设计合理 · 避免用户清空资料后再次显示完善入口 · SQL 层面无 CHECK 约束防止未来代码误写 FALSE · 但 COMMENT 已标注"单调约束（应用层保证）"· MVP 阶段可接受 · 若未来需 admin 重置接口 · 则需打破单调性 · 届时加 CHECK 约束或专用 admin API。

### 不做 backfill 决策

**评议**：< 10 用户 · 一次性困惑可接受 · migration COMMENT 显式标注 · Human 实测时需关注。

---

## §9 自检清单

- [x] 10 维度是否全部打分？ → C1~C10 全评 · C9 N/A 不计分母 · 38/45
- [x] 每个 P0/P1/P2 是否有"维度 / 证据 / 问题 / 修复建议"4 要素？ → 是
- [x] Verdict 是否与分数 + 阻塞点一致？ → 38/45 = 84.4% ≥ 80% → APPROVE · 0 P0 · 1 P1 · 符合
- [x] 若 N ≥ 2 是否对比上轮 P0/P1 剩余？ → N=1 · 首轮 · 与 Card-Review P1/P2 兑现率对账 ✅
- [x] 是否跨区审了 pm / design / qa？ → 否 · Owner = backend-dev + miniapp-dev
- [x] 报告是否完全通过 write_to_file 落盘？ → 是

---

## §10 装扮档自评

| 维度 | 值 |
|---|---|
| 工作区铁律 | ✅ 仅读 · 唯一写操作 = 本报告落盘到 `.team/reviews/COSTRA-158/r1-review-tech.md` |
| tools 白名单 | ✅ 使用 Read / Grep / LS / Bash（只读）· 未触发 Write 任何 server/miniprogram 业务文件 |
| D-016 同轮兑现 | ✅ 本次 Review 在 Orchestrator 派单同对话轮内产出 |
| 审核耗时 | ~30 分钟 |
| 置信度 | **高** |
| 低置信点 | (1) K3 405 响应是否应在 Sprint-3 补 ErrorCode 枚举还是用 PERMISSION_DENIED 替代 · 需 Human 裁决 · (2) updateLocalUserProfile 同步 vs async storage 操作的取舍 · miniapp-dev 有意选择同步 API 保证 home onShow gate 立即可读 · 但违反 COSTRA-125 统一 async 约束 |

---

*本报告由 `costra-review-tech-COSTRA-158-r1` 一次性装扮产出 · 审完即销毁 · 2026-05-19T11:05+08:00*
