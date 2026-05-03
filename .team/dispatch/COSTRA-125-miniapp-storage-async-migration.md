# COSTRA-125 · 启动期 storage 异步化 · onLaunch 内同步调用根因解决

- Sprint: Sprint-1 末（2026-04-23 ~ 2026-05-06 · **收官期 · 剩 3 天**）或 Sprint-2 头部（按实装时间点）
- Epic: Epic-C 本地存储 + 云同步（补 · COSTRA-124 接力）
- Owner: miniapp-dev
- Type: fix
- Priority: P1
- Points: **2**
- 依赖: COSTRA-124（已**部分闭合** · 顶层副作用分支 · commit `a296be0` + `221b074`）
- 创建: 2026-05-03 20:32（by Orchestrator · R2 诊断翻转后接力卡）
- Driver:
  - COSTRA-124 R2 诊断：`.team/members/miniapp-dev/history/2026-05-03-costra-124-r2-diagnose.md`
  - FU-LAUNCH-FIRST-RENDER-RACE 第 7 次实测证伪 R1 假设（2026-05-03 20:09 Human 实测 Console 证据）
  - D-017 第 5 次实战 · SBAI v1.1 P2' 冒烟第 3 回产物
  - 定性 v3：SDK 2.32.3+ 启动期 · 渲染层 storage group `_prepare` 就绪时刻晚于 App.onLaunch 触发 · 任何 onLaunch 内同步 storage 调用均撞 `too eayly`（SDK + 业务共同责任）

---

## §1 背景（R1 假设证伪 + R2 新根因）

### §1.1 COSTRA-124 R1 实装 · 事实状态

- **R1 做了什么**（commit `a296be0` + `221b074`）：
  - 移除 `storage.ts:29` 模块顶层 `ensureVersion()` 裸调
  - `app.ts onLaunch` 首行 `ensureVersion()`
  - 全仓 0 顶层 `wx.*` 副作用（`docs/devops/startup-api-call-audit.md` 自证）
  - 新建 `docs/devops/libversion-upgrade.md`（方法论 v1.0）
  - R1 Review 33/35（`costra-review-tech`）· card-review 26/30（`costra-card-reviewer-tech`）
- **R1 架构价值**（保留 · 不撤回）：
  - 消除模块顶层副作用（公认反模式）
  - 建立了 audit 基础设施 + 方法论文档 + FU 追写范式
  - 作为 COSTRA-125 的必要前置
- **R1 假设被实测证伪**（Human 2026-05-03 20:09 第 7 次模拟器实测）：
  - Console 错误复现 7+ 次 × 4 种 API（get / set / remove / metadata）
  - Launch Time 1864 ms（基线 865 ms · ×2.16 劣化）
  - 错误归属 **渲染层** · 发生时刻在 `[Costra] onLaunch env= dev` 打印**之后**
  - R1 假设"迁入 onLaunch 即安全"被证伪 —— onLaunch 时**渲染层 storage group `_prepare` 仍未就绪**

### §1.2 新根因（定性 v3 · 详见 R2 诊断 §5.4）

> **微信基础库 2.32.3+ 在 App.onLaunch 触发时 · 渲染层 storage group `_prepare` 状态尚未就绪 · 任何从逻辑层同步发起的 `wx.*StorageSync` 调用都会经 jsbridge 委托到渲染层 storage group 并报 `too eayly` · 这是 SDK 内部实现细节 · 与官方文档"onLaunch 时 wx 可用"承诺脱节 · SDK + 业务共同责任**

R1 漏网的关键触发点（R2 普查证据）：

| # | 文件:行号 | API | 发生时刻（相对 onLaunch） |
|---|---|---|---|
| 1-3 | `app.ts:28` → `storage.ts:31/33/34` | get / clear / set VERSION_KEY | onLaunch 进入瞬间（ensureVersion）|
| **4** | **`app.ts:35` → `auth.ts:70` → `storage.ts:54`** | **get TOKEN_KEY** | **onLaunch 进入 + ~1 µs**（`async initAuth` 体内 await 之前同步执行 · R1 漏网）|

对账闭合：Console 4 种错误完全吻合以上 4 次调用 · 无第 5 个漏网点（R2 §1.3 数学对账）。

### §1.3 Human 拍板（2026-05-03 20:32）

