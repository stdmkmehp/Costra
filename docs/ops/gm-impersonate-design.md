# GM 权限与指定账号登录（impersonate）· 完整实施方案

> 状态：已实施（2026-08-20 · db / backend / miniapp 三卡落地）
> 修订（2026-08-20）：伪造 openid 由手填改为**服务端自动分配**——`POST /gm/impersonate` 入参收窄为 `user_id` / `create_fake: true` 二选一，`fake_openid` 入参移除；D4 前缀隔离不变
> 修订（2026-09-02 · v2 双榜单改造）：`GET /gm/users` 由「created_at DESC 单榜 + OFFSET 分页」改为**双榜单一次全量下发**（近7天活跃 Top 200 + 最近注册 Top 200 · 无分页参数），整榜走 Redis read-through 缓存（`cache:v1:gm:active-users` · TTL 1800s · Redis 异常降级直查 SQL），客户端双 section 各自本地翻页（每页 10 条）。详见 §10
> 关联：继 WX_MOCK_LOGIN 移除后，免扫码/指定账号登录的正式实现

## 0. 背景与已定决策

测试/定位问题时需要以指定用户身份登录小程序（wx.login 只能登扫码人自己）。
方案核心：**users 表 GM 标记 + 服务端实时校验 + GM 用户可登录任意账号或伪造账号**。
不区分 staging/prod，安全控制面 = DB 用户级授权。

已定案决策：
- D1：`is_gm` 经登录响应 + `GET /users/me` 双通道下发
- D2：GM 校验**实时查库**，不用 JWT claim（授权/回收即时生效）
- D3：用户列表**不返回 openid**，选人用 user_id；列表展示 = 头像+昵称+创建时间+id 短码
- D4：伪造 openid **强制 `gm_fake_` 前缀**（与真实 openid 物理隔离、可批量清理）；**服务端自动分配**（`gm_fake_` + 32 位 hex = randomUUID 去横线），客户端不接受手动指定
- D5：审计 = warn 级日志（gm→target）；`sessions.impersonated_by` 列为 P1 可选增强，**本期不做**
- D6：授权走运维 SQL，文档化；不做脚本
- D7：GM 切换前调服务端 `POST /auth/logout` 吊销当前会话（抽无副作用的 `revokeSessionRemote()`，吞错不阻塞切换；须在 `clearToken` 前调用以携带 refresh_token）

## 1. DB 变更

