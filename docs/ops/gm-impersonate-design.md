# GM 权限与指定账号登录（impersonate）· 完整实施方案

> 状态：已实施（2026-08-20 · db / backend / miniapp 三卡落地）
> 关联：继 WX_MOCK_LOGIN 移除后，免扫码/指定账号登录的正式实现

## 0. 背景与已定决策

测试/定位问题时需要以指定用户身份登录小程序（wx.login 只能登扫码人自己）。
方案核心：**users 表 GM 标记 + 服务端实时校验 + GM 用户可登录任意账号或伪造账号**。
不区分 staging/prod，安全控制面 = DB 用户级授权。

已定案决策：
- D1：`is_gm` 经登录响应 + `GET /users/me` 双通道下发
- D2：GM 校验**实时查库**，不用 JWT claim（授权/回收即时生效）
- D3：用户列表**不返回 openid**，选人用 user_id；列表展示 = 头像+昵称+创建时间+id 短码
- D4：伪造 openid **强制 `gm_fake_` 前缀**（与真实 openid 物理隔离、可批量清理）
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
- 新增：
```ts
/** GM 用户列表：created_at DESC, id DESC 稳定排序；排除软删。limit 由调用方按 page_size+1 传入判 has_more */
listRecentUsers(limit: number, offset: number): Promise<UserEntity[]>
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

**端点 1：`GET /gm/users`**
- query schema：`page` int ≥1 默认 1；`page_size` int 1..50 默认 20
- 实现：`listRecentUsers(page_size + 1, (page-1)*page_size)`，前 page_size 条为 items，多出 1 条则 `has_more=true`
- 响应 200：
```json
{ "items": [{ "id": "uuid", "id_short": "uuid前8位", "nickname": "...", "avatar_url": null, "created_at": "ISO" }],
  "page": 1, "page_size": 20, "has_more": true }
```
- **不返回 openid**。

**端点 2：`POST /gm/impersonate`**
- body schema（`additionalProperties:false`）：`user_id` uuid、`fake_openid` string、`client_fp`（复用 auth.ts L31 的 pattern）
- 校验：`user_id` 与 `fake_openid` **必须二选一**（都缺/都给 → `INVALID_ARGUMENT`）；`fake_openid` 必须匹配 `^gm_fake_[A-Za-z0-9_-]{4,64}$`（不符 → `INVALID_ARGUMENT`）
- user_id 路径：`findById` 不存在 → `NOT_FOUND`；取该用户的 `wxOpenid`/`wxUnionid`
- fake_openid 路径：`loginAsOpenid(fake_openid, null, clientFp)`（upsert 语义自动建号 + bootstrap 个人 family/ledger）
- 成功 → 200 `AuthTokenPair`（与 wx-login 完全同形）
- 审计：`app.log.warn({ gmUserId, mode: 'user_id'|'fake_openid', targetUserId?, fakeOpenid? }, 'gm impersonate login')`
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
gmLoginAs(target: { userId?: string; fakeOpenid?: string }, gmAccessToken: string): Promise<Token>
```
（request POST /gm/impersonate 带 client_fp=await getOrCreateDeviceFp()，随后走同一管道。
**`gmAccessToken` 必须显式传入**：切换流程先 `clearToken` 再调本函数，request 无法自动注入 Bearer，
由调用方在清理前捕获当前 access_token，经 `extraHeader.Authorization` 透传。）

### 3.2 新建 `services/gmApi.ts`
仅 `listGmUsers(page, pageSize)`，走 `services/request.ts`。
**`impersonate` 请求不放入本模块**，内聚在 `auth.gmLoginAs`：随后必须走 `applyLoginResponse` 登录管道，
且可避免 auth → gmApi → request → auth 循环依赖。

### 3.3 设置页入口（`pages-family/settings/index`）
- 当前是占位页（只有"账本导入/导出"）。onShow：`getToken()?.raw.user.is_gm === true` → setData。
- wxml 增加仅 GM 可见分区，文案明确标注：**「GM 工具 · 切换登录身份」**→ navigateTo `/pages-gm/impersonate/index`。

### 3.4 新建分包页 `pages-gm/impersonate/index`
- `app.json` 注册 subpackage `pages-gm`（不加入 preloadRule）。
- UI：列表（头像+昵称+创建日期+id 短码）+ 上一页/下一页翻页 + 顶部「伪造身份登录」入口（输入框，提示 `gm_fake_` 前缀要求）→ 选中后确认弹窗（左确认右取消，项目惯例）。
- **切换流程**（复用 logout 清理语义，复用现有导出，顺序与 mine 页 logout 对齐）：
  1. 确认弹窗 → `syncOnce('hide')`
  2. `outbox.pendingCount() > 0` → 二次弹窗（文案对齐 mine："最新记录可能尚未同步，切换后可能丢失"）
  3. 确认弹窗通过后、清理前捕获 `gmAccessToken = getToken()?.raw.access_token` → `stopScheduler()` → `revokeSessionRemote()`（吞错；必须在 `clearToken()` 前，body 需携带当前 refresh_token）→ `clearToken()` → 动态 import `localReset.resetLocalData()`（必须动态 import，防循环依赖）
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
- 新建 `routes/gm.spec.ts`：未登录 401；非 GM 403（两端点）；list 分页/has_more/created_at DESC/无 openid 字段/不含软删用户；impersonate user_id 200 且 user.id=目标；目标不存在 404；fake_openid 合法→200 建号且 is_gm=false；非法前缀 400；user_id 与 fake_openid 同给/同缺 400

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