- **D1 方案**：按推荐 = **B' + E' 合并版**（异步 API 全量 + bootstrap Promise 统一）
- **D2 卡边界**：按推荐 = **COSTRA-124 部分闭合（顶层副作用分支）+ 立 COSTRA-125 接力卡**
- **D3 范围**：按推荐 = **sync.ts / auth.ts 其他写入点一并改 async**（不留半拉子技术债）

---

## §2 方案（B' + E' 合并版 · 干净彻底）

### §2.1 B' 核心：`storage.ts` 全量 async 化（基于 `wx.getStorage({key})` 官方 Promise 形态 · 基础库 2.21.0+ 支持）

```typescript
// storage.ts 修复后（示意）
export async function ensureVersion(): Promise<void> {
  if (typeof wx === 'undefined') return;
  try {
    const res = await wx.getStorage({ key: VERSION_KEY });
    if ((res as any).data !== STORAGE_VERSION) {
      await wx.clearStorage();
      await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
    }
  } catch (e: any) {
    // data not found 也走这里 · 首次启动正常路径
    if (e?.errMsg?.includes('data not found')) {
      try {
        await wx.clearStorage();
        await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
      } catch (e2) {
        console.warn('[storage] ensureVersion init failed', e2);
      }
      return;
    }
    console.warn('[storage] ensureVersion failed', e);
  }
}

export async function getItem<T>(key: string): Promise<T | null> {
  if (typeof wx === 'undefined') return null;
  try {
    const res = await wx.getStorage({ key });
    const env = (res as any).data as Envelope<T> | undefined;
    if (!env) return null;
    if (env.ttl && Date.now() - env.t > env.ttl) {
      await removeItem(key);
      return null;
    }
    return env.d;
  } catch (e: any) {
    if (e?.errMsg?.includes('data not found')) return null;
    console.warn('[storage] get failed', key, e);
    return null;
  }
}

export async function setItem<T>(key: string, data: T, ttlMs?: number): Promise<void> {
  if (typeof wx === 'undefined') return;
  const envelope: Envelope<T> = { v: STORAGE_VERSION, t: Date.now(), ttl: ttlMs, d: data };
  try {
    await wx.setStorage({ key, data: envelope });
  } catch (e) {
    console.error('[storage] set failed', key, e);
  }
}

export async function removeItem(key: string): Promise<void> {
  if (typeof wx === 'undefined') return;
  try { await wx.removeStorage({ key }); } catch { /* noop */ }
}
```

### §2.2 E' 核心：`app.globalData.bootstrapPromise` + Page.onLoad gate

```typescript
// app.ts 修复后（示意）
App<{ globalData: AppGlobalData; bootstrapPromise: Promise<void> }>({
  globalData: { /*...*/ },
  bootstrapPromise: Promise.resolve(), // 占位 · onLaunch 覆盖

  onLaunch() {
    this.globalData.bootAt = Date.now();
    console.info('[Costra] onLaunch env=', this.globalData.env.name);

    // 串行 bootstrap：version 校验 → token 恢复 · 两阶段都是 async
    this.bootstrapPromise = (async () => {
      await ensureVersion();
      await initAuth();
      if (!isLoggedIn()) {
        try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
      }
    })().catch((err) => {
      console.error('[Costra] bootstrap failed', err);
      try { wx.reLaunch({ url: '/pages/login/index' }); } catch { /* noop */ }
    });
  },

  onShow() {
    // 等 bootstrap 完成才检查续签 · 避免竞态
    void this.bootstrapPromise.then(() => {
      if (isLoggedIn()) {
        const token = getToken();
        if (token?.shouldRefresh()) {
          void token.refreshFn().catch(/*...*/);
        }
      }
    });
  }
});

// Page.onLoad（需登录态的页面）
onLoad() {
  const app = getApp<IAppOption>();
  app.bootstrapPromise.then(() => {
    if (!hasValidSession()) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    // ...继续初始化页面数据
  });
}
```

### §2.3 D3 范围：sync.ts / auth.ts 其他写入点一并改 async

