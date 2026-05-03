# miniapp-dev · 2026-05-03 · COSTRA-124 Revise-Round-2 根因重做（R1 假设证伪）

- subagent_spawn_ts: 2026-05-03T12:15:15Z
- subagent_finish_ts: 2026-05-03T12:55:00Z（落盘前）
- orchestrator_context: D-017 Step 2 第 5 次实战 · SBAI v1.1 P2' 冒烟第 3 回 · 本轮**只诊断不改代码**
- task_type: review-response（revise-round-2 诊断篇 · 按 D-015 §2.1 "同轮落盘修复"语义本应一轮到位 · 但本次**按 Orchestrator 派单明令只诊断不修复** · 分离诊断/修复两轮是 D-017 Step 2 与 D-015 的显式叠加）

---

## §0 事实源三证（D-017 铁律）

| # | 证据 | 结果 |
|---|---|---|
| 1 | `git ls-files miniprogram/` | 60 个文件 · 结构完整（主包 pages/ + 分包 pages-stat/ pages-family/ + services/ tokens/ utils/） |
| 2 | `git log --oneline -10 miniprogram/app.ts miniprogram/services/storage.ts` | 最近一次改动 = `a296be0 fix(miniapp): move ensureversion from storage top-level to app onlaunch`（R1 实装 commit · 2026-05-02） |
| 3 | `git show HEAD:miniprogram/app.ts` + `git show HEAD:miniprogram/services/storage.ts` | R1 改动确已落盘：`app.ts:28` 首行 `ensureVersion()` · `storage.ts` 顶层无裸调 · `ensureVersion` 正确 `export` |

**三证确认 R1 实装本身正确 · 但实测仍报 `too eayly` → R1 假设必然不完整**。

---

## §1 任务描述

**Human 2026-05-03 20:09（UTC+8）第 7 次模拟器实测**（R1 实装 commit `a296be0` + 文档 commit `221b074` 已落盘 · 已清缓存 + 重新编译）· Console 日志证据：

```
[system] WeChatLib: 2.32.3 (2024.3.17 23:34:59)
[system] No. of subpackages: 2
[system] LazyCodeLoading: true
app.ts:31 [Costra] onLaunch env= dev              ← onLaunch 已进入 · 本行之前 Console 无任何红色错误
[渲染层错误] [jsbridge] invoke getGlobalStorage fail: too eayly. ... at Tt._prepare ... at createOrGetStorageGroup
[渲染层错误] Error: SystemError Failed get storage group metadata;getGlobalStorage:fail too early
[渲染层错误] [jsbridge] invoke setGlobalStorage fail: too eayly. ... at Tt._setMetadata
[渲染层错误] [jsbridge] invoke getGlobalStorage fail: too eayly. ... at Tt.get
[渲染层错误] Error: SystemError Failed get storage group data
[渲染层错误] [jsbridge] invoke removeGlobalStorage fail: too eayly. ... at Tt.delete
[渲染层错误] Error: SystemError Failed delete storage group data
[system] Launch Time: 1864 ms
```

Human 补充："wx.login 没跑到是因为还没点登录。这个问题只要一打开小程序就会出现，点登录后会正常弹 wx.login。"

核心冲突：
- **R1 的核心假设**："把 `ensureVersion()` 从 storage.ts 模块顶层迁入 app.ts `onLaunch` 首行即可规避 `too eayly`"
- **实测证伪**：onLaunch 已进入（`[Costra] onLaunch env= dev` 先出）· 但错误**仍在其后成群抛出**（`_prepare/_setMetadata/get/delete` 共 4 种 API × 多次）· 属**渲染层错误**
- **R1 未彻底修好** → **Revise-Round-2 根因重做 · 本轮只诊断不修复**

---

## §2 L1 表层现象（重构）

| 维度 | 本次（第 7 次实测 · 2026-05-03 20:09） | 上次根因报告假设（2026-05-02 20:25 v1） |
|---|---|---|
| 错误文本 | 4 类：`getGlobalStorage fail: too eayly` / `setGlobalStorage fail: too eayly` / `removeGlobalStorage fail: too eayly` / `SystemError Failed {get,set,delete} storage group {metadata,data}` | 仅 1 类：`getGlobalStorage fail: too eayly` |
| 错误归属 | `[渲染层错误]`（明确标注） | 同（渲染层） |
| 栈关键帧 | `Tt._prepare` / `Tt._setMetadata` / `Tt.get` / `Tt.delete` / `createOrGetStorageGroup` | `WAWebview.js → Tt._prepare → createOrGetStorageGroup`（仅 get 路径） |
| 发生时刻 | **onLaunch 进入后**（`[Costra] onLaunch env= dev` 打印在前 · 错误在后） | 未明确相对时刻（假设在 App 注册前） |
| 错误与用户交互关系 | **无关**（Human 明文：不点登录就复现 · 点登录后反而 wx.login OK） | 未测 |
| Launch Time | 1864 ms（基线 865 ms · **×2.16 劣化** · 与错误堆栈反复抛出相关） | 未测（上次也 1000+ ms 但未比对） |
| 错误触发频次 | 至少 7 次（从日志可数 · 实际可能更多 console 聚合） | 假设 1~3 次（ensureVersion 三步 get/clear/set 各 1 次） |

