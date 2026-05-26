# Phase-3 真机 Prod 验证手册 · COSTRA-154 + COSTRA-150

> **任务**：Phase-2 部署闸门 5/5 PASS 后，验证真机→prod 后端全链路  
> **卡号**：COSTRA-154（wx.login 全链路）· COSTRA-150（数据同步）  
> **目标环境**：`https://costra.cloud`（49.235.216.20）  
> **关键差异**：无 mock · `WX_MOCK_LOGIN=0` · 真实微信 code → 微信上游 code2Session → 真 openid  
> **实测者**：Human  
> **预计时间**：~30 分钟  
> **版本**：v1.0 · 2026-05-26

---

## §0 Phase-3 与 staging 联合实测的关键区别

| 维度 | staging 联合实测（已有手册） | Phase-3 prod 真机验证（本手册） |
|------|--------------------------|-------------------------------|
| 后端地址 | `http://localhost:8080/v1` | `https://costra.cloud/v1` |
| 微信登录 | server `WX_MOCK_LOGIN=1` mock | server `WX_MOCK_LOGIN=0` 真实 |
| code2Session | 返回 mock-openid-xxx | 真调微信上游，返回真 openid |
| 小程序运行环境 | 开发者工具模拟器 | **真机预览/真机调试** |
| `CURRENT_ENV` | `'dev'` | `'prod'`（需构建前修改） |
| HTTPS | 不校验 | 必须有效证书（Let's Encrypt） |
| 请求域名校验 | 关闭 | **开启**（微信后台需配置） |

---

## §1 前置条件检查

### §1.1 服务端确认（已在 Phase-2 完成）

以下由 Phase-2 deploy-all.sh + 09-verify-gates.sh 保证，仅需快速复验：

```bash
# SSH 登录服务器
ssh root@49.235.216.20

# 1. 容器全部运行
docker ps --format '{{.Names}} {{.Status}}' | grep -E 'costra-(server|nginx|postgres|redis)'
# 期望：4 个容器 Up

# 2. healthz 探活
curl -s https://costra.cloud/healthz | jq .status
# 期望："ok"

# 3. WX_MOCK_LOGIN 确认为 0
docker exec costra-server printenv WX_MOCK_LOGIN
# 期望：0（或空值 = 默认关闭）

# 4. NODE_ENV 确认为 production
docker exec costra-server printenv NODE_ENV
# 期望：production

# 5. 证书有效期
echo | openssl s_client -connect costra.cloud:443 -servername costra.cloud 2>/dev/null | openssl x509 -noout -dates
# 期望：notAfter 在当前日期之后
```

**如果任一步失败**：回到 Phase-2 闸门排查，不进入后续步骤。

### §1.2 微信后台配置确认

