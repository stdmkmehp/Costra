# COSTRA-105 · Human 端到端实测手册（单人记账闭环 + 离线弱网）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张）
> **验证类别**：T2-with-runtime · D-022 §4.1 runtime 类强制 Human 实测前置
> **执行人**：Human · **预计耗时**：A 起手 ~ 8 min · B 跟进 ~ 15 min · C 主路径 ~ 35 min · 全套 ~ 50 min
> **验证对象**：单人记账完整闭环（client 103 + server 104 + 156）+ 离线弱网专项
> **修订**：v1.8 · 2026-05-18 20:4x · Human 实测收尾增量（USER_ID 占位修正 + D.2/H6 BLOCKED-BY-COSTRA-154 + prod 跳过纪要 + 部分 PASS 收口口径）
>
> 📌 **v1.6 的 4 个文档级 gap 修订 + R1.x BUG 修复内容全部保留**（v1.7 精简结构 / v1.8 实测增量 · 不重构）

---

## ⚠ v1.8 顶层状态（2026-05-18 实测收尾 · 必读）

| 项 | 状态 | 来源 |
|---|---|---|
| 方式 A · Mock | 🟢 **PASS**（H1/H2/H3/H5 命中）| Human 实测 2026-05-18 |
| 方式 B · 本地 server | 🟢 **PASS · partial**（H1~H5 全命中 · BUG-001/002 已修 ≥ commit `9be5e84`）| Human 实测 2026-05-18 |
| 方式 C · prod / staging | ⏸️ **跳过**（M2 Phase-2 复测 · 不阻 R1 双卡 approve）| Human 决策 2026-05-18 20:4x |
| **§4.2 D.2 · 冷启 pull 回环** | 🔴 **BLOCKED-BY-COSTRA-154**（GET /sync/pull 返回 501 NOT_IMPLEMENTED · stub 主动切出 FU-104-SYNC-PULL）| Human 实测 2026-05-18 20:1x |
| **H6 · 端到端契约对齐** | 🔴 **BLOCKED-BY-COSTRA-154**（同 D.2 · COSTRA-154 实装后回归即可）| 同上 |
| **H4 · 幂等不重复入账** | 🟢 **PASS**（§5 curl 直打 · 不依赖 D.2）| Human 实测 2026-05-18 |
| 收口口径 | **R1 部分 PASS · 双卡 approve 可放行**（v1.4 `BLOCKED-BY-COSTRA-156` 范式同款 · 等 Sprint-3 154 实装回归即闭环）| 见 §6 |

---

## 0. 前置环境清单

### 0.1 三模式分流（先决策再执行）

5 个步骤覆盖端到端闭环 · 选**主模式**起手（推荐 A → C 双跑 · D-023 后 C 已可达）：

| 模式 | 适用场景 | server | DB | 推荐性 |
|---|---|---|---|---|
| **A · Mock 通路**（client mockLogin） | 仅验 client 侧（mockExchange / 本地 storage / outbox 入队 / payload snake_case） | ❌ | ❌ | ⭐ 起手必跑（~ 8 min · 覆盖 A/B/C 步骤） |
| **B · 本地 server**（client 真发 + WX_MOCK_LOGIN） | 验 server 端幂等 / 三态 / DB 落库 / 离线→联网 push | ✅ | ✅ migrations 全跑 | ⭐ 跟进跑（~ 15 min · 覆盖 D/E + 复跑 A/B/C 真链路） |
| **C · 真 staging / prod**（D-023 后路径 · 推荐主路径） | 贯通真链路（真 wx.login / 真 JWT / 真 DB / 真域名 `costra.cloud`） | ✅ prod 已部署 | ✅ prod 已 migrations | 🟢 **D-023 后可跑**（ICP ✅ + R-013 ✅ + 主域 ✅ + nginx/TLS ✅ · 仅等 Human 配微信白名单）|

> **R-020 强约束**：方式 C staging 与 prod 共用域名 · 实测前 §0.5.5 三项自检全勾才执行（避免污染 prod 数据）。
> **方式 C 替代方式 B 大部分价值**：D-023 后建议 A + C 双跑（B 退化为 server 端 debug 回归用）。

### 0.2 步骤×模式适用矩阵（5 步×3 模式 = 15 格 · v1.7 顶层合并）

| 步骤 | 方式 A · Mock | 方式 B · 本地 server | 方式 C · 真 server |
|---|---|---|---|
| **A** 冷启登录 | ✅ 必跑 · mockExchange + storage 写入 | ✅ 复跑 · 真 wx.login → POST /v1/auth/wx-login → 真 JWT | ✅ 必跑 · 同 B（URL `https://costra.cloud/v1`）|
| **B** 在线记一笔 | ✅ 必跑 · 写本地 entry · 不发 HTTP | ✅ 复跑 · 写本地 + 入 outbox | ✅ 必跑 · 同 B |
| **C** 离线 outbox 入队 | ✅ 必跑（mockLogin 也走 outbox · COSTRA-103 解耦） | ✅ 复跑 · 入队后 D 验 push | ✅ 必跑 · 同 B |
| **D.1** push 链路 | ❌ SKIP（mockLogin 不发 HTTP） | ✅ 必跑 · 验集成层联通 | 🟢 **强烈推荐** · 真链路最高保真 |
| **D.2** 冷启 pull 回环 | ❌ SKIP | ✅ 必跑 · 验端到端契约对齐 | 🟢 **强烈推荐** · H6 真链路最高保真 |
| **E** curl 幂等 | ❌ SKIP（无 server） | ✅ 必跑 · curl 直打 server | 🟢 **强烈推荐** · `curl https://costra.cloud/v1/...` |