新建 `server/db/migrations/0018_users_is_gm.sql`（migration 由 `infra/scripts/06-migrate.sh` 按文件名顺序执行，SQL 必须幂等）：

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_gm BOOLEAN NOT NULL DEFAULT FALSE;
```

同步两处（项目惯例）：
- `server/db/migrations/0001_init.sql` 的 users 幂等 ALTER 块（对齐 preferred_* 先例）
- `server/test/setup.ts` pg-mem DDL 的 users 表加 `is_gm BOOLEAN NOT NULL DEFAULT FALSE`

字段语义：默认 false；**全库无任何 API 写该列**（`PATCH /users/me` schema 是 `additionalProperties:false` 白名单，天然排除），唯一写入路径 = 运维 SQL。

## 2. Server 变更

### 2.1 `server/src/repositories/userRepo.ts`
- `UserEntity` / `UserRow` / `rowToEntity` 增加 `isGm: boolean`（映射 `is_gm`）。
- **所有** SELECT/RETURNING 列清单补 `is_gm`：`findByOpenid`、`findById`、`create`、`updateProfile`、`updatePreference`、`clearPreferenceForFamily`。
- ~~listRecentUsers~~（v2 已移除，替换为下列双榜查询 · §10）：
```ts
/** 活跃榜：since 起有 entries 的用户 · entryCount7d DESC, lastActiveAt DESC, id DESC */
listActiveUsers(since: Date, limit: number): Promise<ActiveUserSummary[]>
/** 注册榜：created_at DESC, id DESC 稳定排序；排除软删 */
listRecentRegistered(limit: number): Promise<RecentUserSummary[]>
```

### 2.2 `server/src/services/authService.ts`
- 抽取 `wxLogin`（L161）中 code2Session 之后的整段管线为：
```ts
loginAsOpenid(openid: string, unionid: string | null, clientFp?: string | null): Promise<AuthTokenPair>
```
内容 = L164-234 原样（withTx 内 upsertByOpenid + 个人 family/ledger bootstrap + signPair + persistSession + 组装响应）。`wxLogin` 改为 `code2Session → loginAsOpenid(openid, unionid ?? null, clientFp)`。加入 `AuthService` 接口导出。
- `AuthTokenPair.user` 增加 `is_gm: boolean`；`toUserView` 补 `is_gm: u.isGm`。

### 2.3 `server/src/routes/users.ts`
- `UserView` / `toUserView` 增加 `is_gm`（GET/PATCH /users/me 响应携带）。

### 2.4 新建 `server/src/routes/gm.ts`
复用现有 per-route 鉴权模式（参 routes/users.ts L27 `parseUserId`）：

```ts
async function requireGm(request: FastifyRequest): Promise<string> {
  // jwtVerify 失败 → UNAUTHENTICATED 'invalid token'（同 parseUserId）
  // userRepo.findById(sub) → !user → UNAUTHENTICATED 'user not found'
  // !user.isGm → PERMISSION_DENIED 'gm only'
  // 返回 gmUserId
}
```

**端点 1：`GET /gm/users`**（v2 双榜单 · §10）
- 无分页参数：一次返回两个封顶榜单（各 Top 200），分页由客户端本地切片
- 实现：`getGmListsCached(loader)` read-through（`server/src/services/gmActiveUsersCache.ts`）；loader 内 `Promise.all(listActiveUsers(7天前, 200), listRecentRegistered(200))`；TTL = `ttl().gmActiveUsersSec`（默认 1800s · env `TTL_GM_ACTIVE_USERS_SEC`）；Redis 读/写异常均降级直查 SQL（warn 日志）
- 响应 200：
```json
{ "active": [{ "id": "uuid", "id_short": "uuid前8位", "nickname": "...", "avatar_url": null,
               "created_at": "ISO", "entry_count_7d": 32, "last_active_at": "ISO" }],
  "recent": [{ "id": "uuid", "id_short": "uuid前8位", "nickname": "...", "avatar_url": null,
               "created_at": "ISO" }] }
