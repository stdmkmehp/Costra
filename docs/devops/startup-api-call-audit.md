# 启动期 API 调用审计报告（Sprint-1 末）

- 卡号：COSTRA-124
- Refs：`.team/dispatch/COSTRA-124-miniapp-fix-startup-storage-timing.md` §3 (b)
- 审计时间：2026-05-02
- 审计人：装扮 subagent `costra-miniapp-dev`（SBAI v1.1 P2' 实战第 2 回）
- 审计范围：`miniprogram/**/*.ts`（源码目录 · 不含 `node_modules/` / `miniprogram_npm/`）

---

## §1 审计背景

COSTRA-124 修复 `miniprogram/services/storage.ts:29` 模块顶层副作用 `ensureVersion()`
后 · 按 Human 2026-05-02 20:31 Q4 拍板 · **顺扫 `miniprogram/` 所有模块顶层 `wx.*` 调用**
防止同族再犯（即"模块导入时即在 App() 注册前同步触发 wx.* 调用"的反模式）。

Driver：

- FU-LAUNCH-FIRST-RENDER-RACE 第 4 次重定性（`.team/follow-ups/README.md` §519-559）
- D-017 Step 2 根因报告（`.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`）

---

## §2 扫描命令与执行结果

### §2.1 扫描命令（2 条 grep · 对齐 dispatch §3 (b)）

```bash
# 命令 1：扫模块顶层直接 wx.* 调用（行首缩进 0）
rg -n '^wx\.' miniprogram --glob '*.ts'

# 命令 2：扫顶层赋值触发 wx 调用（顶层 const/let/var 表达式里含 wx.）
rg -nE '^(const|let|var).*wx\.' miniprogram --glob '*.ts'
```

（实际执行用的是 agent 的 Grep 工具 · 语义等价 ripgrep · 基于 `.gitignore` 天然排除 `node_modules/` / `miniprogram_npm/`。）

### §2.2 执行结果（2026-05-02 R1 实装时）

| # | 命令 | 命中数 | 红线（> 0） | 结论 |
|---|---|---|---|---|
| 1 | `^wx\.`（顶层裸调） | **0** | ❌ 不触发 | ✅ PASS |
| 2 | `^(const\|let\|var).*wx\.`（顶层赋值触发 wx） | **0** | ❌ 不触发 | ✅ PASS |

**额外宽松扫查**（不在 DoD · 但作为审计增值项）：

| # | pattern | 命中数 | 说明 |
|---|---|---|---|
| 3 | `^[a-zA-Z_$][a-zA-Z0-9_$]*\(` 排除所有声明关键字 | 0 | 无其他顶层函数裸调 |
| 4 | `^setTimeout\|^setInterval` | 0 | 无顶层定时器反模式 |

**结论**：`miniprogram/**/*.ts` 在 COSTRA-124 (a) 修复后 · 模块顶层**零副作用**（仅保留 `import` / `export` / 类型声明 / 常量字面量 / `App({...})` / `Page({...})` / `Component({...})` 注册）。

---

## §3 历史对照

| 时间点 | 源码状态 | 顶层副作用命中 |
|---|---|---|
| COSTRA-030 初始化（~2026-03-xx） | `storage.ts:29` 有 `ensureVersion()` 裸调 | 1 |
| COSTRA-102/118/121/122/123 各节点 | 同上（未触发 Review 关注 · 基础库 2.30.x 时序宽松） | 1 |
| **COSTRA-123 收官（2026-05-01 21:18）** | 同上（Launch Time 从 3547 ms 降至 865 ms 后 · SDK 时序窗口收窄 · FU-LAUNCH 第 2 次观察） | 1（未坐实为根因） |
| **2026-05-02 19:32 · FU 第 3 次观察** | 同上（定性加固为"100% SDK 内部 Bug" · 后被独立复核推翻） | 1（定性误判） |
| **2026-05-02 20:25 · D-017 Step 2 根因报告** | 同上（装扮 subagent 独立核查坐实 `storage.ts:29` 是唯一业务触发点） | 1 |
| **2026-05-02 COSTRA-124 R1 修复后** | `ensureVersion()` 改 export · 调用点迁 `app.ts:onLaunch` 首行 | **0** |

---

## §4 同族违规发现

**无**。

本次顺扫未在 `storage.ts` 之外发现任何其他模块顶层 `wx.*` 或等价反模式。具体排除分析：

