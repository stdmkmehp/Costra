# COSTRA-105 · Human 端到端实测手册（单人记账闭环 + 离线弱网）

> **卡号**：COSTRA-105（Sprint-2 主线第 4 张）
> **验证类别**：T2-with-runtime · Human 模拟器实测前置（D-022 §4.1 强制铁律）
> **执行人**：Human（本项目唯一持真微信开发者工具者）
> **预计耗时**：25~35 分钟（5 个步骤 + ≥ 5 硬断言）
> **验证对象**：单人记账完整闭环（client 103 + server 104 拼接）+ 离线弱网专项
> **runtime 类 T2 铁律**：D-022 §4.1 命中（平台 API 运行时行为 + 微信基础库版本差异）· 断言全 PASS 才能 T1 终审
> **修订**：v1.5 · 2026-05-18 18:4x · D-023 落地后 prod/staging 入口收敛根域 `https://costra.cloud/v1` · §0.1 三模式表方式 C 升级 🚧→🟢 + §0.5 新增 §0.5.0 D-023 升级路径（**当前可跑实测主路径**：阻塞条件 5/7 已解 + Human 操作 3 件 + R-020 staging/prod 边界自检 3 项强制）+ §1~§5 五处步骤模式适用矩阵方式 C 行 URL 刷新 · 历史 §0.5.1~§0.5.3 D-023 §4.2 红线保留不动 · 等 Human 微信公众平台填白名单后即可跑方式 C 主路径 → 双卡 H1~H6 真链路实测 → 双卡 approve

---

## 0. 前置环境清单

### 0.1 三模式分流（先决策再执行 · 范式参 102 §0.2）

本卡 5 步骤覆盖**端到端闭环**，client 与 server 联调路径不止一条。先选一种**主模式**（推荐 A → B 双跑），实测起点不同：

| 模式 | 适用场景 | 是否需 server | 是否需 DB | 推荐性 |
|---|---|---|---|---|
| **方式 A · Mock 通路（client 端 mockLogin）** | 仅验 client 侧（登录假 token / 首页 / 记一笔写本地 / outbox 入队 / payload snake_case） | ❌ 不需要 | ❌ 不需要 | ⭐ 起手必跑（~ 8 分钟覆盖步骤 A/B/C） |
| **方式 B · 本地 server**（client 真发 HTTP + server WX_MOCK_LOGIN） | 验 server 端幂等 / 三态消费 / DB 落库 / 离线 → 联网 push 端到端 | ✅ 需要 | ✅ 需要（migrations 全跑齐） | ⭐ 跟进跑（~ 15 分钟覆盖步骤 D/E + 复跑 A/B/C 走真链路） |
| **方式 C · 真 staging / prod**（D-023 后路径 · v1.5 升级） | 贯通真实链路（真 wx.login / 真 JWT / 真 DB / 真域名 `costra.cloud`）| ✅ prod server（已部署）| ✅ prod DB（已 migrations 齐）| 🟢 **D-023 后可跑**（ICP ✅ 下证 + R-013 ✅ Closed + 主域 `costra.cloud` 🟢 已生效 + nginx/TLS 已配 · 仅等 Human 在微信公众平台填白名单 · 详见 §0.5.0）|

> **本次推荐**（v1.5 D-023 后）：
> - **优先序**：A 起手 → B 跟进 → **C 主路径**（验真链路 · ~ 35 分钟全套 · 含 H1~H6 真 server 实测）
> - **R-020 强约束**：方式 C staging 与 prod 共用域名 · 实测前 §0.5.0.5 三项自检全勾才执行（避免误污染 prod 数据）
> - **方式 C 替代方式 B 大部分价值**：除非 server 端开发期 debug · 否则 D-023 后建议 A + C 双跑（B 退化为 server-side 修代码后回归用）

> **⚠️ 已知 gap 已修复 · ✅ COSTRA-156 R1 review-tech APPROVE 后即可跑步骤 D**：
> 2026-05-13 COSTRA-156 R1 实装完成：server `app.ts` 加 `/v1` prefix 包裹业务路由 · client 0 改动 · OpenAPI servers 契约已兑现。
>
> **联合实测时序**：本手册步骤 D（D.1 + D.2）需等 156 R1 review-tech APPROVE 后才能跑（COSTRA-105 R1.1 手册 v1.4 同步明示）。
>
> **步骤 A/B/C/E 均不受影响**，可正常实测验证 H1~H5；**H6 必须等 156 APPROVE 后跑步骤 D.2 才能验**（v1.4 新增）。

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

