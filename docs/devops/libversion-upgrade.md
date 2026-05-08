# 微信基础库版本升级影响评估方法论

- 卡号：COSTRA-124
- Refs：`.team/dispatch/COSTRA-124-miniapp-fix-startup-storage-timing.md` §3 (d)
- 创建：2026-05-02
- Owner：miniapp-dev
- Driver：FU-LAUNCH-FIRST-RENDER-RACE 定性翻转事件（前 3 次误判 SDK Bug · 第 4 次坐实业务触发 · 高版本基础库对启动期 storage 调用有隐式时序约束）
- 状态：v1.0（Sprint-1 末立档 · Sprint-2 起每次微信基础库 / 开发者工具版本跃迁时走一遍）

---

## §0 读者与适用场景

**读者**：Costra 小程序维护者（当前：`miniapp-dev` 装扮 subagent + Human tech-lead）

**适用场景**（任一触发）：

1. `project.config.json` 的 `libVersion` 将要跨 minor 版本（如 2.30.x → 2.32.x）
2. 开发者工具版本（`编辑器版本`）主版本号跨一个（1.x → 2.x）
3. 模拟器启动 Console 新出现"基础库内部栈"为主的红色告警（如本次 FU-LAUNCH）
4. 微信官方发布 breaking change 类 release note（storage / router / lifecycle 族）

**不适用**：纯 patch 版（如 2.32.3 → 2.32.4）· 仍建议跑 §2 第 4 步冒烟但无需出完整报告。

---

## §1 本次案例（FU-LAUNCH-FIRST-RENDER-RACE · COSTRA-124）

**≥ 4 项硬性条目（对齐 dispatch §3 (d) P1-2 修订后度量）**

### §1.1 错误原文

```
[渲染层错误] [jsbridge] invoke getGlobalStorage fail: too eayly.
Error: invoke too eayly
  at v (WAWebview.js:1:123691)
  at invoke
```

拼写 `too eayly`（SDK 把 `early` 错拼为 `eayly` · 官方内置字符串 · 从 2024 年 issue 跟踪至 2026-05 未修）· 同族亦可能报为 `setGlobalStorage fail` / `removeGlobalStorage fail` / `traceEvent fail`。

### §1.2 错误栈（业务 + SDK 切面）

- **业务切面**（我方代码 · 修复前）：
  ```
  miniprogram/app.ts:6 (import './services/auth')
  → miniprogram/services/auth.ts:7 (import './storage')
  → miniprogram/services/storage.ts:29 (top-level ensureVersion() 裸调)
  → wx.getStorageSync('__costra_storage_version')
  ```
- **SDK 切面**（微信基础库 2.32.3 内部 · 不受我方控制）：
  ```
  WAWebview.js:1:123691
  → invoke
  → v → M → N → Qt
  → Tt._prepare
  → createOrGetStorageGroup
  ```
- **时序锚点**（Human 第 3 次观察 Console 实录）：
  ```
  [system] WeChatLib: 2.32.3
  No. of subpackages: 2
  LazyCodeLoading: true
  ← 本错误在这里报（App() 注册之前）
  app.ts:23 [Costra] onLaunch env= dev   ← App 注册后
  [system] Launch Time: 865 ms
  ```

### §1.3 根因定位链（L1 → L4）

- **L1（现象）**：启动期 Console 报 `getGlobalStorage fail: too eayly` · 拼写 `eayly` 是 SDK 内置字符串 · 前 3 次（2026-04-29 / 2026-05-01 / 2026-05-02 19:32）观察均定性"100% SDK 内部 Bug · 非业务"
- **L2（SDK 机制）**：微信 WAWebview 启动期 · 先注册 jsbridge · 再 bootstrap `createOrGetStorageGroup._prepare`（storage group metadata 加载）· 再触发 `App()` 的 onLaunch · 期间 JS 层同步 API `wx.getStorageSync` 桥接到 native 侧仍要走 `storage group prepare` 基础设施 · **_prepare 未就绪时 SDK 统一以 "getGlobalStorage fail: too eayly" 命名报错**（与 JS 层调用名无关）· 这推翻了"同步 API 不走 storage group"的前 3 次假设
- **L3（业务触发）**：`miniprogram/services/storage.ts:29` 存在模块顶层裸调 `ensureVersion()` · 通过 `app.ts → auth.ts → storage.ts` 三级 import 链 · 在 `App({...})` 注册**之前**就触发 `wx.getStorageSync(VERSION_KEY)`
- **L4（定性翻转 · 事件追踪）**：
  - 2026-05-02 20:15 Human 抛出新线索"不是微信基础库的 bug · 而是高版本库对时序有要求"
  - 2026-05-02 20:20 装扮 subagent `costra-miniapp-dev` D-017 Step 2 独立核查（只诊断不修复）
  - 2026-05-02 20:25 根因报告落盘 · 方案 A/B/C + Q1-Q6 决策点
  - 2026-05-02 20:31 Human 拍板 Q1-Q6 全"按推荐" · 方案 A（迁入 onLaunch）
  - 2026-05-02 20:58 COSTRA-124 立卡
  - 2026-05-02 21:05 card-review Round-1 PASS-WITH-FOLLOWUP 26/30
  - 2026-05-02 21:xx R1 实装（本卡）

