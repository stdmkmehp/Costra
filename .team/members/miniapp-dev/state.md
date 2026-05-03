# miniapp-dev · state.md

> 角色规则来源：`.team/agents/03-miniapp-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 miniapp-dev（旧 MiniApp-Agent）执行微信小程序开发。

- 角色文件：`.team/agents/03-miniapp-agent.md`
- **已知偏差**：角色文件写 `miniapp/` · 实际仓库是 `miniprogram/`（对齐 COSTRA-121~123 收官事实）· 装扮时以 `miniprogram/` 为准

## §2 当前关注（active tasks）

- COSTRA-102 · 登录→首页→记一笔端到端（等 Human 人验）· 5~10 分钟
- Todo: COSTRA-103（本地持久化 + outbox）/ COSTRA-112（主体字样清扫）
- **COSTRA-124 · 部分闭合**（顶层副作用子目标 close · commit `a296be0` · FU-LAUNCH-A closed · 架构价值保留 · R1 假设证伪部分由 COSTRA-125 接力）
- **🆕 COSTRA-125 · 启动期 storage 异步化 · onLaunch 内同步调用根因解决 · 2 点 · P1 · 方案 B'+E' 合并版 · 等 Orchestrator spawn 实装（卡审 + R1 + review-tech + Human 第 8 次实测）**

## §3 交付历史索引

- 2026-05-02 · `history/2026-05-02-getglobalstorage-v2-diagnose.md` · FU-LAUNCH 第 3 次观察 **重定性 v2**（D-017 Step 2 · SBAI v1.1 P2' 冒烟 · 证据坐实"storage.ts:29 模块顶层副作用 vs 高版本库时序约束"）
- 2026-05-02 · `history/2026-05-02-costra-124-r1-implement.md` · COSTRA-124 R1 实装（SBAI v1.1 P2' 实战第 2 回 · DoD (a)(b)(c 路径 ①)(d)(f 预闭合)(g) 已交付 · (e) 待 Human 实测 · 2 文件代码修复 + 2 份新文档 + FU f.1+f.2 追写）
- **2026-05-03** · `history/2026-05-03-costra-124-r2-diagnose.md` · COSTRA-124 **Revise-Round-2 根因重做**（SBAI v1.1 P2' 冒烟第 3 回 · D-017 Step 2 只诊断不修复 · 基于 Human 第 7 次实测证伪 R1 假设 · L1-L4 四层根因重做 · 6 方案对比 · 8 Q 决策点 · 0 次 miniprogram/ 写入 · 0 次 git commit）

## §4 最近决策影响

- `D-018 SBAI v1.0`
- `ADR-0002`· 技术栈（不适用 miniapp · 适用 backend）
- COSTRA-119/120/121/122/123 同族盲区五连收官（规约盲区检测工具链）

## §5 工作区 + 权限

可写目录：`miniprogram/` / `.team/members/miniapp-dev/`
禁写：其他目录 · 特别是 `server/` `api/` `design/`

## §6 遗留问题 / FU / 债务

- FU-LAUNCH-FIRST-RENDER-RACE · `getGlobalStorage fail: too eayly` 错误 · **定性已升级到 v3**（2026-05-03）
  - **v1**（2026-04-29 ~ 2026-05-02 19:32 · 三次观察）："100% 微信 SDK 内部启动时序 Bug · 非业务"
  - **v2**（2026-05-02 20:25 · 装扮 subagent 根因 v1）："我方 `miniprogram/services/storage.ts:29` 模块顶层副作用 `ensureVersion()` 在 `App()` 注册之前同步调 `wx.getStorageSync/clearStorageSync/setStorageSync` · 业务触发 · 非 SDK Bug"
  - **v3（本次 2026-05-03 · R2 诊断再翻转）**："SDK 2.32.3+ 启动期 storage group `_prepare` 尚未就绪 + 业务在 `App.onLaunch` 内任何同步 storage 调用 = 必然冲突 · **SDK + 业务共同责任** · R1 假设（迁入 onLaunch 即安全）证伪 · onLaunch 内仍有第二触发点 `auth.ts:70 initAuth → getItem(TOKEN_KEY)`（async function 体内第一行 · 在 await 之前同步执行）"
  - **证据**：Human 2026-05-03 20:09 第 7 次实测 · Console `[Costra] onLaunch env= dev` 先出 · 之后仍报 7+ 次 `[渲染层错误] too eayly` · Launch Time 1864 ms（基线 865 · ×2.16 劣化）
  - **因果链（新）**：基础库 2.32.3 在 onLaunch 触发时渲染层 storage group `_prepare` 未就绪 → AppService 逻辑层任何同步 `wx.*StorageSync` 调用经 jsbridge 委托到渲染层 storage group → prepare 未就绪抛 too eayly（4 种 API · get/set/remove/metadata）· SDK 内部 try 吞 · 业务看不到错但 Console 留痕 · Launch Time 劣化
  - **分裂为子 FU**（Q8 推荐）：
    - FU-LAUNCH-FIRST-RENDER-RACE-**A**（storage.ts 顶层副作用 · COSTRA-124 已闭合 · 可 close）
    - FU-LAUNCH-FIRST-RENDER-RACE-**B**（onLaunch 内同步 storage 调用族冲突 `_prepare` 未就绪 · COSTRA-125 候选认领 · 保持 `open`）
    - FU-LAUNCH-FIRST-RENDER-RACE-**C**（`Expected updated data but get first rendering data` · R1 路径 ① 假设自然消失的判定因 storage 问题未修无法落实 · 保持 `open` · 等 COSTRA-125 实测）
  - **推荐方案**（R2 诊断）：B'（异步 API 全量替换 · 2 点 · 中高置信）主推 · C'（降基础库到 2.30.x）兜底 · E'（bootstrap Promise + lazy init）Sprint-2 演进
  - **Q1-Q8 决策点** 见 `history/2026-05-03-costra-124-r2-diagnose.md §7`

- **COSTRA-124 Card-Review Round-1 Follow-up**（2026-05-02 21:05 · PASS-WITH-FOLLOWUP 26/30 · 3 P2 非强制建议 · R1 实装时自主决定是否合并）
  - **FU-124-P2-1**（估点实事求是）：dispatch §8 时间预算"30 min 两份文档"建议改为"45-60 min" · 或 Sprint-1 末 Retro 议题"紧急卡估点偏乐观"增列第 5 条证据
  - **FU-124-P2-2**（实测断言语义）：dispatch §3 DoD (e) 4 条验证断言补一行"4 条全 PASS 为硬门槛；Launch Time 900-935 ms 视为 AMBER · 走 Human 个案裁决不自动 REVISE"
  - **FU-124-P2-3**（FU 闭合定性翻转追写）：DoD (f) 可扩展为 f.1 + f.2 两小段 · f.2 明文记"前 3 次定性误判（SDK 内部 Bug）→ 第 4 次新线索（Human）→ 装扮 subagent 独立核查坐实 storage.ts:29 → COSTRA-124 修复 → FU closed"完整翻转链 + 下游议题（Sprint-1 末 Retro 第 15 条"独立复核可翻转历史定性"范式）

- **COSTRA-124 R1 Review 33/35 纸面审漏拦截 R1 假设漏洞**（2026-05-03 R2 发现）· Retro 议题 17 候选："Review-Tech 对 runtime 规约类 T2 卡 · 需 Human 模拟器实测作为 Round-N+1 前置" · 与 Retro 议题 11 "Review 可能基于错误假设" 并链 · 本次是第 2 次纸面审漏检事件（COSTRA-121 是第 1 次）

- **docs/devops/libversion-upgrade.md §3 反模式 #4 追写候选**（R2 诊断产物）：坏例 "R1 假设把 wx.* 同步调用从模块顶层迁入 App.onLaunch 首行即安全" · 好例 "验证 SDK 运行时实现细节与文档承诺是否吻合 · 必须模拟器实测不信纸面" · 原因 "文档承诺 ≠ 运行时实现 · SDK 内部 storage group/prepare 状态机属黑盒"

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
- 2026-05-02T20:25:00+08:00 · SBAI v1.1 P2' 冒烟首次自主落盘（by costra-miniapp-dev · D-017 Step 2 重做根因分析 · FU-LAUNCH 定性升级 v2）
- 2026-05-02T21:07:00+08:00 · COSTRA-124 立卡 + Card-Review Round-1 PASS-WITH-FOLLOWUP 26/30 · 3 P2 记入 §6 follow-up（by Orchestrator · 调度层元数据维护）
- 2026-05-02T21:30:00+08:00 · COSTRA-124 R1 实装交付（by costra-miniapp-dev · SBAI v1.1 P2' 实战第 2 回 · storage.ts:29 顶层副作用消除 + app.ts onLaunch 首行挂载 + 2 份新文档 + FU f.1+f.2 预闭合 · 等 Human 实测 + review-tech Round-1）
- 2026-05-03T12:55:00+08:00 · COSTRA-124 Revise-Round-2 根因重做完成（by costra-miniapp-dev · SBAI v1.1 P2' 冒烟第 3 回 · **只诊断不改代码** · 基于 Human 第 7 次实测证伪 R1 假设 · L1-L4 四层根因重做 · 定性升级到 v3（SDK+业务共同责任）· 6 方案对比 · 8 Q 决策点 · **0 次 miniprogram/ 写入 · 0 次 git commit** · 等 Orchestrator 收 final message 回给 Human 裁决）
- **2026-05-03T20:32:00+08:00 · COSTRA-125 立卡**（by Orchestrator · Human D1/D2/D3 全按推荐 · 方案 B'+E' 合并版 · COSTRA-124 部分闭合 · FU-LAUNCH 分裂 A/B/C 三子 FU · A closed · B/C open · libversion-upgrade.md §3 追反模式 #4 · 本 state.md §2 active 调整 · 等 Orchestrator 后续 spawn card-reviewer-tech 卡审 + 实装 spawn）
