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
  - **下一步待 Human 裁决**：方案 A/B/C（见本次 history）· 推荐 A（移除模块顶层副作用 · 迁入 onLaunch）

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
- 2026-05-02T20:25:00+08:00 · SBAI v1.1 P2' 冒烟首次自主落盘（by costra-miniapp-dev · D-017 Step 2 重做根因分析 · FU-LAUNCH 定性升级）