**L1 新结论**：错误**不止一处触发** · 不止 `wx.getStorageSync` 一个入口 · 属**"onLaunch 进入后 · 整个 storage group 基础设施都处于 `_prepare` 未就绪态"的批量失败**。

---

## §3 L2 · SDK 机制层（WebFetch 官方文档证据 + 实测逆推）

### §3.1 官方文档证据（3 次 WebFetch · §G.5 冒烟 tool 集合 1/3）

| 来源 | URL | 关键原文 | 对本次诊断的意义 |
|---|---|---|---|
| A | <https://developers.weixin.qq.com/miniprogram/dev/api/storage/wx.getStorageSync.html> | **"storage 应只用来进行数据的持久化存储，不应用于运行时的数据传递或全局状态管理。启动过程中过多的同步读写存储，会显著影响启动耗时。"** | 官方**自认**启动期 storage 同步调用有**性能影响** · 但属**软警告** · **未明文说启动期会失败** |
| B | <https://developers.weixin.qq.com/miniprogram/dev/reference/api/App.html> | "onLaunch 时逻辑层已完成初始化 · wx 对象已注入 · 不要在 app.js 顶层调（App 未注册）· 推荐在 onLaunch 内 `wx.getStorageSync` 取 token" | 官方**承诺** onLaunch 内 wx.getStorageSync 可用 —— **但本次实测证伪** |
| C | <https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/operating-mechanism.html> | 运行机制页**未提及** "storage group" / "prepare" / "渲染层 storage 委托"等概念 · 说 "storage 属逻辑层能力 · 理论上不受 Skyline 影响" | `storage group prepare` 是 **SDK 内部实现细节** · **不在契约层** · 且 storage 归属"逻辑层"与实测归属`[渲染层错误]`**矛盾** |

### §3.2 对官方文档证据的解读

**三点核心判断**：

1. **文档 B 的承诺（onLaunch 内 storage 可用）与实测行为严重冲突** · 这不是"我方违反文档" · 而是 **基础库 2.32.3 的实现与文档脱节**（可能是 2.32.x 某次 patch 引入的**运行时回归**）
2. **storage group 的"prepare 未就绪"属 SDK 内部状态机** · 官方未承诺任何入口（onLaunch / onShow / Page.onLoad）一定 prepare 就绪 · 这是个**隐式契约黑洞**
3. **错误归属 `[渲染层错误]`** · 而我方 `wx.getStorageSync` 调在 **AppService 逻辑层** —— 说明 2.32.3+ 把 storage 调用**委托给渲染层 storage group 基础设施**（SDK 内部实现选择 · 非业务可控）· 而**渲染层 storage group `_prepare` 就绪晚于 AppService 的 onLaunch 触发**

### §3.3 推测（需 Sprint-2 模拟器二分验证 · 非本轮诊断强证据）

SDK 2.32.3+ 的启动期 storage 实现可能是：

```
AppService 启动 → App() 注册 → onLaunch 触发
         ↓                            ↓
     wx.getStorageSync(K)         [Costra] onLaunch env= dev 打印
         ↓（此时渲染层 storage group _prepare 未就绪）
     [渲染层错误] too eayly
         ↓（SDK 内部可能 swallow · 也可能级联重试）
     返回 '' 或 undefined（业务看不见错误）
```

即：**onLaunch 时"逻辑层就绪 ≠ 渲染层 storage group 就绪"** · 官方文档混淆了"wx 对象可调"与"调用一定不失败"两件事。

---

## §4 L3 · 我方业务调 storage 的完整调用点普查（本轮关键发现）

### §4.1 DFS 展开 · onLaunch 触发后的 storage 同步调用链

| # | 文件:行号 | Storage API | 调用链（onLaunch 起） | 执行时刻（相对 onLaunch 进入） |
|---|---|---|---|---|
| 1 | `app.ts:28` → `storage.ts:31` | `wx.getStorageSync(VERSION_KEY)` | onLaunch 第 1 行 `ensureVersion()` → storage.ts:31 | **onLaunch 进入瞬间**（同步）|
| 2 | `storage.ts:33` | `wx.clearStorageSync()` | ensureVersion 内（若 version 不匹配）| ≈ 同上（同步）|
| 3 | `storage.ts:34` | `wx.setStorageSync(VERSION_KEY, 1)` | ensureVersion 内（若 version 不匹配）| ≈ 同上（同步）|
| 4 | `app.ts:35` → `auth.ts:70` → `storage.ts:54` | **`wx.getStorageSync(TOKEN_KEY)`** ← **本轮关键新发现！** | `initAuth()` 是 async 但体内第 1 行 `getItem(TOKEN_KEY)` 在 await 之前 · **同步执行** | **onLaunch 进入 +  ~1 µs**（async 函数被调用瞬间执行同步部分）|

