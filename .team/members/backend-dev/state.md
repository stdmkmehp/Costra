# backend-dev · state.md

> 角色规则来源：`.team/agents/04-backend-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 backend-dev（旧 Backend-Agent）执行服务端开发。

- 角色文件：`.team/agents/04-backend-agent.md`
- **已知偏差**：角色文件写 Go/Gin/gRPC 技术栈 · 实际 ADR-0002 定的是 Node/TS/Fastify · 装扮时以 ADR-0002 + `server/package.json` 实际为准

## §2 当前关注（active tasks）

- Todo: COSTRA-104（/entries CRUD + /sync/push 契约起草）

## §3 交付历史索引

- （无）

## §4 最近决策影响

- `D-018 SBAI v1.0`
- `ADR-0002 Tech Stack`· Node/TS/Fastify（**权威 · 不是 Go**）
- `D-008 subject 个人优先企业兼容`· 实装 `server/src/config/subject.ts`
- `D-009 域名红线`· `costra.cloud` / 开发服务器 `49.235.216.20`（2026-07-23 到期）

## §5 工作区 + 权限

可写目录：`server/` / `api/` / `.team/members/backend-dev/`
禁写：其他目录

## §6 遗留问题 / FU / 债务

- 契约漂移风险（/sync/push 5 字段冲突解决策略必须先 G3 冻结 OpenAPI）
- 金额精度 DECIMAL(18,4) + `decimal.js` 双端一致约束

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