### 0.5 方式 C · 真 staging / prod 前置（D-023 升级路径 · v1.5 推荐主路径）

> 📌 **v1.5 增量说明**（2026-05-18 D-023 落地后）：本节由 v1.4 的"🚧 阻塞段 + 解锁后剧本"升级为"🟢 D-023 后可跑主路径 + 历史叙事保留参考"。原 §0.5.1~§0.5.3 历史叙事**保留不动**（D-023 §4.2 红线 · 历史时序不回溯改写），新增 §0.5.0 为当前实际执行路径。

#### 0.5.0 D-023 后状态升级（**当前可跑实测主路径** · v1.5 新增）

##### 0.5.0.1 域名收敛事实（D-023 · 2026-05-18 落地）

D-023 决议下 staging 与 prod 入口**临时共用根域** `https://costra.cloud/v1`（子域 `api.* / api-staging.*` 搁置至 Phase-2 · 重启触发条件见 D-023 §2.4）：

| env | 当前 apiBaseUrl | D-009 原规划 | 备注 |
|---|---|---|---|
| dev | `http://localhost:8080/v1` | 不变 | 本地 server 模式 |
| **staging** | **`https://costra.cloud/v1`** | `https://api-staging.costra.cloud/v1` | ⚪ D-023 临时复用 prod URL · 子域启用时切回 |
| **prod** | **`https://costra.cloud/v1`** | `https://api.costra.cloud/v1`（曾规划）| 🟢 D-023 prod 入口回归根域 · 与 ICP 下证主域一致 |

##### 0.5.0.2 阻塞条件最新清单（vs §0.5.1 历史叙事大幅松绑）

| 阻塞项 | v1.4 状态 | **v1.5 D-023 后状态** | 备注 |
|---|---|---|---|
| ICP 备案 | 🟡 等通管局短信 | 🟢 **已下证**（沪ICP备2026017253号-1X / -2 @ 2026-05-13）| `docs/legal/compliance-registry.md` |
| 服务器域名白名单 | ⏳ 备案下证后配 `api-staging.*` + `api.*` | 🟡 **仅等 Human 在微信公众平台后台填 `https://costra.cloud`**（D-023 §7 操作清单 #1 · ~5 分钟 · 即时生效）| `infra/wechat/domains.md §4.2` |
| R-013 风险 | 未关闭 | 🟢 **已 Closed @ 2026-05-13** | risks.md |
| R-019 公安联网备案 | — | 🟠 Open（截止 2026-06-12 · 不阻塞实测）| risks.md |
| **R-020 staging/prod 边界**（D-023 派生）| — | 🟡 **新增 Open**（实测时引入"环境标识自检"避免误污染 prod 数据 · 见 §0.5.0.5）| risks.md |
| staging server 部署 | 🟡 ADR-0002 §部署策略补丁 | 🟢 **prod = staging 共用** `49.235.216.20:80/443` 已就位 · `nginx + TLS + costra.cloud` 已生效 | 主域 A 记录 + Let's Encrypt 已签 |
| `costra.cloud` 健康探测 | — | 🟢 `curl https://costra.cloud/v1/healthz` 期望 200 | 实测前自检命令 |

##### 0.5.0.3 v1.5 推荐执行路径（vs v1.4 §0.5.2 复跑剧本简化版）

**前置确认（3 项必勾才执行 · 比 v1.4 §0.5.2 的 5 项缩短 ~40%）**：

- [ ] Human 已在微信公众平台「服务器域名」白名单填 `https://costra.cloud`（4 类全填：request / socket / uploadFile / downloadFile · D-023 §7 操作 #1）
- [ ] 本机 `curl -i https://costra.cloud/v1/healthz` 期望 200 + JSON 含 `status:"ok"` · ICP 备案号 `沪ICP备2026017253号-2`（FU-DEVOPS-NGINX-ICP-HEADER 实装后头部也会带 · 见 D-023 §4.3）
- [ ] `docs/legal/compliance-registry.md §3` 域名清单显示 `costra.cloud` 状态 🟢

**切换步骤**（vs v1.4 §0.5.2 步骤 1 改两处 → v1.5 仅改 1 处 enum · 编译期常量已对齐）：