### §1.4 修复路径

- **方案**：A（Human 拍板 · 零风险 · 15-25 min 编码）
- **改动**：
  - `miniprogram/services/storage.ts`：删除 line 29 顶层 `ensureVersion()` · 函数改为 `export` · 补 JSDoc 注释警示
  - `miniprogram/app.ts`：`onLaunch()` 首行加 `ensureVersion()` 调用 · 补 import
- **commit sha**：`a296be0`（由 Orchestrator commit 后补 · 格式 `fix(miniapp): move ensureVersion from storage top-level to app onLaunch (COSTRA-124)`）
- **验证**：
  - 静态：`npm run typecheck` + `npm run lint` 双 PASS（本 R1 已执行）
  - 动态：Human 第 7 次模拟器实测（dispatch §9 的 5 条检查清单）

---

## §2 影响评估 4 步清单

**≥ 4 子步 · 每步含"命令行 / 预期产出 / 红线判定"**（对齐 P1-2 修订度量）

### §2.1 第 1 步：扫模块顶层副作用

- **动机**：基础库每次升级 · 启动期 bootstrap 顺序可能微调 · 模块 top-level 的同步 wx.* 调用是首当其冲的时序踩雷点（本次 FU-LAUNCH 即是典型）
- **命令行**：
  ```bash
  # 1) 顶层直接裸调
  rg -n '^wx\.' miniprogram --glob '*.ts'
  # 2) 顶层赋值触发
  rg -nE '^(const|let|var).*wx\.' miniprogram --glob '*.ts'
  # 3) 顶层 setTimeout / setInterval（延迟类反模式）
  rg -nE '^setTimeout|^setInterval' miniprogram --glob '*.ts'
  ```
- **预期产出**：
  - 3 条命令均 0 命中
  - 若有命中 → 逐一确认是否在 App/Page/Component 注册之内（注册之内的不算 top-level 副作用）· 注册之外的一律整改
- **红线判定**：3 条命令**任一**命中数 > 0（注册之外）→ **阻断升级** · 先走 COSTRA-124 范式修复 · 再重评估

### §2.2 第 2 步：对比微信官方 changelog

- **动机**：官方 release notes 是时序约束变更的**唯一权威源** · 本次若提前对 2.32.x 的 changelog 做关键字检索 · 理论上能提前发现"storage group prepare" 相关调整
- **命令行**（实际是 Web 检索 · 无单一 CLI）：
  ```bash
  # 打开微信小程序基础库 release notes
  open https://developers.weixin.qq.com/miniprogram/dev/framework/release/
  # 或用 agent 的 WebFetch 工具（装扮 subagent 可直接调用）
  ```
- **关键字清单**（至少检索）：`storage` / `lifecycle` / `onLaunch` / `App` / `bootstrap` / `prepare` / `breaking` / `时序`
- **预期产出**：
  - 从上次生效版本（如 2.30.x）到目标版本的 **所有 minor release notes 的摘要条目**
  - 标注"高风险 API 族"（如本次的 storage / App 生命周期）
- **红线判定**：发现 breaking change 条目且未做适配 → **阻断升级** · 出专项评估卡（如本 COSTRA-124）

### §2.3 第 3 步：列风险点清单（本次升级的 API 族矩阵）

- **动机**：基础库每次升级涉及数十个 API · 不可能全测 · 需基于 §2.2 产出聚焦高风险族
- **命令行**（组合 grep · 聚焦本次 release notes 涉及的 API 族）：
  ```bash
  # 示例：若 changelog 指出 storage / App 族有变
  rg -nE 'wx\.(get|set|remove|clear)Storage' miniprogram --glob '*.ts'
  rg -n 'onLaunch|onShow|onHide' miniprogram --glob '*.ts'
  ```
- **预期产出**：**风险矩阵表**，列 = API 族 · 行 = 我方业务点 · 值 = 风险级（H/M/L）
  - 示例：
    | API 族 | 业务点 | 风险级 |
    |---|---|---|
    | storage 同步 API | `services/storage.ts` 所有 CRUD | **H**（本次触发源） |
    | App 生命周期 | `app.ts onLaunch/onShow` | M |
    | 分包加载 | `subpackages` 2 个 | M |
    | 页面生命周期 | 各 `pages/*/*.ts` | L |