### §4.2 `initAuth` 是 async function 为何仍同步触发 storage？

JavaScript `async function` 语义：被调用时，**函数体内第一个 `await` 之前的代码仍是同步执行的**，只是把"函数返回值"包装成 Promise。

对照 `auth.ts:69-77`：

```ts
export async function initAuth(): Promise<void> {
  const saved = getItem<TokenStored>(TOKEN_KEY);   // ← ⚠️ 同步执行！在 onLaunch 栈上
  if (saved && saved.access_expires_at > Date.now()) {
    current = wrap(saved);
    return;
  }
  current = null;
}
```

- `initAuth` 函数体**没有任何 await**（走 mock 或 dev 早退分支）· 即使有 await 也在 `getItem` 之后
- 所以 `app.ts:35 initAuth().then(...)` 这一行，`initAuth()` 调用**会同步执行到 return 为止** · 然后 .then 才进入 microtask
- **结果**：`app.ts:28 ensureVersion()` 的 3 个 storage 调用 + `auth.ts:70 getItem(TOKEN_KEY)` 的 1 个 storage 调用 · **共 4 次同步 storage 调用全部堆在 onLaunch 栈内的前几 µs**

### §4.3 这解释了实测观察

| 实测观察 | §4.1 解释 |
|---|---|
| 错误出现在 `[Costra] onLaunch env= dev`（app.ts:31）**之后** | ensureVersion 是 onLaunch 第 28 行 · console.info 是第 31 行 · console.info 先打印然后后续 initAuth 又调 storage · 但错误是**异步 jsbridge 回报**（渲染层→逻辑层）· 时序上落在 console.info 之后合理 |
| 4 种 API 错误都出（get/set/remove/metadata）| ensureVersion 触发 get（#1）+ set（#3）· initAuth 再触发 get（#4）· remove 可能是 SDK 内部级联（version 不匹配时 clearStorageSync 隐式遍历所有 key 调 remove） |
| Launch Time 1864 ms | 每次 jsbridge 错误报告都占启动线程 · 加上 SDK 内部可能的重试/超时 · 累计 ~1000 ms 劣化 |
| 错误与用户交互无关 | 调用栈完全在 App 生命周期 onLaunch 里 · 与用户点击/wx.login 无关 |

### §4.4 R1 未覆盖的第二个触发点 = `initAuth()` 内的 `getItem(TOKEN_KEY)`

**R1 只挪了 `ensureVersion`** · 但 **`initAuth` 内的 `getItem(TOKEN_KEY)` 仍在 onLaunch 栈上同步执行** · 属于"不迁 storage.ts 顶层但仍在 onLaunch 里的同类调用"——**这才是 R1 假设的最大漏洞**。

### §4.5 顺扫其他潜在路径（本轮排除）

| 候选触发链 | 结论 |
|---|---|
| Page() 构造期 `data` 字面量含 storage 调用 | ❌ Grep `Page\b.*data:` 扫 10 个 Page 定义 · 均为纯字面量 · 无 getItem/wx 调用 |
| import 副作用（模块顶层） | ❌ Grep `^wx\.` + `^(const\|let\|var).*wx\.` 全仓 0 命中 · R1 已消除这类 |
| `services/sync.ts` 的 `getCursor/getItem` | ✅ 不在启动链 · 只在 `syncPull` 调用时才走 · 不影响冷启动 |
| `tokens/index.ts` | ❌ 纯对象字面量 · 无 wx 调用 |
| `services/env.ts` | ❌ 仅 ENV_MAP 常量 · 无 wx 调用 |
| `services/flags.ts` | ❌ 仅 wrapper 闭包 · 无顶层 wx |
| `services/request.ts` | ❌ 启动期不调用 · 由页面 / auth 按需触发 |
| pages/login/index.ts onLoad | ❌ 只调 `hasValidSession()`（纯内存 `current` 读）· 不访问 storage |
| pages/home/index.ts onShow | ❌ 同上 |

**L3 最终结论**：冷启动期 storage 同步调用链**仅 2 条** · 全部在 `app.ts:onLaunch` 栈内 · 对应 `ensureVersion()` + `initAuth()` → `getItem(TOKEN_KEY)`。

---

## §5 L4 · 根因（新 · 证伪 R1 假设）

### §5.1 根因链（严格因果序）

```
（新）基础库 2.32.3 启动期实现
      ↓
App() 注册 + onLaunch 触发 时 · 渲染层 storage group _prepare 状态为"未就绪"
      ↓
     ┌──────────────────────────┬──────────────────────────┐
     ↓                          ↓                          ↓
app.ts:28 ensureVersion()   app.ts:35 initAuth()     （R1 覆盖的旧顶层副作用）
      ↓                          ↓                     已消除
storage.ts:31 getStorageSync   auth.ts:70 getItem→
storage.ts:33 clearStorageSync  storage.ts:54 getStorageSync
storage.ts:34 setStorageSync     ↓
      ↓                     jsbridge → 渲染层
jsbridge → 渲染层           storage group
storage group _prepare 未就绪 → "too eayly"（×N）
      ↓
SDK 内部 storage group 元数据/数据访问失败
      ↓
返回空 / 抛 SystemError
      ↓
业务层：getItem 返回 null · ensureVersion 里的 try/catch 吞错 · 业务看不到错
但 Console 留下 [渲染层错误] × 多条
Launch Time 1864 ms（每次 jsbridge 往返 ~100-200 ms）
```