1. **改 client `services/env.ts`** 仅 1 处（apiBaseUrl 不需改 · 已是 `https://costra.cloud/v1`）：

   ```ts
   // line 50：
   const CURRENT_ENV: EnvName = 'staging';   // 'dev' → 'staging'（验"准 staging"）
   // 或：
   const CURRENT_ENV: EnvName = 'prod';      // 验真 prod 入口（**仅在 staging 验证完毕、Sprint-2 提审前才切 prod**）
   ```

   > **⚠️ R-020 边界**：`services/env.ts` line 25~46 staging 段含强约束注释 `// D-023 临时复用 prod URL...`，回切 staging 子域时按此注释精确恢复（防漂移）。**禁止 commit 此 CURRENT_ENV 改动** · 实测完毕 `git checkout miniprogram/services/env.ts` 还原。

2. **微信开发者工具**：右上角 详情 → 本地设置 → **关闭"不校验合法域名"**（真链路必须真审 · 与 v1.4 §0.5.2 step 2 同）

3. **跑前 5 分钟自检（v1.5 强化）**：
   - `curl -sI https://costra.cloud/v1/healthz` 返回 200 + `Strict-Transport-Security` 头存在（HTTPS 强制）
   - 网络面板能命中 `https://costra.cloud/v1/auth/wx-login`（走真 server · 不是 localhost）
   - 拒绝任何 HTTP 明文请求（应该 0 条 · 微信平台合规要求）
   - `wx.getStorageSync('__costra_token_v1')` 是真后端签发的 JWT（payload 解 base64 含真 user_id · 不是 mock）

##### 0.5.0.4 复跑步骤映射（v1.5 与 v1.4 §0.5.2 对齐）

跑步骤 **A → B → C → D.1 → D.2 → E** 全套（与方式 B 步骤一一对应 · 仅 base URL 替换）：

| 步骤 | 方式 C URL 替换 | 与 v1.4 差异 |
|---|---|---|
| **A** | `POST https://costra.cloud/v1/auth/wx-login` | URL 由 `api-staging.costra.cloud` → `costra.cloud` |
| **B** | client 真发 `POST https://costra.cloud/v1/sync/push`（H5 snake_case 验同方式 B）| 同上 |
| **C** | 离线断网（不发 HTTP · 与方式 B 同）| 无差异 |
| **D.1** | `POST https://costra.cloud/v1/sync/push` 200 + DB 落库（如 Human 有 server SSH 可 psql 自查；否则跳 D.1 D1.3 项）| URL 替换 |
| **D.2** | `GET https://costra.cloud/v1/sync/pull?...` 200 + 冷启首页一致 | URL 替换 |
| **E** | `curl https://costra.cloud/v1/sync/push ...` 验幂等 | URL 替换 |

##### 0.5.0.5 R-020 staging/prod 边界自检（v1.5 强制 · 实测前必跑）

> **R-020 风险描述**：D-023 §2.2 决议下 staging env 与 prod env 在「微信白名单」层共用 `https://costra.cloud`，从微信平台视角**无法区分两者**。若开发期误把 staging 测试数据 push 到 prod 数据库，造成**生产数据污染**。

**实测前 3 项强制自检**（任一不满足 → 立即停止 · 不跑实测）：

- [ ] **client 编译期常量隔离**：`services/env.ts` 当前 `CURRENT_ENV` 值与你预期一致（`staging` 或 `prod` · 不要混跑 · 一次只验一个 env）
- [ ] **server `WX_MOCK_LOGIN` 隔离**：通过 `curl -i https://costra.cloud/v1/auth/wx-login -d '{"code":"verify-prod-isolation"}'`，期望返回**真腾讯 code2Session 错误**（`40029 invalid code` 或 `45011`）· **绝不应**返回 `mock-openid-*` · 若返 mock 则 server 误启 `WX_MOCK_LOGIN=1` → 立即停止 · 联系 backend-dev 排查 prod 构建产物
- [ ] **数据隔离自标识**：实测记账时备注一律用 `staging-test-YYYY-MM-DD-<your-name>` 或 `prod-verify-YYYY-MM-DD-<your-name>` 前缀 · 实测后 Sprint-2 末由 backend-dev 跑 `npm run db:cleanup-test-data` 批量清理（候选 FU 待立 · 实测前先用前缀标识兜底）

**实测中遇到 R-020 风险触发** → 立 P0 缺陷单（`qa/defects/2026-MM-DD-COSTRA-105-r-020-trigger.md`）+ 同时发 `revise:COSTRA-105 reason:r-020-triggered` 阻断 Sprint-2 提审。

