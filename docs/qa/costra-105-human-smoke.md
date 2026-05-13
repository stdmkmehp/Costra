# COSTRA-105 · Human 端到端实测手册（单人记账闭环 + 离线弱网）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张）
> **验证类别**：T2-with-runtime · Human 模拟器实测前置（D-022 §4.1 强制铁律）
> **执行人**：Human（本项目唯一持真微信开发者工具者）
> **预计耗时**：25~35 分钟（5 个步骤 + ≥ 5 硬断言）
> **验证对象**：单人记账完整闭环（client 103 + server 104 拼接）+ 离线弱网专项
> **runtime 类 T2 铁律**：D-022 §4.1 命中（平台 API 运行时行为 + 微信基础库版本差异）· 断言全 PASS 才能 T1 终审
> **修订**：v1.1 · 2026-05-12 16:1x · §0 三模式前置完整重写 + 各步骤模式适用矩阵 + §0.5 真 staging 触发条件 + 复跑剧本（COSTRA-105 R1.1）

---

## 0. 前置环境清单

### 0.1 三模式分流（先决策再执行 · 范式参 102 §0.2）

本卡 5 步骤覆盖**端到端闭环**，client 与 server 联调路径不止一条。先选一种**主模式**（推荐 A → B 双跑），实测起点不同：

| 模式 | 适用场景 | 是否需 server | 是否需 DB | 推荐性 |
|---|---|---|---|---|
| **方式 A · Mock 通路（client 端 mockLogin）** | 仅验 client 侧（登录假 token / 首页 / 记一笔写本地 / outbox 入队 / payload snake_case） | ❌ 不需要 | ❌ 不需要 | ⭐ 起手必跑（~ 8 分钟覆盖步骤 A/B/C） |
| **方式 B · 本地 server**（client 真发 HTTP + server WX_MOCK_LOGIN） | 验 server 端幂等 / 三态消费 / DB 落库 / 离线 → 联网 push 端到端 | ✅ 需要 | ✅ 需要（migrations 全跑齐） | ⭐ 跟进跑（~ 15 分钟覆盖步骤 D/E + 复跑 A/B/C 走真链路） |
| **方式 C · 真 staging** | 贯通真实链路（真 wx.login / 真 JWT / staging DB / 真域名）| ✅ staging server | ✅ staging DB | 🚧 **当前阻塞**（ICP 备案未下证 + `api.costra.cloud` 域名白名单未配 · R-013 未关闭）· 留 Sprint-2 提审前补跑（详见 §0.5） |

> **本次推荐**：先 A 后 B（共 ~ 25 分钟）· C 留 Sprint-2 提审前 ICP 下证 + R-013 关闭后跑（参 charter §9 / `infra/wechat/domains.md §4`）。

> **⚠️ 已知 gap · ✅ 已决策（2026-05-12 16:27 Human 选方案 A · 委托 COSTRA-156 Sprint-3 头部修复）**：
> client `services/env.ts` `apiBaseUrl=http://localhost:8080/v1` + server 实际路由无 `/v1` 前缀 · **方式 B 步骤 D（client 离线→联网→自动 push）会撞 404**。
>
> **决策**：方案 A · server `app.ts` 加 `/v1` prefix 让实装服从 OpenAPI 契约（OpenAPI servers 段 4 条全带 `/v1` 是事实源）。client 0 改动。
>
> **责任卡**：`COSTRA-156` Sprint-3 头部 · 2 点 · backend-dev 主驾 · 早于 COSTRA-150（client 调度器联调依赖此 fix）。详见 `.team/follow-ups/README.md` §族 A · `FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH`。
>
> **本卡处置**：方式 B 步骤 D 显式标 `🚧 BLOCKED-BY-COSTRA-156` · 不阻断本卡 H1~H5 终审。**步骤 E（curl 直打 server · 不经 client buildUrl）不受影响**，可正常实测验证 H4 幂等。**步骤 D 待 COSTRA-156 实装并通过其 review 后回归再跑**（Sprint-3 头部）。

---

### 0.2 通用前置（所有模式共用）

#### 0.2.1 工具 & 凭证
- [ ] **微信开发者工具** ≥ 1.06.x（含基础库 3.8.12 · COSTRA-126 已升级）
- [ ] **项目目录**：`/Users/weizhao/Desktop/Costra`（已 checkout 当前分支 `dev` · HEAD ≥ `fb4c79b` 含 COSTRA-105 R1）
- [ ] **本地 Node.js**：≥ 18.x（`node -v` 确认）
- [ ] **依赖安装**：