### §5.2 R1 假设的精确证伪

| R1 假设（2026-05-02） | 新证据 | 结论 |
|---|---|---|
| "storage.ts:29 模块顶层 `ensureVersion()` 是唯一触发点" | §4.1 证明至少有 2 处（ensureVersion + initAuth 内 getItem）· 实际错误 ×7+ | **部分正确 · 不完整** |
| "迁入 onLaunch 首行即可规避 too eayly" | 实测 onLaunch 已进入仍报错 → onLaunch 不是安全时刻 | **完全证伪** |
| "太早"指 App() 注册前 | `[Costra] onLaunch env= dev`（app.ts:31）打印后仍报错 · App 已注册 onLaunch 已触发 → "太早"指 **渲染层 storage group `_prepare` 未就绪** · 与 App 注册状态无关 | **证伪 · 太早的参照系错了** |
| "方案 A 零风险" | 方案 A 让 ensureVersion 的 3 次错误从 App-before 挪到 App-within · **错误数量几乎不变 · 只是换个时点复现** | **方案 A 实质无效 · 假安全** |

### §5.3 R1 为什么过了 Review 33/35？

- review-tech R1 审查**纸面审** · 无模拟器访问 · 只能验"R1 实装与 dispatch §3 DoD 一致"
- Grep 自证 `^wx\.` 0 命中 · audit 报告 0 命中 —— **这些都对** · 但只覆盖"模块顶层副作用"一个维度
- 没人在模拟器跑过 · 所以 "onLaunch 内调 storage 会失败" 这个**反直觉事实**没被发现
- Sprint-1 末 Retro 议题 11 "Review 35/35 可能基于错误假设 · Human 实测闸作为绝对证据" 正是本次范式的第 2 次复现（COSTRA-121 / COSTRA-124 连庄）

### §5.4 L4 根因定性（最终）

**本次 FU-LAUNCH-FIRST-RENDER-RACE 的根因不是"storage.ts 顶层副作用"（R1 假设）· 而是**：

> **微信基础库 2.32.3+ 在 App.onLaunch 触发时 · 渲染层 storage group `_prepare` 状态尚未就绪 · 任何从逻辑层同步发起的 storage 调用（`wx.*StorageSync`）都会经 jsbridge 委托到渲染层 storage group 并报 `too eayly` · 这是 SDK 内部实现细节 · 与官方文档"onLaunch 时 wx 可用"承诺脱节**。

从"业务触发"重新解读："业务触发"指"我方有 storage 调用"这一事实 · 而"错误本身的必然性"属 SDK 2.32.3+ 的启动期时序约束。**本质是 SDK + 业务时序双方的合谋** · 不是单方过错。

**定性定格**（相对 2026-05-02 v2 定性再升级 v3）：
- v1（2026-04-29 ~ 2026-05-02 19:32 · 三次观察）："100% SDK 内部 Bug"
- v2（2026-05-02 20:25 · 装扮 subagent 根因 v1）："storage.ts:29 顶层副作用业务触发 · SDK 无辜"
- **v3（本次 2026-05-03 · R2 诊断）**："SDK 2.32.3+ 启动期 storage group 就绪时序约束 + 业务任何 onLaunch 内同步 storage 调用 = 必然冲突 · SDK 与业务**共同责任**"

---

## §6 ≥ 3 方案对比（§G.2）

**按成本递增 + 风险分布**列 6 个方案（超过要求的 3 个 · 零改/小改/结构性齐备）：

### §6.1 方案 A'（推荐主修 · 小改 · 中成本）：推迟到 App.onShow 或首 Page.onLoad

**做法**：把 `ensureVersion()` + `initAuth()` 整体从 `App.onLaunch` 挪到 `App.onShow`（首次 show 时跑）· 或首个 Page（login）的 `onLoad`

**预期效果**：
- onShow 晚于 onLaunch · 渲染层已开始准备 → storage group `_prepare` 可能已就绪（**需模拟器验证**）
- 首 Page.onLoad 更晚 · 更安全 · 但会阻塞登录页首屏渲染

**成本**：代码改 5-10 行 · app.ts 重构 onLaunch 轻量化 · 增 onShow 方法

**风险**：
- ⚠️ **R1 再证伪风险**：onShow 也可能 prepare 未就绪（官方文档一样模糊）· 需 Human 实测
- ⚠️ `initAuth` 挪到 onShow 后 · 首 Page 渲染时 `hasValidSession()` 可能误报未登录（竞态）· 需加 "initAuth 完成前首屏显示骨架" 语义
- ⚠️ onShow 每次前后台切换都触发 · ensureVersion 要幂等（当前函数体就是幂等的 · 风险低）