##### 0.5.0.6 真 staging 实测发现 BUG 处置（与 v1.4 §0.5.3 一致）

- 立 P0 缺陷单（路径 `qa/defects/2026-MM-DD-COSTRA-105-staging-issue.md` · 模板 qa-planner §5.2）
- 转介责任 Agent（backend-dev / miniapp-dev / devops-ops）
- 阻断微信审核提交（COSTRA-901）直至修复

---

> 📂 **以下 §0.5.1~§0.5.3 为 v1.4 历史叙事 · D-023 §4.2 红线保留不动 · 仅供回溯参考**：当前路径请走上方 §0.5.0 D-023 升级路径。子域 `api-staging.costra.cloud` / `api.costra.cloud` 在 D-023 §2.4 触发条件出现时重启立卡，届时 §0.5.1~§0.5.3 才恢复执行价值。

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
> | client 调度器（onShow / 网络恢复 / 周期 setInterval / **冷启自动 pull**）| FU-103-CLIENT-SYNC-SCHEDULER（Sprint-3 候选 COSTRA-150）| 步骤 D.1 push（Console 手动触发可跑）+ 步骤 D.2 pull（Console 手动触发可跑）|
> | conflict 真实合并 UI | FU-103-CONFLICT-MERGE-UI（Sprint-3 候选 COSTRA-151）| 不影响本卡（步骤 E curl 验幂等 · 不验合并 UI）|
> | client/server URL `/v1` 前缀一致性 | ✅ **已修复· COSTRA-156 R1**（server 加 prefix · client 0 改动）| 步骤 D.1+D.2 现可全跑（等 156 review-tech APPROVE）|
>
> **R1 实测目标 = 闭环可达性 + 用例可执行性 + 集成层契约对齐**（v1.4 强化）：H1~H6 全 PASS = 用例集 + 手册 + 闭环逻辑 + client⇄server 协议无 bug · 调度器自动化留 FU 不阻断（手动 Console 触发 pull/push 可达成 H6）。

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
| 方式 C · 真 staging / prod（D-023 后）| 🟢 **可跑** | 同方式 B 但 base URL 是 `https://costra.cloud/v1`（D-023 §2.1/§2.2 收敛根域 · 不再分 staging/prod 子域）|

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
| 方式 C · 真 staging / prod（D-023 后）| 🟢 **可跑** | 同方式 B（URL → `https://costra.cloud/v1`）|

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
| 方式 C · 真 staging / prod（D-023 后）| 🟢 **可跑** | 同方式 B（URL → `https://costra.cloud/v1`）|

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

## 4. 步骤 D · 联网恢复 → outbox push + client 视角端到端回环（SU-004 对应）

> **本步骤拆两小节**（v1.4 补强）：
> - **D.1** · push 链路诊断（client→server 真发 + outbox 出队 + DB 落库 · 验"通不通"）
> - **D.2** · client 视角端到端回环（冷启 → pull → 首页显示一致 · 验"用户路径走得通"）
>
> **设计动机**（v1.4）：D.1 与步骤 E（curl 直打 server）配对——前者验集成层联通、后者验 server 内核幂等；D.2 与 D.1 配对——前者验"端到端协议契约对齐"（如 COSTRA-156 修的 `/v1` URL prefix mismatch 类集成 bug）、后者验"server 行为正确"。三者互补不重叠。

### 4.0 模式适用矩阵

| 模式 | 是否适用 | 备注 |
|---|---|---|
| 方式 A · Mock | ❌ 不适用 | mockLogin 不发 HTTP · 看不到 push/pull 行为 · 直接 SKIP |
| 方式 B · 本地 server | ✅ **必跑**（server 已加 `/v1` prefix · 等 156 review-tech APPROVE 后实测）| D.1 + D.2 全跑 |
| 方式 C · 真 staging / prod（D-023 后）| 🟢 **强烈推荐**（v1.5）| 同方式 B（URL → `https://costra.cloud/v1`）· **D.2 H6 在真链路上的验证才是端到端契约对齐的最高保真证据** |

---

### 4.1 D.1 · push 链路诊断（方式 B · 等 156 review-tech APPROVE 后实测）

#### 4.1.1 操作

