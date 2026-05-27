# Phase-3 双卡联合实测手册 · COSTRA-164 + COSTRA-165 + COSTRA-154 + COSTRA-150

> **任务**：Phase-3 真机 Prod 双卡联合实测（COSTRA-164 family bootstrap + COSTRA-165 family-context service + COSTRA-154 wx.login 全链路 + COSTRA-150 数据同步）
> **触发**：COSTRA-164 R1.x APPROVE 38/40 + COSTRA-165 R1 APPROVE 38/40 · 双卡联立 R1 APPROVE-pending-joint-test
> **核心变化**：v1.0 §3.1 让 Human 手动 SSH 注入 family_id 的临时绕过**完全废弃**——164+165 实装后 client 登录响应即透明拿到 default_family_id/default_ledger_id
> **目标环境**：`https://costra.cloud`（49.235.216.20）
> **关键差异**：无 mock · `WX_MOCK_LOGIN=0` · 真实微信 code → 微信上游 code2Session → 真 openid · client 自动获取 family-context
> **实测者**：Human
> **预计时间**：~45 分钟（v1.0 30min + 4 场景 family-context 验证）
> **版本**：v2.0 · 2026-05-27 · 替代 v1.0（2026-05-26）
> **D-025 议题 25 强约束已贯彻**：每条命令写入前均 Read 验证源码/配置 · 每个事实陈述标注 file:line 锚点

---

## §0 版本与变更说明

### v2.0 替代 v1.0

| 维度 | v1.0（已废弃） | v2.0（当前） |
|------|---------------|-------------|
| family_id 来源 | §3.1 SSH SQL 手动建 family/ledger + §3.2 Console setStorageSync 注入 | 登录响应自动返回 + client 透明写入 storage（COSTRA-164+165 实装） |
| 测试覆盖 | 仅 wx.login + 数据同步 | 新增 4 大 family-context 场景（全新登录 / 旧 token 升级 / logout 清理 / entry 实际写入） |
| storage key | `__costra_family_id_v1`（旧 key · 仅存 family_id 字符串） | `__costra_family_context_v1`（新 key · 含 family_id + ledger_id 结构体） |
| 旧 key 清理 | 无 | `family.ts:23` setActiveFamily 自动 removeItem 旧 key |
| 预计时间 | 30 min | 45 min |

### v1.0 已废弃章节

- **§3.1 数据准备：服务端建 family + ledger（SSH SQL 方案 A）** → 完全废弃 · COSTRA-164 server bootstrap 已在 wx.login 时为新用户透明创建
- **§3.2 注入 family_id 到小程序 storage** → 完全废弃 · COSTRA-165 client 已透明接收并写入 `__costra_family_context_v1`

### v2.0 新增章节

- **§3 COSTRA-165：family-context 4 场景实测**（全新登录 / 旧 token 升级 / logout 清理 / entry 写入）
- **§2 Step 5 验证 Token 持久化**：新增 default_family_id / default_ledger_id / family-context / globalData 断言
- **§6 排查指南**：新增 family-context 相关排查项
- **§7 联动 D-024 §2.2 C1 双卡 approve 流程**

---

## §1 前置条件检查

### §1.1 服务端确认（已在 Phase-2 完成）

> 事实源：`infra/prod-bootstrap-compose.md` §7 闸门验证 + §4.4 stack 验证

以下由 Phase-2 deploy-all.sh + 09-verify-gates.sh 保证，仅需快速复验：

```bash
# SSH 登录服务器
ssh root@49.235.216.20

# 1. 容器全部运行
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'costra-(server|nginx|postgres|redis)'
# 期望：4 个容器 Up
# 事实源：infra/prod-bootstrap-compose.md §4.4 4 容器架构

# 2. healthz 探活
curl -s https://costra.cloud/healthz | jq .status
# 期望："ok"
# 事实源：infra/docker-compose.prod.yml server healthcheck 路径 /healthz（非 /v1/healthz · v1.0 历史错误已修正）

# 3. WX_MOCK_LOGIN 确认为 0
docker exec costra-server printenv WX_MOCK_LOGIN
# 期望：0（或空值 = 默认关闭）
# 事实源：infra/prod-bootstrap-compose.md §3.4 server.env WX_MOCK_LOGIN=0 · D-026 §2.3 C2 强制

# 4. NODE_ENV 确认为 production
docker exec costra-server printenv NODE_ENV
# 期望：production
# 事实源：infra/prod-bootstrap-compose.md §3.4 server.env NODE_ENV=production

# 5. 证书有效期
echo | openssl s_client -connect costra.cloud:443 -servername costra.cloud 2>/dev/null | openssl x509 -noout -dates
# 期望：notAfter 在当前日期之后
# 事实源：infra/prod-bootstrap-compose.md §6.1 certbot webroot 签证
```

**如果任一步失败**：回到 Phase-2 闸门排查，不进入后续步骤。

### §1.2 微信后台配置确认

