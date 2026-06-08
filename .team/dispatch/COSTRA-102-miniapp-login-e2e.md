# 任务派单 · COSTRA-102 MiniApp 登录 → 首页 → 记一笔端到端（Sprint-1 主线第三卡 · 客户端运行时首次真实立起）

> **派单时刻**：2026-04-27 09:45（Orchestrator · Human 指令 `run miniapp COSTRA-102` · 09:47 触发）
> **Owner**：MiniApp-Agent（`.team/agents/03-miniapp-agent.md`）
> **估点**：5（Sprint-1 主线第三卡 · Sprint 原计划 40 点已含本卡）
> **依赖**（全部已满足）：
> - COSTRA-100 · G3 契约补齐 · Approved（2026-04-23 22:38）
> - COSTRA-101 §6.1.a + §6.1.b · 微信登录整卡 · Human T1 APPROVED（2026-04-24 19:28） · `/auth/wx-login` `/auth/refresh` `/auth/logout` 三端点可用
> - COSTRA-118 · miniprogram 技术债专项普查 · Human T2 APPROVED 路径 A（2026-04-27 09:39） · **`.team/reviews/COSTRA-118/FINAL.md §分流矩阵` 已将 8 P0 + 3 P1 正式并入本卡扩展验收**
> - COSTRA-113 · subject 配置 · Approved（骨架期个人主体事实源）
> - COSTRA-030 · miniprogram 骨架 · Approved（当前 19 .ts + 8 .wxml + 9 .wxss + 11 .json 事实源）
> **解阻塞目标**：
> - Sprint-1 DoD 第 1 条（真实微信登录可通 · 拿 access/refresh）
> - Sprint-1 DoD 第 2 条部分（记一笔本地落库 · 真实推送留 COSTRA-103/104）
> - COSTRA-103 / COSTRA-104 / COSTRA-105 启动前置（本卡提供登录态 + 真实请求层）
> - COSTRA-118 路径 A 收口承接（10 P0 中 8 条 + 5 P1 中 3 条由本卡消化 · 剩余 P0-10 part B 待 COSTRA-109 PM 产出后同步填入）

---

## 0. 本卡的三重含义

这不是一张"写 login 页 + 首页 + 记账页"的普通卡。从工作区事实看：

- **骨架代码"像"三页都有**（`pages/login`、`pages/home`、`pages/entry` 均可编译），但 COSTRA-118 Round-1 已指出 **10 个 P0 契约错配 / 字段幻觉 / 安全红线**（`.team/reviews/COSTRA-118/round-1-tech.md`）
- **`services/request.ts` 错解错误响应**（`body.error.code` 而非 `body.code`）· **`services/auth.ts` TokenPair 字段错配**（`access` / `refresh` / `expiresAt` vs OpenAPI `access_token` / `refresh_token` / `access_token_ttl_sec`）· **`services/sync.ts` 端点幻觉**（`GET /sync/{entity}?sinceVersion=` 不存在；真实契约为 `POST /sync/pull` body）
- **登录页仍挂 `open-type="getUserInfo"`**（P0-10 · 微信 2022 已废弃的接口）· **`app.wxss` CSS 变量名全站不一致**（P0-9）· **`utils/time.ts toUtcIso` 双减时区 BUG**（P0-8）

因此本卡同时肩负：

1. **客户端运行时首次真实立起**（将 Mock 切到真实后端 · 三端点对齐 `/auth/wx-login` `/auth/refresh` `/auth/logout` · access_token/refresh_token 走真 JWT · 本地验证 Human 2026-04-30 可手工通过）
2. **契约彻底对齐**（COSTRA-118 路径 A 承接：TokenPair 字段 / 错误响应解析 / Idempotency-Key / Entity 枚举 / sync 端点 全部按 OpenAPI 事实源重写）
3. **Sprint-1 主链路贯通**（登录 → 首页显示真实昵称 → 记一笔写入本地 outbox · 为 COSTRA-103 本地持久化 + COSTRA-104 批量推送打通上游）

因此验收要在"**契约对齐 + 可启动 + 单测绿 + Human 本地验证过**"四个维度同时过。

---

## 1. 工作区与能力边界（硬约束 · 必读 · 首要前置）

### 1.1 工作区定义修正（override 03-miniapp-agent.md §身份 "仅允许修改 miniapp/"）