1. 开发者工具 → **Network → Online**（取消离线）
2. **手动触发 push**（因为 R1 不实装调度器 · FU-103-CLIENT-SYNC-SCHEDULER · COSTRA-150 候选）：在 Console 执行：
   ```js
   const sync = require('./services/sync')
   sync.pushDelta().then(r => console.log('push result', r)).catch(e => console.error('push fail', e))
   ```
3. 观察 Console + Network + Storage

#### 4.1.2 断言（3 条 · 集成层联通诊断）

| # | 断言 | 期望 | 验证位置 |
|---|---|---|---|
| D1.1 | Network 面板有 `POST http://localhost:8080/v1/sync/push` 200 | 网络日志 | 网络面板 |
| D1.2 | `outbox:__index` 长度 = 原长度 - 已推条数（或对应 `outbox:{seq}` key 已 removeItem · 不再存在）| Storage Tab | Storage Tab grep `outbox:` |
| D1.3 | DB：`psql 'postgres://costra:costra_dev_pw@localhost:5432/costra' -c "SELECT count(*) FROM entries WHERE note = 'offline-test-c'"` → 1 | psql 输出 `count = 1` | psql 命令行 |

#### 4.1.3 Pass/Fail

- [ ] 方式 B · D.1 · Pass · [ ] Fail

> **D.1 失败处置**：
> - D1.1 Network 无 POST 请求 → 触发逻辑 bug（miniapp-dev · COSTRA-103 R1 边界）
> - D1.1 有 POST 但 404 → URL 契约不一致（应已被 COSTRA-156 修复 · 若仍 404 立 P0 缺陷）
> - D1.2 outbox 未出队 → ackResults 三态消费 bug（miniapp-dev · COSTRA-103 R1.2）
> - D1.3 DB count = 0 → server push 落库 bug（backend-dev · COSTRA-104 R1）

---

### 4.2 D.2 · client 视角端到端回环（方式 B · v1.4 新增 · 真实用户路径验证）

> **本节立意**：D.1 验"client 真发 HTTP 能让 server 收到"，D.2 验"server 数据能真正流回 client UI"。这是**唯一能在手动测试阶段捕获 client⇄server 协议契约 mismatch（如字段命名/类型/URL prefix）类集成 bug 的路径**——server 单元测试 + curl + D.1 push 都可能漏过此类问题。

#### 4.2.1 前置确认（D.1 已 PASS）

- D.1 全 3 条断言已 PASS · `offline-test-c` 已落 DB
- 不要清 storage（D.2 起点 = D.1 结束态 · 含 watermark + 本地 entry）
- server 仍运行（不要 ctrl-c）

#### 4.2.2 操作

1. **拿当前 family_id**（在 Console 执行 · 或从 §0.4.6 seed 输出复用）：
   ```js
   // 方式 1：从 storage 读（如 client 已写入）
   wx.getStorageSync('__costra_family_id_v1')
   // 方式 2：从 §0.4.6 seed 输出取（manual-test 默认）
   // → 'F0000000-0000-0000-0000-0000000000F0'（按你的 seed 实际值替换）
   ```

2. **手动重置 watermark + 清本地 entries 索引**（模拟"换设备 / 重装小程序后冷启从 server 拉数据"场景 · 这是 D.2 的核心场景）：
   ```js
   // 仅清 watermark + entry 索引 · 保留 token（避免重新登录）
   wx.removeStorageSync('sync:watermark:F0000000-0000-0000-0000-0000000000F0')  // 替换为实际 family_id
   wx.removeStorageSync('entry:__index')
   // 注：不删 entry:{ref_id} 原始 key · syncPull 会用 server 数据 putEntity 覆盖 · 验证"server 是数据真源"
   console.log('watermark + entry index cleared, ready for D.2')
   ```

3. **手动触发 pull**（FU-103-CLIENT-SYNC-SCHEDULER 未实装冷启自动 pull · 需 Console 触发）：
   ```js
   const sync = require('./services/sync')
   sync.syncPull('F0000000-0000-0000-0000-0000000000F0')  // 替换为实际 family_id
     .then(r => console.log('pull result', JSON.stringify(r, null, 2)))
     .catch(e => console.error('pull fail', e))
   ```

4. **冷启小程序**（编译 → 普通编译 · 触发 home 页重新渲染）

5. 进入首页 · 观察"最近账单"列表

#### 4.2.3 断言（4 条 · 集成层端到端契约对齐）