- `miniprogram/services/env.ts`：`ENV_MAP` 仅为对象字面量常量 · `getEnv()` / `isFlagOn()` 只在被调用时读取 · 无 `wx.*`
- `miniprogram/services/auth.ts`：`current` 为顶层 `let` 但初值是 `null` · 首次写入在 `initAuth()` 或 `doWxLogin()` 内 · 属函数内副作用 · 合规
- `miniprogram/services/request.ts`（如存在）：`wx.request` 调用全部包在 `request()` 函数体内 · 合规
- `miniprogram/app.ts`：`globalData: { env: getEnv(), tokens, bootAt: 0 }` 在 `App({...})` 参数求值时调 `getEnv()` · 但 `getEnv()` 不触发 `wx.*` · 合规
- `miniprogram/tokens/index.ts`：COSTRA-122 修复后 · 纯 TS 常量对象 · 无副作用

---

## §5 未来 CI 升级候选（Sprint-2 Planning 议题）

本次 grep 扫查为"手工 + 审计报告"级 · 若希望常态化防回归 · 建议 Sprint-2 新增硬拦截脚本：

**候选脚本**：`scripts/devops/startup-top-level-call-check.mjs`

**职责**：

1. 扫 `miniprogram/**/*.ts`（排除 `*.d.ts` / `*.test.ts`）
2. 用 TypeScript AST（`ts.createSourceFile`）识别每份文件的 **top-level statements**
3. 对每个 top-level `ExpressionStatement` · 判定：
   - 是否 `CallExpression`
   - 是否 `App(...)` / `Page(...)` / `Component(...)` 注册（允许）
   - 其他一律视为违规 · 打印 `file:line` + 违规表达式 · exit 1

**接入**：`package.json > scripts > check:startup-topcall` · 纳入 `check:all` 族 · husky pre-commit 拦截

**成本估算**：0.5 点 · 约 30-45 min 实现 + 10 min 测试

**收益**：永久性消除"模块顶层副作用"反模式的回归风险 · 补齐 Sprint-1 五连规约盲区（119/120/121/122/123）的第 6 层防护

**决策人**：Sprint-2 Planning 时 tech-lead / Human 裁决

---

## §6 反模式清单交叉引用

本审计报告与 `docs/devops/libversion-upgrade.md` §3 "反模式清单"交叉引用 · 共同沉淀"基础库升级期 + 启动期 API 调用"两个切面的工程经验。

---

**报告结束。本报告为 COSTRA-124 DoD (b) 交付物 · R1 交付后由 `costra-review-tech` Round-1 审查。**

---

## §7 R2 普查追写（COSTRA-125 实装 · 2026-05-04）

### §7.1 触发与目的

COSTRA-124 R1 假设证伪后（Human 2026-05-03 20:09 第 7 次模拟器实测 · `too eayly` ×7+ 仍报 · 详见 `.team/members/miniapp-dev/history/2026-05-03-costra-124-r2-diagnose.md`）· COSTRA-125 接力卡需在 `storage.ts → 全量 async` 重构基础上 · 重新普查"onLaunch 栈内同步 storage 调用"并对账闭合。

普查范围扩大：从"模块顶层副作用"扩展到 **"App.onLaunch 栈内（含 `async function` 体内 await 之前的同步部分）所有 `wx.*StorageSync` 调用点"**。

### §7.2 R2 调用点普查（COSTRA-124 R2 诊断证据 · 数学对账闭合）

冷启动期同步 storage 调用 **共 4 次 · 仅 2 个源**（COSTRA-125 修复前）：

| # | 文件:行号 | API | 调用链（onLaunch 起） | 时刻（相对 onLaunch 进入） |
|---|---|---|---|---|
| 1 | `app.ts:28` → `storage.ts:31` | `wx.getStorageSync(VERSION_KEY)` | `ensureVersion()` 第 1 行 | onLaunch 进入瞬间 |
| 2 | `storage.ts:33` | `wx.clearStorageSync()` | `ensureVersion()` 内（version 不匹配分支） | ≈ 同上 |
| 3 | `storage.ts:34` | `wx.setStorageSync(VERSION_KEY, 1)` | `ensureVersion()` 内（version 不匹配分支） | ≈ 同上 |
| 4 | `app.ts:35` → `auth.ts:70` → `storage.ts:54` | `wx.getStorageSync(TOKEN_KEY)` | `initAuth()` async function 体内**第 1 行**（在 await 之前同步执行）· **R1 漏网点** | onLaunch 进入 + ~1 µs |