**事实**：项目实际小程序源码目录是 **`miniprogram/`**（COSTRA-030 骨架期落盘时选定 · 与微信开发者工具默认约定一致 · `project.config.json` 中 `miniprogramRoot: "miniprogram"` 已锁死）· agent 定义文件 §身份描述的"miniapp/" 目录**不存在**。

**本卡工作区**：**`miniprogram/`**（所有代码 + 单测 + 配置）· `docs/miniapp/architecture.md`（如新增）

**不允许跨界**：
- 禁止改 `server/**`、`api/**`、`docs/api/**`（契约事实源 · 发现不符发 `review_request` 给 Backend · 本卡 Sprint-1 末前不新立跨区卡）
- 禁止改 `infra/**` / `scripts/**`（DevOps 工作区）
- 允许读：`api/openapi.yaml`（镜像）、`server/api/openapi.yaml`（事实源）、`docs/api/*.md`、`docs/design/**`、`design/**`、`docs/db/schema.md`（只读上下文 · 禁止修改）

**例外**：本卡 P1-2 `CLIENT_NETWORK_ERROR` 错误码命名跨 PM/Backend 需协调 · 由 Orchestrator 兜底 · MiniApp-Agent 无需主动改 `docs/api/error-codes.md`（交由 Orchestrator 在本卡 Review 通过后开新规约卡处理）

### 1.2 能力边界铁律（沿用 COSTRA-114 v2 @ 2026-04-24 13:14）

- **Agent 无真机 / 无真微信开发者工具 / 无真服务器访问权**
- Agent 交付**止于**：代码 + 本地静态检查（typecheck / lint） + 单测绿灯 + 文档
- Agent **不得**声称"本地扫码登录通过"、"真实服务器联调成功"、"体验版二维码已生成"等需要真机/真服务的结论
- **Human 本地验证节点**在 **2026-04-30 Sprint-1 中点**（sprint-01-plan.md §Human 介入节点第 3 行 · 已锁定 · 估耗时 20 分钟）· Agent 须交付 **Human 本地验证手册**（详见 §4）作为替代凭证

### 1.3 本卡的 Mock 策略边界

- **保留 Mock 通路**（`services/env.ts` 的 `mockLogin: true` flag） · 但**必须同时让真实通路可跑**（`mockLogin: false` 下 env=dev 指向 `http://127.0.0.1:3000/v1` · staging/prod 指向 `https://api-staging.costra.cloud/v1` 等）
- Mock 仅在 dev 环境默认开启 · staging / prod 环境 `mockLogin: false` 硬编码不变
- **单测默认走 Mock**（纯逻辑层覆盖 · 不依赖真实 wx 运行时）

---

## 2. DoD 拆分（基础段 · 与 sprint-01-plan.md §COSTRA-102 对齐并精化）

> 编号 `D2.x` 为基础 DoD · 扩展段 COSTRA-118 分流项编号 `E.x`（§3 列出） · 两段合取为本卡 Acceptance Criteria 全集。

### D2.1 登录页真实链路

- [ ] `pages/login/index.wxml`：**移除 `open-type="getUserInfo"`**（P0-10 part A · getUserInfo 自 2022-04-14 基础库 2.21.2 已失效）· 保留 `bindtap="onTapLogin"`
- [ ] `pages/login/index.ts`：`onTapLogin` 内先调 `wx.login()` 拿 code → `POST /auth/wx-login` → 成功后可选调 `wx.getUserProfile()`（首次授权弹窗 · 用户主动点击事件内 · 失败不阻塞登录）→ PATCH `/users/me` 写 nickname/avatar_url（失败不阻塞）
- [ ] 已有 session 冷启动续期逻辑保留（`onLoad` 中 `hasValidSession()` 跳首页）
- [ ] 错误路径：`/auth/wx-login` 401 → 红字提示 "登录失败，请重试"；网络错误 → 提示 "网络异常"

### D2.2 Auth 服务重写（P0-2 / P0-3 核心）

- [ ] `services/auth.ts`：重写 `TokenRaw` 对齐 OpenAPI `AuthTokenPair`：
  ```ts
  interface TokenRaw {
    access_token: string;
    refresh_token: string;
    access_token_ttl_sec: number;
    refresh_token_ttl_sec: number;
    user: { id: string; nickname: string; avatar_url: string };
  }
  ```