```bash
cd /Users/weizhao/Desktop/Costra
npm install                    # root（decimal.js + vitest 等）
npm run typecheck              # 期望 exit 0
npm test                       # 期望 34 tests passed（含 COSTRA-103 db.spec/outbox.spec）
```

#### 0.2.2 微信开发者工具首次准备（首次 / 依赖变更后必做 · COSTRA-123 教训）

1. 以 `/Users/weizhao/Desktop/Costra` **项目根**打开微信开发者工具（**不要**打开 `miniprogram/` 子目录 · COSTRA-121 工具链 SSOT 规约 · 见根 `README.md` §本地开发）
2. 顶部菜单 **工具 → 构建 npm**（确保 `decimal.js` 等 npm 包构建到 `miniprogram_npm/`）
3. 等待 "构建完成" 提示
4. **方式 B/C 必须额外做**：右上角 **详情 → 本地设置** → 勾选 **"不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书"**（因 dev URL 是 `http://localhost:8080` 非 HTTPS · 也非微信白名单域名）

> 📌 方式 A Mock 通路下不发 HTTP 请求 · 此勾选可不开 · 但留着不影响其他实测。

---

### 0.3 方式 A · Mock 通路前置（最快 · 不依赖 server / DB）

#### 0.3.1 确认 client 端 mockLogin = true（默认即是）

文件 `miniprogram/services/env.ts` line 14~24 应保持骨架默认：

```ts
const ENV_MAP: Record<EnvName, EnvConfig> = {
  dev: {
    name: 'dev',
    apiBaseUrl: 'http://localhost:8080/v1',
    mockLogin: true,            // ← 必须 true
    flags: { ... }
  },
  ...
};
const CURRENT_ENV: EnvName = 'dev';   // ← 必须 'dev'
```

如果你之前为方式 B 改过 `mockLogin: false`，此步要**改回 `true`**。

#### 0.3.2 行为说明

- `wx.login` 拿到 code → `auth.ts:164` 检测 `env.mockLogin` 为 true → **走 `mockExchange` 本地造假 token**（`mock.access.<seed>` / `mock.refresh.<seed>`）→ 直接写 storage → 完全不发 HTTP 请求
- 适合验 client 侧本地行为：登录闭环 / 首页渲染 / 记一笔写 storage / outbox 入队 / payload snake_case

#### 0.3.3 不需要做的事

- ❌ 不需要 `cd server && npm run dev`（server 没启也能跑）
- ❌ 不需要 DB（不会有任何写库）
- ❌ 不需要 docker / postgres / redis

---

### 0.4 方式 B · 本地 server 前置（client 真发 HTTP + server WX mock）

#### 0.4.1 切换 client 到真链路（编辑源码 · 暂时性）

文件 `miniprogram/services/env.ts` 临时改：

```ts
dev: {
  ...
  mockLogin: false,             // ← 改为 false（client 真发 wx.request 到 localhost:8080）
  ...
}
```

> **注意**：这是源码修改 · 实测完毕后建议 `git checkout miniprogram/services/env.ts` 还原。**禁止 commit 此改动**（后续 `mockLogin` 默认值由 COSTRA-160 / 构建脚本治理 · 当前手动）。

#### 0.4.2 微信开发者工具勾选"不校验合法域名"

见 §0.2.2 step 4。**方式 B 必须勾**，否则 wx.request 撞域名白名单拒绝。

#### 0.4.3 启动 server（WX_MOCK_LOGIN 模式）

```bash
# 终端 1（保留运行）
cd /Users/weizhao/Desktop/Costra/server
WX_MOCK_LOGIN=1 npm run dev
```

期望日志（pino JSON · 字段顺序不强制）：

```
{"level":30,...,"msg":"Server listening at http://127.0.0.1:8080"}
{"level":30,...,"port":8080,"nodeEnv":"development","msg":"costra-server listening"}
{"level":40,...,"wxMockLogin":true,"msg":"⚠️  WX_MOCK_LOGIN enabled · code2Session mocked · DO NOT enable in production"}
```

只要看到 `port: 8080` + `costra-server listening` + `wxMockLogin:true` 三条即视启动成功。

> **WX_MOCK_LOGIN 含义**：server 启动期注入 mock fetch · 任意 wx.login code 都返成功（`openid: 'mock-openid-<hash>'` / `unionid` / `session_key`）· 跳过腾讯真接口（避免 `40029 invalid code`）。**仅 NODE_ENV=development 生效** · prod 启动会被 loadEnv 拒绝。