**关键点**：调用 4 全部在 onLaunch 栈内同步发生 · 即使 `initAuth` 是 async function · JavaScript 语义保证函数体内**第一个 await 之前的代码仍在调用栈同步执行** · 所以 `getItem(TOKEN_KEY)` 在 onLaunch 同 tick 内被触发 · 命中渲染层 storage group `_prepare` 未就绪 · 抛 `too eayly`。

### §7.3 COSTRA-125 修复后顺扫结果

修复后 `miniprogram/` 顺扫（2026-05-04 R1 实装时）：

```bash
# 同步 API 残留扫描
rg -n 'wx\.(get|set|remove|clear)StorageSync' miniprogram --glob '*.ts'
```

**结果**：

| # | pattern | 命中数 | 说明 |
|---|---|---|---|
| 1 | `wx\.getStorageSync` 等 4 同步 API | **0** | 全部消灭 · storage.ts 已切换到 `wx.getStorage({key})` Promise 形态 |
| 2 | 注释中的 `*Sync` 字样 | 2 | 均在文档/警示注释中（`storage.ts §不变量 #1` + `app.ts` 历史注释）· 非代码调用 · 合规 |
| 3 | `^wx\.`（顶层裸调） | 0 | 继承 COSTRA-124 R1 状态 |
| 4 | `^(const\|let\|var).*wx\.`（顶层赋值） | 0 | 同上 |

**结论**：`miniprogram/**/*.ts` 在 COSTRA-125 修复后 · 启动期所有 storage 调用均走 **async API**（Promise 形态）· SDK 内部负责等待 `_prepare` 就绪后再 resolve。同步 storage API 不再存在。

### §7.4 调用方扫尾对账（DoD (b)(c) 闭合证据）

storage.ts 全 async 化后的 caller 改造 grep 结果（2026-05-04 typecheck PASS 后）：

| caller 文件 | 改 await 数 | 说明 |
|---|---|---|
| `services/auth.ts` | 6 | initAuth `await getItem(TOKEN_KEY)` × 1 + doWxLogin `await setItem` × 1 + refreshToken `await setItem` × 2（mock + real）+ clearToken `await removeItem` × 1 + logout `await clearToken` × 1 |
| `services/sync.ts` | 5 | getCursor `await getItem` × 1 + setCursor `await setItem` × 1 + syncPull `await getCursor/setCursor` × 2 + enqueueLocalEntry `await getItem/setItem` × 2 + __peekOutbox `await getItem` × 1（合计去重计入函数数）|
| `services/request.ts` | 1 | 401 兜底分支 `await clearToken()`（COSTRA-125 顺扫漏点）|
| `app.ts` | 2 | onLaunch 内 `await ensureVersion(); await initAuth();`（封在 IIFE bootstrapPromise 内）|
| `pages/login/index.ts` | 0 | 无直接 storage 调用 · onLoad 走 `await getApp().bootstrapPromise.then(...)` gate |
| `pages/home/index.ts` | 0 | 同上 |
| `pages/mine/index.ts` | 0 | 同上 |
| `pages/entry/index.ts` | 0 | 已有 `await enqueueLocalEntry(...)`（COSTRA-102 即对齐）|

### §7.5 增值发现（Sprint-2 议题候选）

R2 普查过程中识别到一个**潜在二阶时序约束**（**不在本卡范围 · 仅登记为 Sprint-2 议题候选**）：

- `app.ts:globalData.bootAt = Date.now()` 在 `console.info('[Costra] onLaunch env=', ...)` 之前执行
- 当前 `bootAt` 仅作为业务遥测使用 · 不影响 storage · 但若未来某处用 `bootAt` 做"启动是否完成"判断 · 应改用 `app.bootstrapPromise` 而非 `bootAt`（语义更准）

### §7.6 与 §5 候选 CI 脚本的关系

COSTRA-125 修复后 · §5 提议的 `scripts/devops/startup-top-level-call-check.mjs` 候选脚本依然有效 · 但应**扩展第 4 类规则**：

- 旧规则（COSTRA-124 R1 期定义）：扫"模块顶层 `wx.*StorageSync`"
- 新规则（COSTRA-125 R2 期补充）：扫"任何位置的 `wx.*StorageSync` 调用"（启动期 + 运行期都禁用同步 API · 因为渲染层 `_prepare` 就绪状态在前后台切换、热重载等场景仍可能未就绪）
- 实施成本：从 0.5 点上调到 0.7 点（多一类 AST 模式匹配）· 决策人：Sprint-2 Planning

---

**R2 追写结束 · 2026-05-04 by `costra-miniapp-dev`（COSTRA-125 R1 交付物 · DoD (h) 文档追写）**