```
- **不返回 openid**；两榜语义独立、不去重（同一用户可同时出现）

**端点 2：`POST /gm/impersonate`**
- body schema（`additionalProperties:false`）：`user_id` uuid、`create_fake` boolean（`enum:[true]`）、`client_fp`（复用 auth.ts L31 的 pattern）
- 校验：`user_id` 与 `create_fake` **必须二选一**（都缺/都给 → `INVALID_ARGUMENT`）；旧 `fake_openid` 入参已从契约移除（给了 → `INVALID_ARGUMENT`）
- user_id 路径：`findById` 不存在 → `NOT_FOUND`；取该用户的 `wxOpenid`/`wxUnionid`
- create_fake 路径：服务端生成 `gm_fake_` + 32 位 hex → `loginAsOpenid(fakeOpenid, null, clientFp)`（upsert 语义自动建号 + bootstrap 个人 family/ledger）；**每次调用新建独立账号**，复登已建伪造账号走 user_id 路径（伪造账号 created_at 最新，排在用户列表最前）
- 成功 → 200 `AuthTokenPair`（与 wx-login 完全同形）
- 审计：`app.log.warn({ gmUserId, mode: 'user_id'|'fake_auto', targetUserId?, fakeOpenid? }, 'gm impersonate login')`
- 不新增 ErrorCode（复用 UNAUTHENTICATED/PERMISSION_DENIED/NOT_FOUND/INVALID_ARGUMENT，不动错误契约文档）

### 2.5 注册与契约
- `server/src/app.ts` 注册 `registerGmRoutes`（对齐现有路由注册方式）。
- `server/api/openapi.yaml`（108KB 事实源；根目录 api/openapi.yaml 是指针不用动）：`User` schema + `AuthTokenPair.user` 加 `is_gm`；登记两个 GM 端点（标注 GM-only）。

## 3. Miniapp 变更

### 3.1 `services/auth.ts`
- `TokenRaw.user` 增加 `is_gm: boolean`。
- 抽取 `logout()` 内远端吊销段（request POST /auth/logout + 吞错 warn）为导出函数 `revokeSessionRemote()`：不带 `userLoggedOut`/`reLaunch` 副作用，`logout()` 与 GM 切换流程共用（D7）。
- 抽取 `doWxLogin` 登录后管道（buildStored → replaceCurrent → setItem → restoreActiveFamilyAfterLogin → flushPendingPreference）为私有共用函数 `applyLoginResponse`，新增导出：
```ts
gmLoginAs(target: { userId?: string; createFake?: boolean }, gmAccessToken: string): Promise<Token>
```
（request POST /gm/impersonate 带 client_fp=await getOrCreateDeviceFp()，随后走同一管道。
**`gmAccessToken` 必须显式传入**：切换流程先 `clearToken` 再调本函数，request 无法自动注入 Bearer，
由调用方在清理前捕获当前 access_token，经 `extraHeader.Authorization` 透传。）

### 3.2 新建 `services/gmApi.ts`
仅 `listGmUsers()`（v2：无分页参数，一次返回 `{active, recent}` 双榜全量），走 `services/request.ts`。
**`impersonate` 请求不放入本模块**，内聚在 `auth.gmLoginAs`：随后必须走 `applyLoginResponse` 登录管道，
且可避免 auth → gmApi → request → auth 循环依赖。

### 3.3 设置页入口（`pages-family/settings/index`）
- 当前是占位页（只有"账本导入/导出"）。onShow：`getToken()?.raw.user.is_gm === true` → setData。
- wxml 增加仅 GM 可见分区，文案明确标注：**「GM 工具 · 切换登录身份」**→ navigateTo `/pages-gm/impersonate/index`。

### 3.4 新建分包页 `pages-gm/impersonate/index`
- `app.json` 注册 subpackage `pages-gm`（不加入 preloadRule）。
- UI（v2）：双 section——「近7天活跃」（副标题：近7天 N 笔 · 最后活跃 MM-DD HH:mm · id 短码）在上、「最近注册」（副标题：注册日期 · id 短码）在下；每区独立本地翻页（每页 10 条 · 页码 `x / y` · 单页时隐藏翻页行）+ 顶部「伪造身份登录」入口（单按钮「新建伪造账号登录」，伪造 openid 由服务端自动分配）→ 选中后确认弹窗（原生 wx.showModal，左取消右确认，项目惯例）。
- **切换流程**（复用 logout 清理语义，复用现有导出，顺序与 mine 页 logout 对齐）：
  1. 确认弹窗 → `syncOnce('hide')`
  2. `outbox.pendingCount() > 0` → 二次弹窗（文案对齐 mine："最新记录可能尚未同步，切换后可能丢失"）
  3. 确认弹窗通过后、清理前捕获 `gmAccessToken = getToken()?.raw.access_token` → `stopScheduler()` → `revokeSessionRemote()`（吞错；必须在 `clearToken()` 前，body 需携带当前 refresh_token）→ `clearToken()` → `localReset.resetLocalData()`（顶层静态 import；早期"动态 import 防循环依赖"是过度设计，小程序运行时不支持 ESM `import()`，会静默失败→本地数据不清→GM 切换身份串账。CommonJS 循环无害）
  4. `gmLoginAs(target, gmAccessToken)` → `startScheduler()`（已幂等）→ `wx.reLaunch(/pages/ledger/index)`；`gmLoginAs` 失败时本地已全清 → 提示并 `reLaunch(/pages/login/index)` 走标准登录闭环
- **不设置** `globalData.userLoggedOut`（这不是登出，impersonate 后已是登录态）。

## 4. 运维手册

见 `docs/ops/gm-access.md`：
```sql
-- 授权（按 openid 或 id 单人授权）
UPDATE users SET is_gm = TRUE, updated_at = now() WHERE wx_openid = '<openid>';  -- 或 WHERE id = '<uuid>'
-- 回收（即时生效：requireGm 实时查库，下一请求即 403）
UPDATE users SET is_gm = FALSE, updated_at = now() WHERE id = '<uuid>';
-- 假账号识别
SELECT id, wx_openid, created_at FROM users WHERE wx_openid LIKE 'gm\_fake\_%' ESCAPE '\';
```
- 审计查询：server 日志 `jq 'select(.msg=="gm impersonate login")'`
- 授权生效时机：用户重新登录或下次 `/users/me` 刷新后客户端可见入口（服务端校验即时生效）

## 5. 测试清单

**server**（在 `server/` 下跑）：
- userRepo：`is_gm` 映射与默认值 false（findById/create/upsert）
- authService：`loginAsOpenid` 与 wxLogin 同行为（fake openid 自动建号+bootstrap+签发）
- 新建 `routes/gm.spec.ts`：未登录 401；非 GM 403（两端点）；list（v2）双榜 active 按 entry_count_7d DESC/recent 按 created_at DESC/无 openid 字段/排除软删/无流水用户不进 active；二次请求命中缓存（新写入流水不影响已缓存榜单）；Redis 异常降级直查 SQL 200；impersonate user_id 200 且 user.id=目标；目标不存在 404；create_fake→200 服务端自动分配（openid 匹配 `gm_fake_[0-9a-f]{32}`、is_gm=false、每次调用新建独立账号）；旧 fake_openid 入参 400；user_id 与 create_fake 同给/同缺 400

**miniapp**：
- `auth.spec.ts`：mockRaw/T11 契约补 `is_gm`；`gmLoginAs` 管道用例
- `gmApi.spec.ts`：请求形状与错误透传

## 6. 回归与验收

- `server/`：typecheck + 全量 test 绿；0018 连跑两次幂等
- 根目录：typecheck + lint(0 error) + 全量 test 绿
- 手验：非 GM 无入口且 curl 两端点 403；授权后设置页出现入口、可登录目标/伪造账号；回收后入口消失且 403

## 7. 提交拆分（按序）

1. `feat(db): users.is_gm 字段 migration`（0018 + 0001 镜像 + setup.ts）
2. `feat(backend): GM 权限校验与 impersonate 端点`（repo/service 抽取/gm.ts/users.ts/openapi + 测试）
3. `feat(miniapp): GM 切换登录身份入口与页面`（auth/gmApi/settings/pages-gm + 测试）
4. `docs(ops): GM 授权与审计手册`

## 8. 明确排除项

- `sessions.impersonated_by` 审计列（P1 可选，另开卡）
- GM 分级/角色体系（boolean 够用，不预设计）
- nginx 层对 /v1/gm/ 的额外限制（应用层校验已足够，不加运维面）

## 9. 实施前置检查（开卡前必读）

- `server/src/services/authService.ts` 的 `wxLogin`（L161-L234）：抽取目标管线，确认 `loginAsOpenid` 签名闭合。
- `server/src/routes/auth.ts` L31：`client_fp` pattern 定义位置，gm.ts 复用同一正则。
- `server/src/repositories/userRepo.ts`：所有 SELECT 列清单集中维护，补 `is_gm` 时注意 `updateProfile`/`updatePreference` 的 RETURNING 列。
- `server/test/setup.ts`：users 表 pg-mem DDL 需与 0001_init 镜像，migration 走真实 PG 由 06-migrate.sh。
- `miniprogram/services/auth.ts`：`TokenRaw.user`（L28-37）补 `is_gm`；`getToken()` 返回的运行时 Token 经 `current.raw.user.is_gm` 读取。
- `miniprogram/pages-family/settings/index`：确认当前占位页 wxml 结构，GM 分区追加在末尾。
- 切换流程严格对齐 `pages/mine/index.ts` 的 logout 顺序（syncOnce → pendingCount → stopScheduler → clearToken → resetLocalData → reLaunch）。

## 10. v2 双榜单改造（2026-09-02 · 已实施）

### 10.1 动机（旧版三痛点）

1. 每次翻页都实时打 SQL（OFFSET 分页）；
2. 只能按注册时间排序，排查问题时更关心"谁最近在用"；
3. 翻页按钮在列表尾部，翻页发请求 → loading 跳动 → 按钮被顶出屏幕，需反复回划。

### 10.2 冻结口径（用户拍板）

| # | 决策点 | 结论 |
|---|--------|------|
| F1 | 活跃度口径 | 近 7 天 `entries` 写入数（`created_by` + `deleted_at IS NULL`）；不引入 sessions/audit_logs |
| F2 | 榜单构成 | 双榜同页：「近7天活跃」在上 +「最近注册」在下；各 Top 200；**不去重**（语义各自字面化） |
| F3 | 非活跃用户 | 不进任何榜单（只建号未记账的用户不可见）；指定个别用户登录后续另出方案 |
| F4 | 缓存 | Redis 单 key `cache:v1:gm:active-users` 存整份双榜（envelope `{"v":{active,recent}}`）；TTL 固定 1800s（`ttl().gmActiveUsersSec`）；无强制刷新口、无主动失效挂钩；Redis 读/写异常降级直查 SQL |
| F5 | 分页 | 端点无分页参数；一次全量下发两榜（~60KB），每区客户端本地翻页（每页 10 条 · 独立页码 · 单页隐藏翻页行） |

### 10.3 关键设计判断

- **本地翻页优于服务端分页**：榜单封顶 + 整榜已缓存 ⇒ 每次翻页仍发请求虽命中 Redis，但 loading 位移问题（痛点 3）会回来；本地切片瞬时、每页条数固定 ⇒ 列表高度恒定、按钮位置不动，痛点 3 根除。
- **上拉加载（onReachBottom）被否决**：双 section 下触发点唯一、追加语义归属不明；且活跃区 200 条会把注册区压出十屏。
- **口径副作用转正**：新建伪造账号必现「最近注册」区顶部，复登入口（v1 依赖 created_at 置顶）在 v2 自然保留。
- **缓存正当性**：GM 低频内部工具，一次聚合多次翻页复用；鉴权（requireGm 实时查库）不经过缓存，不触碰业务缓存红线（8-28 业务缓存回滚决策不适用于此）。
- **性能观察项**：`entries(created_at)` 无索引走 seq scan；30min 至多一次重算，当前表量可接受，表量上来后再评估加索引。
- **pg-mem 兼容**：活跃窗口起点由 JS 计算后以参数传入（`created_at >= $1`），避免 SQL interval 字面量；无 GREATEST/窗口函数。

### 10.4 落点清单

- `userRepo.ts`：`listRecentUsers` 移除 → `listActiveUsers(since, limit)` / `listRecentRegistered(limit)`（均不 SELECT openid）。
- 新建 `services/gmActiveUsersCache.ts`：`getGmListsCached(loader, log)` read-through（miss/坏 envelope/异常 → loader 重算回写；回写失败吞错）。
- `ttl.ts` + `.env.example`：新增 `gmActiveUsersSec` / `TTL_GM_ACTIVE_USERS_SEC=1800`。
- `routes/gm.ts`：`GET /gm/users` 无 query schema，响应 `{active, recent}`；`GM_LIST_LIMIT=200`、窗口 7 天。
- `openapi.yaml` /gm/users 契约重写。
- 小程序：`gmApi.ts` 类型与签名（无参）；`pages-gm/impersonate` 双 section + 本地翻页（每页 10 条），全量榜单挂 Page 实例属性（非 data，避免大数组 diff）。
- 测试：`gm.test.ts` T3 重写 + T9（缓存命中）+ T10（Redis 降级）；`gmApi.spec.ts` 重写。

### 10.5 明确排除

- 指定个别用户登录（搜索/id 直达）：另出方案；
- 强制刷新口、缓存主动失效挂钩、`entries(created_at)` 索引（观察项）。
