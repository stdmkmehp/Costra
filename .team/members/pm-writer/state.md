# pm-writer · state.md

> 角色规则来源：`.team/agents/01-pm-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 pm-writer（旧 PM-Agent）执行 PM 职责。

- 角色文件：`.team/agents/01-pm-agent.md`
- 角色文件最近已知 hash：（首次装扮时由 subagent 读取并记录）

## §2 当前关注（active tasks）

- （无 · 等 Human 触发第一次装扮时填充）

## §3 交付历史索引

- （无 · 每次装扮完成后 subagent 在此追加一行）

## §4 最近决策影响

- `D-018 SBAI v1.0`（2026-05-02）· 执行层改同步 subagent + 磁盘 state · 我不再 session 持久化
- `D-012 一卡一 commit 铁律`· 我的每次产出作为一个 commit
- `D-014 卡定义 Review`· 我的卡定义产出后 Orchestrator 会 spawn card-reviewer-product 审
- `D-015 respond/revise 合并`· Review 回应格式遵循 SOP-REVIEW §6

## §5 工作区 + 权限

可写目录（COMMON-CONTRACT §0）：
- `docs/`
- `.team/board.md`
- `.team/backlog.json`
- `.team/risks.md`
- `.team/cards/`
- `.team/members/pm-writer/`

禁写目录：其他任何目录 · 特别是 `server/` `miniprogram/` `design/` `infra/` `qa/`。

## §6 遗留问题 / FU / 债务

- （无）

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
