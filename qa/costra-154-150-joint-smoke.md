# COSTRA-154 + COSTRA-150 · 双卡联合 staging 实测手册

> **D-022 §4.1 runtime T2 卡铁律**：双卡均属 runtime T2 · 必须 Human 真实运行验证 §3.5 5 条断言（A~E）才能整卡 approve · 仅自动化绿不算
> **D-024 §2.2 C1 第 3 次实战**：105+156 / 157+158 / 154+150 三连攒批
> **D-025 AP-001 反例第 1 次 Orchestrator 命中**：之前手册有事实错误（healthz 加 /v1 / DB 名错 / INSERT 缺列）· 本手册由 qa-planner 归口 · 每条命令/路径/SQL 均有 Read 验证的事实源
>
> **实测者**：Human
> **预计时间**：~ 20 分钟
> **修订版本**：v1.3 · 2026-05-22（R1.x.2 修订 · 配套 3 个 BUG 修复）
>
> **v1.3 修订（选项 B 彻底修复）**：
> - watermark 协议从 ISO 时间戳升级为 BIGINT change_seq（v1.2）· 完全消除 §3.5 残余风险
> - §3.E 期望 watermark 为整数（不再 ISO 字符串）
> - §3.E.5 PASS 判据更新（typeof watermark === 'number' + pulled=0）
> - 配套 BUG 卡（追加 §11 升级声明）：
>   - `qa/defects/2026-05-22-COSTRA-150-D-outbox-deadlock-on-push-failure.md`（client outbox 死锁）
>   - `qa/defects/2026-05-22-COSTRA-154-watermark-microsecond-precision.md` §11 v1.2 升级声明
>
> **v1.1 修订**（保留）：
> - §3.D.1 步骤 1：IDE Network 调试面板 Offline → 改为**模拟器面板网络类型切换**
> - §3.A.2 PASS 判据：明确 IDE 内部错误不算 error/warn
> - watermark storage key 修订：`sync:watermark:` → `watermark:`（事实源 `db.ts:86-88`）

---

## §1 前置环境

### §1.1 系统要求

| 依赖 | 最低版本 | 验证命令 |
|---|---|---|
| macOS | 12+ | `sw_vers` |
| Node.js | ≥ 20.0.0 | `node -v` |
| Docker Desktop | 运行中 | `docker ps` |
| psql (PostgreSQL client) | 14+ | `psql --version` |
| 微信开发者工具 | ≥ 1.06 stable | 启动确认 |
| jq | 1.6+ | `jq --version` |

### §1.2 Repo 检出与 commit 锚点

```bash
cd /Users/weizhao/Desktop/Costra
git log --oneline -20 | grep -E "(7e87bad|8eecd4c|ee97a7a|5ac8153)"
```

**期望**：4 条 commit 全找到：
- `7e87bad` → COSTRA-154 R1（sync pull 实装）
- `8eecd4c` → COSTRA-154 R1.x.1（类型修正 + hash 同步）
- `ee97a7a` → COSTRA-150 R1（sync scheduler 实装）
- `5ac8153` → COSTRA-150 R1.x.1（[未经验测] 标注 + hash 同步）

> **事实源**：review-tech R1 报告 `.team/reviews/COSTRA-154/round-1-tech.md:5` + `.team/reviews/COSTRA-150/round-1-tech.md:5`

### §1.3 Server 启动

#### §1.3.1 启动 Docker 依赖

```bash
cd /Users/weizhao/Desktop/Costra/server
npm run db:up
```

> **事实源**：`server/package.json:20` `"db:up": "docker compose up -d"` · `server/docker-compose.yml:9-27` 4 服务（postgres + redis + minio + mailhog）· `POSTGRES_DB: costra`（L14）

#### §1.3.2 安装依赖 + 跑 migrations

```bash
cd /Users/weizhao/Desktop/Costra/server
npm install
npm run db:migrate
```

> **事实源**：`server/package.json:22` `"db:migrate": "bash scripts/dev/migrate.sh"` · `server/scripts/dev/migrate.sh:21-23` 按 `db/migrations/*.sql` 文件名顺序执行

#### §1.3.3 启动 dev server（WX_MOCK_LOGIN=1）

```bash
cd /Users/weizhao/Desktop/Costra/server
WX_MOCK_LOGIN=1 npm run dev
```

> **事实源**：`server/package.json:12` `"dev": "tsx watch src/server.ts"` · `server/.env:7` `NODE_ENV=development`（确保 mock 生效）
> **为什么不用 .env 里的 WX_MOCK_LOGIN**：`.env` 无此字段（`server/.env` 无 WX_MOCK_LOGIN 行）· 用环境变量注入不污染 .env

**期望终端输出**（pino JSON）：
```
"msg":"Server listening at http://0.0.0.0:8080"
"wxMockLogin":true,"msg":"⚠️  WX_MOCK_LOGIN enabled ..."
```

#### §1.3.4 健康检查

```bash
curl http://localhost:8080/healthz
```

> **⚠️ 关键：不带 /v1** · 事实源：`server/src/app.ts:69` 注释 `healthz 保留根路径（K8s/SLB liveness probe 惯例 · 不进 v1 prefix）` + `server/src/routes/healthz.ts:17` `app.get('/healthz', ...)`