| # | 断言 | 期望 | 验证位置 |
|---|---|---|---|
| **D2.1** | Network 面板有 `GET http://localhost:8080/v1/sync/pull?family_id=...&since=...&limit=200` 200 · 响应含 `watermark` + `changes.entries` 数组 ≥ 1 条 | 网络日志 + Response Body | 网络面板 |
| **D2.2** | 步骤 3 pull 后 · `entry:__index` 重新含 `offline-test-c` 那笔的 `client_ref_id`（来自 server · 不是 storage 残留 · 因步骤 2 已清 index）| Storage Tab | Storage Tab grep `entry:__index` |
| **D2.3** | 冷启首页"最近账单"列表显示 `offline-test-c` · 金额 56.78 · 分类"交通" · 与步骤 C 输入**完全一致**（端到端字段无丢失/无错位/无类型变换 bug · 如 `amount: 5678` cents → UI 显示 56.78 元）| 首页 UI | 视觉检查 |
| **D2.4** | pull 响应 payload 100% snake_case（响应字段 0 次 `clientRefId` / `occurredAt` / `serverVersion` 等驼峰 · 与 H5 互补 · H5 验 push 请求/E 验 server 响应 · D2.4 验 pull 响应）| 响应 Body | Network 面板 → Response → 字段名 grep |

#### 4.2.4 Pass/Fail

- [ ] 方式 B · D.2 · Pass · [ ] Fail
- 失败回报模板：`revise:COSTRA-105 reason:<step-D.2 具体断言失败>`

> **D.2 失败处置**：
> - **D2.1 Network 无 GET pull / 404** → URL 契约 mismatch（client 路径 vs server 路由 · 应已被 COSTRA-156 修复 · 若仍 404 立 P0 缺陷转 backend-dev）
> - **D2.2 entry index 未恢复** → `applyServerChanges` 实装 bug（miniapp-dev · COSTRA-103 R1 边界 · 见 `services/db.ts` line 235~252 entries 分支）
> - **D2.3 UI 显示与输入不一致**：
>   - 金额错位（如显示 5678 元 / 0.5678 元）→ amount cents↔元 转换 bug（miniapp-dev · 步骤 C `amount: 5678` 应 ÷100 渲染）
>   - 分类丢失/错位 → category_id 映射 bug（miniapp-dev · home 渲染层）
>   - 备注丢失 → server 写入丢字段（backend-dev · COSTRA-104 sync/push 落库列）
> - **D2.4 驼峰命名出现** → server 响应序列化 bug（backend-dev · COSTRA-104 / 155 schema 序列化）

---

## 5. 步骤 E · 幂等验证（SU-005 对应 · 直 curl server · 不经 client）

### 5.0 模式适用矩阵

| 模式 | 是否适用 | 备注 |
|---|---|---|
| 方式 A · Mock | ❌ 不适用（无 server）| SKIP |
| 方式 B · 本地 server | ✅ **必跑**（不依赖 client URL · 直 curl 走 server 真实路径） | 复用 COSTRA-104 curl 范式 |
| 方式 C · 真 staging / prod（D-023 后）| 🟢 **强烈推荐**（v1.5）| `curl https://costra.cloud/v1/sync/push ...`（base URL 替换 · 验真 server 24h 幂等）|

### 5.1 操作（方式 B · 前置 §0.4.4 migrations + §0.4.6 seed 已做）