- `auth.ts`: `initAuth / doWxLogin / refreshToken / clearToken / logout` 内所有 `setItem/getItem/removeItem` 调用点加 `await`
- `sync.ts`: `getCursor / setCursor / enqueueLocalEntry / __peekOutbox` 改 `async` · 调用方加 `await`
- 单测: `auth.spec.ts` / `request.spec.ts` 内 mock 同步 storage 的地方改 async mock

---

## §3 DoD（8 条 · 可度量）

### (a) storage.ts 全量 async 化

- 所有导出 API 改返回 `Promise<T>` / `Promise<void>`：
  - `ensureVersion(): Promise<void>`
  - `getItem<T>(key): Promise<T | null>`
  - `setItem<T>(key, data, ttlMs?): Promise<void>`
  - `removeItem(key): Promise<void>`
- 内部实现全改用 `wx.getStorage({key})` / `wx.setStorage({...})` / `wx.removeStorage({...})` / `wx.clearStorage()` 的官方 Promise 形态（基础库 2.21.0+ 支持 · `project.config.json` libVersion 2.32.3 满足）
- **不保留同步 API 的 `*Sync` 版本**（避免再次踩坑 · 避免同步/异步 API 混用）
- 验证：`npm run typecheck` + `npm run lint` 双 PASS

### (b) auth.ts 全路径 async 对齐

- `initAuth()` 函数体 `getItem(TOKEN_KEY)` 改为 `await getItem(TOKEN_KEY)`（**关键：R1 漏网点**）
- `doWxLogin()` / `refreshToken()` 中的 `setItem(TOKEN_KEY, stored)` 改 `await setItem(...)`
- `clearToken()` 改为 `async function` · `removeItem` 加 `await`（调用方 `logout()` 已 async · 天然兼容）
- 验证：typecheck PASS · `services/auth.spec.ts` 现有断言全绿（必要处更新 mock）

### (c) sync.ts 全路径 async 对齐（D3 不留半拉子）

- `getCursor()` / `setCursor()` / `enqueueLocalEntry()` / `__peekOutbox()` 改 `async`
- `syncPull()` 内部 `getCursor` / `setCursor` 加 `await`
- 验证：typecheck PASS

### (d) app.ts · bootstrap Promise 统一门控

- 在 `App({...})` 参数中声明 `bootstrapPromise: Promise<void>`（初始占位 `Promise.resolve()`）
- `onLaunch()` 内部：
  - 用 IIFE 构造 `this.bootstrapPromise = (async () => { await ensureVersion(); await initAuth(); ... })()`
  - 原 `initAuth().then(...) wx.reLaunch` 逻辑迁入 IIFE 末尾
  - 外层 `.catch` 兜底错误（仍 wx.reLaunch 到 login）
- `onShow()` 内部：`void this.bootstrapPromise.then(() => { /* 续签检查 */ })`
- 验证：typecheck PASS · Human 实测 Console 无 `too eayly`

### (e) 页面层 Page.onLoad gate（按需改 · 范围最小化）

- **本卡只改登录态敏感页**（共 3 个页面）：
  - `pages/login/index.ts`（登录页 · onLoad 若已登录直接跳首页）
  - `pages/home/index.ts`（首页 · onLoad 若未登录跳 login）
  - `pages/mine/index.ts`（我的 · onLoad 若未登录跳 login）
- 其他 Page（entry / family-dashboard / stat-overview / pages-stat/ / pages-family/）：本卡不改 · 保持现有 `hasValidSession()` 同步检查（它们通过 tabBar 跳转 · 天然晚于 bootstrap）· Sprint-2 再扫
- 改法：`onLoad` 首行 `await getApp().bootstrapPromise`（或 `.then()` 非 async onLoad）
- 验证：typecheck PASS · Human 实测首页 → 登录页跳转仍流畅（无白屏超过 200 ms）

### (f) 单测更新

- `services/auth.spec.ts`：mock `storage.getItem / setItem / removeItem` 改为 async mock（返回 Promise）· 所有断言更新为 await
- `services/request.spec.ts`：若有间接用 storage 的地方同步更新
- 新增（推荐）：`services/storage.spec.ts`（若不存在）· 最小覆盖 3 个 API 的 async 语义 + error path（data not found）
- 验证：`npm run test` 全绿（exitCode 0）

### (g) Human 模拟器实测（E1 路径 · 第 8 次启动）

subagent 无模拟器访问 · 由 Human 触发微信开发者工具重启。