#### 0.4.4 DB 准备（首次 / 重建 DB 后）

**前置**：本地已起 postgres + redis（推荐 `cd server && docker compose up -d` · 或自建）。DB 默认连接：`postgres://costra:costra_dev_pw@localhost:5432/costra`。

```bash
# 终端 2
cd /Users/weizhao/Desktop/Costra/server

# 跑齐所有 migrations（按文件名顺序 · 幂等可重跑 · COSTRA-104 R1 落盘的 dev DX 三件套）
npm run db:migrate
```

期望按序跑完 4 个 migration：

| 文件 | 内容 | 来源卡 |
|---|---|---|
| `0001_init.sql` | 全表 schema（users/families/ledgers/family_members/entries/categories/budgets/...）| COSTRA-021 |
| `0002_seed_system_categories.sql` | 12 条系统预设分类 | seed |
| `0003_user_sessions.sql` | user_sessions 表 + 索引 | COSTRA-101 |
| `0004_entries_account_columns.sql` | entries 加 `account_id` + `to_account_id` 列 | COSTRA-104 R1.x.2（修 schema gap）|

**最后输出**：`✅ All migrations applied.`

#### 0.4.5 数据重置（脏数据撞冲突时跑）

```bash
cd /Users/weizhao/Desktop/Costra/server
npm run db:reset-data    # TRUNCATE 业务表（保留 schema + 系统分类）+ redis flushall
```

> 用 TRUNCATE 而非 DROP DATABASE · 误跑可恢复 · 不需要重跑 migrations。

#### 0.4.6 seed family/ledger（步骤 D/E 必跑）

步骤 D（client 离线→联网 push）和步骤 E（curl 幂等）都需要 entries.ledger_id 外键指向**真实存在的** ledger。`USER_ID` 来自步骤 A 登录响应：

```bash
# 步骤 A 登录后 · Console 复制 user.id · 例如 'mock-user-abc123'
# 然后另起终端
cd /Users/weizhao/Desktop/Costra/server
USER_ID='mock-user-abc123' npm run db:seed:curl-test
```

期望输出：

```
==> seeding family/ledger/family_members for user_id=mock-user-abc123
   family_id=00000000-0000-0000-0000-0000000000F0 (ManualTest)
   ledger_id=00000000-0000-0000-0000-000000000001 (Main)
✅ seed done
```

> 如果 step D/E 用真链路 user，必须先跑 seed · 否则 entries 写入会撞 FK 约束。

---

### 0.5 方式 C · 真 staging 前置（当前阻塞 · 解锁后复跑剧本）

#### 0.5.1 当前阻塞原因（charter §9 / `infra/wechat/domains.md` §4）

| 阻塞项 | 状态 | 关闭条件 |
|---|---|---|
| ICP 备案 | 🟡 已提交接入商 · 等通管局短信审核 | 通管局首审通过（估 5 月中下旬）|
| 服务器域名白名单 | ⏳ 备案下证后立即配 `api.costra.cloud` / `api-staging.costra.cloud` | 微信小程序后台「开发管理 → 服务器域名」配齐 4 类（request / socket / uploadFile / downloadFile）|
| R-013 风险 | 未关闭（risks.md R-013）| Human 按 `infra/wechat/domains.md §4` 配置完毕后发 `close:R-013` |
| staging server 部署 | 🟡 开发服务器 `49.235.216.20` 已就位（D-009 · 3 月期）· staging 部署延后到 Sprint-2 末决策（ADR-0002 §部署策略补丁）| docker 镜像推送 + nginx 反代 `api-staging.costra.cloud` + TLS 证书 |

**当前不可跑** · 方式 C 留 Sprint-2 提审前补跑（典型时机：ICP 下证 + 白名单配置完成 + staging 部署完成）。

#### 0.5.2 解锁后复跑剧本（Human 提审前必做 · ~ 15 分钟）

**前置确认**（4 项必勾才执行）：

- [ ] ICP 备案已下证（通管局短信收到）
- [ ] `api-staging.costra.cloud` DNS 解析到 staging server IP（`dig api-staging.costra.cloud` 出 IP）
- [ ] 微信小程序后台「服务器域名」白名单已配 `https://api-staging.costra.cloud`
- [ ] staging server 已部署（`curl https://api-staging.costra.cloud/v1/healthz` 200 · 或 server 实际 health endpoint）
- [ ] `risks.md` R-013 已发 `close:R-013`

**切换步骤**：