登录 [微信公众平台](https://mp.weixin.qq.com)（AppID: `wxf8b0d3e3a83f9941`）：

1. **开发管理 → 开发设置 → 服务器域名**：
   - `request 合法域名`：必须包含 `https://costra.cloud`
   - 如未配置 → 点"修改"添加（需管理员扫码确认，每月限 5 次）

2. **开发管理 → 开发设置 → 服务器域名**：
   - 确认无 `http://localhost` 相关域名残留（prod 不需要）

> **事实源**：微信小程序在真机运行时强制校验请求域名白名单；不在白名单内的请求直接被 block（不经过网络）

### §1.3 小程序环境切换

#### §1.3.1 修改 `CURRENT_ENV` 为 `'prod'`

```bash
cd /Users/weizhao/Desktop/Costra/miniprogram/services
```

编辑 `env.ts` 第 50 行：

```diff
- const CURRENT_ENV: EnvName = 'dev';
+ const CURRENT_ENV: EnvName = 'prod';
```

> **事实源**：`miniprogram/services/env.ts:50`  
> 切换后 `getEnv().apiBaseUrl` → `https://costra.cloud/v1`，`mockLogin` → `false`

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

## §2 COSTRA-154：wx.login 全链路验证

### 测试目标

验证：真机 `wx.login()` → `POST /v1/auth/wx-login {code}` → prod server 调微信上游 code2Session → 返回真 JWT → 小程序存储 token → 后续请求鉴权通过。

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
[auth] login success {userId: "0197xxxx-...", nickname: "微信用户"}
```

> **事实源**：
> - `miniprogram/services/auth.ts:163` → `[auth] wx.login ok`
> - `miniprogram/services/auth.ts:178-180` → login success（POST 成功后）
> - code 长度 = 32 是微信标准（真机 + 开发者工具均如此）

#### Step 3：观察 Network

| 请求 | 期望 |
|------|------|
| `POST https://costra.cloud/v1/auth/wx-login` | Status 200 |
| Response body | `{"access_token":"ey...","refresh_token":"ey...","access_token_ttl_sec":7200,"refresh_token_ttl_sec":2592000,"user":{...}}` |

**FAIL 场景**：

| 响应码 | 含义 | 排查 |
|--------|------|------|
| 502/504 | nginx 转发失败 | server 容器是否运行 |
| 500 `WX_CODE_INVALID` | 微信 code 无效 | code 是否过期（5min 有效）/ AppSecret 是否正确 |
| 500 `UNAVAILABLE` | 微信上游不可用 | 服务器网络 → 微信 API 是否通 |

#### Step 4：验证页面跳转

- 登录成功后自动跳转到 **home 页**
- home 页应正常渲染（无白屏/错误提示）

#### Step 5：验证 Token 持久化

在调试 Console 执行：

```js
const t = wx.getStorageSync('__costra_token_v1');
console.log('envelope:', JSON.stringify(Object.keys(t)));
console.log('user.id:', t?.d?.raw?.user?.id);
console.log('access_token prefix:', t?.d?.raw?.access_token?.substring(0, 20));
```

**期望**：
- `envelope: ["v","t","d"]`
- `user.id`: UUID v7 格式
- `access_token prefix`: `eyJ...`（JWT 格式）

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

---

### §2.4 COSTRA-154 PASS 判定

| 检查项 | PASS 条件 |
|--------|-----------|
| P1 · wx.login 获取 code | Console 出现 `[auth] wx.login ok {codeLen: 32}` |
| P2 · POST /auth/wx-login 成功 | Network 200 + response 含 access_token |
| P3 · Token 本地持久化 | storage `__costra_token_v1` 为合规 envelope |
| P4 · 后续请求带 Authorization | 任意业务请求 header 含 `Bearer ey...` |
| P5 · 页面正常跳转 | 登录后 home 页正常渲染 |

**5/5 全 PASS** → COSTRA-154 ✅  
**任一 FAIL** → 记录故障现象，进入 §5 排查

---

## §3 COSTRA-150：数据同步全链路验证

### 前置：确保 COSTRA-154 已 PASS（有有效登录态）

---

### §3.1 数据准备：服务端建 family + ledger

> 真机 prod 环境无法用 seed 脚本（脚本连本地 DB）。需要通过以下方式之一准备数据：

#### 方案 A：SSH 到服务器执行 SQL（推荐）

```bash
ssh root@49.235.216.20

# 1. 获取刚登录的 user_id
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT id, wx_openid, nickname FROM users ORDER BY created_at DESC LIMIT 3"
# 找到你的真实 openid 对应的 user（不是 mock-openid-xxx）
# 记录 USER_ID

# 2. 创建 family + ledger + member（如尚未存在）
# ⚠️ 注意：必须用 `cat <<'SQL' | docker exec -i` 方式（不能用 docker exec ... <<'SQL'，heredoc 不会被正确传入容器）
cat <<'SQL' | docker exec -i costra-postgres psql -U costra -d costra
DO $$
DECLARE
  uid UUID := '019e6395-9baf-7fa3-8660-62252088d64c';
  fid UUID;
  lid UUID;
BEGIN
  -- 创建 family
  INSERT INTO families (id, name, owner_id, created_at, updated_at)
  VALUES (gen_random_uuid(), '我的家庭', uid, now(), now())
  RETURNING id INTO fid;

  -- 如果已存在，取现有的
  IF fid IS NULL THEN
    SELECT id INTO fid FROM families WHERE owner_id = uid LIMIT 1;
  END IF;

  -- 创建 ledger
  INSERT INTO ledgers (id, family_id, name, currency, created_at, updated_at)
  VALUES (gen_random_uuid(), fid, '日常账本', 'CNY', now(), now())
  RETURNING id INTO lid;

  IF lid IS NULL THEN
    SELECT id INTO lid FROM ledgers WHERE family_id = fid LIMIT 1;
  END IF;

  -- 加入 family_members
  INSERT INTO family_members (family_id, user_id, role, joined_at)
  VALUES (fid, uid, 'owner', now())
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'family_id=%, ledger_id=%, user_id=%', fid, lid, uid;
END $$;
SQL
```

> **⚠️ 常见坑**：`docker exec container psql <<'SQL'` 不生效（heredoc 不会通过 stdin 传入容器）。  
> 正确方式是 `cat <<'SQL' | docker exec -i container psql`（管道 + `-i` 参数保持 stdin 打开）。

记录输出的 `family_id` 和 `ledger_id`。

#### 方案 B：通过小程序 UI 触发（如业务流程已实现家庭创建）

如果小程序已有创建家庭/账本的入口，直接在真机上操作即可。

---

### §3.2 注入 family_id 到小程序 storage

在真机调试 Console 执行：

```js
// 替换为 §3.1 中获取的 family_id
const FAMILY_ID = 'c8da95ab-f645-49c6-8341-e31b14d6c94b';
wx.setStorageSync('__costra_family_id_v1', {
  v: 1,
  t: Date.now(),
  d: FAMILY_ID
});
// 验证
console.log('family_id set:', wx.getStorageSync('__costra_family_id_v1'));
```

> **事实源**：`miniprogram/services/storage.ts:10,48-56` envelope 格式 `{v:1, t:timestamp, d:data}`

---

### §3.3 断言 A：冷启后 sync pull 成功

#### 操作

1. 关闭小程序（真机上滑退出 / 开发者工具重编译）
2. 重新打开小程序
3. 等待 3~5 秒

#### 期望 Console

```
[Costra] onLaunch env= prod
[auth] initAuth · restored session
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

#### PASS 判定

- Console 出现 `[sync] ok` 日志（trigger 为 launch 或 page-show）
- Network pull 请求 200
- watermark 为整数（v1.2 协议）

---

### §3.4 断言 B：记一笔 → push 上行成功

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
| Request body | `{"ops":[{"op":"create","entity":"entry",...,"payload":{"amount":8888,...}}]}` |
| Response body | `{"results":[{"status":"ok","server_id":"...","server_version":1}]}` |

#### 验证 DB 持久化（SSH 到服务器）

```bash
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT id, amount, note, version, change_seq FROM entries ORDER BY created_at DESC LIMIT 3"
```

**期望**：有一行 `amount=8888, note='Phase3真机测试', version=1`

#### PASS 判定

- Network POST /sync/push 返回 200
- results[0].status = "ok"
- DB 中有对应 entry 记录

---

### §3.5 断言 C：watermark 持久化 + 增量 pull

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

#### 期望 Console

```
[sync] ok · pushed=0 ... pulled=0 watermark=N (trigger=launch|page-show)
```

`pulled=0` 说明无新增数据（上次 push 的 entry 已在本地）

#### 验证 watermark storage

```js
// 在 Console 执行（替换 family_id）
const wm = wx.getStorageSync('watermark:<your-family-id>');
console.log('watermark envelope:', wm);
console.log('watermark value:', wm?.d);
console.log('is number:', typeof wm?.d === 'number');
```

#### PASS 判定

- since 参数为非零正整数
- pulled = 0
- watermark storage 值为 number 类型

---

### §3.6 断言 D：离线记账 → 恢复网络 → 自动 push

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

> **事实源**：`miniprogram/services/syncScheduler.ts:120-125` `wx.onNetworkStatusChange` → 恢复后触发 syncOnce

#### 期望 Network

恢复网络后：
1. `POST https://costra.cloud/v1/sync/push` → 200（push 离线 entry）
2. `GET https://costra.cloud/v1/sync/pull?...` → 200（pull 确认）

#### 验证 DB（SSH）

```bash
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT id, amount, note, version FROM entries WHERE note = '离线测试'"
```

**期望**：有一行 `amount=666, note='离线测试', version=1`

#### PASS 判定

- Console 出现 `trigger=network-recover` + pushed=1
- DB 中有离线记录
- 无 `[sync] fail` 错误

---

### §3.7 断言 E：5 分钟稳定性观察

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

## §4 综合 PASS 判定表

```
## Phase-3 Prod 真机验证结果

日期：2026-05-__
实测者：__
环境：prod (https://costra.cloud) · 真机调试

### COSTRA-154 wx.login 全链路

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| P1 | wx.login 获取 code（len=32） | PASS / FAIL | |
| P2 | POST /auth/wx-login → 200 | PASS / FAIL | |
| P3 | Token envelope 持久化 | PASS / FAIL | |
| P4 | 后续请求带 Authorization | PASS / FAIL | |
| P5 | 登录后 home 页正常渲染 | PASS / FAIL | |

### COSTRA-150 数据同步

| # | 检查项 | 结果 | 证据 |
|---|--------|------|------|
| S1 | 冷启 sync pull 成功（200） | PASS / FAIL | |
| S2 | 记一笔 → push 上行 → DB 有记录 | PASS / FAIL | |
| S3 | watermark 持久化 · since≠0 | PASS / FAIL | |
| S4 | 离线 → 恢复 → network-recover push | PASS / FAIL | |
| S5 | 5 分钟无 [sync] fail | PASS / FAIL | |

### 整体结论

- ✅ P1~P5 + S1~S5 全 PASS → Phase-3 通过 → 可提审
- ❌ 任一 FAIL → 见 §5 排查 → 修复后重测
```

---

## §5 故障排查

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

### Q4：`[sync] skip · no active family`

**含义**：`getActiveFamilyId()` 返回 null

**排查**：
```js
// Console 执行
const f = wx.getStorageSync('__costra_family_id_v1');
console.log('raw storage:', f);
console.log('d value:', f?.d);
```

- 如果 `f` 为空 → 未执行 §3.2 注入
- 如果 `f` 是裸字符串 → envelope 格式错误（必须是 `{v:1,t:...,d:"uuid"}`）
- 如果 `f.d` 有值但仍 skip → 检查 `getItem` 是否正常解析（storage.ts TTL 是否过期）

### Q5：POST /sync/push 返回 403

**含义**：user 不在 family_members 中

**排查**：
```bash
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT * FROM family_members WHERE family_id = '<family_id>'"
```

- 如无记录 → §3.1 SQL 未执行成功
- 如 user_id 不匹配 → 重新查 users 表确认当前登录用户 ID

### Q6：HTTPS 证书错误

**排查**：
```bash
# 在服务器上
certbot certificates
# 看到 costra.cloud 证书信息

# 如果过期
certbot renew
docker exec costra-nginx nginx -s reload
```

### Q7：登录成功但 home 页白屏

**可能原因**：
1. JS 运行时错误 → 查 Console 红色报错
2. 接口 404 → 检查 API 路由是否都注册了
3. 网络超时 → 检查服务器响应时间

### Q8：`wx.onNetworkStatusChange` 不触发（断言 D 失败）

**已知限制**：
- 微信开发者工具的 Network 面板 Offline 按钮**不会**触发此回调
- 必须用**真机飞行模式** / **真实断网**
- 在真机调试模式下，飞行模式切换应能正常触发

### Q9：watermark 为 ISO 字符串而非整数

**含义**：server 可能未部署 v1.2 升级（0006_entries_change_seq.sql）

**排查**：
```bash
docker exec costra-postgres psql -U costra -d costra \
  -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'entries' AND column_name = 'change_seq'"
```

- 如果无 `change_seq` 列 → migration 0006 未执行
- 解决：重新跑 migration

### Q10：push 后 DB 无记录但返回 200 ok

**排查**：
1. 检查 response 中 `results[0].server_id` 是否有值
2. 用该 server_id 查 entries 表
3. 可能 ledger_id 不对应 → 检查 push payload 中的 ledger_id 是否在 ledgers 表中存在

---

## §6 收尾

### Phase-3 PASS 后

1. **恢复 `CURRENT_ENV`**（如不希望后续开发走 prod）：
   ```diff
   - const CURRENT_ENV: EnvName = 'prod';
   + const CURRENT_ENV: EnvName = 'dev';
   ```

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

## §7 操作 Checklist（快速参考）

```
□ §1.1 服务端 4 容器运行 + healthz ok + WX_MOCK_LOGIN=0
□ §1.2 微信后台 request 域名含 https://costra.cloud
□ §1.3 env.ts CURRENT_ENV = 'prod'
□ §1.4 真机调试连接成功
□ §2.1 首次登录 → code → token → home 页
□ §2.2 后续请求带 Authorization
□ §3.1 服务端有 family + ledger + member 数据
□ §3.2 family_id 注入 storage（envelope 格式）
□ §3.3 冷启 sync pull 成功
□ §3.4 记一笔 → push 成功 → DB 有记录
□ §3.5 watermark 持久化 · since≠0
□ §3.6 飞行模式 → 记账 → 恢复 → network-recover push
□ §3.7 5 分钟稳定运行无 fail
```

---

## §8 事实源索引

| 引用 | 文件路径 | 关键行/说明 |
|------|---------|------------|
| CURRENT_ENV 切换 | miniprogram/services/env.ts | L50 |
| apiBaseUrl prod | miniprogram/services/env.ts | L39 `https://costra.cloud/v1` |
| wx.login 日志 | miniprogram/services/auth.ts | L163 |
| Token 结构 | miniprogram/services/auth.ts | L10-20 TokenRaw/TokenStored |
| Storage envelope | miniprogram/services/storage.ts | L10, L48-56 |
| syncScheduler 日志模板 | miniprogram/services/syncScheduler.ts | L57, L65, L72, L83-85, L94, L117, L122, L147 |
| network-recover 触发 | miniprogram/services/syncScheduler.ts | L120-125 |
| watermark key | miniprogram/services/db.ts | L86-88 `watermark:<family_id>` |
| code2Session 错误码 | server/src/wx/code2Session.ts | 40029/40163 映射 |
| JWT 配置 | server/src/config/env.ts | JWT_SECRET/ISSUER/AUDIENCE |
| sync push 路由 | server/src/routes/sync.ts | L85-114 |
| sync pull 路由 | server/src/routes/sync.ts | L174-196 |
| change_seq migration | server/db/migrations/0006_entries_change_seq.sql | BIGINT SEQUENCE |
| prod docker compose | infra/docker-compose.prod.yml | 4 容器架构 |
| 部署手册 | infra/prod-bootstrap-compose.md | v1.6 |