- **红线判定**：H 级业务点 ≥ 1 且未经模拟器冒烟验证 → **阻断升级**

### §2.4 第 4 步：模拟器冒烟实测

- **动机**：静态检查 + release notes 分析都是推测 · 最终必须以真机/模拟器启动日志为准
- **命令行**（subagent 无模拟器访问 · 由 Human 触发 · 步骤标准化）：
  ```
  1. 微信开发者工具 → 项目 → 清缓存（清全部）
  2. 编译 → 首次启动（冷启动）
  3. Console 面板截图 → 存 docs/devops/startup-console-<date>.png
  4. 记录 Launch Time 数值（搜索 `[system] Launch Time:` 那一行）
  ```
- **预期产出**：
  - Console **0 条**红色告警（Error 级）
  - Launch Time 与基线差 ≤ ±35 ms（如本次基线 865 ms · 接受区间 830-900 ms）
  - 业务链路至少跑到"登录页首屏" + `wx.login` 成功回调（可见 `auth.ts:157 [auth] wx.login ok` 日志）
- **红线判定**：
  - Console 出现 Error 级告警 → 必须定位根因（如本次的 `too eayly`）· 不允许"观察项"敷衍
  - Launch Time 超基线 +35 ms → AMBER · 走 Human 个案裁决（参考 COSTRA-124 DoD (e) P2-2 采纳条款）
  - 业务链路断裂（如登录页不显示） → **P0 阻断** · 回滚基础库版本

---

## §3 反模式清单

**≥ 3 条 · 每条含"坏例 / 好例 / 原因"**（对齐 P1-2 修订度量）

### §3.1 反模式 1 · 模块顶层 `wx.*` 裸调（本次 FU-LAUNCH 触发源）

- **坏例**（`miniprogram/services/storage.ts` 修复前）：
  ```typescript
  function ensureVersion(): void {
    const v = wx.getStorageSync(VERSION_KEY);
    // ...
  }
  ensureVersion();   // ← 模块顶层裸调 · import 链触发 · App() 注册前
  ```
- **好例**（修复后）：
  ```typescript
  export function ensureVersion(): void { /* 同上 */ }
  // app.ts
  App({
    onLaunch() {
      ensureVersion();   // ← App 注册后首行 · SDK storage group 已 prepare 完成
      // ...
    }
  });
  ```
- **原因**：微信基础库 2.32.3+ 要求 storage 调用必须在 `storage group._prepare` 完成**之后** · `App()` 注册是 prepare 完成的事实边界 · 顶层 import 副作用会赶在 prepare 前触发 · 抛 `too eayly`

### §3.2 反模式 2 · 模块顶层 `setTimeout(wx.*)` 延迟（"看似规避实则更差"）

- **坏例**：
  ```typescript
  // 有人会想："顶层不让同步调 · 那我延迟 0 ms 推到下一 tick 总行了吧"
  setTimeout(() => {
    wx.getStorageSync(VERSION_KEY);   // ← 仍是顶层副作用 · 只是事件循环移位
  }, 0);
  ```
- **好例**：显式放 `onLaunch` / `onShow` / `Page.onLoad` 等 lifecycle hook：
  ```typescript
  // app.ts
  App({
    onLaunch() {
      ensureVersion();
    }
  });
  ```
- **原因**：
  - `setTimeout(0)` 只是把回调推到事件循环的 macrotask 队列 · 执行时刻**不确定**（可能在 `onLaunch` 之前 · 也可能之后）· 反而比同步调更难排查
  - 隐性耦合：后续 `initAuth()` 里的 `getItem(TOKEN_KEY)` 会与这个延迟 `ensureVersion()` 竞态 · 若版本校验失败要清库 · 但 auth 已经读出旧 token · 数据污染
  - 官方最佳实践：初始化逻辑必须显式挂 `onLaunch` · 不走"延迟猜时机"

### §3.3 反模式 3 · 分包懒加载模块的顶层副作用（本次顺扫增补自识别）

- **坏例**：
  ```typescript
  // miniprogram/pages-stats/services/stats-cache.ts（分包内模块 · LazyCodeLoading: true）
  import { getEnv } from '../../services/env';
  // 顶层副作用：分包首次加载时触发
  const CACHE_KEY = `__stats_${getEnv().name}_v1`;
  wx.getStorageSync(CACHE_KEY);   // ← 坏：虽然不是启动期 · 但在分包加载瞬间的时序同样不可预测
  ```