1. **改 client `services/env.ts`** 两处：

   ```ts
   // line 50 改：
   const CURRENT_ENV: EnvName = 'staging';   // 'dev' → 'staging'

   // line 28~34 staging 段确认：
   staging: {
     name: 'staging',
     apiBaseUrl: 'https://api-staging.costra.cloud/v1',  // D-009 锁定
     mockLogin: false,
     ...
   }
   ```

   > **注意**：这是源码修改 · 实测完毕后 `git checkout miniprogram/services/env.ts` 还原。

2. **微信开发者工具**：右上角 详情 → 本地设置 → **关闭"不校验合法域名"**（staging 必须真链路 · 由白名单+TLS 真审）

3. **跑前 5 分钟自检**（避免半路阻塞）：
   - 网络面板能命中 `https://api-staging.costra.cloud/v1/auth/wx-login`（走 staging server · 不是 localhost）
   - 拒绝任何 HTTP 明文请求（应该 0 条）
   - `wx.getStorageSync('__costra_token_v1')` 是真 staging 后端签发的 JWT（payload 解 base64 含真 user_id · 不是 mock）

4. **复跑步骤** A → B → E（步骤 C/D 因 client 端调度器留 FU 仍 BLOCKED · 同方式 B）：
   - **步骤 A**（复用 §1）：真 wx.login → 真 code → POST /v1/auth/wx-login（真 staging 服务器）→ 真 JWT
   - **步骤 B**（复用 §2）：在线记一笔 → client 写本地 + 入 outbox（行为同方式 B）
   - **步骤 E**（复用 §5）：curl 直打 staging：`curl https://api-staging.costra.cloud/v1/sync/push ...` · 验幂等

5. **额外断言**（仅 staging）：
   - 网络面板 0 次 `http://` 明文请求（合规 · 提审前必查）
   - Console 无 `getRealtimeLogManager` 警告
   - JWT iss/aud 字段是 staging 真值（不是 dev mock）

#### 0.5.3 真 staging 实测发现 BUG 处置

- 立 P0 缺陷单（路径 `qa/defects/2026-MM-DD-COSTRA-105-staging-issue.md` · 模板 qa-planner §5.2）
- 转介责任 Agent（backend-dev / miniapp-dev / devops-ops）
- 阻断微信审核提交（COSTRA-901）直至修复

---

### 0.6 R1 范围声明（实测前必读 · 防止误判 BUG）

> **本卡 R1 实装范围**（5 项交付）：
>
> - `qa/strategy.md`（163 行 · 7 段结构）
> - `qa/cases/single-user-smoke.md`（14 条用例 · 九类覆盖 9/9）
> - **本手册**（Human 模拟器实测 5 步 + ≥ 5 硬断言）
> - `qa/automation/README.md`（脚手架形式 ② · INVEST small 守卫）
> - `qa/checklists/wechat-review.md`（占位骨架 · 留 COSTRA-901）
>
> **不实装 · 留 follow-up**：
>
> | 不实装项 | 留 FU | 影响实测哪步 |
> |---|---|---|
> | 全量 14 用例自动化 + CI 集成 | FU-105-AUTOMATION-FULL-COVERAGE（Sprint-3 P2 5 点）| 不影响（自动化是脚手架 · 实测靠手动）|
> | client 调度器（onShow / 网络恢复 / 周期 setInterval）| FU-103-CLIENT-SYNC-SCHEDULER（Sprint-3 候选 COSTRA-150）| **方式 B 步骤 D**（client 自动 push 不会触发 · 需 console 手动调 `pushDelta()`）|
> | conflict 真实合并 UI | FU-103-CONFLICT-MERGE-UI（Sprint-3 候选 COSTRA-151）| 不影响本卡（步骤 E curl 验幂等 · 不验合并 UI）|
> | client/server URL `/v1` 前缀一致性 | ✅ **已决策方案 A · COSTRA-156**（Sprint-3 头部 · server 加 prefix）| **方式 B 步骤 D**（当前撞 404 · COSTRA-156 实装后回归）|
>
> **R1 实测目标 = 闭环可达性 + 用例可执行性**：H1~H5 全 PASS = 用例集 + 手册 + 闭环逻辑无 bug · 调度器 + URL 一致性留 FU 不阻断。

---

### 0.7 实测起点重置（每步开始前自检 · 参 103 §0.5 范式）

每个步骤开始前 · 在微信开发者工具 Console 跑：

```js
// 仅清 client storage（不影响 DB · 重测起点对齐）
wx.clearStorageSync()
console.log('storage cleared, ready for next step')
```

如要彻底起点（包含 DB · 仅方式 B/C）：