**期望**：
```json
{"status":"ok","build_sha":"","now_utc":"...","icp":{...}}
```

**PASS 判定**：HTTP 200 + `"status":"ok"`

### §1.4 Miniprogram 端配置

1. 打开微信开发者工具
2. 导入项目：
   - 项目路径：`/Users/weizhao/Desktop/Costra/miniprogram`
   - AppID：`wxf8b0d3e3a83f9941`
   > **事实源**：`server/.env:24` `WX_APP_ID=wxf8b0d3e3a83f9941`
3. **详情 → 本地设置**：
   - ✅ 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书
4. 编译模式：普通编译
5. 打开 Console 面板 + Network 面板

### §1.5 关键注意事项

#### §1.5.1 mockLogin = false（不是 true！）

> **事实源**：`miniprogram/services/env.ts:50` `const CURRENT_ENV: EnvName = 'dev'` + `env.ts:18` `mockLogin: false`
>
> ⚠️ **任务背景说 `mockLogin: true` 是错的** · 实际源码 dev 环境 `mockLogin: false` · 这意味着小程序会走**真实 wx.login → POST /v1/auth/wx-login** 链路 · 但 server 端 `WX_MOCK_LOGIN=1` 会 mock code2Session · 所以开发者工具模拟器中 wx.login 能成功返回 code · server 端用 mock 处理 · 整条链路是"真 wx.login + mock 服务端验证"

#### §1.5.2 auth.ts mock 降级路径

> **事实源**：`miniprogram/services/auth.ts:165-168`
> ```ts
> if (env.mockLogin) {
>   const mock = mockExchange(code);
>   ...
> }
> ```
> 因为 `env.mockLogin = false` · 小程序**不会**走 `mockExchange` 分支 · 而是走 L174 真实链路 `request<TokenRaw>({method: 'POST', path: '/auth/wx-login', body: {code}})`

#### §1.5.3 NODE_ENV=development

> **事实源**：`server/.env:7` `NODE_ENV=development`（已写死）· `WX_MOCK_LOGIN=1` 只在 `NODE_ENV=development` 时生效

---

## §2 数据准备

### §2.1 在小程序中完成首次登录建 user

1. 在微信开发者工具中，点击"编译"启动小程序
2. 应自动跳到登录页 → 点击"一键微信登录"
3. 观察 Console 输出 `[auth] wx.login ok {codeLen: 32}`

> **事实源**：`miniprogram/services/auth.ts:163` `console.info('[auth] wx.login ok', { codeLen: code.length })`

4. 登录成功后跳转到 home 页

### §2.2 查询 user_id

在**新终端**中执行：

```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
  -c "SELECT id, openid, nickname FROM users ORDER BY created_at DESC LIMIT 1"
```

> **事实源**：`server/.env:12` `DATABASE_URL=postgres://costra:costra_dev_pw@localhost:5432/costra` · DB 名 = `costra`（不是 `costra_dev`）

**期望**：1 行，id 为 UUID v7 格式（如 `019e...`）· openid 为 `mock-openid-xxx` · nickname 为 `微信用户`

记录 USER_ID：
```bash
USER_ID=<上面查到的 id 值>
echo "USER_ID=$USER_ID"
```

### §2.3 用 seed 脚本建 family/ledger/family_members

```bash
cd /Users/weizhao/Desktop/Costra/server
USER_ID=$USER_ID npm run db:seed:curl-test
```

> **事实源**：`server/package.json:24` `"db:seed:curl-test": "bash scripts/dev/seed-curl-test.sh"` · `server/scripts/dev/seed-curl-test.sh:19-26` 必须提供 USER_ID 环境变量 · L30 `FAMILY_ID=00000000-0000-0000-0000-0000000000F0` · L31 `LEDGER_ID=00000000-0000-0000-0000-000000000001`

**期望输出末尾**：
```
    t     | count
----------+-------
 families |     1
 ledgers  |     1
 members  |     1
```

> **事实源**：`seed-curl-test.sh:45-46` `INSERT INTO families (id, name, owner_id) VALUES (:family_id, 'CurlTestFamily', :user_id) ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id` · families 表有 owner_id 列（0001_init.sql L32）

### §2.4 family_id 注入小程序 storage

**⚠️ 关键：不能用 `wx.setStorageSync` 直接写裸字符串**

> **事实源**：`miniprogram/services/storage.ts:48-56` `setItem` 把数据包装成 envelope `{v: STORAGE_VERSION, t: Date.now(), ttl, d: data}` · `getItem` (L58-76) 从 `env.d` 取数据 · 如果用 `wx.setStorageSync` 直接写裸字符串 · `getItem` 解析 `env.d` 会是 `undefined` · `getActiveFamilyId` 返回 null · syncScheduler 永远 skip

#### §2.4.1 正确做法：用 storage.ts 的 setItem

在微信开发者工具 **Console** 面板执行：

```js
// 必须通过 storage.ts 的 setItem 写入 · 保持 envelope 一致性
// 微信小程序 Console 中无法直接 import 模块 · 替代方案：手动构造 envelope
const FAMILY_ID = '00000000-0000-0000-0000-0000000000F0';
wx.setStorageSync('__costra_family_id_v1', {
  v: 1,
  t: Date.now(),
  d: FAMILY_ID
});
```