**5 条断言**（AND 语义 · Launch Time AMBER 容差继承 COSTRA-124 P2-2 条款）：

| # | 验证项 | 通过标准 |
|---|---|---|
| 1 | `too eayly` Console 错误 | **0 次上报**（所有 get/set/remove/metadata 变种） |
| 2 | `Expected updated data but get first rendering data` | **0 次上报** |
| 3 | Launch Time | **≤ 900 ms**（基线 865 · AMBER 900-935 ms Human 个案裁决）|
| 4 | 登录链路 | 点"一键微信登录" → Console 出 `[auth] wx.login ok {codeLen: 32}` |
| 5 | 首页 → 记一笔 | 可进入 · 无白屏 · 无报错 |

### (h) FU / 文档 / 追写

- `.team/follow-ups/README.md`：
  - FU-LAUNCH-FIRST-RENDER-RACE 分裂为 **A / B / C 三子 FU**（见 §5 本卡追写计划）
  - A（顶层副作用）· B（onLaunch 内同步调用）· C（Expected updated data）
  - 本卡闭合后 · A + B 真 closed · C 按实测结果决定
- `docs/devops/libversion-upgrade.md §3`：
  - 追写 **反模式 #4 · "过度信赖 onLaunch 作为 storage 就绪时刻"**（坏例 = R1 方案 A / 好例 = 异步 API 全量 + bootstrap gate / 原因 = onLaunch ≠ 渲染层 storage group `_prepare` 就绪）
- `docs/devops/startup-api-call-audit.md`：追写 R2 普查结果（onLaunch 栈内同步 storage 调用 4 次 · 对账闭合）

---

## §4 工作区 + 权限

**可写**：
- `miniprogram/services/storage.ts`（重构为 async）
- `miniprogram/services/auth.ts`（改 await）
- `miniprogram/services/sync.ts`（改 async）
- `miniprogram/app.ts`（bootstrapPromise）
- `miniprogram/pages/login/index.ts`（onLoad gate）
- `miniprogram/pages/home/index.ts`（onLoad gate）
- `miniprogram/pages/mine/index.ts`（onLoad gate）
- `miniprogram/services/auth.spec.ts`（更新 mock）
- `miniprogram/services/request.spec.ts`（若波及）
- `miniprogram/services/storage.spec.ts`（新建 · 若不存在）
- `miniprogram/app.d.ts` 或 `typings/` 补 `bootstrapPromise` 类型（若需要）
- `docs/devops/libversion-upgrade.md`（§3 追反模式 #4）
- `docs/devops/startup-api-call-audit.md`（R2 普查追写）
- `.team/follow-ups/README.md`（FU 分裂 · 闭合 A + B）
- `.team/members/miniapp-dev/state.md`（§2/§3/§7 收尾必做）
- `.team/members/miniapp-dev/history/2026-05-03-costra-125-*.md`（新建 · 收尾必做）

**禁写**：
- `server/` / `api/` / `design/` / `infra/`
- `.team/decisions/*.md`（规约不在本卡范围）
- `.team/dispatch/COSTRA-124-*.md`（124 dispatch 属历史文件 · 125 是接力卡 · 不回改 124）
- `miniprogram/pages/entry/` / `miniprogram/pages/family-dashboard/` / `miniprogram/pages/stat-overview/` / `miniprogram/pages-stat/` / `miniprogram/pages-family/`（本卡范围外）
- `project.config.json`（基础库版本不动 · 走 B' 不走 C'）

---

## §5 FU 分裂计划（DoD (h) 落地方案）

原 FU-LAUNCH-FIRST-RENDER-RACE 拆为 3 个子 FU：

| 子 FU | 范围 | 状态 | owner_card |
|---|---|---|---|
| **FU-LAUNCH-A** · 顶层副作用 | `storage.ts` 模块顶层 `ensureVersion()` 裸调 | **close** @ COSTRA-124（commit `a296be0`）| COSTRA-124（已部分闭合）|
| **FU-LAUNCH-B** · onLaunch 内同步 storage 调用 | 渲染层 storage group `_prepare` 就绪时刻晚于 AppService onLaunch · 任何同步调用失败 | **open** · 等 COSTRA-125 修复 + Human 实测 | COSTRA-125（本卡） |
| **FU-LAUNCH-C** · Expected updated data but get first rendering data | 启动期首渲染数据投递错位（可能与 B 同源 · 也可能独立）| **open** · 等 COSTRA-125 实测后判定（若随 B 修复自然消失 → close · 否则保持 open 观察）| COSTRA-125 或 Sprint-2 |