### 0.3 通用前置（所有模式）

#### 0.3.1 工具 & 凭证
- [ ] **微信开发者工具** ≥ 1.06.x（基础库 3.8.12 · COSTRA-126）
- [ ] **项目目录**：`/Users/weizhao/Desktop/Costra` · `dev` 分支 · HEAD 含 COSTRA-105 R1.x.1/R1.x.2 修复（≥ commit `9be5e84`）
- [ ] **Node.js** ≥ 18.x · 依赖：
  ```bash
  cd /Users/weizhao/Desktop/Costra && npm install && npm run typecheck && npm test
  # 期望：typecheck exit 0 · 42/42 tests passed
  ```

#### 0.3.2 微信开发者工具首次准备（COSTRA-123 教训）

1. 以**项目根** `/Users/weizhao/Desktop/Costra` 打开（**不要**打开 `miniprogram/` 子目录 · COSTRA-121 工具链 SSOT）
2. 顶部菜单 **工具 → 构建 npm**（确保 `decimal.js` 等构建到 `miniprogram_npm/`）
3. **方式 B 必须**：右上角 详情 → 本地设置 → 勾选 **"不校验合法域名/TLS/证书"**（dev URL 是 HTTP localhost 非 HTTPS）
4. **方式 C 必须**：相反 · **关闭"不校验合法域名"**（真链路必须真审）
5. 方式 A 不发 HTTP · 勾选与否都不影响

#### 0.3.3 实测起点重置（每步开始前）

```js
// Console 跑 · 仅清 client storage（不影响 DB）
wx.clearStorageSync()
console.log('storage cleared')
```

如要彻底起点（含 DB · 仅 B/C）：`cd server && npm run db:reset-data` + 重跑 §0.4.6 seed。

---

### 0.4 方式 B 前置（本地 server · client 真发 HTTP）

#### 0.4.1 切 client 到真链路（暂时性）

`miniprogram/services/env.ts` line 14~24：

```ts
dev: {
  apiBaseUrl: 'http://localhost:8080/v1',
  mockLogin: false,   // ← 改为 false（client 真发 wx.request）
  ...
}
```

> 实测完毕 `git checkout miniprogram/services/env.ts` 还原 · **禁止 commit**（mockLogin 默认值由 COSTRA-160 治理）。

#### 0.4.2 启动 server（WX_MOCK_LOGIN 模式）

```bash
# 终端 1（保留运行）
cd /Users/weizhao/Desktop/Costra/server
WX_MOCK_LOGIN=1 npm run dev
```

期望日志（pino JSON · 三条即视成功）：
- `port: 8080`
- `costra-server listening`
- `wxMockLogin: true`

> WX_MOCK_LOGIN：server 启动期注入 mock fetch · 任意 wx.login code 都返成功 · 跳过腾讯真接口（避免 `40029 invalid code`）· **仅 NODE_ENV=development 生效** · prod 启动 loadEnv 拒绝。

#### 0.4.3 DB 准备（首次 / 重建 DB）

前置：本地起 postgres + redis（`cd server && docker compose up -d`）· DB 连接 `postgres://costra:costra_dev_pw@localhost:5432/costra`。

```bash
# 终端 2
cd /Users/weizhao/Desktop/Costra/server
npm run db:migrate
```

期望按序跑完 4 个 migrations（0001 init / 0002 seed_categories / 0003 user_sessions / 0004 entries_account_columns） → `✅ All migrations applied.`

数据重置（脏数据撞冲突时跑）：`npm run db:reset-data`（TRUNCATE 业务表 + redis flushall · 不动 schema）。

#### 0.4.4 seed family/ledger（D/E 必跑）

`USER_ID` = **步骤 A 登录响应里的 `user.id`**（server 端 users 表 UUID v7 主键 · 不是 openid · 不是字面量）。

**两步范式**（v1.8 修订 · 避免直接抄占位字面量撞 PG 22P02）：

```js
// 步骤 1 · 微信开发者工具 Console（步骤 A 登录后跑）
const env = wx.getStorageSync('__costra_token_v1')
console.log('USER_ID =', env.d.raw.user.id)
// 输出形如：019e1a8d-2d20-7xxx-xxxx-xxxxxxxxxxxx（envelope `.d.raw` 解包 · 见 §0.4.5 token 数据模型）
```

```bash
# 步骤 2 · 终端复制上一步真 UUID 跑 seed
cd /Users/weizhao/Desktop/Costra/server
USER_ID='019e1a8d-2d20-...' npm run db:seed:curl-test
```

期望输出：`families/ledgers/members count=1` × 3 行 + `✅ Seed complete. Ready to POST /entries with ledger_id=00000000-0000-0000-0000-000000000001`。

> 不跑 seed → entries 写入会撞 FK 约束。
> ❌ **禁止直接跑 `USER_ID='mock-user-abc123' npm run db:seed:curl-test`**（字符串字面量 → seed SQL `INSERT INTO families ... owner_id` UUID 列报 `invalid input syntax for type uuid`）。