- [ ] 本地存储结构：`{ raw: TokenRaw, access_expires_at: number, refresh_expires_at: number }`（`access_expires_at = Date.now() + access_token_ttl_sec * 1000`）
- [ ] `shouldRefresh()` 用 `access_expires_at` 判断；续签阈值保留 5 分钟窗口
- [ ] `refreshToken()` 请求体改为 `{ refresh_token: current.raw.refresh_token }`（P0-3 · 字段名对齐）
- [ ] 新增 `logout()` 走真 `POST /auth/logout`（204 无响应体 · 无论成功失败都清本地 → `wx.reLaunch({ url: '/pages/login/index' })`）
- [ ] **移除 P0-1**：`services/auth.ts:85` 当前 `console.info('[auth] wx.login code=', code.slice(0, 8) + '...')` 改为 `console.info('[auth] wx.login ok', { codeLen: code.length })`（不记录 code 任何片段 · 敏感值红线）

### D2.3 Request 层统一改造（P0-4 / P0-5 核心）

- [ ] `services/request.ts`：
  - **P0-4**：为 `method !== 'GET'` 自动注入 `Idempotency-Key` 请求头（UUID v4 · 允许 caller 通过 `opts.idempotencyKey` 显式复用 key 用于 retry）
  - **P0-5**：响应错误解析按 `docs/api/error-codes.md` 事实源契约：
    ```ts
    body.code    // 顶层 code（不是 body.error.code）
    body.message // 顶层 message
    body.trace_id // 顶层 trace_id（snake_case · 由 MiniApp 映射到 camelCase）
    body.details  // 顶层 details（可选）
    ```
  - **P1-2**：`fail` 回调的客户端网络错误 code 改为 **`CLIENT_NETWORK_ERROR`**（加 `CLIENT_` 前缀明示非服务端 · 与后端 21 条枚举隔离）· 不跨区改 `docs/api/error-codes.md`（FU 登记）
  - `ErrorCode` 联合类型守卫：可选消费 `docs/api/error-codes.md` 枚举 · 通过一个内部 `const KNOWN_SERVER_CODES = new Set([...])` 实现即可 · 未知 code 保留原值不丢数据

### D2.4 首页显示真实用户画像

- [ ] `pages/home/index.ts`：
  - `onShow` 中若 `getToken()` 存在 → 显示 `getToken().raw.user.nickname` / `avatar_url`（OpenAPI `AuthTokenPair.user` 字段 · 无需额外调 `/users/me`）
  - **P1-4**：`refresh()` 中 TODO 注释改为 `// TODO(COSTRA-401 或 Epic-F /reports/monthly): 调 POST /reports/monthly { ledger_id, month }`
- [ ] `pages/home/index.wxml` 昵称位从占位符换成 `{{userName}}`（ts 侧 setData 注入）· 头像用 `<image>` 加兜底（加载失败显示默认 emoji）

### D2.5 记一笔 outbox 入队保留（本卡仅保证 P0-7 枚举对齐）

- [ ] `services/sync.ts`：
  - **P0-7**：`Entity` 类型改为 `'entry' | 'category' | 'budget'`（OpenAPI `tags` 枚举事实源 · 废弃 `ledger_entries` / `accounts` / `families` / `family_members` 幻觉）
  - **P0-6**：`pullDelta` 重写为 `POST /sync/pull` body = `{ ledger_id, since: lastPulledAt(ISO8601), entities: [...] }`（契约见 `docs/api/sync-protocol.md`）· 返回值与响应契约对齐 · **本卡仅做接口签名正确性 · 真实批量 push / conflict 处理仍是 COSTRA-103 / 104 的范围**
  - outbox 入队逻辑本卡不改（P1-3 属 COSTRA-103 范围）
- [ ] `pages/entry/index.ts` 不改动接口（`enqueueLocalEntry` 签名保持 · `occurredAt: new Date().toISOString()` 已正确 · P0-8 修完后更稳）

### D2.6 时间工具 P0-8 快修

- [ ] `utils/time.ts::toUtcIso` 删除双减时区逻辑：
  ```ts
  // 错：new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString()
  // 对：d.toISOString()  // 这本身就是 UTC
  export function toUtcIso(d: Date): string {
    return d.toISOString();
  }
  ```
