# devops-ops · state.md

> 角色规则来源：`.team/agents/05-devops-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 devops-ops（旧 DevOps-Agent）执行基建 / CI / 发布职责。

- 角色文件：`.team/agents/05-devops-agent.md`
- 不走审查 subagent · Human 直审（涉及生产 / 密钥 / 域名）

## §2 当前关注（active tasks）

- Todo: COSTRA-114（开发服务器 bootstrap 手册 · I-003 未开工）
- 其他: COSTRA-108（miniprogram-ci 演练）/ COSTRA-117（husky v10 兼容）

## §3 交付历史索引

- （无 · 从下一次装扮开始记录）

## §4 最近决策影响

- `D-018 SBAI v1.0`
- `D-009 域名红线`
- COSTRA-115 DNS + 白名单 CI 收官

## §5 工作区 + 权限

可写目录：`infra/` / 各模块 `.github/workflows/` / `scripts/devops/` / `.team/members/devops-ops/`
禁写：其他目录 · 特别是 `server/` 与业务代码

## §6 遗留问题 / FU / 债务

- husky v10 DEPRECATED 警告（COSTRA-117 处理）
- 开发服务器 `49.235.216.20` 2026-07-23 到期提醒

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