---

### 0.5 方式 C 前置（D-023 后路径 · 推荐主路径）

#### 0.5.1 域名收敛事实（D-023 · 2026-05-18）

D-023 决议下 staging 与 prod 入口**共用根域** `https://costra.cloud/v1`（子域 `api.* / api-staging.*` 搁置 Phase-2 · 触发条件见 D-023 §2.4）：

| env | apiBaseUrl |
|---|---|
| dev | `http://localhost:8080/v1` |
| **staging** | **`https://costra.cloud/v1`** ⚪ D-023 临时复用 prod URL |
| **prod** | **`https://costra.cloud/v1`** 🟢 D-023 prod 回归根域 |

#### 0.5.2 阻塞清单（7/7 已解 · 公安备案已提交等下证）

| 项 | 状态 |
|---|---|
| ICP 备案 | 🟢 已下证（沪ICP备2026017253号-1X / -2 @ 2026-05-13）|
| **微信白名单** | 🟢 **Human 已配 `https://costra.cloud` @ 2026-05-19**（4 类 request/socket/uploadFile/downloadFile 全填 · 即时生效 · D-023 §7 #1 解锁条件已满足）|
| R-013 风险 | 🟢 Closed @ 2026-05-13 |
| **R-019 公安联网备案** | 🟡 **Human 已提交申请 @ 2026-05-19**（在 30 日窗口内 · 距截止 2026-06-12 余 24 天 · 等公安系统 15~20 工作日审核下证 · 不阻塞实测）|
| **R-020 staging/prod 边界** | 🟡 D-023 派生 · 实测前 §0.5.5 自检 3 项强制 · mitigation 已落实（编译期常量 + WX_MOCK_LOGIN env 隔离）|
| prod server 部署 | 🟢 `49.235.216.20` + nginx + TLS + costra.cloud 已生效 |
| 健康探测 | 🟢 `curl https://costra.cloud/v1/healthz` 期望 200 |

#### 0.5.3 切换步骤（3 项前置 · vs v1.4 5 项 缩 40%）

**前置必勾**：
- [ ] Human 已在微信公众平台「服务器域名」白名单填 `https://costra.cloud`（4 类全填：request/socket/uploadFile/downloadFile）
- [ ] `curl -i https://costra.cloud/v1/healthz` 200 + JSON `status:"ok"`
- [ ] `docs/legal/compliance-registry.md §3` 域名清单显示 `costra.cloud` 🟢

**操作**：
1. 改 `services/env.ts` line 50：`const CURRENT_ENV: EnvName = 'staging';` 或 `'prod';`（仅 staging 验证完毕、Sprint-2 提审前才切 prod）· apiBaseUrl 已是 `https://costra.cloud/v1` 无需改。**禁止 commit · 实测后 git checkout 还原**。
2. 微信开发者工具 → 详情 → 本地设置 → **关闭"不校验合法域名"**
3. 跑前 5 min 自检：
   - `curl -sI https://costra.cloud/v1/healthz` 200 + `Strict-Transport-Security` 头
   - 网络面板能命中 `https://costra.cloud/v1/auth/wx-login`（不是 localhost）
   - 拒绝任何 `http://` 明文请求（应 0 条 · 微信合规）
   - JWT payload base64 解码含真 user_id（不是 mock）

#### 0.5.4 复跑步骤（A → B → C → D.1 → D.2 → E 全套 · 仅 base URL 替换）

与方式 B 步骤一一对应 · URL 由 `http://localhost:8080/v1` → `https://costra.cloud/v1`。

#### 0.5.5 R-020 staging/prod 边界自检（实测前必跑 · 任一不满足立即停）

> **风险**：staging 与 prod 共用 `https://costra.cloud` 白名单 · 微信平台无法区分 · 误推可能污染 prod 数据。

- [ ] **client 编译期常量隔离**：`services/env.ts` 当前 `CURRENT_ENV` 与你预期一致（不混跑 · 一次只验一个 env）
- [ ] **server WX_MOCK_LOGIN 隔离**：`curl -i https://costra.cloud/v1/auth/wx-login -d '{"code":"verify-prod-isolation"}'` 期望返回**真腾讯 code2Session 错误**（`40029` / `45011`）· 绝不应返回 `mock-openid-*` · 若返 mock 立停 + 联系 backend-dev
- [ ] **数据自标识前缀**：实测备注一律用 `staging-test-YYYY-MM-DD-<name>` 或 `prod-verify-YYYY-MM-DD-<name>`（实测后 backend-dev 跑 `db:cleanup-test-data` 清理）

> **R-020 触发** → 立 P0 缺陷单（`qa/defects/...-r-020-trigger.md`）+ 发 `revise:COSTRA-105 reason:r-020-triggered`。

#### 0.5.6 真 staging 实测发现 BUG → 立 P0 缺陷单（`qa/defects/2026-MM-DD-...staging-issue.md`）→ 转介责任 Agent → 阻断微信审核（COSTRA-901）

> **历史叙事**：v1.4 旧版含 `api-staging.costra.cloud` 子域路径剧本（D-023 §4.2 红线保留语义）· 仅在 D-023 §2.4 触发条件出现 + 子域 Phase-2 重启时回归 · 当前不走此路径 · 详见 git 历史 v1.4 / D-023 §0.5.2。

---

