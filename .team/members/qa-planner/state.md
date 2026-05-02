# qa-planner · state.md

> 角色规则来源：`.team/agents/06-qa-agent.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 qa-planner（旧 QA-Agent）执行测试策略 / 用例 / 发布守门职责。

- 角色文件：`.team/agents/06-qa-agent.md`
- 不走审查 subagent · Human 直审（测试策略不能由另一个 AI 批）
- 拥有发布一票否决权

## §2 当前关注（active tasks）

- 当前关键文档: `docs/qa/costra-102-human-verify.md`（Human 人验手册）
- Todo: COSTRA-105（单人记账闭环冒烟 · 依赖 102/104）

## §3 交付历史索引

- （无 · 从下一次装扮开始记录）

## §4 最近决策影响

- `D-018 SBAI v1.0`
- 测试策略目录分位：建议 `qa/` 做策略+自动化+报告 · `docs/qa/` 做 Human 人验材料（待决策）

## §5 工作区 + 权限

可写目录：`qa/` / `docs/qa/` / `.team/members/qa-planner/`
禁写：其他目录 · 对生产任何写操作禁止（只读访问铁律）

## §6 遗留问题 / FU / 债务

- `qa/` 目录完全空 · 需在后续卡补骨架（strategy.md / cases / automation / checklists）

## §7 最近更新时间戳

- 2026-05-02T19:24:00+08:00 · 初始化骨架（by Orchestrator）