> **事实源**：`miniprogram/services/storage.ts:10` `const STORAGE_VERSION = 1` · L50 `const envelope: Envelope<T> = { v: STORAGE_VERSION, t: Date.now(), ttl: ttlMs, d: data }` · L52 `await wx.setStorage({ key, data: envelope })`
>
> **为什么 Console 执行 `setItem` 不可行**：微信小程序 Console 无法 `require('./services/storage')`（模块系统限制）· 手动构造 envelope 并用 `wx.setStorageSync` 是等效做法（setStorageSync 写入的是最终 storage 格式 · storage.ts 内部也是用 `wx.setStorage` 写 envelope）

#### §2.4.2 验证 storage 注入成功

在 Console 执行：

```js
wx.getStorageSync('__costra_family_id_v1')
```

**期望返回**（envelope 格式）：
```json
{"v":1,"t":1747891...,"d":"00000000-0000-0000-0000-0000000000F0"}
```

**⚠️ 如果返回裸字符串 `"00000000-..."` 而非 envelope**：说明用了 `wx.setStorageSync(key, FAMILY_ID)` 直接写 · `getItem` 会读 `env.d` 得 `undefined` → 同步调度器永远 skip · **必须重新按 §2.4.1 方式写入**

### §2.5 验证登录态 + family_id 双就绪

在 Console 执行：

```js
// 检查登录态
const token = wx.getStorageSync('__costra_token_v1');
console.log('token envelope keys:', Object.keys(token));
console.log('has access_token:', !!token?.d?.raw?.access_token);
console.log('user.id:', token?.d?.raw?.user?.id);

// 检查 family_id
const fam = wx.getStorageSync('__costra_family_id_v1');
console.log('family_id:', fam?.d);
```

**期望**：
- `token envelope keys: ["v","t","d"]`
- `has access_token: true`
- `user.id:` 与 §2.2 查到的 USER_ID 一致
- `family_id: 00000000-0000-0000-0000-0000000000F0`

---

## §3 5 条断言（A~E · 严格按 COSTRA-150 dispatch §3.5）

### 断言 A：Console 无 `[sync] fail` 以外 error/warn（5 分钟观察窗）

#### §3.A.1 操作步骤

1. 确认 §2 全部就绪（登录态 + family_id + seed 数据）
2. 在微信开发者工具中点击"编译"重新冷启小程序
3. 等 10 秒让调度器触发 + 登录完成
4. 观察 Console 面板 5 分钟 · 记录所有 `[sync]` 前缀日志
5. 在此期间可正常操作小程序（切换 home/mine 页 · 不做特殊操作）

#### §3.A.2 期望 Console

- ✅ 可出现 `[sync] ok · pushed=0 pulled=N watermark=... (trigger=...)`
- ✅ 可出现 `[sync] skip · already running (trigger=...)`
- ✅ 可出现 `[sync] skip page-show · debounced (page=...)`
- ✅ 可出现 `[sync] network recover · trigger sync`
- ❌ **不应出现** `[sync] fail · ...`（除手动断网恢复等极端场景）

> **v1.1 排除项**（IDE 内部错误 · 不算 error/warn · 不影响断言 A 判定）：
> - `Failed to load resource ... apihelper/assdk` / `__WORKER__/worker.js?libName=WAAccelerateWorker.js` → IDE 内部 XHR
> - `Component is not found in path "wx://not-found"` → IDE 组件注入级联 fallback
> - `[Costra] runtime error MiniProgramError ... 'send' on 'XMLHttpRequest'` → app.ts:97 onError 捕获的 IDE XHR 失败
>
> 上述 4 条均为开发者工具自身行为 · 不是项目代码缺陷 · 偶现 · 暂不处理（后续可立 P3 卡用 onError 过滤）

> **事实源**：`miniprogram/services/syncScheduler.ts:84` `[sync] ok · pushed=${pushResult.pushed} pulled=${pulled} watermark=${pullResult.watermark} (trigger=${trigger})` · L57 `[sync] skip · already running (trigger=${trigger})` · L65 `[sync] skip · not logged in (trigger=${trigger})` · L72 `[sync] skip · no active family (trigger=${trigger})` · L94 `[sync] fail · ${e?.code || 'unknown'} ${e?.message || e} (trigger=${trigger})` · L122 `[sync] network recover · trigger sync` · L147 `[sync] skip page-show · debounced (page=${pageName})`

#### §3.A.3 期望 Network

- `GET http://localhost:8080/v1/sync/pull?family_id=00000000-...0F0&since=0&limit=200` → 200

> **事实源**：`miniprogram/services/sync.ts:48-56` request 参数 `method: 'GET', path: '/sync/pull', query: {family_id, since, limit}` · `miniprogram/services/env.ts:17` `apiBaseUrl: 'http://localhost:8080/v1'` · URL 拼接 = `http://localhost:8080/v1/sync/pull?family_id=...&since=...&limit=200` · `miniprogram/services/db.ts:267-268` getWatermark 默认 epoch `'1970-01-01T00:00:00.000Z'`

#### §3.A.4 期望 DB 状态