### 0.6 R1 实装范围声明（实测前必读 · 防止误判 BUG）

**已实装**：
- `qa/strategy.md` + `qa/cases/single-user-smoke.md` + 本手册 + `qa/automation/README.md` 脚手架 + `qa/checklists/wechat-review.md` 占位

**不实装 · 留 follow-up**：
- 全量 14 用例自动化 → FU-105-AUTOMATION-FULL-COVERAGE（COSTRA-155 候选 P2）
- client 调度器（onShow / 网络恢复 / 周期 / 冷启自动 pull）→ FU-103-CLIENT-SYNC-SCHEDULER（COSTRA-150 候选 P1）· **影响 D.1/D.2 需 Console paste 手动触发**
- conflict 真实合并 UI → FU-103-CONFLICT-MERGE-UI（COSTRA-151 候选 P2 · 不影响本卡）

**R1 实测目标 = H1~H6 全 PASS = 用例集 + 手册 + 闭环 + client⇄server 协议契约对齐无 bug**。

---

## 1. 步骤 A · 冷启动 + 登录闭环（SU-001）

**操作**：
1. Console 清 storage：`wx.clearStorageSync()`
2. 杀小程序 + 编译 → 普通编译
3. 计时（点编译 → home 可点击）
4. 点"一键微信登录"
5. （首次）允许 `getUserProfile` 弹窗

**断言**：

| # | 断言 | 期望 |
|---|---|---|
| A1 | TTI ≤ 2s（NFR）| 可度量 |
| A2 | 2s 内跳 `home` | 页面可见 |
| A3 | `wx.getStorageSync('__costra_token_v1')` 有有效 Token（**注意 envelope** · `tokenEnv.d.raw.access_token` ≥ 36 字符 · v1.6 修订）| Storage Tab |
| A4 | Console 无 `too eayly` 报错（COSTRA-127 兑现）| 0 次 |
| A5 | A：Console `[auth] wx.login ok` + **无** POST 网络请求；B/C：Network 有 `POST /v1/auth/wx-login` 200 + 响应含 5 字段（access_token/refresh_token/access_token_ttl_sec/refresh_token_ttl_sec/user）| Network Tab |

---

## 2. 步骤 B · 在线记一笔（SU-002 · 端到端）

**操作**：
1. 进首页 → FAB `+` → 记一笔页
2. 选"支出" / 金额 `12.34` / 分类"餐饮" / 备注 `manual-test-b`
3. 提交（提交前打开 Console + Storage Tab）

**断言**：

| # | 断言 | 期望 |
|---|---|---|
| B1 | Toast "已记录" / "保存成功" | UI |
| B2 | `entry:__index` 长度 ≥ 1（**注意 envelope** · `idxEnv.d` 是真数组）| Storage |
| B3 | `entry:{client_ref_id}` 存在（格式 `entry:<uuid>`）| Storage |
| B4 | payload 100% snake_case（`ledger_id` / `amount`(int 分) / `category_id` / `occurred_at` · 0 次 `amountCents` 等驼峰）| Console grep |
| B5 | Console 无 `TypeError` / `console.error` | 0 次 |

---

## 3. 步骤 C · 离线 outbox 入队（SU-003）

**操作**：
1. 开发者工具 → **Network → Offline**
2. 离线记一笔：金额 `56.78` / 备注 `offline-test-c` / 分类"交通"
3. 提交

**断言**：

| # | 断言 | 期望 |
|---|---|---|
| C1 | Toast "已记录"（即使断网）| UI |
| C2 | `entry:__index` 长度 = 步骤 B 后 + 1 | Storage |
| C3 | `outbox:__index` 长度 = 原 + 1 | Storage |
| C4 | `outbox:{seq}` payload 含 `amount: 5678`（int 分 · snake_case）| Console |
| C5 | `client_ref_id` 格式 UUID v4（36 字符）| Console |

---

## 4. 步骤 D · 联网恢复 → outbox push + 冷启 pull 回环（SU-004）

> **D 拆 D.1（push 链路诊断）+ D.2（client 视角端到端回环）**·
> D.1 与步骤 E 配对：D.1 验集成层联通 / E 验 server 内核幂等
> D.2 与 D.1 配对：D.1 验"通不通" / D.2 验"用户路径走得通"——三者互补不重叠
>
> **v1.6 修订**：微信小程序 Console 沙箱**禁用 CommonJS `require`** + storage 层 Envelope 包装（`.d`）+ token 双层嵌套（`.d.raw.access_token`）→ 改为 **wx.request fallback 5 步 paste 范式** · D1.2 + D2.2 路径降级（fallback 不走 ackResults / applyServerChanges · 等 FU-105-DEV-CONSOLE-HOOK 实装后回切真路径）。

### 4.1 D.1 · push 链路诊断

**操作**（Console paste 5 步）：

1. 开发者工具 → **Network → Online**

2. 取真 token（注意 envelope `.d.raw` 双层解包）：
   ```js
   const tokenEnv = wx.getStorageSync('__costra_token_v1')
   const token = tokenEnv && tokenEnv.d && tokenEnv.d.raw && tokenEnv.d.raw.access_token
   console.log('token (前 20):', token && token.substring(0, 20), '· length:', token && token.length)
   // 期望：长度 ≥ 36 · 不为 undefined
   ```