---

## §6 commit 纪律

- scope 白名单：`miniapp` / `docs` / `repo`（`.team/` 归 `repo`）
- 建议分 **2 commit**（D-012 单卡即提交 + 允许按 scope 拆）：
  - commit 1: `fix(miniapp): migrate storage/auth/sync to async api + bootstrap promise (COSTRA-125)` — `miniprogram/` 全部
  - commit 2: `docs(repo): costra-125 fu split + libversion-upgrade anti-pattern #4 (COSTRA-125)` — `.team/` + `docs/`
- Footer 必含: `Refs: COSTRA-125`
- 禁止 `--no-verify` · 禁止 `git push --force`
- hooks 必须 PASS（lint + typecheck + commitlint · husky v10 deprecation warning 非阻塞 · 见 COSTRA-117）

---

## §7 E1 路径 · Human 实测由 Human 完成

subagent 无模拟器访问 · DoD (g) 5 条断言必须由 Human 触发第 8 次模拟器启动。

subagent 在 final message 必含：

- "(a)(b)(c)(d)(e)(f)(h) 已完成"（具体到文件 + 行数 diff 清单）
- "(g) 待 Human 第 8 次模拟器实测 · 清缓存 + 重新编译 + 冷启动 · 对照 §3 (g) 5 条断言贴结果"
- "R2 实装 Round-1 交付完成 · 等 Orchestrator spawn review-tech Round-1"

---

## §8 验收

- **R1 审查 PASS**（`costra-review-tech` Verdict ≥ 28/35 · 0 P0 · 或 PASS-WITH-FOLLOWUP）
- **Human 模拟器实测 5 条全 PASS**（DoD (g)）
- **FU-LAUNCH-B close**（DoD (h)）
- 三条齐全 → COSTRA-125 CLOSED · COSTRA-124 随之完全闭合（顶层副作用 + 渲染层时序 两分支齐绿）· Sprint-1 基建线 **9 卡全数收官**（100 + 101 + 119-125）

---

## §9 附录 · Human 实测检查清单（subagent 在 final message 复述此表）

| # | 验证项 | 通过标准 | 实测结果 |
|---|---|---|---|
| 1 | `too eayly`（任意变种：get/set/remove/metadata）Console 错误 | 0 次上报 | ☐ |
| 2 | `Expected updated data but get first rendering data` | 0 次上报 | ☐ |
| 3 | Launch Time | ≤ 900 ms（基线 865 · AMBER 900-935 Human 裁决）| ☐ ms |
| 4 | 一键微信登录 | `auth.ts:157 [auth] wx.login ok {codeLen: 32}` | ☐ |
| 5 | 首页 → 记一笔 | 可进入 · 无白屏 · 无报错 | ☐ |

---

## §10 时间预算

- (a) storage.ts 重构：20 min
- (b) auth.ts await 对齐：15 min
- (c) sync.ts async 化：10 min
- (d) app.ts bootstrapPromise：15 min
- (e) 3 个 Page onLoad gate：15 min
- (f) 单测更新：20 min
- 顺扫 typecheck + lint 修复：10 min
- (h) FU 分裂 + docs 追写 + state.md + history：25 min
- R1 Review + Response：20-30 min
- Human 实测 + 终审：15 min
- **合计 AI 侧**：~2-2.5 h · **Human 侧**：~15 min

---

## §11 Driver 溯源

- COSTRA-124 R2 诊断 history：`.team/members/miniapp-dev/history/2026-05-03-costra-124-r2-diagnose.md`（500 行 · L1-L4 + 6 方案 + 8 Q）
- Human 2026-05-03 20:32 D1/D2/D3 全按推荐（方案 B'+E' 合并版 · COSTRA-124 部分闭合 · D3 一并改）
- 本卡走 SBAI v1.1 派单 · 装扮 subagent `costra-miniapp-dev` 实装 · D-014 触发 card-review + D-018 SBAI 框架