```bash
cd server && npm run db:reset-data
# 然后重新跑 npm run db:seed:curl-test（如步骤 D/E 需要）
```

---

## 1. 步骤 A · 冷启动 + 登录闭环（SU-001 对应）

### 1.0 模式适用矩阵

| 模式 | 是否适用 | 备注 |
|---|---|---|
| 方式 A · Mock | ✅ 必跑 | 验 client 端 mockExchange + storage 写入 · 不发 HTTP |
| 方式 B · 本地 server | ✅ 复跑（推荐）| 验真 wx.login → POST /auth/wx-login → 真 JWT |
| 方式 C · 真 staging | 🚧 阻塞（§0.5）| 同方式 B 但 base URL 是 `https://api-staging.costra.cloud/v1` |

### 1.1 操作

1. **清 storage**（Console 执行）：
   ```js
   wx.clearStorageSync()
   console.log('storage cleared, ready for step A')
   ```
2. **杀掉小程序**（编译 → 普通编译 · 或重新打开微信开发者工具）
3. **计时**：从点击编译到 `home` 可点击
4. 点"一键微信登录"
5. （首次）允许 `getUserProfile` 授权弹窗

### 1.2 断言（5 条）

| # | 断言 | 期望 | 模式适用 |
|---|---|---|---|
| A1 | TTI ≤ 2s（NFR）| 可度量 | 全模式 |
| A2 | 2s 内跳 `home` | 页面可见 | 全模式 |
| A3 | `wx.getStorageSync('__costra_token_v1')` 有有效 Token（access_token ≥ 36 字符）| Storage Tab 可见 | 全模式 |
| A4 | Console 无 `too eayly` 报错（COSTRA-127 兑现） | 0 次 | 全模式 |
| A5 | 方式 A：Console 打印 `[auth] wx.login ok { codeLen: xx }` 但 **无** `POST /auth/wx-login` 网络请求；方式 B：网络面板有 **POST http://localhost:8080/v1/auth/wx-login** 200 + 响应含 5 字段（access_token / refresh_token / access_token_ttl_sec / refresh_token_ttl_sec / user）| Network Tab | 模式 A 验"不发"· 模式 B 验"真发" |

> 方式 B A5 若返 404 · 即手册修订发现的 URL `/v1` mismatch · 不阻断本卡（FU 待立）· 跳过此项继续。

### 1.3 Pass/Fail

- [ ] 方式 A · Pass · [ ] Fail
- [ ] 方式 B · Pass · [ ] Fail
- 失败回报模板：`revise:COSTRA-105 reason:<step-A 具体断言失败>`

---

## 2. 步骤 B · 在线记一笔（SU-002 对应 · 端到端）

### 2.0 模式适用矩阵

| 模式 | 是否适用 | 备注 |
|---|---|---|
| 方式 A · Mock | ✅ 必跑 | 验 client 写本地 entry storage + payload snake_case · 不发 HTTP |
| 方式 B · 本地 server | ✅ 复跑 | 验 client 同时入本地 + 入 outbox 待 push（COSTRA-103 R1 行为）|
| 方式 C · 真 staging | 🚧 阻塞（§0.5）| 同方式 B |

### 2.1 操作

1. 进入首页 → 点击 FAB `+` → 进入记一笔页
2. 选"支出"，金额输入 `12.34`，分类选"餐饮"，备注 `manual-test-b`
3. 提交（点保存）
4. **提交前打开 Console → Storage Tab 准备观察**

### 2.2 断言（5 条 · 全模式）

| # | 断言 | 期望 |
|---|---|---|
| B1 | Toast "已记录" 或 "保存成功" | UI 可见 |
| B2 | `entry:__index` 长度 ≥ 1 | Storage Tab |
| B3 | `entry:{client_ref_id}` 存在（格式 `entry:<uuid>`）| Storage Tab |
| B4 | payload 100% snake_case（`ledger_id` / `amount`（int 分）/ `category_id` / `occurred_at` · 0 次 `amountCents` / `categoryId` 等驼峰）| Console grep |
| B5 | Console 无 `TypeError` / `console.error` | 0 次 |

### 2.3 Pass/Fail

- [ ] 方式 A · Pass · [ ] Fail
- [ ] 方式 B · Pass · [ ] Fail
- 失败回报：`revise:COSTRA-105 reason:<step-B 具体断言失败>`

---

## 3. 步骤 C · 离线记一笔 + outbox 入队（SU-003 对应）

### 3.0 模式适用矩阵