3. 取第一个 outbox op（注意 envelope `.d` 解包）：
   ```js
   const idxEnv = wx.getStorageSync('outbox:__index')
   const idx = idxEnv && idxEnv.d
   console.log('outbox seqs:', idx)   // 期望非空数组
   const op0Env = wx.getStorageSync(`outbox:${idx[0]}`)
   const op0 = op0Env && op0Env.d
   console.log('op0:', op0)           // 期望含 op/entity/client_ref_id/payload
   ```
   > 若 `idx` 为空 → outbox 没有待推数据 · 回去重跑 §3。
   > **Envelope 包装说明**：`services/storage.ts` 所有 setItem 自动 `{v, t, ttl?, d}` · 真数据在 `.d`。`auth.ts` token 再包一层 `{raw, access_expires_at, refresh_expires_at}` · 真 access_token 在 `.d.raw.access_token`。

4. 直发 push（绕过 `services/request.ts` 包装层 · 仅验 server 收到 + DB 落库）：
   ```js
   wx.request({
     url: 'http://localhost:8080/v1/sync/push',     // 方式 C → https://costra.cloud/v1/sync/push
     method: 'POST',
     header: {
       'content-type': 'application/json',
       'authorization': `Bearer ${token}`,
       'idempotency-key': op0.idempotency_key
     },
     data: { ops: [{
       op: op0.op, entity: op0.entity,
       client_ref_id: op0.client_ref_id,
       base_version: op0.base_version,
       payload: op0.payload
     }]},
     success: r => console.log('push response:', r.statusCode, r.data),
     fail: e => console.error('push fail', e)
   })
   ```

5. 观察 Console + Network + Storage Tab

**断言**：

| # | 断言 | 期望 |
|---|---|---|
| D1.1 | Network `POST /v1/sync/push` 200 · 响应 `{results: [{client_ref_id, status: 'ok', server_id, server_version: 1}]}` | Network + Console |
| D1.2 | （fallback SKIP）outbox 自动出队需 `wx.__costra_dev_sync__.pushDelta()` 真路径 · 等 FU-105-DEV-CONSOLE-HOOK 实装回归 | — |
| D1.3 | DB 用 op0 实际 `client_ref_id` 查（**不要用 note** · note 可能任意填）：<br>`psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c "SELECT id, ledger_id, client_ref_id, note, amount, type, version FROM entries WHERE client_ref_id = '<op0.client_ref_id>'"` → **1 行** · server_id 与响应一致 · version=1 | psql |

> **v1.6 重要修订**：
> - D1.2 fallback 不走 ackResults · 不影响 H4/H6（H4 由 §5 curl 验 · H6 由 §4.2 验）
> - D1.3 SQL 改 `client_ref_id`（client 自动 UUID · 稳定唯一 · 不依赖人工输入）
> - DB 列名是 `version`（vs 协议字段 `server_version`）

**失败处置**：
- D1.1 401 → token 路径错（最常见）：必须 `tokenEnv.d.raw.access_token`
- D1.1 500 → server 错误日志（找 trace_id）：常见 `payload.ledger_id` 非 UUID（已修 · COSTRA-105 R1.x.1+R1.x.2）
- D1.1 404 → URL 契约 mismatch（应已被 COSTRA-156 修复 · 若仍 404 立 P0）
- D1.3 cnt=0 → 检查 SQL 用 `client_ref_id` 不是 `note`

**实测期发现真 BUG 处置 SOP**（v1.6 新增）：
1. 不停 D.1 实测（用 `payload: {...op0.payload, ledger_id: '<真 UUID>'}` 临时覆盖继续 · 拿 D1.1+D1.3 通过证据）
2. 立 P0 BUG 单 `qa/defects/2026-MM-DD-COSTRA-105-...md`（含 client + server 双责任域具体根因）
3. 派 miniapp-dev + backend-dev R1.x（D-017 v3 §2.4 E1 例外路径 · ≤ 1h 单 commit 收尾）
4. 不阻断 D.2（独立验证路径可继续）

### 4.2 D.2 · client 视角端到端回环

> 🔴 **v1.8 BLOCKED-BY-COSTRA-154**（2026-05-18 20:1x Human 实测发现）：
> - **现象**：`GET /v1/sync/pull?family_id=...&since=...` 返回 **501 NOT_IMPLEMENTED**（server stub）+ 响应 body `deferred_card: COSTRA-154`
> - **根因**：COSTRA-104 R1 主动切出去 sync/pull 实装到 FU-104-SYNC-PULL（候选卡 COSTRA-154 · Sprint-3 P0 头部 · 估 5 点）· 当前 R1 范围内 server 仅提供 stub
> - **影响**：D.2 全 4 断言（D2.1~D2.4）无法验 · 联动 H6 同步 BLOCKED
> - **不阻 COSTRA-105 R1 双卡 approve**：v1.4 `BLOCKED-BY-COSTRA-156` 范式同款（156 修 URL prefix 后 105 自动回归 PASS）· COSTRA-154 实装后 D.2 + H6 自动回归
> - **当前指引**：D.2 全段 SKIP（不再要求 Human 跑）· 等 Sprint-3 COSTRA-154 实装后回归 = 自动等效验
> - **缺陷单**：`qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`

⚠ **以下步骤仅作为 COSTRA-154 实装后回归参考保留**（v1.4 H6 引入时设计 · client wx.request fallback 5 步范式）。