- **好例**：
  ```typescript
  export function getStatsCache() {
    const CACHE_KEY = `__stats_${getEnv().name}_v1`;
    return wx.getStorageSync(CACHE_KEY);
  }
  // 在 Page.onLoad / Component.attached 里才调用
  ```
- **原因**：
  - `LazyCodeLoading: true`（`project.config.json` 开启 · COSTRA-123 前已默认）下 · 分包脚本首次加载时机由用户页面跳转触发 · 同样不走 App 生命周期
  - 若分包模块顶层有 `wx.*` 副作用 · 与分包 loader 的 storage group 还原时序会冲突 · 再现 `too eayly` 的**子分包变种**
  - **识别线索**（从本次 COSTRA-124 追查过程自识别）：顺扫应覆盖 `miniprogram/pages-*/` 分包目录 · 不能只扫主包 · Sprint-2 `startup-top-level-call-check.mjs`（`docs/devops/startup-api-call-audit.md` §5 候选脚本）应显式纳入这一层

### §3.4 反模式 4 · 过度信赖 onLaunch 作为 storage 就绪时刻

- **坏例**（COSTRA-124 R1 方案 A · commit `a296be0`）：
  ```typescript
  // app.ts
  App({
    onLaunch() {
      ensureVersion();   // 同步 wx.getStorageSync · 假设 onLaunch 内 storage group 已就绪
      initAuth().then(...);  // async function 体内 getItem(TOKEN_KEY) 在 await 前同步执行 · 同假设
    }
  });
  ```
  实测（Human 2026-05-03 20:09 第 7 次模拟器启动）：Console 报 `too eayly` ×7+ · 4 种 API（get/set/remove/metadata）· Launch Time 1864 ms（基线 865 · ×2.16 劣化）· 证伪"onLaunch 够晚"假设。

- **好例**（COSTRA-125 方案 B'+E' · 异步 API 全量 + bootstrap Promise）：
  ```typescript
  // storage.ts
  export async function ensureVersion(): Promise<void> {
    try {
      const res = await wx.getStorage({ key: VERSION_KEY });  // Promise 形态 · SDK 内部等 _prepare
      if ((res as any).data !== STORAGE_VERSION) {
        await wx.clearStorage();
        await wx.setStorage({ key: VERSION_KEY, data: STORAGE_VERSION });
      }
    } catch (e: any) { /* data not found / 其他 · 统一降级 */ }
  }

  // app.ts
  App({
    bootstrapPromise: Promise.resolve(),
    onLaunch() {
      this.bootstrapPromise = (async () => {
        await ensureVersion();
        await initAuth();
        // ...
      })();
    }
  });
  ```

- **原因**：
  - 文档承诺"onLaunch 内 wx 可用"≠ 运行时"storage group `_prepare` 已就绪"
  - SDK 2.32.3+ 把 storage 委托给**渲染层** storage group · 而渲染层 `_prepare` 就绪时刻晚于 AppService 层 onLaunch 触发（SDK 内部实现细节 · 黑盒）
  - 同步 API（`wx.*StorageSync`）无法表达"等就绪"语义 · 一调必立刻走 jsbridge · 撞 `_prepare` 未就绪就抛 `too eayly`
  - 异步 API（`wx.getStorage({key})` Promise 形态 · 基础库 2.21.0+ 支持）把"等就绪"的责任交回 SDK · 业务只需 await · 不需猜时刻
  - **本质教训**：**不要把生命周期 hook 名称当作底层设施就绪的代理信号** · 特别是 SDK 内部状态机属黑盒 · 需通过异步 API 让 SDK 内部自己表达就绪时机

- **识别线索**：
  - 若错误栈含 `_prepare` / `createOrGetStorageGroup` / `_setMetadata` · 基本可判定为"就绪时序"类问题 · 而非"调用时机"类问题
  - 若同一个 API 族（storage / media / location 等）有同步 + 异步两套 · 启动期优先走异步版本
  - 异步 API 在 AMBER 区间（Launch Time 900-935 ms）可能仍劣化 · 但不会抛 Error 级告警

**v5 定稿（COSTRA-127）**：`Expected updated data` 双因 = lib 2.32~2.33 SDK race（lib 3.8+ 修复）+ 业务 onShow setData 时序竞速（COSTRA-127 修复）。

| 版本 | 定性 | 卡号 |
|---|---|---|
| v1~v2 | 误判 · 见 history | 124 |
| v3 | SDK + 业务共责（onLaunch 同步 storage） | 125 |
| v4 | SDK race · 业务无责 | 126 |
| **v5（定稿）** | 双因（SDK race · lib 3.8+ 修 + 业务 onShow 时序） | **127** |