| 模式 | 是否适用 | 备注 |
|---|---|---|
| 方式 A · Mock | ✅ 必跑 | mockLogin 模式下也走 outbox 入队（COSTRA-103 outbox 与 server 解耦 · 仅看 storage）|
| 方式 B · 本地 server | ✅ 复跑 | 行为同方式 A · 入队后下一步 D 验 push |
| 方式 C · 真 staging | 🚧 阻塞（§0.5）| 同方式 B |

### 3.1 操作

1. 开发者工具 → **Network → Offline**（模拟断网 · 微信开发者工具内置选项）
2. 在离线状态下记一笔：金额 `56.78`，备注 `offline-test-c`，分类"交通"
3. 提交

### 3.2 断言（5 条 · 全模式）

| # | 断言 | 期望 |
|---|---|---|
| C1 | Toast "已记录"（本地排队 · 即使断网也能保存）| UI 可见 |
| C2 | `entry:__index` 长度 = 步骤 B 后 + 1 | Storage Tab |
| C3 | `outbox:__index` 长度 = 原长度 + 1 | Storage Tab |
| C4 | `outbox:{seq}` payload 含 `amount: 5678`（snake_case · int 分单位）| Console |
| C5 | `client_ref_id` 格式 UUID v4（36 字符）| Console |

### 3.3 Pass/Fail

- [ ] 方式 A · Pass · [ ] Fail
- [ ] 方式 B · Pass · [ ] Fail

---

## 4. 步骤 D · 联网恢复 → outbox 自动 push（SU-004 对应）

### 4.0 模式适用矩阵

| 模式 | 是否适用 | 备注 |
|---|---|---|
| 方式 A · Mock | ❌ 不适用 | mockLogin 不发 HTTP · 看不到 push 行为 · 直接 SKIP |
| 方式 B · 本地 server | 🚧 **BLOCKED-BY-COSTRA-156**（已决策方案 A · 待 Sprint-3 头部修）| client `/v1/sync/push` vs server `/sync/push` 路径不匹配 · 实测会撞 404 · 不阻断本卡（已立 FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH + COSTRA-156 占位卡）|
| 方式 C · 真 staging | 🚧 阻塞（§0.5）| COSTRA-156 URL fix + COSTRA-150 调度器实装后再跑 |

### 4.1 操作（方式 B · 阻塞下仅做"诊断式实测"）

1. 开发者工具 → **Network → Online**（取消离线）
2. **手动触发 push**（因为 R1 不实装调度器 · 不会自动）：在 Console 执行：
   ```js
   const sync = require('./services/sync')
   sync.pushDelta().then(r => console.log('push result', r)).catch(e => console.error('push fail', e))
   ```
3. 观察 Console + Network

### 4.2 断言（3 条 · 仅做诊断 · **当前不阻断 H1~H5**）

| # | 断言 | 期望 | 当前预期结果（手册修订时） |
|---|---|---|---|
| D1 | Console 有 `POST .../sync/push` 请求 | 日志可见 | 🟡 看得到请求发出但 404 |
| D2 | `outbox:__index` 长度 = 原长度 - 已推条数（或 outbox item 有 `pushed_at` 标记）| Storage Tab | 🚧 BLOCKED-BY-URL-MISMATCH（push 失败 outbox 不会出队）|
| D3 | DB 查询：`psql ... -c "SELECT count(*) FROM entries WHERE note = 'offline-test-c'"` → 1 | psql | 🚧 BLOCKED（push 没成功 DB 没记录）|

### 4.3 Pass/Fail

- [ ] 方式 A · SKIP（不适用）
- [ ] 方式 B · 🚧 BLOCKED-BY-COSTRA-156（不阻断本卡终审 · COSTRA-156 Sprint-3 头部修复后回归）

> **失败处置**：步骤 D 当前 FAIL 是预期 · COSTRA-156（Sprint-3 头部 · 2 点 · backend-dev）实装并通过 review 后回归再跑。**本卡步骤 D 不计入 H1~H5 硬断言**。

---

## 5. 步骤 E · 幂等验证（SU-005 对应 · 直 curl server · 不经 client）

### 5.0 模式适用矩阵

| 模式 | 是否适用 | 备注 |
|---|---|---|
| 方式 A · Mock | ❌ 不适用（无 server）| SKIP |
| 方式 B · 本地 server | ✅ **必跑**（不依赖 client URL · 直 curl 走 server 真实路径） | 复用 COSTRA-104 curl 范式 |
| 方式 C · 真 staging | 🚧 阻塞（§0.5）| 把 base URL 换 staging |