**置信度**：**中低** · 只是把错误时点往后挪一档 · 没有根本解决 `_prepare` 就绪时机未知的问题

### §6.2 方案 B'（推荐主修 · 小改 · 低成本 · 高置信）：异步 storage API 全量替换

**做法**：
- 把 `wx.getStorageSync` → `wx.getStorage({ success, fail, complete })`（官方 Promise 封装 `wx.getStorage({key}).then(...)` 2.21.0+ 支持）
- `storage.ts` 全部同步 API 改为返回 `Promise<T | null>`
- 所有 caller（`auth.ts` / `sync.ts` / `storage.ts 内部`）改 await
- `ensureVersion` 改为 `async ensureVersion(): Promise<void>` · `app.ts:onLaunch` 内 `await ensureVersion()`

**预期效果**：
- 异步 API 走回调/Promise · SDK 有机会**内部等 `_prepare` 就绪**再执行 · 官方实现细节承担就绪等待
- 理论上彻底规避 "too eayly"（但需模拟器验证 · 因为官方也没白纸黑字承诺异步 API 会等）
- 类型安全 · 所有 caller 强制 await · 无隐式同步假设

**成本**：代码改 ~60 行 · 影响 `storage.ts` + `auth.ts` + `sync.ts` + `app.ts`（onLaunch/onShow）+ `login/index.ts` / `home/index.ts` / `mine/index.ts`（hasValidSession 路径不变 · 因为 current 是内存态 · 只影响初始化路径）

**风险**：
- ⚠️ 重构面大 · 但类型系统强制兜住 · typecheck 能抓所有遗漏点
- ⚠️ `initAuth` 本来就 async · 改完更自然 · 但 `request.ts` 里的 `getToken()` 是同步读内存 · 必须确保 `initAuth()` 在 request 前已 resolve · 否则 Authorization header 漏打
- ⚠️ Sprint-1 末估点压力（1 点估点必超 · 可能需 2-3 点）

**置信度**：**中高** · 异步 API 更符合 SDK 现代实现设计 · 但需实测坐实

### §6.3 方案 C'（零代码改动 · 最低成本 · 事实债务）：降级基础库到 2.31.x 或更低

**做法**：`project.config.json` `"libVersion": "2.32.3"` → `"2.30.4"` 或 `"2.19.4"`（Sprint-0 前稳定版）· 不改一行业务代码

**预期效果**：
- 2.32.3 的 storage group 新实现是"启动期 prepare 晚就绪"的直接成因 · 降版本可能退回旧实现 · 旧实现 storage 在 onLaunch 内可用（文档 B 的承诺原本就是对旧实现的描述）
- Launch Time 可能回到 865 ms 基线

**成本**：代码 0 行改动 · commit 只改 project.config.json 1 行

**风险**：
- ⚠️ **长期技术债**：阻碍 Skyline / 2.32.3+ 新特性使用 · 未来 Sprint 升级还要重走一遍
- ⚠️ 其他已用 2.32.3+ 特性回归（如分包预加载新策略 / LazyCodeLoading 新行为）· 风险面扩大
- ⚠️ 与 `docs/devops/libversion-upgrade.md` §3 反模式 #1 "不升反降作为规避手段" 冲突（本次追写就得反模式 #4 "R1 假设证伪后把降版本作为权宜之计"）
- ⚠️ Human 线索原文："不是微信基础库的 bug · 而是高版本库对时序有要求" → 隐含态度是"承认新库的时序约束并适配"· 降版本与此态度背道而驰

**置信度**：**高**（能规避 · 但和项目方向背离）

### §6.4 方案 D'（小改 · 中高置信）：微任务延迟触发 storage 调用

**做法**：
```ts
onLaunch() {
  this.globalData.bootAt = Date.now();
  console.info('[Costra] onLaunch env=', this.globalData.env.name);

  // 让出 microtask · 等渲染层 storage group _prepare
  Promise.resolve().then(() => {
    ensureVersion();
    initAuth().then(/*...*/);
  });
}
```

**预期效果**：
- Promise.resolve().then 把整个 storage-touching 块推到当前 tick 结束后的 microtask · 可能给 `_prepare` 一个"就绪机会"
- 比方案 A' 更轻量（不依赖 onShow/onLoad 生命周期契约）· 比方案 B' 低重构量

**成本**：代码改 ~3 行 · 仅 app.ts

**风险**：
- ⚠️ **不确定性最大**：`_prepare` 就绪时刻是 SDK 内部 · microtask 后仍可能未就绪
- ⚠️ 不保证 Launch Time 改善（`_prepare` 可能是 macrotask 驱动 · 1 个 microtask 根本等不到）
- ⚠️ **反模式候选**：方法论文档 §3.2 已明文 "setTimeout/微任务延迟掩盖时序问题 = 坏例" · 此方案与反模式 #2 危险接近