登录 [微信公众平台](https://mp.weixin.qq.com)（AppID: `wxf8b0d3e3a83f9941`）：

1. **开发管理 → 开发设置 → 服务器域名**：
   - `request 合法域名`：必须包含 `https://costra.cloud`
   - 如未配置 → 点"修改"添加（需管理员扫码确认，每月限 5 次）

2. **开发管理 → 开发设置 → 服务器域名**：
   - 确认无 `http://localhost` 相关域名残留（prod 不需要）

> **事实源**：微信小程序在真机运行时强制校验请求域名白名单；不在白名单内的请求直接被 block

### §1.3 小程序环境切换 prod

#### §1.3.1 修改 `CURRENT_ENV` 为 `'prod'`

```bash
cd /Users/weizhao/Desktop/Costra/miniprogram/services
```

编辑 `env.ts` 第 50 行：

> 事实源：`miniprogram/services/env.ts:50` 当前值为 `const CURRENT_ENV: EnvName = 'prod'`

**验证当前值**：如果 env.ts:50 已经是 `'prod'`，则无需修改。

```diff
- const CURRENT_ENV: EnvName = 'dev';
+ const CURRENT_ENV: EnvName = 'prod';
```

> **事实源**：`miniprogram/services/env.ts:50` · 切换后 `getEnv().apiBaseUrl` → `https://costra.cloud/v1`（env.ts:39），`mockLogin` → `false`（env.ts:40）

#### §1.3.2 验证切换生效

在微信开发者工具中编译，Console 应输出：

```
[Costra] onLaunch env= prod
```

> **事实源**：`miniprogram/app.ts:51` `console.info('[Costra] onLaunch env=', this.globalData.env.name)`

### §1.4 真机调试准备

1. **微信开发者工具** → 点击顶部 **"真机调试"**（不是"预览"——真机调试能看到实时 Console + Network）
2. 手机微信扫码连接
3. 确认 PC 端出现 **"真机调试窗口"**：左侧模拟器 + 右侧 Console/Network 面板
4. **关键**：真机调试模式下**不会**跳过域名校验——如果请求被 block 说明 §1.2 未配好

> **备选方案**：如真机调试不稳定，可用 **"预览"** 模式 + 手机端"打开调试"（vConsole）
> 操作：预览 → 扫码 → 手机小程序右上角 ··· → 打开调试 → vConsole 面板出现

---

## §2 COSTRA-154：wx.login 全链路验证（更新 · 含 family-context 字段验证）

### 测试目标

验证：真机 `wx.login()` → `POST /v1/auth/wx-login {code}` → prod server 调微信上游 code2Session → 返回真 JWT（**含 default_family_id + default_ledger_id**）→ 小程序存储 token + 写入 family-context storage + 同步 globalData → 后续请求鉴权通过。

---

### §2.1 测试步骤：首次登录

#### Step 1：触发登录

1. 真机上打开小程序（首次打开 / 清除 storage 后）
2. 应显示登录页
3. 点击 **"一键微信登录"** 按钮

#### Step 2：观察 Console 日志

**期望依次出现**：

```
[Costra] onLaunch env= prod
[auth] wx.login ok {codeLen: 32}
[auth] login success {userId: "0197xxxx-...", familyId: "0197xxxx-..."}
```

> **事实源**：
> - `miniprogram/services/auth.ts:205` → `[auth] wx.login ok`
> - `miniprogram/services/auth.ts:249` → `[auth] login success`（POST 成功后 · 含 userId + familyId）
> - code 长度 = 32 是微信标准（真机 + 开发者工具均如此）

#### Step 3：观察 Network

| 请求 | 期望 |
|------|------|
| `POST https://costra.cloud/v1/auth/wx-login` | Status 200 |
| Response body | `{"access_token":"ey...","refresh_token":"ey...","access_token_ttl_sec":7200,"refresh_token_ttl_sec":2592000,"user":{...},"default_family_id":"0197xxxx-...","default_ledger_id":"0197xxxx-..."}` |

> **事实源**：`server/src/routes/auth.ts:56` 路由路径 `/auth/wx-login` · `server/src/services/authService.ts:201-210` wxLogin 返回 AuthTokenPair 含 default_family_id + default_ledger_id

**FAIL 场景**：

| 响应码 | 含义 | 排查 |
|--------|------|------|
| 502/504 | nginx 转发失败 | server 容器是否运行 |
| 500 `WX_CODE_INVALID` | 微信 code 无效 | code 是否过期（5min 有效）/ AppSecret 是否正确 |
| 500 `UNAVAILABLE` | 微信上游不可用 | 服务器网络 → 微信 API 是否通 |

#### Step 4：验证页面跳转

- 登录成功后自动跳转到 **home 页**
- home 页应正常渲染（无白屏/错误提示）

#### Step 5：验证 Token 持久化 + family-context（**v2.0 核心更新**）

在调试 Console 执行：

```js
// 验证 Token envelope（含 default_family_id / default_ledger_id）
const t = wx.getStorageSync('__costra_token_v1');
console.log('envelope keys:', JSON.stringify(Object.keys(t)));
console.log('user.id:', t?.d?.raw?.user?.id);
console.log('access_token prefix:', t?.d?.raw?.access_token?.substring(0, 20));
console.log('default_family_id:', t?.d?.raw?.default_family_id);   // 必须 UUID 格式 · 非空
console.log('default_ledger_id:', t?.d?.raw?.default_ledger_id);   // 必须 UUID 格式 · 非空
```

> **事实源**：
> - `miniprogram/services/storage.ts:10,13-18` envelope 格式 `{v:1, t:timestamp, d:data}`
> - `miniprogram/services/auth.ts:13` TOKEN_KEY = `__costra_token_v1`
> - `miniprogram/services/auth.ts:40-41` TokenRaw 含 default_family_id / default_ledger_id

**期望**：
- `envelope keys: ["v","t","d"]`
- `user.id`: UUID v7 格式
- `access_token prefix`: `eyJ...`（JWT 格式）
- `default_family_id`: **UUID 格式 · 非空**（如 `0197xxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx`）
- `default_ledger_id`: **UUID 格式 · 非空**

然后验证 family-context storage + globalData：

```js
// 验证 __costra_family_context_v1 已写入
const fc = wx.getStorageSync('__costra_family_context_v1');
console.log('family_context envelope:', JSON.stringify(Object.keys(fc)));
console.log('family_context.d:', JSON.stringify(fc?.d));  // { family_id, ledger_id }

// 验证 globalData.activeLedgerId 已同步
console.log('globalData.activeLedgerId:', getApp().globalData.activeLedgerId);
```

> **事实源**：
> - `miniprogram/services/family.ts:12` FAMILY_CONTEXT_KEY = `__costra_family_context_v1`
> - `miniprogram/services/auth.ts:239-247` doWxLogin 真实链路写 setActiveFamily + 同步 globalData.activeLedgerId
> - `miniprogram/app.ts:22` globalData.activeLedgerId 字段声明

**期望**：
- `family_context.d`: `{ family_id: "UUID", ledger_id: "UUID" }` · 两值均非空
- `globalData.activeLedgerId`: 等于 `default_ledger_id`（与 token 中的值一致）

**同时验证旧 key 已清理**：

```js
// 旧 key 应不存在（family.ts:23 setActiveFamily 自动 removeItem）
const oldKey = wx.getStorageSync('__costra_family_id_v1');
console.log('legacy family_id key:', oldKey);  // 期望: 空或 undefined
```

> **事实源**：`miniprogram/services/family.ts:14` LEGACY_FAMILY_ID_KEY = `__costra_family_id_v1` · `family.ts:23` setActiveFamily 内 removeItem(LEGACY_FAMILY_ID_KEY)

---

### §2.2 测试步骤：Token 鉴权验证

#### Step 1：在登录态下发起鉴权请求

登录成功后，home 页 onShow 会触发 sync pull（需要 family_id）。此时可手动验证：

```js
// 在真机调试 Console 中执行
const token = wx.getStorageSync('__costra_token_v1');
const accessToken = token?.d?.raw?.access_token;
console.log('Token valid:', !!accessToken);
```

#### Step 2：观察带 Authorization 的请求

后续任何请求（如 sync/pull）Network 面板应看到：
- Request Header: `Authorization: Bearer eyJ...`
- Response: 非 401（200 或业务错误码）

> **事实源**：`miniprogram/services/request.ts` 自动注入 Authorization header

---

### §2.3 测试步骤：Token 续签（可选 · 加分项）

> 此项需等 access_token 接近过期（2h TTL）或手动缩短 server 端 TTL 测试。
> Phase-3 基础验证可跳过，记录为 "未测" 状态。

**方法**（如需测试）：
1. 修改 token storage 中 `access_expires_at` 为当前时间 - 1min
2. 触发任意请求
3. 观察是否自动调用 `POST /v1/auth/refresh` 并获得新 token
4. 验证 refresh response 也含 `default_family_id` + `default_ledger_id`（authService.ts:275-276）

> **事实源**：`miniprogram/services/auth.ts:262-304` refreshToken 函数 · `server/src/services/authService.ts:268-277` refresh 也返回 default_family_id/default_ledger_id

---

### §2.4 COSTRA-154 PASS 判定

| 检查项 | PASS 条件 |
|--------|-----------|
| P1 · wx.login 获取 code | Console 出现 `[auth] wx.login ok {codeLen: 32}` |
| P2 · POST /auth/wx-login 成功 | Network 200 + response 含 access_token + default_family_id + default_ledger_id |
| P3 · Token 本地持久化 | storage `__costra_token_v1` 为合规 envelope + default_family_id/ledger_id 非空 UUID |
| P4 · family-context storage 写入 | storage `__costra_family_context_v1` 为合规 envelope + d 含 family_id + ledger_id |
| P5 · globalData 同步 | `getApp().globalData.activeLedgerId` === token 中 default_ledger_id |
| P6 · 旧 key 已清理 | storage `__costra_family_id_v1` 为空 |
| P7 · 后续请求带 Authorization | 任意业务请求 header 含 `Bearer ey...` |
| P8 · 页面正常跳转 | 登录后 home 页正常渲染 |

**8/8 全 PASS** → COSTRA-154 ✅
**任一 FAIL** → 记录故障现象，进入 §6 排查

---

## §3 COSTRA-165：family-context 4 场景实测（核心新章节）

> **前置**：确保 §2 wx.login 全链路已 PASS（有有效登录态）

### 场景 1：全新登录场景（C1）

**目标**：验证从零状态登录 → family-context 全链路写入

#### 操作

1. **清 storage**：在 Console 执行 `wx.clearStorageSync()` · 或卸载小程序重装
2. 关闭小程序 → 重新打开
3. 触发登录 → 点击"一键微信登录"
4. 等待登录完成

#### 验证

在 Console 执行：

```js
// A. Token 含 default_family_id / default_ledger_id
const t = wx.getStorageSync('__costra_token_v1');
console.log('C1-A default_family_id:', t?.d?.raw?.default_family_id);  // UUID · 非空
console.log('C1-A default_ledger_id:', t?.d?.raw?.default_ledger_id);  // UUID · 非空

// B. family-context storage 立即写入
const fc = wx.getStorageSync('__costra_family_context_v1');
console.log('C1-B family_context:', JSON.stringify(fc?.d));  // { family_id, ledger_id }

// C. globalData.activeLedgerId 同步
console.log('C1-C activeLedgerId:', getApp().globalData.activeLedgerId);  // === default_ledger_id
```

> **事实源**：
> - `miniprogram/services/auth.ts:239-247` doWxLogin 真实链路：setActiveFamily → 同步 globalData
> - `miniprogram/services/family.ts:20-24` setActiveFamily 写 FAMILY_CONTEXT_KEY + 清 LEGACY

#### PASS 判定

- `default_family_id` 非空 UUID ✓
- `default_ledger_id` 非空 UUID ✓
- `family_context.d` 含 family_id + ledger_id ✓
- `globalData.activeLedgerId` === `default_ledger_id` ✓

---

### 场景 2：旧 token 升级场景（C2 · **最关键 · COSTRA-165 P1-1 修订对应**）

**目标**：验证旧版 token（不含 default_family_id）升级后 → initAuth 自动 refresh → family-context 透明写入 · **用户不需要重新登录**

#### 准备

模拟升级前旧 token（不含 default_family_id / 无 family-context storage）：

```js
// 1. 读取当前 token
const t = wx.getStorageSync('__costra_token_v1');

// 2. 构造旧版 token（去掉 default_family_id / default_ledger_id）
const oldRaw = { ...t.d.raw };
delete oldRaw.default_family_id;
delete oldRaw.default_ledger_id;
const oldToken = { v: t.v, t: t.t, d: { ...t.d, raw: oldRaw } };

// 3. 覆盖 token storage（模拟旧版）
wx.setStorageSync('__costra_token_v1', oldToken);

// 4. 清除 family-context storage（模拟旧版没有此 key）
wx.removeStorageSync('__costra_family_context_v1');

// 5. 验证准备完成
console.log('C2-prep family_context:', wx.getStorageSync('__costra_family_context_v1'));  // 空
console.log('C2-prep token has default_family_id:', !!wx.getStorageSync('__costra_token_v1')?.d?.raw?.default_family_id);  // false
```

#### 操作

1. **关闭小程序**（真机上滑退出 / 开发者工具重编译）
2. **重新打开小程序**
3. 观察 Console · **不需要重新点击登录按钮**

#### 期望 Console

```
[Costra] onLaunch env= prod
```

**不应出现**：`[auth] initAuth fallback refresh failed`

**应该出现**（可能不显式打出，但通过后续验证确认 refresh 成功路径走了）：

> 事实源：`miniprogram/services/auth.ts:92-103` initAuth 检测到 storage 无 family-context（`getActiveFamilyId()` 返回 null）→ 自动调 `refreshToken()` → refresh response 含 default_family_id/default_ledger_id → 写入 storage + globalData · 用户不需要重新登录

#### 验证

在 Console 执行：

```js
// A. Token 已更新 · 现含 default_family_id / default_ledger_id
const t2 = wx.getStorageSync('__costra_token_v1');
console.log('C2-A default_family_id:', t2?.d?.raw?.default_family_id);  // UUID · 非空（refresh 返的）
console.log('C2-A default_ledger_id:', t2?.d?.raw?.default_ledger_id);  // UUID · 非空

// B. family-context storage 已写入
const fc2 = wx.getStorageSync('__costra_family_context_v1');
console.log('C2-B family_context:', JSON.stringify(fc2?.d));  // { family_id, ledger_id }

// C. globalData.activeLedgerId 已同步
console.log('C2-C activeLedgerId:', getApp().globalData.activeLedgerId);  // === default_ledger_id
```

> **事实源**：
> - `miniprogram/services/auth.ts:93-97` initAuth fallback：`if (!familyId) { await refreshToken(); }` · refreshToken 内部已调 setActiveFamily
> - `miniprogram/services/auth.ts:292-303` refreshToken 真实链路：if (resp.default_family_id && resp.default_ledger_id) → setActiveFamily + 同步 globalData
> - `server/src/services/authService.ts:256-277` refresh 也返回 default_family_id + default_ledger_id

#### 反向验证：refresh_token 非法 → 应清 token + family-context（不弹强制 toast）

```js
// 1. 把 refresh_token 改非法值
const t3 = wx.getStorageSync('__costra_token_v1');
const badRaw = { ...t3.d.raw, refresh_token: 'invalid-token-xxx' };
const badToken = { v: t3.v, t: t3.t, d: { ...t3.d, raw: badRaw } };
wx.setStorageSync('__costra_token_v1', badToken);

// 2. 清 family-context（模拟 initAuth 需 refresh 但 refresh 会失败）
wx.removeStorageSync('__costra_family_context_v1');

// 3. 关闭并重新打开小程序
// 4. 观察 Console
```

**期望**：
- Console 出现 `[auth] initAuth fallback refresh failed`（auth.ts:100）
- **不应出现强制错误 toast / 弹窗**（initAuth 静默清 token + 跳登录页）
- 跳转到登录页（正常 UX · 用户重新登录即可）

> **事实源**：`miniprogram/services/auth.ts:98-103` refresh 失败兜底：console.warn → clearToken + clearActiveFamily → return（不 throw · 不弹 toast）

#### PASS 判定

- 旧 token 升级后 family-context 透明写入 ✓
- 用户不需要重新登录 ✓
- `[auth] initAuth fallback refresh failed` 不出现（成功路径）✓
- refresh_token 非法时：清 token + 跳登录页（不弹 toast）✓

---

### 场景 3：logout 清理路径（C3）

**目标**：验证登出后 family-context + token + globalData 完整清理

#### 操作

1. 先完成场景 1 或场景 2（确保已登录 + family-context 已写入）
2. 在小程序中点击 **退出登录**（mine 页 → 退出按钮）

#### 验证

在 Console 执行：

```js
// A. __costra_family_context_v1 已清除
const fc3 = wx.getStorageSync('__costra_family_context_v1');
console.log('C3-A family_context after logout:', fc3);  // 期望: 空或 undefined

// B. __costra_token_v1 已清除
const t4 = wx.getStorageSync('__costra_token_v1');
console.log('C3-B token after logout:', t4);  // 期望: 空或 undefined

// C. globalData.activeLedgerId 变 undefined
console.log('C3-C activeLedgerId after logout:', getApp().globalData.activeLedgerId);  // 期望: undefined
```

> **事实源**：
> - `miniprogram/services/auth.ts:181-188` logout 顺序：先 clearActiveFamily（L182）→ 设置 globalData.activeLedgerId = undefined（L185）→ 最后 clearToken（L188）
> - `miniprogram/services/family.ts:48-51` clearActiveFamily → removeItem(FAMILY_CONTEXT_KEY) + removeItem(LEGACY_FAMILY_ID_KEY)

#### PASS 判定

- `__costra_family_context_v1` 已清除 ✓
- `__costra_token_v1` 已清除 ✓
- `globalData.activeLedgerId` === undefined ✓
- 页面跳转到登录页 ✓

---

### 场景 4：entry 页 ledger_id 实际写入（C4）

**目标**：验证记账时 entry payload 中 ledger_id 为真实 UUID（非 `'default'` 字面量 · 非 FALLBACK_LEDGER_ID）

#### 操作

1. 先完成场景 1（确保已登录 + family-context 已写入）
2. 跳到 **记一笔** 页面
3. 输入金额 `0.01`
4. 点保存

#### 验证

**Console 验证**：不应出现 `[entry] activeLedgerId missing in globalData` 警告

> **事实源**：`miniprogram/pages/entry/index.ts:61-63` if (!ledgerId) → console.warn · 正常路径不应触发

**Network 验证**：

观察 `POST https://costra.cloud/v1/sync/push` 请求：

- Request body 中 `ledger_id` 应为真实 UUID（等于 default_ledger_id）
- **不应**为 `'default'` 字面量
- **不应**为 `00000000-0000-0000-0000-000000000001`（FALLBACK_LEDGER_ID）

> **事实源**：
> - `miniprogram/pages/entry/index.ts:60` `const ledgerId = getApp().globalData.activeLedgerId`
> - `miniprogram/pages/entry/index.ts:67` `ledger_id: ledgerId || FALLBACK_LEDGER_ID`
> - `miniprogram/pages/entry/index.ts:15` FALLBACK_LEDGER_ID = `'00000000-0000-0000-0000-000000000001'`

**Server 端验证**（SSH 到服务器）：

```bash
ssh root@49.235.216.20

docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT id, ledger_id, amount, note, version FROM entries ORDER BY created_at DESC LIMIT 1"
```

> **事实源**：`infra/prod-bootstrap-compose.md` §4.4 DB 连接方式 `docker exec costra-postgres psql -U costra -d costra`（DB 名为 `costra` · 非 `costra_dev`）

**期望**：
- 有一行 `amount=1`（0.01 元 = 1 分）+ 真实 `ledger_id`（UUID 格式 · 与 default_ledger_id 一致）
- `ledger_id` 不是 FALLBACK_LEDGER_ID `00000000-0000-0000-0000-000000000001`

#### PASS 判定

- Console 无 `[entry] activeLedgerId missing` 警告 ✓
- Network push payload 中 `ledger_id` 为真实 UUID ✓
- DB 中 entry 的 `ledger_id` 为真实 UUID（与 default_ledger_id 一致）✓

---

## §4 COSTRA-150：数据同步全链路验证（更新）

### 前置：确保 §2 + §3 场景 1 已 PASS（有有效登录态 + family-context 已写入）

> **v2.0 核心变更**：v1.0 §3.1 SSH SQL 注入 family_id **完全废弃** · 删除整段。
> 无需手动建 family/ledger · COSTRA-164 server bootstrap 已在 wx.login 时为新用户透明创建（`server/src/services/authService.ts:138-210` · wxLogin 函数内单事务包住 user upsert + family/ledger bootstrap）· COSTRA-165 client 已透明接收并写入 storage/globalData。

---

### §4.1 断言 A：冷启后 sync pull 成功

#### 操作

1. 关闭小程序（真机上滑退出 / 开发者工具重编译）
2. 重新打开小程序
3. 等待 3~5 秒

#### 期望 Console

```
[Costra] onLaunch env= prod
[sync] ok · pushed=0 conflicts=0 rejected=0 failed=0 pulled=N watermark=N (trigger=launch)
```

**或者**（如 bootstrap > 500ms）：
```
[sync] skip · not logged in (trigger=launch)
... (几秒后 page-show 触发)
[sync] ok · pushed=0 ... pulled=N watermark=N (trigger=page-show)
```

#### 期望 Network

| 请求 | 期望 |
|------|------|
| `GET https://costra.cloud/v1/sync/pull?family_id=<fid>&since=0&limit=200` | 200 |
| Response | `{"watermark":<integer>,"has_more":false,"changes":{...}}` |

> **事实源**：family_id 来源从 storage `__costra_family_context_v1` 自动获取（`miniprogram/services/family.ts:32-35` getActiveFamilyId）· 不再需要手动注入

#### PASS 判定

- Console 出现 `[sync] ok` 日志（trigger 为 launch 或 page-show）
- Network pull 请求 200
- watermark 为整数（v1.2 协议）

---

### §4.2 断言 B：记一笔 → push 上行成功

#### 操作

1. 在 home 页点击 **"+"** 记一笔
2. 输入金额：`88.88`
3. 选择分类（任意）
4. 填写备注：`Phase3真机测试`
5. 点击保存

#### 期望 Console

```
[sync] ok · pushed=1 conflicts=0 rejected=0 failed=0 pulled=0 watermark=N (trigger=...)
```

#### 期望 Network

| 请求 | 期望 |
|------|------|
| `POST https://costra.cloud/v1/sync/push` | 200 |
| Request headers | `Authorization: Bearer ey...` + `Idempotency-Key: <uuid>` |
| Request body | `{"ops":[{"op":"create","entity":"entry",...,"payload":{"ledger_id":"<真实UUID>","amount":8888,...}}]}` |
| Response body | `{"results":[{"status":"ok","server_id":"...","server_version":1}]}` |

> **事实源**：push payload 中 `ledger_id` 应为真实 UUID（来自 globalData.activeLedgerId · 由 auth.ts:246 设置）· 非 `'default'` 字面量 · 非 FALLBACK

#### 验证 DB 持久化（SSH 到服务器）

```bash
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT id, ledger_id, amount, note, version, change_seq FROM entries ORDER BY created_at DESC LIMIT 3"
```

> **事实源**：`infra/prod-bootstrap-compose.md` §4.4 DB 连接方式

**期望**：有一行 `amount=8888, note='Phase3真机测试', version=1` + `ledger_id` 为真实 UUID

#### PASS 判定

- Network POST /sync/push 返回 200
- results[0].status = "ok"
- DB 中有对应 entry 记录 + ledger_id 为真实 UUID

---

### §4.3 断言 C：watermark 持久化 + 增量 pull

#### 操作

1. 确认断言 B 已 PASS
2. 关闭小程序（真机上滑退出）
3. 重新打开小程序
4. 等待 sync 触发

#### 期望 Network

```
GET https://costra.cloud/v1/sync/pull?family_id=<fid>&since=<非零整数>&limit=200
```

**关键**：`since` 参数 ≠ 0（说明 watermark 已持久化，走增量拉取）

#### 验证 watermark storage

```js
// 在 Console 执行（替换 family_id）
const wm = wx.getStorageSync('watermark:<your-family-id>');
console.log('watermark envelope:', wm);
console.log('watermark value:', wm?.d);
console.log('is number:', typeof wm?.d === 'number');
```

> **事实源**：`miniprogram/services/db.ts` watermark key 格式 `watermark:<family_id>`

#### PASS 判定

- since 参数为非零正整数
- pulled = 0
- watermark storage 值为 number 类型

---

### §4.4 断言 D：离线记账 → 恢复网络 → 自动 push

#### 操作

1. 手机开启**飞行模式**（或关闭 WiFi + 移动数据）
2. 在小程序中记一笔：金额 `6.66`，备注 `离线测试`
3. 观察 Console：应有本地保存成功提示
4. **恢复网络**（关闭飞行模式 / 开 WiFi）
5. 等待 5~10 秒

#### 期望 Console

```
[sync] network recover · trigger sync
[sync] ok · pushed=1 conflicts=0 rejected=0 failed=0 pulled=0 watermark=N (trigger=network-recover)
```

> **事实源**：`miniprogram/services/syncScheduler.ts` `wx.onNetworkStatusChange` → 恢复后触发 syncOnce

#### 验证 DB（SSH）

```bash
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT id, ledger_id, amount, note, version FROM entries WHERE note = '离线测试'"
```

**期望**：有一行 `amount=666, note='离线测试', version=1` + ledger_id 为真实 UUID

#### PASS 判定

- Console 出现 `trigger=network-recover` + pushed=1
- DB 中有离线记录
- 无 `[sync] fail` 错误

---

### §4.5 断言 E：5 分钟稳定性观察

#### 操作

1. 保持小程序前台运行
2. 正常操作：切换 home/mine 页面、查看记录
3. 观察 Console 5 分钟

#### 期望

- ✅ 可出现 `[sync] ok ... (trigger=periodic)` 或 `(trigger=page-show)`
- ✅ 可出现 `[sync] skip page-show · debounced`
- ❌ 不应出现 `[sync] fail` 日志
- ❌ 不应出现 401 错误（token 在 2h 有效期内）

#### PASS 判定

- 5 分钟内无 `[sync] fail` 日志
- 无 401/403 错误
- sync 调度器正常工作（有 ok 或 skip 日志）

---

## §5 PASS 判定（双卡联合）

### 综合判定表

```
## Phase-3 双卡联合 Prod 真机验证结果

日期：2026-05-__
实测者：__
环境：prod (https://costra.cloud) · 真机调试

### COSTRA-154 wx.login 全链路

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| P1 | wx.login 获取 code（len=32） | PASS / FAIL | |
| P2 | POST /auth/wx-login → 200 + default_family_id/ledger_id | PASS / FAIL | |
| P3 | Token envelope 持久化 + family IDs | PASS / FAIL | |
| P4 | family-context storage 写入 | PASS / FAIL | |
| P5 | globalData.activeLedgerId 同步 | PASS / FAIL | |
| P6 | 旧 family_id key 已清理 | PASS / FAIL | |
| P7 | 后续请求带 Authorization | PASS / FAIL | |
| P8 | 登录后 home 页正常渲染 | PASS / FAIL | |

### COSTRA-165 family-context 4 场景

| # | 场景 | 结果 | 证据 |
|---|------|------|------|
| C1 | 全新登录 → family-context 全写入 | PASS / FAIL | |
| C2 | 旧 token 升级 → refresh 透明写入 | PASS / FAIL | |
| C3 | logout → family-context + token 全清除 | PASS / FAIL | |
| C4 | entry 记账 → ledger_id 为真实 UUID | PASS / FAIL | |

### COSTRA-150 数据同步

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| S1 | 冷启 sync pull 成功（200） | PASS / FAIL | |
| S2 | 记一笔 → push 上行 → DB 有记录 + ledger_id 正确 | PASS / FAIL | |
| S3 | watermark 持久化 · since≠0 | PASS / FAIL | |
| S4 | 离线 → 恢复 → network-recover push | PASS / FAIL | |
| S5 | 5 分钟无 [sync] fail | PASS / FAIL | |

### 整体结论

- ✅ P1~P8 + C1~C4 + S1~S5 全 PASS → Phase-3 双卡联合通过 → §7 双卡 approve
- ❌ 任一 FAIL → 见 §6 排查 → 修复后重测
```

---

## §6 排查指南（更新 · 含 family-context 排查）

### Q1：POST /auth/wx-login 返回 500 `WX_CODE_INVALID`

**含义**：微信 code 无效（错误码 40029 或 40163）

**排查**：
1. code 是否在 5 分钟内使用？（微信 code 有效期 5min）
2. code 是否被重复使用？（每个 code 只能用一次）
3. 检查 server 日志：
   ```bash
   docker logs costra-server --tail 50 | grep -i "code2Session\|WX_CODE"
   ```
4. 确认 AppID + AppSecret 匹配：
   ```bash
   docker exec costra-server printenv WX_APP_ID
   # 期望：wxf8b0d3e3a83f9941
   docker exec costra-server printenv WX_APP_SECRET
   # 期望：非空（不应为空字符串）
   ```

> **事实源**：`server/src/wx/code2Session.ts` 错误码映射 40029/40163 → `WX_CODE_INVALID`

### Q2：POST /auth/wx-login 返回 500 `UNAVAILABLE`

**含义**：server → 微信 API 网络不通

**排查**：
```bash
# SSH 到服务器测试微信 API 连通性
docker exec costra-server wget -qO- 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=wxf8b0d3e3a83f9941&secret=test' || echo "NETWORK FAIL"
```

如果返回 `NETWORK FAIL`：检查服务器出口防火墙 / DNS 配置。

### Q3：请求被微信 block（真机无 Network 记录）

**含义**：`costra.cloud` 未在微信后台配为合法请求域名

**排查**：
1. 登录微信公众平台 → 开发设置 → 服务器域名
2. 确认 `request 合法域名` 包含 `https://costra.cloud`
3. 修改后需等待 ~5 分钟生效 + 重启小程序

### Q4：storage `__costra_family_context_v1` 为空

**含义**：family-context 未写入 · 可能 server 未返回字段 或 client 写入失败

**排查**：

```js
// Console 执行
const t = wx.getStorageSync('__costra_token_v1');
console.log('token default_family_id:', t?.d?.raw?.default_family_id);
console.log('token default_ledger_id:', t?.d?.raw?.default_ledger_id);
```

- 如果 token 中 `default_family_id` 也为空 → **server 端问题**
  ```bash
  # 检查 server 日志
  docker logs costra-server --tail 100 | grep -i "family\|bootstrap\|ledger"
  ```
  检查 authService.ts:148-196 wxLogin bootstrap 路径是否正常执行

- 如果 token 中 `default_family_id` 有值但 family-context storage 为空 → **client 端问题**
  检查 auth.ts:239-247 doWxLogin 是否调了 setActiveFamily

> **事实源**：`miniprogram/services/auth.ts:239-242` doWxLogin 真实链路 setActiveFamily 调用 · `server/src/services/authService.ts:148-196` bootstrap 逻辑

### Q5：globalData.activeLedgerId 为 undefined

**含义**：auth.ts 中 doWxLogin/refreshToken 未同步 globalData

**排查**：

```js
// Console 执行
const fc = wx.getStorageSync('__costra_family_context_v1');
console.log('family_context:', JSON.stringify(fc?.d));
console.log('activeLedgerId:', getApp().globalData.activeLedgerId);
```

- 如果 family-context storage 有值但 globalData 为 undefined → 检查 auth.ts:244-247 doWxLogin 是否执行了 `app.globalData.activeLedgerId = resp.default_ledger_id`
- 如果 family-context storage 也为空 → 先按 Q4 排查

> **事实源**：`miniprogram/services/auth.ts:244-247` doWxLogin 同步 globalData · `miniprogram/services/auth.ts:106-111` initAuth 正常路径也同步 globalData

### Q6：旧 token 升级场景没走 refresh

**含义**：initAuth fallback 路径未触发

**排查**：
1. 检查 initAuth 是否正常执行：Console 有无 `[Costra] bootstrap failed`
2. 检查 storage 中 `__costra_family_context_v1` 是否真的为空（initAuth 条件 `!familyId`）
3. 检查 refresh_token 是否有效（过期则 refresh 失败 → clearToken → 跳登录页）

> **事实源**：`miniprogram/services/auth.ts:92-103` initAuth fallback 路径

### Q7：`[sync] skip · no active family`

**含义**：`getActiveFamilyId()` 返回 null · 但 COSTRA-165 实装后不应出现

**排查**：
```js
// Console 执行
const fc = wx.getStorageSync('__costra_family_context_v1');
console.log('raw storage:', fc);
console.log('d value:', fc?.d);
```

- 如果 `fc` 为空 → family-context 未写入（回 Q4 排查）
- 如果 `fc` 是裸字符串 → envelope 格式错误（必须是 `{v:1,t:...,d:{family_id:...,ledger_id:...}}`）
- 如果 `fc.d` 有值但仍 skip → 检查 `getItem` 是否正常解析（storage.ts TTL 是否过期）

> **事实源**：`miniprogram/services/family.ts:32-35` getActiveFamilyId 读 FAMILY_CONTEXT_KEY · `miniprogram/services/storage.ts:58-76` getItem 解析 envelope

### Q8：HTTPS 证书错误

**排查**：
```bash
# 在服务器上
certbot certificates
# 看到 costra.cloud 证书信息

# 如果过期
certbot renew
docker exec costra-nginx nginx -s reload
```

### Q9：登录成功但 home 页白屏

**可能原因**：
1. JS 运行时错误 → 查 Console 红色报错
2. 接口 404 → 检查 API 路由是否都注册了
3. 网络超时 → 检查服务器响应时间

### Q10：`wx.onNetworkStatusChange` 不触发（断言 D 失败）

**已知限制**：
- 微信开发者工具的 Network 面板 Offline 按钮**不会**触发此回调
- 必须用**真机飞行模式** / **真实断网**
- 在真机调试模式下，飞行模式切换应能正常触发

### Q11：watermark 为 ISO 字符串而非整数

**含义**：server 可能未部署 v1.2 升级（0006_entries_change_seq.sql）

**排查**：
```bash
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'entries' AND column_name = 'change_seq'"
```

- 如果无 `change_seq` 列 → migration 0006 未执行
- 解决：重新跑 migration

### Q12：entry 的 ledger_id 为 FALLBACK_LEDGER_ID

**含义**：globalData.activeLedgerId 为 undefined · entry 页走了 fallback

**排查**：
1. 回 Q5 排查 globalData.activeLedgerId 为 undefined 原因
2. 检查 auth 链路是否完整（doWxLogin 是否调了 setActiveFamily + 同步 globalData）

> **事实源**：`miniprogram/pages/entry/index.ts:60-67` `ledgerId = getApp().globalData.activeLedgerId` · `ledger_id: ledgerId || FALLBACK_LEDGER_ID`

---

## §7 联动 D-024 §2.2 C1 双卡 approve 流程

### 前置

- §2 P1~P8 全 PASS（COSTRA-154 wx.login 全链路）
- §3 C1~C4 全 PASS（COSTRA-165 family-context 4 场景）
- §4 S1~S5 全 PASS（COSTRA-150 数据同步）

### 双卡联合 approve 操作

4 场景 + §2/§4 全 PASS → Human 同时发：

```
approve:COSTRA-164
approve:COSTRA-165
```

### FU-150-FAMILY-CONTEXT-SERVICE 真 closed 条件

双卡 joint approve 后 → FU-150-FAMILY-CONTEXT-SERVICE 真 closed @ 双卡 joint approve

> **D-024 §2.2 C1**：联合 staging/prod 实测前置不可省 · Human approve 后 FU-150-FAMILY-CONTEXT-SERVICE 真 closed

---

## §8 操作 Checklist（快速参考）

```
□ §1.1 服务端 4 容器运行 + healthz ok + WX_MOCK_LOGIN=0
□ §1.2 微信后台 request 域名含 https://costra.cloud
□ §1.3 env.ts CURRENT_ENV = 'prod'
□ §1.4 真机调试连接成功
□ §2.1 首次登录 → code → token → home 页
□ §2.1 Step5 default_family_id/ledger_id 非空 UUID
□ §2.1 Step5 family-context storage 已写入
□ §2.1 Step5 globalData.activeLedgerId 同步
□ §2.1 Step5 旧 family_id key 已清理
□ §2.2 后续请求带 Authorization
□ §3-C1 全新登录 → family-context 全写入
□ §3-C2 旧 token 升级 → refresh 透明写入（不重新登录）
□ §3-C2 反向：refresh 失败 → 清 token + 跳登录页（不弹 toast）
□ §3-C3 logout → family-context + token + globalData 全清
□ §3-C4 entry 记账 → ledger_id 为真实 UUID（非 FALLBACK）
□ §4.1 冷启 sync pull 成功
□ §4.2 记一笔 → push 成功 → DB 有记录 + ledger_id 正确
□ §4.3 watermark 持久化 · since≠0
□ §4.4 飞行模式 → 记账 → 恢复 → network-recover push
□ §4.5 5 分钟稳定运行无 fail
□ §7 双卡 joint approve
```

---

## §9 收尾

### Phase-3 PASS 后

1. **恢复 `CURRENT_ENV`**（如不希望后续开发走 prod）：
   ```diff
   - const CURRENT_ENV: EnvName = 'prod';
   + const CURRENT_ENV: EnvName = 'dev';
   ```
   > 事实源：`miniprogram/services/env.ts:50`

2. **记录测试结果**到 `qa/results/` 目录

3. **下一步**：准备微信小程序提审材料
   - 隐私协议
   - 用户授权说明
   - 功能截图

### Phase-3 FAIL 后

1. 将故障现象（Console 截图 + Network 截图 + 服务器日志）记录到 `qa/defects/`
2. 判定修复方案：
   - 配置问题（域名/证书/环境变量）→ 修复后重测
   - 代码 BUG → 立卡修复 → 重新部署 → 重测
3. 修复后从 §1.1 重新开始验证

---

## §10 事实源索引

| 引用 | 文件路径 | 关键行/说明 |
|------|---------|------------|
| TOKEN_KEY | miniprogram/services/auth.ts | L13 `__costra_token_v1` |
| TokenRaw default_family_id | miniprogram/services/auth.ts | L40-41 |
| doWxLogin setActiveFamily | miniprogram/services/auth.ts | L239-247 |
| doWxLogin globalData sync | miniprogram/services/auth.ts | L244-247 |
| initAuth fallback refresh | miniprogram/services/auth.ts | L92-103 |
| logout clearActiveFamily 顺序 | miniprogram/services/auth.ts | L181-188 |
| refreshToken family-context | miniprogram/services/auth.ts | L292-303 |
| refreshToken 空字符串保护 | miniprogram/services/auth.ts | L294 |
| mockExchange family IDs | miniprogram/services/auth.ts | L344-345 |
| FAMILY_CONTEXT_KEY | miniprogram/services/family.ts | L12 `__costra_family_context_v1` |
| LEGACY_FAMILY_ID_KEY | miniprogram/services/family.ts | L14 `__costra_family_id_v1` |
| setActiveFamily 清旧 key | miniprogram/services/family.ts | L23 |
| clearActiveFamily | miniprogram/services/family.ts | L48-51 |
| getActiveFamilyId | miniprogram/services/family.ts | L32-35 |
| CURRENT_ENV | miniprogram/services/env.ts | L50 |
| prod apiBaseUrl | miniprogram/services/env.ts | L39 `https://costra.cloud/v1` |
| globalData.activeLedgerId | miniprogram/app.ts | L22 |
| onLaunch bootstrap | miniprogram/app.ts | L49-67 |
| FALLBACK_LEDGER_ID | miniprogram/pages/entry/index.ts | L15 |
| entry ledgerId 来源 | miniprogram/pages/entry/index.ts | L60-67 |
| Storage envelope | miniprogram/services/storage.ts | L10, L13-18 |
| AuthTokenPair server | server/src/services/authService.ts | L39-59 |
| wxLogin bootstrap | server/src/services/authService.ts | L138-210 |
| refresh default IDs | server/src/services/authService.ts | L256-277 |
| auth routes | server/src/routes/auth.ts | L56 `/auth/wx-login`, L68 `/auth/refresh` |
| OpenAPI AuthTokenPair | server/api/openapi.yaml | L865-897 |
| request auto auth | miniprogram/services/request.ts | L7 Token 注入 |
| syncScheduler | miniprogram/services/syncScheduler.ts | network-recover 触发 |
| prod docker compose | infra/docker-compose.prod.yml | 4 容器架构 |
| 部署手册 | infra/prod-bootstrap-compose.md | v1.6 · healthz 路径 / DB 名 / docker exec 命令 |