**前置**：D.1 全 PASS · 不清 storage（D.2 起点 = D.1 结束态 · 含 watermark + 本地 entry）· server 仍运行。

**操作**（5 步）：

1. 拿当前 family_id（envelope `.d` 解包）：
   ```js
   const famEnv = wx.getStorageSync('__costra_family_id_v1')
   const familyId = famEnv && famEnv.d
   console.log('family_id:', familyId)
   // 若 storage 未写 → 用 §0.4.4 seed 默认值 '00000000-0000-0000-0000-0000000000F0'
   // 或 psql ... -c "SELECT family_id FROM family_members WHERE user_id = '<your_user_id>'"
   ```

2. 重置 watermark + 清 entry index（模拟"换设备/重装小程序后冷启从 server 拉数据"）：
   ```js
   const FAM = '<上一步 family_id>'
   wx.removeStorageSync(`sync:watermark:${FAM}`)
   wx.removeStorageSync('entry:__index')
   // 不删 entry:{ref_id} · syncPull 会用 server 数据 putEntity 覆盖 · 验"server 是数据真源"
   ```

3. 直发 pull：
   ```js
   const FAM = '<上一步 family_id>'
   const SINCE = '1970-01-01T00:00:00.000Z'   // 模拟换设备首次 pull
   wx.request({
     url: `http://localhost:8080/v1/sync/pull?family_id=${FAM}&since=${encodeURIComponent(SINCE)}&limit=200`,
     method: 'GET',
     header: { 'authorization': `Bearer ${token}` },
     success: r => {
       console.log('pull:', r.statusCode, '· watermark:', r.data?.watermark, '· entries:', r.data?.changes?.entries?.length)
       console.log('full body:', JSON.stringify(r.data, null, 2))
     },
     fail: e => console.error('pull fail', e)
   })
   ```
   > fallback 跳过 client `applyServerChanges` 自动落 storage → D2.2 改人工查 server 返回的 changes.entries（等 FU-105-DEV-CONSOLE-HOOK 回切真路径）

4. （fallback 路径下跳过）

5. 冷启小程序（编译 → 普通编译）· 进首页观察"最近账单"列表

**断言**：

| # | 断言 | 期望 |
|---|---|---|
| D2.1 | Network `GET /v1/sync/pull?family_id=...` 200 · Console 输出 watermark 是 ISO 时间戳 · `changes.entries.length` ≥ 1 | Network + Console |
| D2.2 | （fallback）pull 响应 body 含步骤 C 那笔 entry（`changes.entries[i].client_ref_id` 与 op0 匹配 · 等 FU-105-DEV-CONSOLE-HOOK 回切自动验）| Console 输出 |
| D2.3 | 冷启首页"最近账单"显示 D.1 PASS 的那笔 · 金额/分类/备注与步骤 C 输入完全一致（`amount: 5678` cents → UI 显示 56.78 元）<br>注：fallback 下 D2.3 依赖 home 页冷启自调 pull · 若 home 未实装 pull 触发则 D2.3 等 FU-103-CLIENT-SYNC-SCHEDULER 实装回归 | UI |
| D2.4 | pull 响应 100% snake_case（0 次 `clientRefId` / `occurredAt` / `serverVersion` 等驼峰）| Network Response |

**失败处置**：
- D2.1 404 → URL 契约 mismatch（应已被 COSTRA-156 修复 · 若仍 404 立 P0）
- D2.2 → `applyServerChanges` 实装 bug（miniapp-dev · `services/db.ts:235~252`）
- D2.3 金额错位 → cents↔元 转换 bug · 分类丢失 → category_id 映射 bug · 备注丢失 → server 写入丢字段
- D2.4 驼峰 → server 响应序列化 bug（backend-dev · COSTRA-104 / 155）

---

## 5. 步骤 E · curl 幂等验证（SU-005 · 直 curl · 不经 client）

**操作**（前置 §0.4.3 migrations + §0.4.4 seed 已做）：

```bash
# 5.1 拿 Token + USER_ID
cd /Users/weizhao/Desktop/Costra/server
RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/v1/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"manual-test-105"}')
TOKEN=$(echo $RESPONSE | jq -r '.access_token')
USER_ID=$(echo $RESPONSE | jq -r '.user.id')
echo "TOKEN=$TOKEN  USER_ID=$USER_ID"

# 5.2 seed family/ledger（如未跑过 §0.4.4）
USER_ID=$USER_ID npm run db:seed:curl-test

# 5.3 第一次 POST
curl -s -X POST http://127.0.0.1:8080/v1/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 88888888-8888-8888-8888-888888888888' \
  -d '{"ops":[{"op":"create","entity":"entry","client_ref_id":"manual-idemp-001","base_version":null,"payload":{"ledger_id":"00000000-0000-0000-0000-000000000001","amount":8888,"type":"expense","occurred_at":"2026-05-12T09:00:00.000Z"}}]}' | jq .

# 5.4 立刻重发（同 idempotency-key + 同 body）
# 复用 5.3 命令再跑一次
```

> 方式 C：`http://127.0.0.1:8080` → `https://costra.cloud`

**断言**：