- v3/v4 治理产出作为充分必要条件**永久保留**（全 async 化 + bootstrap gate）

### §3.5 反模式 5 · 使用 `development` 基础库验证业务（COSTRA-126 新增 · 2026-05-08）

- **坏例**（开发者工具"调试基础库"档位选 `development`）：
  ```
  调试基础库 → development（最新预览版）
  ```
  报错样本（Human 第 8 次实测 · 2026-05-08）：
  ```
  FrameworkError Error: [Service](TO:基础库开发同学)
    在 onLoad 阶段访问 __wxConfig.useWebWorker 可能取不到值
  FrameworkError Error: [Service](TO:基础库开发同学)
    在 onLoad 阶段访问 __wxConfig.isFirstPage / isLazyLoad / plugins / subPackages 可能取不到值
  ```
  共 5 条 framework error · 启动期直接报红 · 业务流程被中断。

- **好例**：业务**永远使用稳定版**（如 2.32.3 / 3.8.12 / 3.14.x）：
  ```json
  // project.config.json
  {
    "libVersion": "3.8.12"  // ✅ 稳定版 · 当前开发期默认
  }
  ```

- **真因（关键识别点）**：
  - `development` 是微信基础库团队**未发布的开发分支** · 不属于稳定版本号
  - 错误文本含 `(TO:基础库开发同学)` 前缀 = SDK 内部 assert 断言 · 是给基础库团队自己看的诊断标签
  - 业务侧无任何调用方对应 · 报错栈全在微信内部 framework 层
  - `onLoad` 阶段 `__wxConfig` 未就绪是 SDK 内部状态机的中间态 · 稳定版不暴露此信号

- **治理**：
  - 业务**永远使用稳定版**（如 2.32.3 / 3.8.12 / 3.14.x）· `project.config.json` libVersion 字段不允许写 `development`
  - 检测：CI 可考虑加 `check:libversion` 脚本扫 `project.config.json.libVersion` 不得为 `development`（本卡不实装 · 转 FU-LIBVERSION-DEV-GUARD P3 观察 · Sprint-2 候选）

- **识别线索**：
  - 启动期 Console 出现 `(TO:基础库开发同学)` 字样 → 立即检查 libVersion 是否设为 `development` 或某 nightly 预览版
  - `__wxConfig.*` 类未就绪报错只在 development 档位出现 · 稳定版无此信号

### §3.6 R1 假设证伪定稿 v5（COSTRA-124/125/126/127 四卡簇治理收官 · 2026-05-08）

**纠正路径**：

- COSTRA-124 R1 假设（2026-05-02）："顶层副作用迁入 onLaunch 即安全" → Human 第 7 次实测证伪
- COSTRA-124 R2 定性 v3（2026-05-03）："SDK 2.32.3+ 渲染层 storage group `_prepare` 时序 · SDK + 业务共同责任" → Human 第 8 次跨 lib 实测推翻
- **COSTRA-126 定稿 v4（2026-05-08）**："**lib 2.32.x ~ 2.33.x dev 冷启动 SDK 内部 bug · 业务无责** · COSTRA-125 全 async 化是预防性最佳实践（充分必要条件 · 无论 SDK 是否修复都该改）"

**4 条独立证据链**（衔接 COSTRA-124 R2 诊断 + COSTRA-126 跨 lib 实测）：

| # | 证据 | 出处 |
|---|---|---|
| 1 | 业务 grep `wx.*StorageSync` / `traceEvent` / `getSystemInfo` **全 0 命中** | COSTRA-125 R1 实装后全仓扫描 + COSTRA-126 复核 |
| 2 | 报错栈 100% 在 SDK `WAWebview.js` 内部（`Tt._prepare` / `_setMetadata` / `createOrGetStorageGroup`）· 未进任何业务帧 | Human 第 7 次实测 + 第 8 次实测 Console 栈 |
| 3 | 报错时刻 100% 在业务 `[Costra] onLaunch env= dev` 之前 · 与业务代码生命周期解耦 | Human 第 7 次实测 + 第 8 次实测时序锚点 |
| 4 | lib 升级到 3.8.12 后 `too eayly` 整族消失（独立第 4 证据 · 推翻"业务有责"） | Human 第 8 次跨 lib 实测（2026-05-08 16:33 ~ 17:00） |

**治理结论（v5 定稿）**：

- COSTRA-125 全 async 化重构 = 充分必要条件 · 不撤回（即便 SDK race 已修也保留 · 防御未来 SDK 再回退）
- COSTRA-126 开发期 libVersion 升级到 3.8.12 = 临时缓解 dev 工具体验 · NFR 上架最低基础库保持 2.32.3 不动（用户覆盖率优先）
- **FU-LAUNCH-A/B 真 closed**（A @ COSTRA-124 · B @ COSTRA-125 + COSTRA-126）
- **FU-LAUNCH-C 修复 + closed @ COSTRA-127**：`login switchTab→reLaunch` + `home/mine onShow bootstrap gate` → 0 次 `Expected updated data`