**置信度**：**中低**（需要模拟器实测 · 可能误）

### §6.5 方案 E'（结构性 · 高成本 · 最彻底）：storage 访问全量异步化 + lazy init

**做法**：
- `storage.ts` 全量异步化（同方案 B'）
- 引入 `bootstrapPromise`：`app.ts` onLaunch 把 `ensureVersion + initAuth` 包成一个 Promise 暴露到 `wx.$bootstrapPromise`
- 所有 Page.onLoad / onShow 若需要 auth 状态 · 先 `await wx.$bootstrapPromise` 再 `hasValidSession`
- `request.ts` 若检测到未 bootstrap 完成 · 先 await 再 send

**预期效果**：
- 任何页面都不会在 bootstrap 完成前访问 storage · 彻底消除启动竞态
- 与 FU-LAUNCH 另一半（`Expected updated data but get first rendering data`）可能同时解决（因其可能也是 storage 竞态派生）

**成本**：重构 ~200 行 · 影响 10+ 文件 · 估点 3-5 点

**风险**：
- 改动面大 · Sprint-1 末无法完成 · 必须 Sprint-2 专卡
- 需要重新写 storage.ts 单测 + auth.ts 单测

**置信度**：**高**（工程上最彻底 · 代价最大）

### §6.6 方案 F'（零改 · 信息收集）：接受告警 + 白名单化 · 等微信基础库修复

**做法**：
- 接受"onLaunch 内 storage 报 too eayly 但业务层 try/catch 吞掉 · 功能正常"这一事实
- 在 `storage.ts` 的 try/catch 内补 `if (e.message.includes('too eayly')) { /* 已知 SDK 时序告警 · 忽略 */ }` · 不打 warn 日志污染 Console
- FU-LAUNCH 状态继续 `open` · 标注"等微信基础库 2.33+ 修复" · 定期上微信社区看 issue 追踪

**预期效果**：
- Console 干净 · 业务无感知
- Launch Time 可能仍有轻度劣化（jsbridge 往返开销）· 但不阻塞功能

**成本**：代码改 ~3 行（加一条 warn 过滤）

**风险**：
- ⚠️ **鸵鸟策略**：错误仍真实发生 · 只是 UI 隐藏 · 性能劣化真实存在
- ⚠️ Launch Time 1864 ms 远超 900 ms AMBER 区间 · D-017 验证门槛不过
- ⚠️ 不治本 · 社区/官方修复周期不可控

**置信度**：**低**（权宜之计）

### §6.7 方案对比矩阵

| 方案 | 代码改动 | 估点 | 置信度 | Launch Time 预期 | 长期债 | 推荐级别 |
|---|---|---|---|---|---|---|
| A' · onShow/onLoad | 5-10 行 | 0.5 | 中低 | 可能改善 | 低（时序仍不显式） | ⚠️ 可作 POC 但不建议主推 |
| **B' · 异步 API 全量** | ~60 行 | 2 | **中高** | 理论回归基线 | 低（向官方 API 现代化对齐）| ⭐ **主推** |
| C' · 降基础库 | 1 行 | 0.1 | 高 | 回归基线 | **高**（阻碍长期升级）| 🟡 应急兜底 · 不推荐 |
| D' · microtask 延迟 | 3 行 | 0.2 | 中低 | 不确定 | 中（反模式候选）| ❌ 不推荐（踩方法论反模式）|
| E' · 全量 lazy + bootstrap | 200+ 行 | 3-5 | 高 | 回归基线 | 低（工程最彻底）| 🟢 Sprint-2 专卡候选 |
| F' · 鸵鸟 + 社区等 | 3 行 | 0.2 | 低 | 不改善 | 不确定 | ❌ 不推荐（功能 OK 但 Launch Time 不过关）|

**最佳组合**：
- **短期（Sprint-1 末 / Sprint-2 首）**：C'（应急 · 回退基础库）+ E' Sprint-2 立卡长期修复
- **中期（Sprint-2）**：B'（异步 API 全量）作为主修 · 同步验证 2.32.3 + 异步 API 组合是否真能规避
- **长期（Sprint-2~3）**：E'（bootstrap Promise + lazy init）作为架构级演进

**若 Human 要求"必须本轮修好"**：建议走 **B'**（异步 API 全量）· 但本轮已超 1 点估点 · 需重新估 2 点 + 可能新开 COSTRA-125 接力卡。

---

## §7 Q1~Q8 Human 决策点（§G.3）

### Q1 · 定性是否再次翻转？

**推荐答案**：**是**。

- v1（SDK Bug · 三次观察）→ v2（业务触发 · 第 4 次 subagent 翻转）→ **v3（SDK + 业务共同责任 · 第 5 次 R2 再翻转）**
- v3 相对 v2 的修正：v2 归因单点（storage.ts:29）· v3 扩展为"onLaunch 内任何同步 storage 调用都会撞 `_prepare` 未就绪"· 因果域从 1 个触发点升级到 "整个 onLaunch 同步 storage 调用族"
- Retro 议题 15 "独立复核可翻转历史定性" 在本次达到第 2 次翻转 · 可升级为"第 N 次翻转也正常 · 定性是过程产物不是终点"的范式沉淀