- 无变化（仅读取）

#### §3.A.5 PASS / FAIL 判定

- **PASS**：5 分钟内 Console 无 `[sync] fail` 日志
- **FAIL**：出现 `[sync] fail` · 记录完整 console 输出 + 对应 Network 请求/响应

---

### 断言 B：冷启 500ms 后 Console 出现 `[sync] ok · pushed=N pulled=N watermark=N (trigger=launch)`

#### §3.B.1 操作步骤

1. 在微信开发者工具中点击"编译"（冷启）
2. 立即切换到 Console 面板
3. 等待 ~3 秒（500ms bootstrap + 网络请求时间）
4. 记录 Console 中 `[sync]` 相关日志

#### §3.B.2 期望 Console

```
[Costra] onLaunch env= dev
[auth] wx.login ok {codeLen: 32}
[sync] ok · pushed=0 conflicts=0 rejected=0 failed=0 pulled=N watermark=N (trigger=launch)
```

> **事实源**：`miniprogram/app.ts:51` `console.info('[Costra] onLaunch env=', this.globalData.env.name)` · `miniprogram/services/auth.ts:163` `console.info('[auth] wx.login ok', { codeLen: code.length })` · `miniprogram/services/syncScheduler.ts:117` `setTimeout(() => syncOnce('launch'), 500)` · L83-85 console.log 模板

**注意时序**：
1. onLaunch 同步段 → `startScheduler()`（app.ts:71）
2. startScheduler 内 `setTimeout 500ms`（syncScheduler.ts:117）
3. 500ms 后 `syncOnce('launch')` 执行
4. 但 `isLoggedIn()` 依赖 `initAuth()` 完成（app.ts:59 `await initAuth()`）
5. 如果 bootstrapPromise > 500ms → `isLoggedIn()` 返回 false → `[sync] skip · not logged in (trigger=launch)`
6. 这是已知行为（syncScheduler.ts:106-113 [未经验测] 标注）· 下次 page-show 或 60s periodic 兜底

> **事实源**：`miniprogram/services/syncScheduler.ts:106-113` [未经验测] 注释 · `.team/reviews/COSTRA-150/round-1-tech.md:50-61` P1-2 修订

**如果看到 `[sync] skip · not logged in (trigger=launch)`**：不一定是 BUG · 可能是 bootstrap > 500ms · 切到 home 页后看 page-show 是否触发成功

#### §3.B.3 期望 Network

- `GET http://localhost:8080/v1/sync/pull?family_id=00000000-...0F0&since=0&limit=200` → HTTP 200
- 响应 body 含 `watermark` + `changes.entries` 数组

> **事实源**：`server/src/routes/sync.ts:174-196` GET /sync/pull handler · `server/src/services/syncPullService.ts:169-200` syncPull 函数

#### §3.B.4 期望 DB 状态

- `SELECT count(*) FROM entries WHERE ledger_id = '00000000-0000-0000-0000-000000000001'` → 应 ≥ 0（取决于是否有 seed entries）
- watermark 应已写入 storage（检查方式见断言 E）

#### §3.B.5 PASS / FAIL 判定

- **PASS**：Console 出现 `[sync] ok · pushed=N pulled=N watermark=... (trigger=launch)` 或先 skip 后 page-show 成功
- **FAIL**：Console 持续 `[sync] skip · not logged in` 或 `[sync] skip · no active family` · 且 60s 后仍无 ok

---

### 断言 C：home / mine 页切换 5s 内仅 1 次 `trigger=page-show`（debounce 验证）

#### §3.C.1 操作步骤

1. 小程序已在 home 页
2. 切到 mine 页（点击底部 tabBar "我的"）
3. **立即**切回 home 页（< 5s）
4. 再切到 mine 页（仍在 5s 内）
5. 观察 Console 中 `[sync]` 日志

#### §3.C.2 期望 Console

```
[sync] ok · pushed=0 conflicts=0 rejected=0 failed=0 pulled=0 watermark=... (trigger=page-show)
[sync] skip page-show · debounced (page=home)
```

或

```
[sync] ok · pushed=0 conflicts=0 rejected=0 failed=0 pulled=0 watermark=... (trigger=page-show)
[sync] skip page-show · debounced (page=mine)
```

> **事实源**：`miniprogram/services/syncScheduler.ts:144-151` `triggerOnPageShow` 函数 · L146 `if (now - lastShowTriggerAt < SHOW_DEBOUNCE_MS)` → L147 `console.log('[sync] skip page-show · debounced (page=${pageName})')` · L28 `const SHOW_DEBOUNCE_MS = 5000` · `miniprogram/pages/home/index.ts:55` `triggerOnPageShow('home')` · `miniprogram/pages/mine/index.ts:45` `triggerOnPageShow('mine')`

#### §3.C.3 期望 Network

- 5s 内只有 1 次 `GET /v1/sync/pull?...` 请求（不是 3 次）

#### §3.C.4 期望 DB 状态

- 无变化（仅读取）

#### §3.C.5 PASS / FAIL 判定

- **PASS**：5s 内仅 1 次 `trigger=page-show` 成功 + ≥1 次 `skip page-show · debounced`
- **FAIL**：5s 内出现 2+ 次 `trigger=page-show` 成功（debounce 失效）· 或全部 skip（触发器未接入）