| # | 断言 | 期望 |
|---|---|---|
| E1 | 第 1 次：`results[0].status === "ok"` + `server_version: 1` + `server_id` 合法 UUID | 可度量 |
| E2 | 第 2 次：`status: "ok"` + **相同** `server_id` + **相同** `server_version: 1`（缓存命中）| 完全一致 |
| E3 | DB：`SELECT count(*) FROM entries WHERE client_ref_id = 'manual-idemp-001'` → **1**（不重复入账）| psql |
| E4 | 协议 100% snake_case（0 次 `amountCents` / `serverId` 等驼峰）| 响应字段 |

**失败处置**：E3 > 1 → `revise:COSTRA-105 reason:idempotency-broken`（**真 BUG · backend-dev**）· E1/E2 失败 → 检查 WX_MOCK_LOGIN 是否启 + DB seed 是否跑。

---

## 6. ≥ 6 硬断言 + 步骤 Pass/Fail 集中勾选（v1.7 合并）

> H1~H6 全 PASS = T1 终审放行 · 任意 FAIL = 退回 R1 修复
> **v1.8 收口口径**：H1~H5 🟢 PASS · **H6 🔴 BLOCKED-BY-COSTRA-154**（不阻 R1 双卡 approve · 同 v1.4 BLOCKED-BY-COSTRA-156 范式 · 等 Sprint-3 154 实装后等效回归）· 方式 C ⏸️ M2 Phase-2 复测（不阻 R1）· **R1 = 部分 PASS（H1~H5 全绿 + H6 BLOCKED 已立单）= 双卡 approve 可放行**

| # | 硬断言 | 验证位置 | 模式要求 |
|---|---|---|---|
| **H1** | 冷启 TTI ≤ 2s + Launch Time ≤ 900ms（3.8.12 基线）| §1 A1 | A/B/C 任一 PASS |
| **H2** | `entry:__index` 离线写入持久化不丢 | §3 C2 | A/B/C 任一 PASS |
| **H3** | `outbox:__index` 多 key 分片正确（每条独立 key）| §3 C3+C4 | A/B/C 任一 PASS |
| **H4** | idempotency 重放不重复入账（DB count=1）| §5 E3 | **B 或 C 必跑** · curl 直打验 server 内核数学幂等 |
| **H5** | payload 100% snake_case | §2 B4 + §5 E4 + §4.2 D2.4 三覆盖 | A B4 + B/C E4/D2.4 |
| **H6** | client 离线写入 → push → **冷启 pull 回**显示与输入完全一致（端到端契约对齐 · 集成层 bug 唯一手动捕获路径）| §4.2 D2.2+D2.3 | **B 或 C 必跑** · D-023 后 C 真链路最高保真（覆盖 TLS/nginx/DNS/CDN/微信白名单 5 维）<br>🔴 **v1.8 BLOCKED-BY-COSTRA-154** · 154 实装后回归 |

**步骤勾选清单**（v1.7 合并 · 替代散落 §X.3 Pass/Fail · v1.8 标 partial PASS 实测结果）：

| 步骤 | 方式 A | 方式 B | 方式 C |
|---|---|---|---|
| §1 步骤 A | 🟢 PASS | 🟢 PASS | ⏸️ SKIP（prod M2 复测）|
| §2 步骤 B | 🟢 PASS | 🟢 PASS | ⏸️ SKIP |
| §3 步骤 C | 🟢 PASS | 🟢 PASS | ⏸️ SKIP |
| §4.1 步骤 D.1 | SKIP（不适用）| 🟢 PASS（BUG-001/002 已修 ≥ commit `9be5e84`）| ⏸️ SKIP |
| §4.2 步骤 D.2 | SKIP（不适用）| 🔴 **BLOCKED-BY-COSTRA-154** | ⏸️ SKIP |
| §5 步骤 E | SKIP（无 server）| 🟢 PASS（H4 幂等不重复入账 DB count=1）| ⏸️ SKIP |

**任意失败回报**：`revise:COSTRA-105 reason:<step-X 具体断言失败>`

> **H4 vs H6 立意**：H4 验 server 内核数学幂等（curl 直打 · 不经 client）· H6 验 client→server→DB→client 完整路径契约对齐（小程序连 server）· **二者互补不重叠**——H4 漏不掉幂等 bug · H6 漏不掉集成 bug（如 COSTRA-156 修的 `/v1` URL prefix mismatch · server 单测 + curl 都看不出来）。这是 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律真正立意。

---

## 7. 真机矩阵填充表

| 机型 | 系统 | 微信版本 | 基础库 | 模式 | A | B | C | D.1 | D.2 | E | 总判 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| （Human 填）| | | | A / B / **C-staging** / **C-prod** | | | | | | | |
| （Human 填）| | | | A / B / **C-staging** / **C-prod** | | | | | | | |

> Sprint-2 现实约束：Human 持模拟器 + 1 真机 · iOS/Android × 基础库三档延 Sprint-3（FU-105-AUTOMATION-FULL-COVERAGE）。

---

## 8. 失败分流

| 步骤 FAIL | 转介 | 说明 |
|---|---|---|
| A 登录链路（A1~A4）| miniapp-dev + backend-dev | 方式 A：mockExchange / 方式 B/C：wx.login 真链路 |
| A · A5 网络断言 404 | backend-dev | URL `/v1` mismatch（应已被 COSTRA-156 修复）|
| B 写本地 / payload | miniapp-dev | COSTRA-103 outbox |
| C 离线 outbox | miniapp-dev | outbox 多 key 分片 / snake_case |
| **D.1** push 链路（D1.1/D1.3）| backend-dev / miniapp-dev | 见 §4.1 失败处置 + 实测期真 BUG SOP |
| **D.2** 冷启 pull 回环（D2.1~D2.4）| 见 §4.2 失败处置（按 D2.x 编号分流）| v1.4 新增集成层 bug 唯一手动捕获路径 |
| E 幂等（E1/E2/E3）| backend-dev | COSTRA-104 idempotency_keys 表逻辑 |

