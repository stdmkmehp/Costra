# miniapp-dev · 2026-05-02 · FU-LAUNCH-FIRST-RENDER-RACE · getGlobalStorage v2 重定性诊断

- subagent_spawn_ts: 2026-05-02T20:20:00+08:00
- subagent_finish_ts: 2026-05-02T20:30:00+08:00
- orchestrator_context: D-017 Step 2 · 第 3 次观察重跑 · SBAI v1.1 P2' 冒烟首战
- task_type: review-response

## §1 任务描述

Human 2026-05-02 20:15 给出新线索："不是微信基础库的 bug · 而是高版本库对时序有要求"——颠覆前 3 次（2026-04-29 / 2026-05-01 / 2026-05-02 19:32）"100% SDK 内部 Bug · 非业务"的定性。

Orchestrator 派单：装扮 costra-miniapp-dev 按 D-017 Step 2 **只诊断不修复** · 重做四层根因（L1-L4）+ 方案 A/B/C + Human 决策点（≥3 个）+ L2 必须有 WebFetch 官方文档证据。本次是 SBAI v1.1 P2' 冒烟（20:20 tools 逗号分隔格式重 spawn 后）。

## §2 产出

- 新增文件：
  - `.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`（本文件）
- 修改文件：
  - `.team/members/miniapp-dev/state.md`（§3 交付历史索引 + §6 遗留问题定性升级 + §7 时间戳）
- commit：**不 commit**（D-017 Step 2 只诊断不修复 · Orchestrator 收 final message 后裁决是否派 Sprint-2 修复卡）
- 对话产出：完整 L1-L4 根因报告 + 方案 A/B/C 对比 + 6 个 Human 决策点 Q1-Q6 + SBAI v1.1 P2' 冒烟反馈（final message）

## §3 关键决策

### §3.1 定性翻转

**旧定性**（2026-04-29 登记 · 经 3 次观察加固）："100% 非业务 · 微信 SDK 内部启动时序 Bug 确认 · 我方代码在任何路径上都未触达异步 Global Storage API 栈"

**新定性**（本次坐实）："**业务代码触发 · 非 SDK Bug**——`miniprogram/services/storage.ts:29` 模块顶层 `ensureVersion()` 副作用在 `App()` 注册之前同步调 `wx.getStorageSync(VERSION_KEY)`（可能级联 `clearStorageSync/setStorageSync`）· 触发了基础库 2.32.3 对启动期 storage 调用的隐式时序约束"

### §3.2 旧定性的逻辑漏洞（自我复盘 · SBAI v1.1 P2' 价值体现）

前 3 次的核心论证是：**"我方只用同步 API（getStorageSync/setStorageSync）· 错误是异步 API（getGlobalStorage）· 因果链物理阻断"**。

**漏洞**：SDK 内部实现中，**同步 API 的 native 层桥接可能走的是异步 Global Storage group 基础设施**——即 `wx.getStorageSync` 在 native/jsbridge 层调的就是 `getGlobalStorage` · 只是 JS 层包装成同步语义。这在**启动期 storage group metadata 尚未就绪**时会以"异步 API 的错误名"报出来 · 让 JS 层看上去错位。

第 3 次观察的堆栈 `WAWebview.js → invoke → v → M → N → Qt → Tt._prepare → createOrGetStorageGroup` · `_prepare` 和 `createOrGetStorageGroup` 是 SDK 内部"获取 storage group"的基础设施 · **任何 storage 调用（含同步）都要走这里** · 我方 `getStorageSync(VERSION_KEY)` 在这一阶段被调 · 触发了 `prepare` 未完成错误。

### §3.3 推荐方案

**方案 A · 移除模块顶层副作用 · 迁入 `onLaunch`**（推荐）
- 把 `storage.ts:29` 的裸 `ensureVersion()` 调用删除 · 改为 export · 在 `app.ts:onLaunch` 第一行调
- 理由：符合微信官方最佳实践（onLaunch 是初始化逻辑最佳时机）· 零破坏性 · 消除启动期时序风险

**方案 B · 保留顶层副作用 · 加 setTimeout(0) 推迟**
- `setTimeout(() => ensureVersion(), 0)` 推到事件循环下一 tick
- 风险：推迟到 `onLaunch` 之后的时间不确定 · 可能与 `initAuth().getItem(TOKEN_KEY)` 竞态

**方案 C · 降级基础库 + 观察 · 不动代码**
- 把 `libVersion: 2.32.3` 降回到 `2.30.0`（Sprint-0 前稳定版）· 保持 storage.ts 不动
- 弊端：长期技术债 · 阻碍后续 Skyline / 新特性使用 · 不符合 Human 线索"高版本对时序有要求"的处理方向

### §3.4 Q1~Q6 决策点（待 Human 拍板）

- Q1：定性升级是否认可？（本次 vs 前 3 次观察的结论冲突 · Human 以"新线索"为准还是以"三次实证"为准）
- Q2：是否立新卡（修复 storage.ts 模块顶层副作用）· 还是等 Sprint-1 末 Retro 合并议题？
- Q3：推荐方案 A · 是否采纳？或倾向 B/C？
- Q4：是否同步清查 `miniprogram/` 下所有模块顶层 `wx.*` 同步调用（grep 扫 · 不止 storage.ts 一处）？
- Q5：FU-LAUNCH-FIRST-RENDER-RACE 的另一半现象（`[渲染层错误] Expected updated data but get first rendering data`）是否并入本次修复？（两者同属启动期 · 但根因不同）
- Q6：是否补做一份"基础库版本升级影响评估"文档（docs/devops/libversion-upgrade.md）· 沉淀本次经验？

## §4 遗留

- **FU-LAUNCH-FIRST-RENDER-RACE** · 状态保持 `open` · 定性升级为"业务触发" · 等 Q1-Q6 Human 裁决
- 未完成的分支：无（本次只诊断不改代码）
- 另一待查项：`miniprogram/services/env.ts` 虽有 `ENV_MAP` 常量但**无顶层副作用**（仅纯对象字面量）· 本次诊断排除其嫌疑；`app.ts` 的 `globalData: { env: getEnv(), tokens }` 在 `App({...})` 参数求值时调 `getEnv()` · 但 `getEnv()` 只读 ENV_MAP 常量 · 无 wx.* 调用 · 不触发本问题
- SBAI v1.1 P2' 冒烟是否收货：本次证明 v1.1 tools 逗号分隔格式可用 · state.md 自主落盘可用 · history 自主落盘可用 · 独立复核可翻转旧定性——**冒烟通过**

## §5 Subagent 最后的 state.md diff

- §3 交付历史索引：从"（无）"→ 新增 1 条指向本 history
- §6 遗留问题：`getGlobalStorage fail: too early` 的描述从"已 close · 若复现重立卡"升级为"定性升级 · 业务触发 · 三层上下文：原定性/新定性/因果链/下一步待裁决"
- §7 最近更新时间戳：追加 1 行 `2026-05-02T20:25:00+08:00 · SBAI v1.1 P2' 冒烟首次自主落盘（by costra-miniapp-dev）`
