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

## §3 交付历史索引

- 2026-05-02 · `history/2026-05-02-getglobalstorage-v2-diagnose.md` · FU-LAUNCH 第 3 次观察 **重定性**（D-017 Step 2 · SBAI v1.1 P2' 冒烟 · 证据坐实"storage.ts:29 模块顶层副作用 vs 高版本库时序约束"）

## §4 最近决策影响

- `D-018 SBAI v1.0`
- `ADR-0002`· 技术栈（不适用 miniapp · 适用 backend）
- COSTRA-119/120/121/122/123 同族盲区五连收官（规约盲区检测工具链）

## §5 工作区 + 权限

可写目录：`miniprogram/` / `.team/members/miniapp-dev/`
禁写：其他目录 · 特别是 `server/` `api/` `design/`

## §6 遗留问题 / FU / 债务

- FU-LAUNCH-FIRST-RENDER-RACE · `getGlobalStorage fail: too eayly` 错误 · **定性已升级**（2026-05-02 20:25）
  - **原定性**（2026-04-29～2026-05-02 19:32 · 三次观察）："100% 微信 SDK 内部启动时序 Bug · 非业务"
  - **新定性**（Human 2026-05-02 20:15 新线索触发 · 本次根因分析坐实）："我方 `miniprogram/services/storage.ts:29` 模块顶层副作用 `ensureVersion()` 在 `App()` 注册之前同步调 `wx.getStorageSync/clearStorageSync/setStorageSync` · 与高版本基础库（2.32.3+）对 storage 调用时机的新约束冲突 · **业务触发 · 非 SDK Bug**"
  - **因果链**：`app.ts:4 import './services/auth'` → `services/auth.ts:7 import './storage'` → `storage.ts:29 ensureVersion()` top-level 同步执行 → 此时 SDK 内部 `createOrGetStorageGroup/_prepare` 未就绪 → 抛出 `too eayly`
  - **SDK 侧错误名错配**（getGlobalStorage）仍可能是 SDK 包装层产物 · 但触发源在我方业务
  - **已拍板**：Human 2026-05-02 20:31 Q1-Q6 全"按推荐" · 立 COSTRA-124（Sprint-1 末小卡）· 方案 A（迁入 onLaunch）

- **COSTRA-124 Card-Review Round-1 Follow-up**（2026-05-02 21:05 · PASS-WITH-FOLLOWUP 26/30 · 3 P2 非强制建议 · R1 实装时自主决定是否合并）
  - **FU-124-P2-1**（估点实事求是）：dispatch §8 时间预算"30 min 两份文档"建议改为"45-60 min" · 或 Sprint-1 末 Retro 议题"紧急卡估点偏乐观"增列第 5 条证据
  - **FU-124-P2-2**（实测断言语义）：dispatch §3 DoD (e) 4 条验证断言补一行"4 条全 PASS 为硬门槛；Launch Time 900-935 ms 视为 AMBER · 走 Human 个案裁决不自动 REVISE"
  - **FU-124-P2-3**（FU 闭合定性翻转追写）：DoD (f) 可扩展为 f.1 + f.2 两小段 · f.2 明文记"前 3 次定性误判（SDK 内部 Bug）→ 第 4 次新线索（Human）→ 装扮 subagent 独立核查坐实 storage.ts:29 → COSTRA-124 修复 → FU closed"完整翻转链 + 下游议题（Sprint-1 末 Retro 第 15 条"独立复核可翻转历史定性"范式）

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
- 2026-05-02T20:25:00+08:00 · SBAI v1.1 P2' 冒烟首次自主落盘（by costra-miniapp-dev · D-017 Step 2 重做根因分析 · FU-LAUNCH 定性升级）
- 2026-05-02T21:07:00+08:00 · COSTRA-124 立卡 + Card-Review Round-1 PASS-WITH-FOLLOWUP 26/30 · 3 P2 记入 §6 follow-up（by Orchestrator · 调度层元数据维护）