---

### 断言 D：切 Offline → 写一笔 entry → 切 Online → `[sync] ok ... trigger=network-recover` + entry 已上传 server

#### §3.D.1 操作步骤

⚠️ **v1.1 关键修订（BUG-COSTRA-150-D 配套）**：

**❌ 不要用 IDE Network 调试面板的 Offline**——那是 Chromium CDP 的 HTTP 请求拦截器，**不触发** `wx.onNetworkStatusChange`，会让断言 D 永远失败（Human 实测验证：监听 callback 在 IDE Network 面板 Offline/Online 切换时一次都不触发）。

**✅ 必须用以下任一方式**：

| 方式 | 操作 | 适用 |
|---|---|---|
| **A · 模拟器面板（推荐）** | 微信开发者工具**模拟器面板顶部**手机图标 → 网络类型切换为"无网络" | 最快 · 桌面验证 |
| **B · 真机飞行模式** | 微信开发者工具"预览/真机调试"→ 真机 → 开飞行模式 | 最接近真实用户场景 |
| **C · 停 dev server** | `Ctrl+C` 杀掉 `npm run dev` 终端 · 等价 ECONNREFUSED | 不验 network-recover · 仅验 outbox 入队 + push 失败重试 |

**推荐方式 A**：

1. 在微信开发者工具**模拟器面板**（左上角手机模型上方）→ 点"网络"或类似按钮 → 选择"**无网络**"
2. 在小程序中记一笔：点击 `+` → 金额 `12.34` → 分类随意 → 保存
3. 观察 Console：应有本地保存成功提示（outbox 入队）
4. 切回**模拟器面板**网络 → 选择"WiFi"
5. 等待 ~5 秒 · 观察 Console + Network

#### §3.D.2 期望 Console

```
[sync] network recover · trigger sync
[sync] ok · pushed=1 conflicts=0 rejected=0 failed=0 pulled=0 watermark=... (trigger=network-recover)
```

> **v1.1 修订**：R1.x.2 修复后 `[sync] ok` 日志包含 4 个计数字段（pushed/conflicts/rejected/failed）+ pulled · 修复前只有 pushed 字段且永远为 0（BUG-COSTRA-150-D §2.1 直接根因 A）
>
> **事实源**：`miniprogram/services/syncScheduler.ts:120-125` `wx.onNetworkStatusChange` → `console.log('[sync] network recover · trigger sync')` → `syncOnce('network-recover')` · L84 修复后日志模板

#### §3.D.3 期望 Network

1. `POST http://localhost:8080/v1/sync/push` → HTTP 200（push entry）
2. `GET http://localhost:8080/v1/sync/pull?family_id=...&since=...&limit=200` → HTTP 200（pull 回写）

> **事实源**：`miniprogram/services/sync.ts:74-103` pushDelta 内部 `drainBatch` → `request<{results}>` POST /sync/push → `ackResults`

#### §3.D.4 期望 DB 状态

```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
  -c "SELECT id, amount, note, version FROM entries WHERE ledger_id = '00000000-0000-0000-0000-000000000001' ORDER BY created_at DESC LIMIT 3"
```

**期望**：至少 1 行 · amount = 1234（12.34 元 = 1234 分）· version = 1

> **事实源**：`server/db/migrations/0001_init.sql:111` `amount BIGINT NOT NULL CHECK (amount > 0)` 单位分

#### §3.D.5 PASS / FAIL 判定

- **PASS**：Console 出现 `trigger=network-recover` + DB 有新 entry
- **FAIL**：切 Online 后无 `[sync] network recover` 日志 · 或日志出现但 DB 无新 entry

---

### 断言 E：watermark 持久化 · 杀进程冷启 → Console `since=<非 epoch>` （增量而非全量）

#### §3.E.1 操作步骤

1. 确认断言 D 已 PASS（DB 有 entry · watermark 已推进）
2. 在 Console 执行验证当前 watermark：
   ```js
   // watermark key 格式：watermark:<family_id>（注意：无 sync: 前缀）
   // 事实源：miniprogram/services/db.ts:86-88 watermarkKey()
   wx.getStorageSync('watermark:00000000-0000-0000-0000-0000000000F0')
   ```
3. 记录返回的 envelope 中的 `d` 值（v1.2 后应为 BIGINT 整数 · 非 0）
4. 在微信开发者工具中点击"编译"（冷启）
5. 等 3 秒 · 在 Network 面板找 `GET /v1/sync/pull?...` 请求
6. 检查请求 URL 中的 `since` 参数

#### §3.E.2 期望 Console

冷启后 Console 出现：
```
[sync] ok · pushed=0 conflicts=0 rejected=0 failed=0 pulled=0 watermark=N (trigger=launch)
```

> **pulled=0 是关键**：因为 since 是上次 watermark · server 只返 change_seq > since 的行 · 无新行则 entries=[] · pulled=0
>
> **v1.3 修订（BUG-COSTRA-154 v1.2 升级）**：watermark 字段是 **BIGINT 整数**（如 `watermark=12347`）· 不再是 ISO 字符串。
> v1.0 是毫秒 ISO（`.921Z`）· v1.1 是微秒 ISO（`.921137Z`）· v1.2 直接整数（`12347`）· 完全消除时钟精度依赖。
> 事实源协议 §6.3 v1.2 BIGINT change_seq。