- [ ] 补两条单测：`new Date('2026-04-27T01:23:45.678Z')` 的 `toUtcIso` 结果应为同字符串（UTC 输入恒等）· `new Date(2026, 3, 27, 9, 0)` 的本地构造结果 `toUtcIso` 应等于原 Date 的 `.toISOString()`

### D2.7 CSS 变量全站对齐 P0-9 快修（方案 A）

- [ ] `miniprogram/app.wxss` 补齐使用方期望的变量名：
  - `--color-bg` / `--color-surface` / `--color-text` / `--color-text-muted` / `--color-divider`
  - `--color-primary` / `--color-danger` / `--color-success`
  - `--shadow-sm` / `--shadow-lg`
- [ ] 语义映射到既有 `--color-*-*` 定义（不新创值 · 仅补别名）
- [ ] 彻底方案 B（`tokens/index.ts` → app.wxss 构建脚本）**不在本卡范围** · 已登记 FU-118-3 延到 Sprint-2 COSTRA-160

### D2.8 金额工具 decimal.js 顺手切（P1-1 · FU-118-6 scoped 到本卡）

- [ ] `package.json` 根级或 `miniprogram/package.json`（按项目既有结构判断）新增 `decimal.js@^10.4.3` 依赖
- [ ] `utils/money.ts`：
  - `toCents` 重写：`new Decimal(yuan).mul(100).floor().toNumber()`（负数 `ceil` 处理保留原语义）
  - `toYuan` 重写：`new Decimal(cents).div(100).toFixed(2)`（保留 2 位小数）
  - `parseAmountInputToCents` 容错逻辑保留（先正则清洗 · 再走 Decimal）· **确保 `0.1 + 0.2` 系列问题不复现**
- [ ] 补单测：`toCents('0.1') + toCents('0.2')` 应 `=== 30`（cents） · `toYuan(30) === '0.30'`
- [ ] 主包大小影响：decimal.js@10 约 32KB · 当前 miniprogram 主包空间充裕（骨架 < 200KB · 预算 2MB） · ✅ 可接受

### D2.9 TypeScript 静态检查绿灯