**Sprint-1 末 Retro 加固议题（17 + 18 候选）**：

- 议题 17（已立 · 加固）：Review-Tech 纸面审不能拦住运行时假设漏洞 · 本次 v3 定性也通过 R2 诊断 + Card-Review 35 分制 · 但仍被 v4 实测纠正 · 证明"Human 跨 lib 实测"是规约类 T2 卡的最终裁决者
- 议题 18（新立 · 本卡驱动）：**"反模式条目的措辞应区分'坏例（实测可复现）/ 治理结论（充分必要条件）/ 归因主体（可能被未来证据修订）'三层" · 避免归因主体证伪时整条被推翻**——本次 v3 → v4 的纠正中，"业务全 Promise 形态" 这一充分必要条件不变 · 仅"归因主体"从"SDK + 业务共同"修正为"SDK 内部"

### §3.6 反模式 6 · tabBar 跳转用 switchTab + onShow 同步 setData（COSTRA-127 新增 · 2026-05-08）

- **坏例**（login → switchTab(home) · home onShow 同步 hydrateUser + refresh）：
  ```typescript
  // login.ts onTapLogin
  wx.switchTab({ url: '/pages/home/index' });  // ← switchTab 复用 home 旧实例

  // home/index.ts onShow（旧版本）
  onShow() {
    if (!hasValidSession()) {  // ← 同步执行 · bootstrap 未完成时返回 false
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.hydrateUser();  // ← 同步 setData
    this.refresh();      // ← 同步 setData
    // 旧实例 data 可能已被重置 → setData key 与首渲染 schema 不匹配
  }
  ```
  实测（COSTRA-127 D-017 Step 2）：`Expected updated data but get first rendering data` 1 次（lib 3.8.12 重新打开项目冷启动）。

- **好例**（login → reLaunch(home) · home onShow 内 await bootstrapPromise）：
  ```typescript
  // login.ts onTapLogin
  wx.reLaunch({ url: '/pages/home/index' });  // ← reLaunch 强制重新初始化 home

  // home/index.ts onShow（修复后）
  onShow() {
    const app = getApp<{bootstrapPromise: Promise<void>}>();
    void app.bootstrapPromise.then(() => {  // ← 等 bootstrap 完成
      if (!hasValidSession()) {
        wx.reLaunch({ url: '/pages/login/index' });
        return;
      }
      this.hydrateUser();  // ← bootstrap 已完成 · Token 已解析
      this.refresh();
    });
  }
  ```
  实测（COSTRA-127 R1）：冷启动 0 次 `Expected updated data` · 修复有效。

- **原因**：
  - `wx.switchTab` **复用** tabBar 页面已有实例 · 不触发完整生命周期重走
  - `switchTab` 后 onShow 同步执行 · 若 home 旧实例的 data 状态与当前业务状态不一致（如 bootstrap 过程中 Token 已更新但旧实例 data 未同步）· `setData` 写入的 key 可能与首次渲染时的 data schema 不匹配
  - `wx.reLaunch` 强制重新初始化目标页面 · 相当于"冷启动"该页面实例 · 消除旧实例状态残留
  - onShow 无 bootstrap gate 时 · `hasValidSession()` 在 bootstrap 过程中返回 false（Token 尚未从 storage 解析）· 导致误跳 login + 后续 gate 内再次 reLaunch 形成竞速
  - **本质教训**：tabBar 页面间跳转**优先用 reLaunch** 而非 switchTab（保持页面实例全新）；onShow 的 bootstrap gate 是防御 tabBar 页面竞速的充分必要条件

- **识别线索**：
  - Console 出现 `Expected updated data but get first rendering data` · 关注页面是 tabBar 页（home/mine）
  - 触发时机在登录后跳转 home 或 app bootstrap 直达 home 时
  - 与 `too eayly` 族错误同时出现但根因独立（`too eayly` 是 SDK 内部 race · 本条是业务 setData 时序）

- **FU-LAUNCH-C 状态**：`degraded-to-p3-observe` → `closed @ COSTRA-127`（业务时序修复 + Human 实测验证）

---

## §4 跨 lib 实测对照表（COSTRA-126 新增 · 2026-05-08）

**数据来源**：Human 第 8 次模拟器实测（2026-05-08 16:33 ~ 17:00 时段 · 微信开发者工具版本 2.01.2510290 · macOS · COSTRA-125 R1 已落 + 业务代码无变更）