#### §3.E.3 期望 Network

- `GET /v1/sync/pull?family_id=00000000-...0F0&since=N&limit=200`（N 为非零整数）
- **`since` 参数 ≠ `0`**（即不是全量拉取）
- v1.3：`since` 必须是整数 · URL 形如 `since=12345`（非 ISO 字符串）

> **事实源**：`miniprogram/services/sync.ts:47` `const since = await getWatermark(familyId)` · `miniprogram/services/db.ts:267-268` `getWatermark` 从 storage 读取 · 默认 epoch · `miniprogram/services/db.ts:271-273` `setWatermark` 写入 storage · `miniprogram/services/sync.ts:63` `await setWatermark(familyId, resp.watermark)` · `server/src/services/syncPullService.ts:186-188` watermark 推进逻辑

#### §3.E.4 期望 DB 状态

- 无新增行（增量拉取 · 无新变更）

验证 SQL：
```bash
psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
  -c "SELECT count(*) FROM entries WHERE ledger_id = '00000000-0000-0000-0000-000000000001'"
```

期望 count 与断言 D 结束时相同（未新增）

#### §3.E.5 PASS / FAIL 判定

- **PASS**：冷启后 Network 请求 `since=` 参数为非零正整数 + Console `pulled=0` + watermark 类型为整数（v1.2）
- **FAIL（场景 1）**：`since=0`（watermark 未持久化 · 全量重拉）· 或 watermark key 不存在
- **FAIL（场景 2）**：`pulled` 持续 ≥ 1 不归零（同一条 entry 重传 · 修复未生效）
- **FAIL（场景 3）**：watermark 仍是 ISO 字符串（如 `2026-05-22T...Z`）· 说明 server 未走 v1.2 · 或 client storage 未触发 legacy 重置
- **FAIL（场景 4）**：watermark 类型不是 number · 协议 v1.2 BIGINT 契约违规

---

## §4 反馈格式（短小可粘贴）

```
## COSTRA-154 + 150 联合实测结果

日期：2026-05-__
实测者：__

| 断言 | 结果 | 证据（1 行 log） |
|---|---|---|
| A · 无 [sync] fail | PASS / FAIL | |
| B · launch 触发 sync ok | PASS / FAIL | |
| C · page-show debounce | PASS / FAIL | |
| D · network-recover push+pull | PASS / FAIL | |
| E · watermark 持久化 | PASS / FAIL | |

整体结论：✅ 5/5 PASS → approve / ❌ N/5 FAIL → 见故障排查
```

---

## §5 故障排查（FAQ · 8+ 条）

### Q1 `curl http://localhost:8080/healthz` 报 connection refused

**排查**：
1. server 是否已启动？看终端是否有 `costra-server listening`
2. 端口是否被占用？`lsof -i :8080`
3. Docker 容器是否运行？`docker ps | grep costra`
4. 如果 Docker postgres 未启动 → `cd server && npm run db:up`

### Q2 `[sync] skip · no active family` 不消失

**根因**：`getItem('__costra_family_id_v1')` 返回 null

**排查**：
1. Console 执行 `wx.getStorageSync('__costra_family_id_v1')` 检查值
2. 如果返回裸字符串 `"00000000-..."` 而非 envelope `{v:1, t:..., d:"00000000-..."}` → 你用了 `wx.setStorageSync(key, value)` 直接写 · 必须按 §2.4.1 用 envelope 格式
3. 如果返回空 → 未执行 §2.4.1 注入步骤

> **事实源**：`miniprogram/services/storage.ts:61-68` getItem 从 `env.d` 取值 · `syncScheduler.ts:44-47` getActiveFamilyId 用 `getItem<string>(FAMILY_ID_KEY)`

### Q3 `[sync] skip · not logged in`

**根因**：`isLoggedIn()` 返回 false

**排查**：
1. 是否已完成登录？看 home 页是否显示用户名
2. Console 执行 `wx.getStorageSync('__costra_token_v1')` · 检查 envelope 格式 + `d.raw.access_token` 是否存在
3. 如果 token envelope 为空 → 登录流程未完成 → 重新点登录
4. 如果是冷启 500ms 内触发 → 已知 [未经验测] 行为（syncScheduler.ts:106-113）· 下次 page-show 兜底

### Q4 触发 launch 但 Console 啥都没出

**排查**：
1. 是否等了足够时间？launch 触发有 500ms 延迟（syncScheduler.ts:117）
2. bootstrapPromise 是否卡住？看 Console 有无 `[Costra] bootstrap failed`
3. 是否有其他 JS 错误阻塞执行？看 Console 红色报错
4. startScheduler 是否被调用？在 app.ts:71 确认 import

### Q5 watermark 持久化失效（冷启后 since 仍为 epoch）

**根因**：`setWatermark` 未写入 · 或 storage key 不对