```bash
# 5.1.1 拿 Token + USER_ID（任意 code · WX_MOCK_LOGIN=1 接受）
cd /Users/weizhao/Desktop/Costra/server
RESPONSE=$(curl -s -X POST http://127.0.0.1:8080/v1/auth/wx-login \
  -H 'content-type: application/json' \
  -d '{"code":"manual-test-105"}')
echo $RESPONSE | jq .
TOKEN=$(echo $RESPONSE | jq -r '.access_token')
USER_ID=$(echo $RESPONSE | jq -r '.user.id')
echo "TOKEN=$TOKEN  USER_ID=$USER_ID"

# 5.1.2 seed family/ledger（如未跑过 §0.4.6）
USER_ID=$USER_ID npm run db:seed:curl-test

# 5.1.3 第一次 POST（idempotency-key + client_ref_id 双重）
curl -s -X POST http://127.0.0.1:8080/v1/sync/push \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -H 'idempotency-key: 88888888-8888-8888-8888-888888888888' \
  -d '{"ops":[{"op":"create","entity":"entry","client_ref_id":"manual-idemp-001","base_version":null,"payload":{"ledger_id":"00000000-0000-0000-0000-000000000001","amount":8888,"type":"expense","occurred_at":"2026-05-12T09:00:00.000Z"}}]}' | jq .

# 5.1.4 立刻重发（同 idempotency-key + 同 body）
curl -s -X POST http://127.0.0.1:8080/v1/sync/push \
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

## 6. ≥ 6 硬断言（H1~H6 · 全 PASS 才可 T1 终审 · v1.4 新增 H6 · v1.5 加方式 C 路径补强）

| # | 断言 | 验证位置 | 模式要求 | 对应 DoD |
|---|---|---|---|---|
| **H1** | 冷启 TTI ≤ 2s + Launch Time ≤ 900ms（3.8.12 基线）| 步骤 A A1 | 方式 A / B / C 任一 PASS | DoD §3.2 |
| **H2** | `entry:__index` 离线写入持久化不丢（`offline-test-c` 在）| 步骤 C C2 | 方式 A / B / C 任一 PASS | DoD §3.2 |
| **H3** | `outbox:__index` 多 key 分片正确（0 次单 key 数组残留 · 每条独立 key）| 步骤 C C3+C4 | 方式 A / B / C 任一 PASS | DoD §3.2 |
| **H4** | idempotency 重放不重复入账（DB count = 1）| 步骤 E E3 | **方式 B 或 C 必跑**（curl 直打 server · D-023 后 C-staging 路径强烈推荐 v1.5）| DoD §3.2 |
| **H5** | payload 100% snake_case（`ledger_id` / `amount` / `category_id`）| 步骤 B B4 + 步骤 E E4 + 步骤 D.2.4 | 方式 A B4 + 方式 B/C E4/D2.4 三覆盖 | DoD §3.2 |
| **H6** | client 离线写入 → push → **冷启 pull 回**显示与输入完全一致（端到端协议契约对齐 · 集成层 bug 唯一手动捕获路径）| 步骤 D.2.2 + D.2.3 | **方式 B 或 C 必跑**（156 review-tech APPROVE 后 · D-023 后 v1.5 推荐 C-staging 路径上跑 H6 → 真链路保真度最高） | DoD §3.2 集成补强（v1.4 + v1.5 路径升级）|

**H1~H6 全 PASS = T1 终审放行** · **任意 FAIL = 卡退回 R1 修复**

> **H6 立意**（v1.4 补强 · v1.5 路径升级）：H4 验 server 内核数学幂等（curl 直打）· H6 验 client→server→DB→client 完整路径契约对齐（小程序连 server）· 二者**互补不重叠**——H4 漏不掉幂等 bug · H6 漏不掉集成 bug（如 COSTRA-156 修的 `/v1` URL prefix mismatch · server 单测 + curl 都看不出来）。这是 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律的真正立意兑现。
>
> **v1.5 路径升级**：D-023 落地后真链路 `https://costra.cloud/v1` 已可达，H6 在 **C-staging 路径**上的验证才是端到端契约对齐的**最高保真证据**（vs 方式 B 本地 server 仅验编译期 + 协议字段层 · C-staging 还覆盖了 TLS / nginx / DNS / CDN / 微信白名单等真实部署链路环节）。

---

## 7. 真机矩阵填充表

| 机型 | 系统 | 微信版本 | 基础库版本 | 模式 | 步骤 A | 步骤 B | 步骤 C | 步骤 D.1 | 步骤 D.2 | 步骤 E | 通过/失败 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| （Human 填）| | | | A / B / **C-staging** / **C-prod** | | | | | | | |
| （Human 填）| | | | A / B / **C-staging** / **C-prod** | | | | | | | |

> v1.5 新增"C-staging" / "C-prod"两值（D-023 后路径 · §0.5.0 推荐主路径）· 真机矩阵理想覆盖：A 起手 + B 跟进 + C-staging 真链路验 H1~H6 + C-prod 提审前最后一跑（仅 1 真机即可 · 因 C-staging 与 C-prod 在 D-023 后 URL 同 · 行为差异看 §0.5.0.5 R-020 自检矩阵）。

> Sprint-2 现实约束：Human 持微信开发者工具模拟器 + 1 真机 · iOS/Android 各 ≥ 2 真机 + 基础库三档延 Sprint-3 · 走 FU-105-AUTOMATION-FULL-COVERAGE 后回头补。

---

## 8. 失败分流