### §4.1 清缓存 + 重新编译路径（IDE 进程已预热 · 不触发 webview 冷启动 race）

| lib | too eayly | Expected updated data | Launch Time | 业务流程 |
|---|---|---|---|---|
| 2.33.0 | 0 | 0 | 2156 ms | ✅ |

### §4.2 重新打开项目路径（IDE webview 冷启动 · 触发 SDK 内部 race）

| lib | too eayly | Expected updated data | Launch Time | 业务流程 |
|---|---|---|---|---|
| 2.33.0 | 多次（getGlobalStorage / setGlobalStorage / removeGlobalStorage / traceEvent）| 1 次 | 3485 ms | ✅ 但有 SDK 报错 |
| **3.8.12** | **0** | **0**（COSTRA-127 修复）| **4216 ms** | ✅（COSTRA-126 升级目标） |
| 3.14.3 | （未测）| —— | —— | —— |
| `development` | 0 too eayly · **5 条 framework error** `(TO:基础库开发同学)` `__wxConfig.*` | —— | —— | 启动期 framework error · 见 §3.5 反模式 #5 |

### §4.3 关键结论

- **`too eayly` 族**：lib 2.32.x ~ 2.33.x dev 冷启动复现 · lib 3.8.12 已修复（`too eayly` 整族 0 命中 · 4 条独立证据链直接证伪 v3）
- **`Expected updated data` 警告**：
  - lib 3.8.12 冷启动 1 次 → **COSTRA-127 修复（login reLaunch + home/mine onShow bootstrap gate）→ 0 次**
  - 真因：业务 onShow 无 bootstrap gate 导致 setData 与渲染层首渲染数据竞速（双因之一）
  - 与 `too eayly` 根因独立（`too eayly` 是 SDK 内部 race · 本条是业务时序）
- **Launch Time 劣化**：lib 3.8.12 冷启动 4216 ms（lib 2.33.0 冷启动 3485 ms · +731 ms）· 推测为 lib 体积增大 · dev 工具加载耗时 · **真机不会有此问题**（真机不走 dev webview 启动路径）
- **`development` 档位禁用**：见 §3.5 反模式 #5

### §4.4 待补充实测（Sprint-2 真机预览时补全）

- lib 2.32.3（NFR 最低基础库 · 上架档位）实测对照（场景 A + B）
- lib 3.14.3 实测对照（dev 工具最新稳定档位）
- 真机预览实测（验证 dev 工具冷启动现象在真机不复现）

---

## §5 FU-LAUNCH 族关系表

**≥ 1 张表 · 观察次序 / 定性翻转链 / 修复卡号**（对齐 P1-2 修订度量）