**排查**：
1. Console 执行 `wx.getStorageSync('watermark:00000000-0000-0000-0000-0000000000F0')` 检查值（**注意：无 `sync:` 前缀** · 事实源 `db.ts:86-88`）
2. 如果返回空 → setWatermark 未被调用 · 可能 syncPull 返回了非 200
3. 如果返回裸字符串 → envelope 被破坏 · 同 Q2 的 envelope 问题
4. db.ts:267-268 `getWatermark` 默认返回 epoch `'1970-01-01T00:00:00.000Z'`

> **事实源**：`miniprogram/services/db.ts:267-268` `(await getItem<string>(watermarkKey(familyId))) || '1970-01-01T00:00:00.000Z'`

### Q6 `/sync/pull` 返回 401

**根因**：JWT 鉴权失败

**排查**：
1. 检查 server .env `JWT_SECRET` / `JWT_ISSUER` / `JWT_AUDIENCE` 是否与 client request 一致
2. Console 执行 `wx.getStorageSync('__costra_token_v1')?.d?.raw?.access_token` · 是否有值
3. 如果 token 过期 → request.ts L105-119 应自动续签 · 但 mock 模式下 mockExchange 签的 token 不走 server · **注意**：`env.ts:18` `mockLogin: false` → 走真实链路 → token 应该有效
4. `server/.env:21` `JWT_AUDIENCE=costra-miniapp` · server 校验 audience 是否匹配

### Q7 `/sync/pull` 返回 403 PERMISSION_DENIED

**根因**：`isUserInFamily` 校验失败 · user 不在 family 中

**排查**：
1. 是否执行了 §2.3 seed 脚本？
2. seed 脚本的 USER_ID 是否正确？检查：
   ```bash
   psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' \
     -c "SELECT * FROM family_members WHERE family_id = '00000000-0000-0000-0000-0000000000F0'"
   ```
3. 如果 family_members 无行 → seed 未跑成功 · 重新执行 §2.3
4. 如果 user_id 不匹配 → §2.2 查到的 USER_ID 与实际登录 user 不一致

> **事实源**：`server/src/services/syncPullService.ts:54-58` `isUserInFamily` 校验 · `server/src/routes/sync.ts:178` `parseUserIdFromRequest` 从 JWT 取 userId

### Q8 entry 写入但 pushed=0

**可能根因**：
1. outbox drainBatch 未取到待推记录
2. POST /sync/push 网络失败（catch 静默吞错）
3. ledger_id 不是 `00000000-0000-0000-0000-000000000001`（COSTRA-105 D.1 已知历史 · db.ts fallback 到 FALLBACK_LEDGER_ID 可能不匹配）

**排查**：
1. Network 面板有无 `POST /v1/sync/push` 请求？
2. 如果有 → 看响应状态码 + body
3. 如果无 → outbox 可能为空 · 检查离线 entry 是否入队成功
4. Console 执行 `wx.getStorageSync('outbox:__index')` 检查 outbox 索引

### Q9 healthz 返回 404

**根因**：URL 拼错 · 可能加了 `/v1` 前缀

**正确 URL**：`http://localhost:8080/healthz`（**不带** `/v1`）

> **事实源**：`server/src/app.ts:70` healthz 在根路径注册 · 不在 `/v1` prefix 子作用域内（L72-78 业务路由才进 `/v1`）

### Q10 npm run db:seed:curl-test 报 `USER_ID environment variable required`

**根因**：未设置 USER_ID 环境变量

**解决**：
```bash
USER_ID='你的-user-id' npm run db:seed:curl-test
```

> **事实源**：`server/scripts/dev/seed-curl-test.sh:19-26` 检查 `${USER_ID:-}` 是否为空

---

## §6 接口契约速查

### GET /healthz

| 项目 | 值 |
|---|---|
| URL | `http://localhost:8080/healthz` |
| Method | GET |
| Auth | 无 |
| 期望响应 | `200 {"status":"ok","build_sha":"...","now_utc":"...","icp":{...}}` |

> **事实源**：`server/src/routes/healthz.ts:17-24`

### GET /v1/sync/pull

| 项目 | 值 |
|---|---|
| URL | `http://localhost:8080/v1/sync/pull` |
| Method | GET |
| Auth | Bearer JWT（Authorization header） |
| Query 参数 | `family_id`（UUID · 必填）· `since`（ISO 8601 · 必填）· `limit`（int · 可选 · 默认 200 · 上限 500）|
| 期望响应 200 | `{"watermark":"ISO","has_more":false,"changes":{"entries":[...],"categories":[],"budgets":[],"ledgers":[]}}` |
| 期望响应 400 | `{"code":"INVALID_ARGUMENT",...}` |
| 期望响应 401 | `{"code":"UNAUTHENTICATED",...}` |
| 期望响应 403 | `{"code":"PERMISSION_DENIED",...}` |

> **事实源**：`server/src/routes/sync.ts:75-83` pullQuerySchema · `server/src/services/syncPullService.ts:158-167` SyncPullResult · `docs/api/sync-protocol.md §3`

### POST /v1/sync/push

| 项目 | 值 |
|---|---|
| URL | `http://localhost:8080/v1/sync/push` |
| Method | POST |
| Auth | Bearer JWT + `Idempotency-Key` header（必填）|
| Body | `{"ops":[{"op":"create","entity":"entry","client_ref_id":"...","base_version":null,"payload":{...}}]}` |
| 期望响应 200 | `{"results":[{"client_ref_id":"...","status":"ok","server_id":"...","server_version":1}]}` |