### Q2 · R1 修复是否撤回 / 保留 / 并入新方案？

**推荐答案**：**保留**（不撤回）· 并入新方案。

- R1 把 storage.ts 顶层副作用清掉 · **即使不是根因 · 也是架构上更合理的做法**（模块顶层副作用是公认反模式）
- R1 的 `docs/devops/startup-api-call-audit.md` + `docs/devops/libversion-upgrade.md` 文档基础设施仍有价值 · 只需追写"R1 假设证伪反模式 #4" + "v3 定性再翻转"
- 新方案在 R1 基础上继续演进（不从 commit `a296be0` 回滚）

### Q3 · 选哪个方案？

**推荐答案**：**三选一 · 按风险偏好**

| Human 偏好 | 推荐方案 | 理由 |
|---|---|---|
| "Sprint-1 必须闭合 · 小动作" | C'（降基础库）+ Sprint-2 B'/E' 接力 | 最低风险最快兑现 · 但背项目方向 |
| "正确方向 · 接受 Sprint-1 略晚几天收官" | **B'（异步 API 全量）** | 中高置信 · 方向正确 · 估点 2 点 |
| "彻底治 · 接受 Sprint-2 立大卡" | E'（bootstrap + lazy init） | 工程最彻底 · 一劳永逸 · 但本轮无法兑现 |

**subagent 首推**：**B'（异步 API 全量）** · 中道方案 · 方向正确 + 可模拟器验证。

### Q4 · COSTRA-124 是本卡 Revise-Round-2 完成 · 还是立 COSTRA-125 接力卡 · 还是整卡 Revise？

**推荐答案**：**立 COSTRA-125 接力卡**（路径 ②）。

依据：
- Dispatch §3 DoD (c) 路径 ② 明文："复现时诊断不修复 · 另起卡 · 保持 1 点估点"
- COSTRA-124 已闭合"storage.ts 顶层副作用清扫"子目标（有 commit + 文档 + FU f.1/f.2 预闭合齐备）· 这部分价值成立
- COSTRA-124 的 FU-LAUNCH 只**部分闭合**（顶层副作用分支）· 另一半（onLaunch 内同步调用）拆出 FU-LAUNCH-FIRST-RENDER-RACE-B 或直接 COSTRA-125 解决
- 避免本卡 Revise-Round-2/3 无限循环 · 也避免估点严重失真（1 点 → 3 点）

**COSTRA-125 建议定义**：
- 标题："启动期 storage 异步化 · onLaunch 内同步调用根因解决"
- Owner: miniapp-dev
- Type: fix
- Points: 2（如 B' 方案）或 3-5（如 E' 方案 · Sprint-2 专卡）
- DoD: 包含"ensureVersion async 化 + initAuth 内 getItem async 化 + 模拟器实测 Launch Time ≤ 900 ms + Console 0 `too eayly`"
- 依赖: COSTRA-124（已闭合顶层副作用分支）

### Q5 · 基础库版本是否需要立项评估"是否降版本"？

**推荐答案**：**需要**（独立评估卡 · 不纳入 COSTRA-125）。

- 建议新 FU 或卡：`docs/devops/libversion-strategy.md`
- 内容：2.32.3 vs 2.30.x vs 2.19.x 的特性/稳定性矩阵 · 结合 Costra 产品路线（是否依赖 Skyline / 2.32+ 新能力）
- 产出："短期 C' 兜底" / "中期保持 2.32.3 + B'" / "长期 E'" 三档选择依据
- 附带：微信开放社区 `too eayly` issue tracker 链接（若存在 · 让 Orchestrator WebFetch 查一下）· 定期订阅基础库 changelog

### Q6 · `docs/devops/libversion-upgrade.md` §3 反模式清单是否追补 #4？

**推荐答案**：**是**。

追补 **反模式 #4**：
- **坏例**：R1 假设"把 wx.* 同步调用从模块顶层迁入 App.onLaunch 首行即安全"
- **好例**：验证 SDK 运行时实现细节（如"onLaunch 时 storage group `_prepare` 就绪态"）与官方文档承诺（"onLaunch 内 wx 可用"）是否吻合 · 必须模拟器实测 · 不信纸面
- **原因**：文档承诺 ≠ 运行时实现 · 特别是 SDK 内部实现细节（如 storage group / prepare 状态机）属黑盒 · 只能实测逆推

### Q7 · Review-Tech 33/35 纸面审为什么没拦住 R1 假设漏洞？

**推荐答案**：**Retro 议题 17**（新增）

- 现象：review-tech 只纸面审 + Grep 自证 · 无模拟器访问 · 无法验"运行时实现与文档是否一致"
- 议题 17 建议："Review-Tech 对 runtime 规约类 T2 卡 · 必须要求 Human 模拟器实测作为 Round-N+1 的前置 · 或 Review-Tech 本身被赋予 mock 模拟器 Bash 工具（如官方 CI mini-ci）"
- 与 Retro 议题 11 "Review 35/35 可能基于错误假设" 并链