### 5.1 操作（方式 B · 前置 §0.4.4 migrations + §0.4.6 seed 已做）

```bash
# 5.1.1 拿 Token + USER_ID（任意 code · WX_MOCK_LOGIN=1 接受）
cd /Users/weizhao/Desktop/Costra/server
RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"manual-test-105"}')
echo $RESPONSE | jq .
TOKEN=$(echo $RESPONSE | jq -r '.access_token')
USER_ID=$(echo $RESPONSE | jq -r '.user.id')
echo "TOKEN=$TOKEN  USER_ID=$USER_ID"

# 5.1.2 seed family/ledger（如未跑过 §0.4.6）
USER_ID=$USER_ID npm run db:seed:curl-test

# 5.1.3 第一次 POST（idempotency-key + client_ref_id 双重）
curl -s -X POST http://127.0.0.1:8080/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 88888888-8888-8888-8888-888888888888' \
  -d '{"ops":[{"op":"create","entity":"entry","client_ref_id":"manual-idemp-001","base_version":null,"payload":{"ledger_id":"00000000-0000-0000-0000-000000000001","amount":8888,"type":"expense","occurred_at":"2026-05-12T09:00:00.000Z"}}]}' | jq .

# 5.1.4 立刻重发（同 idempotency-key + 同 body）
curl -s -X POST http://127.0.0.1:8080/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 88888888-8888-8888-8888-888888888888' \
  -d '{"ops":[{"op":"create","entity":"entry","client_ref_id":"manual-idemp-001","base_version":null,"payload":{"ledger_id":"00000000-0000-0000-0000-000000000001","amount":8888,"type":"expense","occurred_at":"2026-05-12T09:00:00.000Z"}}]}' | jq .
```

### 5.2 断言（4 条）

| # | 断言 | 期望 |
|---|---|---|
| E1 | 第 1 次响应：`results[0].status === "ok"` + `server_version: 1` + `server_id` 是合法 UUID | 可度量 |
| E2 | 第 2 次响应：`results[0].status === "ok"` + **相同** `server_id` + **相同** `server_version: 1` | 完全一致 |
| E3 | DB：`psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c "SELECT count(*) FROM entries WHERE client_ref_id = 'manual-idemp-001'"` → **1** | psql |
| E4 | 协议 100% snake_case（响应 0 次 `amountCents` / `categoryId` / `serverId` 等驼峰）| 响应字段 |

### 5.3 Pass/Fail

- [ ] 方式 B · Pass · [ ] Fail
- 失败回报：
  - E3 返回 > 1 → `revise:COSTRA-105 reason:idempotency-broken`（**真 BUG · backend-dev 修**）
  - E1/E2 失败 → 检查 server WX_MOCK_LOGIN 是否启 + DB seed 是否跑

---

## 6. ≥ 5 硬断言（H1~H5 · 全 PASS 才可 T1 终审）

| # | 断言 | 验证位置 | 模式要求 | 对应 DoD |
|---|---|---|---|---|
| **H1** | 冷启 TTI ≤ 2s + Launch Time ≤ 900ms（3.8.12 基线）| 步骤 A A1 | 方式 A 或 B 任一 PASS 即可 | DoD §3.2 |
| **H2** | `entry:__index` 离线写入持久化不丢（`offline-test-c` 在）| 步骤 C C2 | 方式 A 或 B 任一 PASS | DoD §3.2 |
| **H3** | `outbox:__index` 多 key 分片正确（0 次单 key 数组残留 · 每条独立 key）| 步骤 C C3+C4 | 方式 A 或 B 任一 PASS | DoD §3.2 |
| **H4** | idempotency 重放不重复入账（DB count = 1）| 步骤 E E3 | **方式 B 必跑**（curl 直打 server）| DoD §3.2 |
| **H5** | payload 100% snake_case（`ledger_id` / `amount` / `category_id`）| 步骤 B B4 + 步骤 E E4 | 方式 A B4 + 方式 B E4 双覆盖 | DoD §3.2 |

**H1~H5 全 PASS = T1 终审放行** · **任意 FAIL（不含步骤 D 当前 BLOCKED）= 卡退回 R1 修复**

> 步骤 D 因 URL mismatch BLOCKED 不计入 H1~H5。该 gap 已 Human 决策方案 A · 委托 COSTRA-156（Sprint-3 头部 · 独立卡 · 早于 COSTRA-150）修复。

---

## 7. 真机矩阵填充表