---

## 9. 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| **v1.8** | 2026-05-18 20:4x | **Human 实测收尾增量**（v1.7 精简结构基础上 4 处增量 · 不重构）：① 顶层加 v1.8 实测状态表（A/B 🟢 PASS · C ⏸️ M2 跳过 · D.2/H6 🔴 BLOCKED-BY-COSTRA-154）· ② §0.4.4 USER_ID 占位字面量歧义修正为"Console 取真 UUID + 终端 seed"两步范式（避免直跑 `mock-user-abc123` 撞 PG 22P02）· ③ §4.2 D.2 顶部加 BLOCKED 横幅（GET /sync/pull 返 501 · stub 主动切出 FU-104-SYNC-PULL → COSTRA-154 · 不阻 R1）· ④ §6 H6 行 + 步骤勾选清单标 partial PASS 实测结果（H1~H5 🟢 + H6 🔴 BLOCKED + C ⏸️）· 收口口径："R1 部分 PASS = 双卡 approve 可放行"（v1.4 BLOCKED-BY-156 范式同款）· 缺陷单 `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md` |
| v1.7 | 2026-05-18 20:1x | **精简整理**：删 §0.5.1（v1.4 阻塞段）+ §0.5.3（与 §0.5.6 重复）+ §9（手册关系 · 信息量低）· 合并 §1~§5 五处模式适用矩阵 → 顶层 §0.2 单表 · 合并 §1.3/§2.3/§3.3/§4.x.3/§5.3 散落 Pass/Fail → §6 集中勾选清单 · 整合 §0.7 实测起点重置 → §0.3.3 · v1.0~v1.4 修订记录长尾保留摘要（git 历史完整保留）· -300 行 / -35%（846→~520）· **保留所有 v1.6 实测核心**（4 个文档 gap 修订 + R-020 自检 + 实测期真 BUG SOP）|
| **v1.6** | 2026-05-18 19:5x | Human 实测期 4 个文档级 gap 修订（Console 不可 require / storage Envelope `.d` / token `.d.raw.access_token` / DB 列名 `version` + SQL 用 `client_ref_id`）· §4.1.1+§4.2.2 改 wx.request fallback 5 步范式 · §4.1.4 新增"实测期发现真 BUG 处置 SOP" · D1.2/D2.2 路径降级 · 立 P0 BUG 单 `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md`（双责 miniapp-dev + backend-dev · COSTRA-105 R1.x.1/R1.x.2 已修 · commits 33dbdea + db488b9 + 9be5e84） |
| **v1.5** | 2026-05-18 18:4x | D-023 路径升级 · staging/prod URL 收敛根域 `https://costra.cloud/v1` · §0.5 新增 D-023 升级路径（阻塞条件 5/7 已解 · R-020 自检 3 项强制）· §1~§5 模式矩阵方式 C 行 URL 刷新 |
| **v1.4** | 2026-05-13 13:5x | 步骤 D 拆 D.1（push）+ D.2（client 视角回环 · 4 断言）· §6 新增 H6 硬断言（client 离线→push→冷启 pull 回环 · 集成层 bug 唯一手动捕获）· H1~H5→H1~H6 |
| v1.3 | 2026-05-13 11:0x | COSTRA-156 R1 实装后 BLOCKED 注记清除（联合实测时序：等 156 review-tech APPROVE）|
| v1.2 | 2026-05-13 10:2x | URL `/v1` mismatch Human 决策方案 A · 委托 COSTRA-156 修复 |
| v1.1 | 2026-05-12 16:1x | §0 三模式前置完整重写（A/B/C） + 各步骤模式矩阵 + 警示 URL prefix mismatch |
| v1.0 | 2026-05-12 14:55 | COSTRA-105 R1 初版（qa-planner 首次实战）|

---

**事实源 / 依据**：
- `server/api/openapi.yaml` v0.1 · `docs/api/sync-protocol.md` §2/§2.5/§3 · `docs/api/id-strategy.md` · `docs/api/error-codes.md`
- `server/scripts/dev/{migrate,reset-data,seed-curl-test}.sh`（COSTRA-104 R1 dev DX 三件套 · 方式 B 复用）
- `.team/decisions/D-023-prod-rollout-on-root-domain.md`（v1.5 主依据）· D-009（域名锁定原决议 · D-023 §4.1 红线保留）
- `docs/legal/compliance-registry.md` v0.2（沪ICP备2026017253号-1X / -2 · 2026-05-13 下证）
- `.team/risks.md` R-013 🟢 Closed · R-019 🟠 Open（截止 2026-06-12）· R-020 🟡 staging/prod 边界
- `qa/defects/2026-05-18-COSTRA-105-D1-real-test-findings.md`（v1.6 真链路实测发现 · BUG-001/002 · 已修）
- `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`（v1.8 D.2 pull 501 blocker · 关联 COSTRA-154）