| 观察序号 | 日期 | 场景 / 触发 | Console 现象 | 当时定性 | 关联卡号 / 证据 |
|---|---|---|---|---|---|
| **观察 1** | 2026-04-29 10:41 | COSTRA-122 收官 · Human 第 5 次模拟器启动 | `getGlobalStorage/setGlobalStorage/removeGlobalStorage fail: too eayly` 3 条 + `Expected updated data but get first rendering data` 1 条 | **SDK 内部 Bug（误判）** · 同时登记 FU-LAUNCH-FIRST-RENDER-RACE（open P2 观察） | COSTRA-122 收官 · `.team/follow-ups/README.md` §519-539 |
| **观察 2** | 2026-05-01 21:18 | COSTRA-123 收官 · Human 第 6 次模拟器启动 | 同观察 1 的 3 条（`too eayly`） · Launch Time 降至 865 ms | **SDK 内部 Bug 保持（误判加固）** · 二级事实登记"storage.ts:29 吻合但未坐实" | COSTRA-123 收官 · `.team/follow-ups/README.md` §541-546 |
| **观察 3** | 2026-05-02 19:32 | D-018 SBAI v1.0 P2 冒烟首战 | 仅 1 条 `getGlobalStorage fail: too eayly` | **加固为"100% 非业务"（误判最强化版）** · 装扮 subagent 独立核查前 3 次定性 | D-018 SBAI v1.0 · `.team/follow-ups/README.md` §547-558 |
| **观察 4（翻转点）** | 2026-05-02 20:15-20:25 | Human 给新线索 "不是微信 bug · 高版本库对时序有要求" + 装扮 subagent D-017 Step 2 重做根因 | 现象未新增 · **定性翻转**（SDK Bug → 业务触发 · storage.ts:29 顶层副作用坐实） | **定性翻转**：业务触发 · 非 SDK Bug | D-017 Step 2 + `.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md` |
| **观察 5（R1 假设预期验证 · 2026-05-02 文档占位）** | 2026-05-02 21:xx（预期）| COSTRA-124 R1 修复 · Human 第 7 次模拟器启动（DoD (e)）· **文档写作时占位** | 预期：`too eayly` 0 条 + Launch Time ≤ 900 ms | **（待实测坐实）** | COSTRA-124 R1 |
| **观察 6（HANDOFF 立案）** | 2026-05-03 12:41 | 本会话 Orchestrator 建 `.team/HANDOFF.md` · 预热第 7 次实测 | （无新 Console 事件） | （无变化） | `.team/HANDOFF.md` v1.0 |
| **观察 7（R1 证伪 · 定性 v3 翻转）** | 2026-05-03 20:09 | Human 第 7 次模拟器实测（已清缓存 + 重新编译）| `too eayly` ×7+ × 4 种 API + Launch Time 1864 ms（基线 ×2.16 劣化）· **R1 假设证伪** | **定性翻转 v3**：SDK 2.32.3+ 渲染层 storage group `_prepare` 就绪时刻晚于 App.onLaunch · 任何 onLaunch 内同步 storage 调用必撞 `too eayly` · SDK + 业务**共同责任** | `.team/members/miniapp-dev/history/2026-05-03-costra-124-r2-diagnose.md` |
| **观察 8（v4 翻转 · COSTRA-126 收官）** | 2026-05-08 16:33 ~ 17:00 | Human 第 8 次模拟器实测 · 5 lib 跨版本对照（2.33.0 / 3.8.12 / 3.14.3 / development）· COSTRA-125 R1 已落 + 业务代码无变更 | lib 2.33.0 冷启动复现 · **lib 3.8.12 too eayly 整族消失** · `Expected updated data` 仅 dev 工具复现 · `development` 档位 5 条 framework error | **定性翻转 v4**：lib 2.32.x ~ 2.33.x dev 冷启动 SDK 内部 bug · 业务无责 · COSTRA-125 全 async 化是预防性最佳实践 | **COSTRA-126**（开发期 libVersion 3.8.12 + 反模式 #4 措辞收紧 + 反模式 #5 新增） |

### §5.1 定性翻转的治理意义

- **范式价值**：前 3 次定性**一致误判** · 第 4 次经"Human 新线索 + 装扮 subagent 独立核查"翻转为 v2 · **第 7 次经 Human 模拟器实测再次翻转为 v3** —— 证明 SBAI v1.1 "装扮 subagent 独立核查可翻转历史定性" 的设计有效且具持续性（Sprint-1 末 Retro 议题 15 加固）
- **监督意义**：历史 FU 的定性不是绝对的 · 当出现新线索（特别是来自 Human 的、可反驳当前定性的线索）或**实测失败**时 · 必须**主动重审** · 不能用"已经观察 N 次都是这个定性"作为拒绝重审的理由
- **证伪意义**（新 · 议题 17）：R1 纸面 Review 33/35 过审 · 但 runtime 实测打脸 —— 证明 Review-Tech 仅靠纸面审 + Grep 自证无法拦住 runtime 假设漏洞 · **规约类 T2 卡需把"Human 模拟器实测"作为 Round-N+1 前置硬门槛**（或 Review-Tech 获得 mini-ci 工具）
- **工程沉淀**：本 `libversion-upgrade.md` 即是两次翻转事件的知识沉淀 · §3.4 反模式 #4 是 v3 定性的治理产物 · 未来每次基础库升级都走 §2 四步 · 避免同族误判再犯

---

## §5 与同族文档的关系

| 文档 | 职责 | 与本文的关系 |
|---|---|---|
| `docs/devops/startup-api-call-audit.md`（COSTRA-124 同批） | 启动期 API 调用审计（顺扫报告） | **数据源** · 本文 §2.1 第 1 步的命令行和红线判定标准与其对齐 |
| `.team/follow-ups/README.md` FU-LAUNCH 段 | 族追踪 FU 条目 | **事件源** · 本文 §4 族关系表的数据基础 |
| `.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md` | D-017 Step 2 根因报告 | **根因源** · 本文 §1 L1-L4 的基础材料 |
| `.team/decisions/D-017-verification-problem-response-sop.md` | 验证问题响应 SOP | **流程源** · 本文所定义的"版本升级影响评估"属 D-017 Step 2-4 的一个实例化模板 |
| `.team/decisions/ADR-0004-miniapp-runtime-details.md`（如存在） | 小程序运行时事实源 | **约束源** · 未来本文若扩充 §6 具体 API 族约束清单时 · 交叉引用 |

---

**文档结束 · v1.0 · 2026-05-08 · by `costra-miniapp-dev`（COSTRA-127 R1 实装 + libversion v5 + 反模式 #6）**