| 步骤 FAIL | 转介 Agent | 说明 |
|---|---|---|
| A · 登录链路（A1~A4 任一）| miniapp-dev + backend-dev | 方式 A：mockExchange 走错；方式 B：wx.login 真链路 / JWT 错 |
| A · A5（方式 B 网络断言）| backend-dev（COSTRA-156）| client `/v1` 前缀 vs server 无前缀 · 已立 FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH + COSTRA-156 占位卡 |
| B · 写本地 / payload | miniapp-dev | COSTRA-103 client outbox 行为 |
| C · 离线 outbox 入队 | miniapp-dev（COSTRA-103 相关）| outbox 多 key 分片 / payload snake_case |
| **D.1** · push 链路诊断（D1.1~D1.3 任一）| backend-dev（COSTRA-156 R1 已实装 · 等 review-tech APPROVE 后实测）| 156 实装 + review 后联合实测 |
| **D.2** · client 视角端到端回环（D2.1~D2.4 任一）| 见 §4.2.4 D.2 失败处置矩阵（按 D2.x 具体编号分流 client/server）| v1.4 新增 · 集成层 bug 唯一手动捕获路径 |
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
| **v1.5** | 2026-05-18 18:4x | **D-023 落地后域名收敛根域刷新**：§0.1 三模式表方式 C 行 🚧→🟢 + URL `api-staging.*`→`costra.cloud` · §0.5 新增 §0.5.0 D-023 升级路径（§0.5.0.1 域名收敛事实 + §0.5.0.2 阻塞条件 5/7 已解 + §0.5.0.3 推荐执行路径 3 项前置 vs v1.4 5 项 · 缩 40% + §0.5.0.4 复跑步骤映射 + §0.5.0.5 R-020 staging/prod 边界自检 3 项强制 + §0.5.0.6 BUG 处置）· 历史 §0.5.1~§0.5.3 D-023 §4.2 红线保留不动 · §1/§2/§3/§4/§5 步骤模式矩阵方式 C 行 5 处 URL 刷新 · §7 真机矩阵加 v1.5 注记 · 立意：尽快兑现"用 costra.cloud 跑通正式流程"诉求 · 与 Sprint-2 提审前 prod 验收时间窗口对齐 · 不破坏 D-009 决策不可变性（D-023 §4.1 红线）|
| **v1.4** | 2026-05-13 13:5x | 步骤 D 拆 D.1（push 链路诊断 · 3 条断言）+ D.2（client 视角端到端回环 · 4 条断言 · 冷启 → pull → 首页显示一致）· §6 新增 H6 硬断言（client 离线写入 → push → 冷启 pull 回环 · 集成层 bug 手动捕获路径） · §0.1 警示 / §0.6 R1 范围 / §8 失败分流 同步 · 立意：H4 curl 验 server 内核幂等 vs H6 小程序连 server 验集成层契约对齐 · 互补不重叠 · 兑现 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律真正立意 · 总硬断言 H1~H6（原 H1~H5）|
| **v1.3** | 2026-05-13 11:0x | COSTRA-156 R1 实装后 BLOCKED 注记清除（联合实测时序明示：等 156 R1 review-tech APPROVE 后才能跑步骤 D）· §0.1 警示段/§0.6 R1范围/§4 模式矩阵/§4.2断言/§4.3 Pass-Fail/§6 H4注记/§8失败分流 D行 全部从"BLOCKED-BY-COSTRA-156"刷新为"✅ 可跑·等 156 review-tech APPROVE" · INFO-2 联合实测时序兑现 |
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
- `infra/wechat/domains.md §4`（R-013 关闭条件 · v1.5 D-023 后白名单填 `https://costra.cloud`）
- `.team/decisions/D-023-prod-rollout-on-root-domain.md`（v1.5 主依据 · prod 入口回归根域 · 子域 Phase-2 搁置 · §7 Human 操作清单 3 件）
- `.team/decisions/D-009-domain-and-dev-server-locked.md`（域名锁定原决议 · D-023 §4.1 红线保留不动）
- `docs/legal/compliance-registry.md` v0.2（ICP 下证事实 · `沪ICP备2026017253号-1X` 小程序 + `沪ICP备2026017253号-2` 后端）
- `.team/risks.md` R-013（🟢 Closed）/ R-019（🟠 公安联网备案截止 2026-06-12）/ R-020（🟡 staging/prod 边界 · §0.5.0.5 自检）