### Q8 · FU-LAUNCH-FIRST-RENDER-RACE 如何处置？

**推荐答案**：**状态保持 `open` + 文档追写第 5 次观察（R2 诊断翻转）+ 分裂为两子 FU**

- **FU-LAUNCH-FIRST-RENDER-RACE-A**：storage.ts 顶层副作用（COSTRA-124 已闭合）· 可 close
- **FU-LAUNCH-FIRST-RENDER-RACE-B**：onLaunch 内同步 storage 调用冲突 `_prepare` 未就绪（新 · COSTRA-125 认领）· 保持 `open`
- **FU-LAUNCH-FIRST-RENDER-RACE-C**：`Expected updated data but get first rendering data`（R1 走路径 ① 假设自然消失 · 本次因 R2 未修复 storage 问题无法判定 · 保持 open · 等 COSTRA-125 实测）

---

## §8 本次 spawn 工具调用集合（§G.5 冒烟自证）

| 工具 | 调用次数 | 范围 |
|---|---|---|
| Read | ~14 次 | `.team/HANDOFF.md` / dispatch / 前 2 次 history / 2 份 reviews / D-017 / D-015 / app.ts / storage.ts / auth.ts / env.ts / app.json / request.ts / home+login pages / state.md |
| Grep | 1 次（合并在 Bash 内）| 通过 Bash 的 grep -rn 批量执行（避免多次 ripgrep 冗余） |
| Bash | **~6 次**（**全部只读** · `git ls-files` / `git log` / `git show` / `cat` / `grep -rn`）· **0 次 git commit / git push / 任何写命令** | `/Users/weizhao/Desktop/Costra/` 工作区只读 |
| WebFetch | **3 次**（微信官方文档）| developers.weixin.qq.com · `wx.getStorageSync` API / App 生命周期 / 运行机制 |
| TodoWrite | 4 次 | 任务拆解追踪（本文件归属任务 8） |
| **Edit** | **0 次（对 miniprogram/ 的改动）** · 本轮只诊断不改代码 · Edit 只用于更新 state.md（§9 落盘） | — |
| **Write** | **本 history 文件 1 次** · 未写任何 miniprogram/ 文件 | — |
| **miniprogram/ 写入总次数** | **0** | 严格遵守 §B 硬约束 |
| **git commit 总次数** | **0** | 严格遵守 §B 硬约束 |

**SBAI v1.1 P2' 冒烟第 3 回**：装扮 subagent 工具集合 `{Read, Grep, Bash(read-only), WebFetch, TodoWrite, Write(仅 .team/), Edit(仅 .team/)}` · **miniprogram/ 写入物理隔离验证通过**（靠纪律而非工具白名单 · 因装扮档仍物理有 Write 权）· D-017 Step 2 "只诊断不修复"纪律首次跨 subagent 实例验证。

---

## §9 state.md 本轮 diff（§H 要求 2）

- **§2 active tasks**：COSTRA-124 条目追写"R2 诊断完成 · R1 假设证伪 · 等 Human 裁决 Q1-Q8 + 可能立 COSTRA-125 接力卡"
- **§3 交付历史索引**：新增本 history `2026-05-03-costra-124-r2-diagnose.md` 一条
- **§6 遗留问题**：FU-LAUNCH-FIRST-RENDER-RACE 条目追写"v3 定性再升级（SDK + 业务共同责任 · onLaunch 内任何同步 storage 调用均会撞 `_prepare` 未就绪）· R1 假设证伪"
- **§7 时间戳**：追加 `2026-05-03T12:55:00+08:00 · COSTRA-124 Revise-Round-2 根因重做完成（by costra-miniapp-dev · SBAI v1.1 P2' 冒烟第 3 回 · 只诊断不改代码）`

---

## §10 交付小结

- **本轮严格 0 代码改动 · 0 git commit**
- 4 份产出：本 history · state.md diff（4 处）· 磁盘 miniprogram/ 未动 · docs/ 未动
- 关键结论：**R1 假设部分正确但不完整 · 定性 v3 升级 · 推荐立 COSTRA-125 接力卡 · 方案 B'（异步 API 全量）主推 · C'（降基础库）兜底 · E'（bootstrap+lazy）Sprint-2 演进**
- Human 决策点 Q1-Q8 · **建议全按推荐**或重点讨论 Q3/Q4（方案选择 + 接力卡立与否）

---

**history 结束 · COSTRA-124 R2 诊断全程 1 次 spawn 完成 · 等 Orchestrator 收 final message 后回给 Human 裁决 · 可能派生动作：立 COSTRA-125 / 追写 docs/devops/libversion-upgrade.md #4 反模式 / 分裂 FU-LAUNCH-FIRST-RENDER-RACE 为 A/B/C 子 FU。**