- [ ] 本卡变更完成后：
  - 根 `tsc --noEmit`（已有 `package.json scripts.typecheck` · 需确认命中 miniprogram/**）绿灯
  - 若 miniprogram 当前无独立 tsconfig · 补一份 `miniprogram/tsconfig.json`（或复用根 · 以项目既有约定为准）
- [ ] `npm run lint`（若已配置）绿灯 · 未配置时本卡不新增（FU 候选）

### D2.10 单元测试（轻量 · 本卡新增 ≤ 10 条用例）

本卡 Agent 只测"纯逻辑 + Service 层 · 不模拟 wx 运行时"：

- [ ] `utils/money.spec.ts`：toCents/toYuan/parseAmountInputToCents 各 2 条（含 decimal 精度 · 含负数）
- [ ] `utils/time.spec.ts`：toUtcIso 2 条（UTC 输入恒等 + 本地 Date 不双减）
- [ ] `services/auth.spec.ts`：TokenPair 字段存取 1 条 + shouldRefresh 边界 1 条（用 mock Date）
- [ ] `services/request.spec.ts`：`toApiError` 对 `body.code` / `body.trace_id` 顶层字段解析 1 条 + Idempotency-Key 注入 1 条

测试框架沿用 vitest（与 server 已建立的测试栈一致 · 降低双栈心智负担） · 若 miniprogram/ 尚未安装 vitest · 本卡顺手装好（devDependency · 不影响主包体积）· 执行命令 `npx vitest run miniprogram/` 或按项目 scripts 配置。

### D2.11 Human 本地验证手册（能力边界铁律替代凭证）

- [ ] 新增 `docs/qa/costra-102-human-verify.md`（或放 `docs/miniapp/` 按项目 docs 既有分类 · 已知 docs/miniapp/ 目录不存在 · 建议 docs/qa/）
- [ ] 手册内容：
  1. 前置环境（微信开发者工具版本 / 本地 server 启动方式 / mockLogin 切换方式）
  2. 五条端到端步骤（A-登录 → B-首页昵称正确 → C-记一笔 → D-检查 outbox storage → E-退出登录）
  3. 每步期望 + 截图位置（Human 填）+ Pass/Fail 单选框
  4. 失败回报模板（issue 模板格式）
- [ ] 预计 Human 本地操作 20 分钟（与 sprint-01-plan.md §Human 介入节点 2026-04-30 锁定时长一致）

---

## 3. 扩展验收项（COSTRA-118 §分流矩阵正式并入 · 本段为本卡 Acceptance Criteria 不可分割部分）

> **事实源**：`.team/reviews/COSTRA-118/FINAL.md §分流矩阵 §→ COSTRA-102`
> **语义**：下列 11 条（8 P0 + 3 P1）在本卡 Review 时逐条核对 · 任一未做即 Review REJECT

| 编号 | 来源 | 映射到本卡 DoD | 是否已包含 |
|---|---|---|---|
| E.P0-1 | COSTRA-118 P0-1 | D2.2 末项 · `console.info` 去 code 片段 | ✅ |
| E.P0-2 | COSTRA-118 P0-2 | D2.2 · TokenRaw 对齐 AuthTokenPair | ✅ |
| E.P0-3 | COSTRA-118 P0-3 | D2.2 · `/auth/refresh` body 字段名 | ✅ |
| E.P0-4 | COSTRA-118 P0-4 | D2.3 · Idempotency-Key 自动注入 | ✅ |
| E.P0-5 | COSTRA-118 P0-5 | D2.3 · 错误响应顶层字段解析 | ✅ |
| E.P0-6 | COSTRA-118 P0-6 | D2.5 · syncPull 端点改 POST /sync/pull | ✅ |
| E.P0-7 | COSTRA-118 P0-7 | D2.5 · Entity 枚举对齐 | ✅ |
| E.P0-8 | COSTRA-118 P0-8 | D2.6 · toUtcIso 去双减 | ✅ |
| E.P0-9 | COSTRA-118 P0-9 | D2.7 · app.wxss CSS 变量 | ✅ |
| E.P0-10-partA | COSTRA-118 P0-10 part A | D2.1 · 去 open-type="getUserInfo" | ✅ |
| E.P1-1 | COSTRA-118 P1-1 / FU-118-6 | D2.8 · decimal.js 切入 | ✅ |
| E.P1-2 | COSTRA-118 P1-2 | D2.3 · CLIENT_NETWORK_ERROR 前缀 | ✅ |
| E.P1-4 | COSTRA-118 P1-4 | D2.4 · TODO 注释纠正 | ✅ |

### 3.1 不在本卡范围（明确排除 · Review 不得追加）

- **E.P0-10 part B**（隐私页占位填充）：依赖 COSTRA-109 PM 产出 · 本卡启动时 PM 草稿尚未到手 · 不阻 · 草稿到手后 Orchestrator 另起同步单（或 COSTRA-109 收口时连带）
- **E.P1-3**（outbox snake_case + ledger_id + currency）：归 COSTRA-103 本地持久化卡（`.team/reviews/COSTRA-118/FINAL.md §→ COSTRA-103`）· 本卡不碰 outbox payload 结构
- **E.P1-5**（CURRENT_ENV 硬编码改注入）：归 COSTRA-108 miniprogram-ci 演练卡 · 本卡保留骨架期占位（`services/env.ts:50` 维持 `CURRENT_ENV: EnvName = 'dev'`）
- **P2-1 / P2-2 / P2-3 / P2-4**：全部留在 Sprint-2 Follow-ups（FU-118-2~5）· 本卡不碰
- **灰色区 AppID README**：留 Sprint-1 末 engineering-guidelines §2.5 澄清（FU-118-1 · PM-Agent 批次维护）

---

## 4. 交付时间盒 & 节奏

| 里程碑 | 时间点 | 动作 | Owner |
|---|---|---|---|
| M1 · 派单 | 2026-04-27 09:45 | 本 dispatch 发出 + 卡定义首轮 Review | Orchestrator |
| M2 · 卡定义 Human 放行 | 2026-04-27 内（推荐 30 分钟内） | Human 回 `approve-def:COSTRA-102` | Human |
| M3 · Agent 实装开工 | Human 放行后立即 | MiniApp-Agent 按 D2.x + §3 逐条改 | MiniApp-Agent |
| M4 · Agent 产出 R1 | 04-28 18:00 前（D4 · sprint-01-plan 节奏） | 代码 + 单测绿灯 + 手册 + 产出首轮 AI-Review 自动拉起 | MiniApp-Agent + Review-Tech + Review-Product |
| M5 · Human 本地验证 | **2026-04-30（Sprint-1 中点 · 硬锁定）** | Human 按手册五步跑完 · 签 Pass 或回 Fail | Human |
| M6 · Human 终审 | M5 通过后 | Human 发 `approve:COSTRA-102` · 整卡收官 | Human |
| M7 · 下游触发 | M6 通过后 | COSTRA-103 / 104 启动 · COSTRA-109 PM 产出后做 P0-10 part B 同步 | Orchestrator |

### 关键依赖观察
- M2 → M3 之间：Human 放行是否有延迟风险 · 历史先例 COSTRA-118 跨机迁移期间挂起 62h · 本卡已登记 Sprint-1 Retro 议题（审计类卡 72h SLA · 本卡非审计类但借鉴）· 若 Human 本周确认忙 · 可考虑 `approve-def:COSTRA-102 and run` 合并触发（Human 预批复的小程序卡定义首轮兑现模式）
- M4 → M5 之间：04-28 ~ 04-30 ~2 个工作日 · 足够 Review 自动循环（D-011 方案 B · 历史数据 2~4 轮收敛）

---

## 5. Review 档位 & 约束

### 5.1 档位
- **D-014-a 卡定义首轮**（本 dispatch 同轮兑现 · D-016 合规）：AI Review-Tech + Review-Product 双签（下一节详述）
- **D-014-b 产出首轮**：Agent 交付代码后 Orchestrator 同轮兑现自动拉起（`run` 触发）· AI Review-Tech + Review-Product 双签
- **D-013 T1 档位**（Sprint-1 主线客户端实装 · 契约承接多条 P0）：产出首轮通过后仍需 **Human T1 终审**（参照 COSTRA-101 先例）· 并含 **Human 2026-04-30 本地验证**（T1 的"真机/真服务"佐证）

### 5.2 同轮兑现铁律（D-016 · 第四次实战观察目标）
- 本 dispatch 发出的同一 tool call 循环内 · 必须完成：dispatch 写盘 + 卡定义首轮 Review-Tech + Review-Product 两份报告 + STATE/board/metrics/messages 六处同步
- 跨轮异步反模式（"60 秒内自动拉起卡定义 Review"）本次不复现

### 5.3 Review 特殊注意
- **COSTRA-118 §分流矩阵逐条 diff 核对**（11 条 + 3 条排除项 · 共 14 条对账表）· Reviewer 必须出结构化核对表 · 任一遗漏即 P0
- **能力边界硬约束核对**：Agent 不得在报告中声称"本地扫码通过"、"体验版 QR 生成"、"真实服务器联调"等表述 · 任一出现即 P0
- **OpenAPI 契约 diff**：`services/auth.ts` TokenRaw interface 与 `server/api/openapi.yaml AuthTokenPair` 字段集必须 1:1 · Reviewer 带工具级 diff

---

## 6. 产出清单（预期）

| 文件 | 动作 | 说明 |
|---|---|---|
| `miniprogram/pages/login/index.wxml` | 改 | 去 getUserInfo open-type |
| `miniprogram/pages/login/index.ts` | 改 | wx.login + getUserProfile 首次授权 |
| `miniprogram/services/auth.ts` | 重写 | TokenRaw 对齐 · logout 真调 · code 日志去片段 |
| `miniprogram/services/request.ts` | 重写 | Idempotency-Key + 错误响应顶层解析 + CLIENT_NETWORK_ERROR |
| `miniprogram/services/sync.ts` | 重写 | Entity 枚举 + syncPull POST /sync/pull 签名 |
| `miniprogram/pages/home/index.ts` / `index.wxml` | 改 | 用户昵称 + 头像显示 + TODO 注释 |
| `miniprogram/utils/time.ts` | 改 | toUtcIso 去双减 |
| `miniprogram/utils/money.ts` | 重写 | decimal.js 切入 |
| `miniprogram/app.wxss` | 改 | CSS 变量补齐别名 |
| `miniprogram/utils/*.spec.ts` / `miniprogram/services/*.spec.ts` | 新增 | 单测 10 条 |
| `miniprogram/tsconfig.json`（如需） | 新增 | 独立 tsconfig |
| `miniprogram/package.json`（或根） | 改 | decimal.js 依赖 + vitest devDep |
| `docs/qa/costra-102-human-verify.md` | 新增 | Human 本地验证手册 |
| `docs/api/error-codes.md` | **不改** | 跨区 · 由 Orchestrator 兜底 |
| `.team/reviews/COSTRA-102/round-1-miniapp-response.md`（M4） | 新增 | Agent 产出报告 |
| `.team/reviews/COSTRA-102/round-1-tech.md` / `round-1-product.md`（M4） | 新增 | Review 双签产出 |

---

## 7. 度量约定（本卡 metrics.json 第 5 条预置）

| 字段 | 值 |
|---|---|
| card_id | COSTRA-102 |
| type | sprint-1-main-line |
| owner | MiniApp-Agent |
| points | 5 |
| review_tier | T1（D-013） |
| rounds_planned | 1~2（D-011 方案 B · 按 COSTRA-101 历史 2~4 轮实际 · 目标 ≤ 2 轮） |
| human_t1_verify_date | 2026-04-30（sprint-01-plan.md 硬锁定） |
| dependency_closeout_refs | COSTRA-100/101/118/030/113 |
| dispatched_p0_count | 10（来源 COSTRA-118 · 含 P0-10 part A · 排除 part B） |
| dispatched_p1_count | 3（来源 COSTRA-118 P1-1/P1-2/P1-4） |
| explicit_out_of_scope | P0-10-partB / P1-3 / P1-5 / P2-1~4 / AppID-README |

---

## 8. 风险登记

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| Human 04-27 ~ 04-30 期间无暇验证 | 中 | 高 | 手册做到足够傻瓜化（5 步 20 分钟）· Human 可分段执行 |
| vitest 在 miniprogram/ 首装有栈对齐问题 | 中 | 中 | 本卡允许小范围调试 · 不通过则降级为"只做静态检查 + Agent 沙箱执行说明"· 单测覆盖延到 COSTRA-108 |
| OpenAPI AuthTokenPair 的 user 字段实际为 null 或缺失 | 低 | 中 | `pages/home/index.ts` 显示昵称时做兜底（undefined → "微信用户"占位 · 登记 FU） |
| P0-9 app.wxss 快修方案 A 引入变量别名冗余 | 低 | 低 | 方案 B（tokens.json → app.wxss 构建脚本）已登记 FU-118-3 · 本卡不彻底解决 · 验收时不追责 |
| decimal.js 主包大小挤压 | 低 | 低 | 32KB · 当前主包剩余 >1.8MB · 充裕 |

---

## 9. 相关 Refs

- Sprint-1 计划：`.team/sprints/sprint-01-plan.md §COSTRA-102`
- 上游签字：`.team/reviews/COSTRA-101/FINAL.md` · `.team/reviews/COSTRA-100/FINAL.md` · `.team/reviews/COSTRA-113/FINAL.md`
- **核心分流事实源**：`.team/reviews/COSTRA-118/FINAL.md §分流矩阵`
- 发现明细（原始）：`.team/reviews/COSTRA-118/round-1-tech.md`
- 契约事实源：`server/api/openapi.yaml` · `docs/api/error-codes.md` · `docs/api/sync-protocol.md` · `docs/api/id-strategy.md` · `docs/api/ttl-policy.md §4`
- 设计事实源：`docs/design/flows/login.md` · `docs/design/ia.md §首页` · `docs/design/flows/add-entry.md`
- 能力边界铁律：`.team/dispatch/COSTRA-114-devops-dev-server-bootstrap.md` v2
- 规约：D-011（方案 B 自动循环）· D-012（单卡提交）· D-013（Review 档位）· D-014-a/b（卡定义 + 产出 Review）· D-015（触发词）· D-016（同轮兑现）· ADR-0002（栈硬约束）· ADR-0004（MiniApp 分层）· ADR-0006（后端运行时）

---

**签字**：Orchestrator @ 2026-04-27 09:45
**下一动作**：同 tool call 循环内触发卡定义首轮 Review（Review-Agent-Tech + Review-Agent-Product）· 无跨轮异步承诺（D-016 第四次实战目标）