| 机型 | 系统 | 微信版本 | 基础库版本 | 模式 | 步骤 A | 步骤 B | 步骤 C | 步骤 D | 步骤 E | 通过/失败 |
|---|---|---|---|---|---|---|---|---|---|---|
| （Human 填）| | | | A 或 B | | | | | | |
| （Human 填）| | | | A 或 B | | | | | | |

> Sprint-2 现实约束：Human 持微信开发者工具模拟器 + 1 真机 · iOS/Android 各 ≥ 2 真机 + 基础库三档延 Sprint-3 · 走 FU-105-AUTOMATION-FULL-COVERAGE 后回头补。

---

## 8. 失败分流

| 步骤 FAIL | 转介 Agent | 说明 |
|---|---|---|
| A · 登录链路（A1~A4 任一）| miniapp-dev + backend-dev | 方式 A：mockExchange 走错；方式 B：wx.login 真链路 / JWT 错 |
| A · A5（方式 B 网络断言）| backend-dev（COSTRA-156）| client `/v1` 前缀 vs server 无前缀 · 已立 FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH + COSTRA-156 占位卡 |
| B · 写本地 / payload | miniapp-dev | COSTRA-103 client outbox 行为 |
| C · 离线 outbox 入队 | miniapp-dev（COSTRA-103 相关）| outbox 多 key 分片 / payload snake_case |
| D · push 失败（当前 BLOCKED-BY-COSTRA-156）| backend-dev（COSTRA-156 主驾）| COSTRA-156 Sprint-3 头部修复后再走 |
| E · 幂等（E1/E2/E3）| backend-dev（COSTRA-104 相关）| server idempotency_keys 表逻辑 |

---

## 9. 与 102/103/104 手册关系

| 手册 | 角色 | 本卡复用/扩展 |
|---|---|---|
| `costra-102-human-verify.md` | 登录→首页→记一笔 E2E（已通）| **§0.2 三模式范式（A/B/C）直接借鉴** · 步骤 A 复用登录闭环 · 步骤 B 复用记一笔格式 |
| `costra-103-human-verify.md` | client outbox 本地 KV 持久化（5 步已通）| 复用 §0.5 实测起点重置 + 步骤 B/C 断言逻辑（entry key / outbox key）|
| `costra-104-curl-verify.md` | server curl 5 步实测（已通）| **§0.4 dev DX 三件套范式直接复用**（WX_MOCK_LOGIN / `npm run db:migrate` / `npm run db:seed:curl-test`）+ 步骤 E 幂等 curl 格式 |

---

## 10. 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| **v1.2** | 2026-05-13 10:2x | URL mismatch Human 决策同步：§0.1 警示 + §0.6 R1 范围 + §4 步骤 D 模式矩阵/Pass-Fail/失败处置 + §6 H1~H5 注记 + §8 失败分流 D 行 / A5 行 全部从"待 Human 决策"刷新为"✅ 已决策方案 A · 委托 COSTRA-156 Sprint-3 头部修复" · COSTRA-105 R1.1 文档 housekeeping |
| **v1.1** | 2026-05-12 16:1x | §0 三模式前置完整重写（方式 A Mock / 方式 B 本地 server / 方式 C 真 staging）+ 各步骤模式适用矩阵 + §0.5 真 staging 触发条件 + 复跑剧本 + 警示 client/server URL `/v1` 前缀 mismatch（待 Human 决策）+ 步骤 D 标 BLOCKED-BY-URL-MISMATCH 不阻断 H1~H5 + 修订记录段 · COSTRA-105 R1.1 |
| v1.0 | 2026-05-12 14:55 | COSTRA-105 R1 初版（qa-planner 首次实装实战）|

---

**协议事实源**：
- `server/api/openapi.yaml` v0.1
- `docs/api/sync-protocol.md` §2（sync/push 三态）/ §2.5（24h 强幂等）/ §3（version conflict）
- `docs/api/id-strategy.md`（client_ref_id / idempotency_key 格式）
- `docs/api/error-codes.md`（错误码枚举）

**dev DX 三件套**（COSTRA-104 R1 落盘 · 本手册方式 B 复用）：
- `server/scripts/dev/migrate.sh` → `npm run db:migrate`
- `server/scripts/dev/reset-data.sh` → `npm run db:reset-data`
- `server/scripts/dev/seed-curl-test.sh` → `USER_ID=xxx npm run db:seed:curl-test`

**外部资源依据**：
- charter §9（外部资源进度 · ICP / 域名 / AppID）
- `infra/wechat/domains.md §4`（R-013 关闭条件 · `api.costra.cloud` 白名单）