> **事实源**：`server/src/routes/sync.ts:85-114` syncPushBodySchema · `docs/api/sync-protocol.md §2`

### mockLogin 行为说明

| 维度 | 行为 |
|---|---|
| `env.ts:18` `mockLogin: false` | 小程序**不走** `mockExchange` · 走**真实** `POST /v1/auth/wx-login` |
| `server` `WX_MOCK_LOGIN=1` | server mock code2Session · 任意 code 都返回 mock openid |
| 开发者工具 | `wx.login()` 在模拟器中返回有效 code |
| **整体链路** | 真 wx.login → 真 POST /auth/wx-login → server mock 处理 → 返回真 JWT |

> **事实源**：`miniprogram/services/auth.ts:165-183` doWxLogin 中 mockLogin 分支 vs 真实链路分支 · `miniprogram/services/env.ts:18` `mockLogin: false`

---

## §7 收尾

### 实测 PASS 后

Human 触发：
```
approve:COSTRA-154 + approve:COSTRA-150
```

这是 D-024 §2.2 C1 第 3 次实战（105+156 / 157+158 / 154+150 三连攒批）。

### 实测 FAIL 路径

1. 贴现象（Console log + Network 截图 + DB 查询结果）
2. 判定：
   - **R1.x.2 同轮修订**：如果缺陷是 P1 且修复量 ≤ 5 行（参 COSTRA-158 R1.x.1 storage envelope 修复范式）
   - **新立 BUG 卡**：如果缺陷是 P0 或修复量 > 5 行（参 COSTRA-105 D.1/D.2 范式）
3. 缺陷单落档：`qa/defects/2026-05-22-COSTRA-154-xxx-brief.md`

---

## §8 D-025 反模式自检

| ID | 反模式 | 自检结果 |
|---|---|---|
| AP-001 字符串代理判定 | ✅ 无凭印象写命令 · 每条命令/路径/SQL 均标注了事实源文件+行号：healthz URL ← app.ts:69 / DB 名 ← .env:12 / families INSERT 含 owner_id ← seed-curl-test.sh:45 + 0001_init.sql:32 / storage envelope ← storage.ts:10,50,61-68 / mockLogin=false ← env.ts:18 / console.log 模板 ← syncScheduler.ts:83-85,57,65,72,94,122,147 |
| AP-002 概率极低就接受 | ✅ 无"应该没事"路径 · storage envelope 兼容性已用 157+158 R1.x.1 runtime 铁证验证（2026-05-19 Human 实测 16/16 PASS）· 本手册 §2.4 明确给出了 envelope 正确构造方式 + 验证步骤 + 失败后果说明 · 未假设 wx.setStorageSync 直接写裸值"应该能用" |
| AP-003 契约-实装漂移 | ✅ 未引入新漂移 · 所有命令与 package.json scripts 一致（db:up ← package.json:20 / db:migrate ← package.json:22 / db:seed:curl-test ← package.json:24）· API 路径与 app.ts 注册一致（healthz 根路径 ← app.ts:70 / /v1/sync/pull ← app.ts:72-78 + sync.ts:174）· env.ts mockLogin 实际值=false 已在 §1.5.1 显式纠正任务背景错误 |

---

**手册事实源索引**：

| 引用 | 文件路径 | 关键行 |
|---|---|---|
| healthz 不带 /v1 | server/src/app.ts | L69 |
| healthz handler | server/src/routes/healthz.ts | L17-24 |
| DB 名 = costra | server/.env | L12 |
| docker-compose POSTGRES_DB | server/docker-compose.yml | L14 |
| seed 脚本 + FAMILY_ID + LEDGER_ID | server/scripts/dev/seed-curl-test.sh | L19-66 |
| families 表 owner_id 列 | server/db/migrations/0001_init.sql | L29-37 |
| npm scripts db:up/db:migrate/db:seed | server/package.json | L20-24 |
| env.ts CURRENT_ENV=dev + mockLogin=false | miniprogram/services/env.ts | L18, L50 |
| auth.ts mockLogin 分支 vs 真实链路 | miniprogram/services/auth.ts | L165-183 |
| storage.ts envelope {v,t,d} | miniprogram/services/storage.ts | L10, L48-56, L58-76 |
| syncScheduler.ts console.log 模板 | miniprogram/services/syncScheduler.ts | L57, L65, L72, L83-85, L94, L117, L122, L147 |
| db.ts getWatermark 默认 epoch | miniprogram/services/db.ts | L267-268 |
| sync.ts syncPull 内部流程 | miniprogram/services/sync.ts | L43-67 |
| app.ts startScheduler 调用 | miniprogram/app.ts | L71 |
| home/index.ts triggerOnPageShow | miniprogram/pages/home/index.ts | L55 |
| mine/index.ts triggerOnPageShow | miniprogram/pages/mine/index.ts | L45 |
| server sync.ts pull handler | server/src/routes/sync.ts | L174-196 |
| server syncPullService | server/src/services/syncPullService.ts | L169-200 |
| request.ts 401 自动续签 | miniprogram/services/request.ts | L105-119 |
