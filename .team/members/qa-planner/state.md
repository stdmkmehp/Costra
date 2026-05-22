# qa-planner · state.md

> 角色规则来源：`.codebuddy/agents/costra-qa-planner.md`
> 公共契约：`.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §8ter
> Schema：`.team/members/README.md §2`
> 初始化：2026-05-02 19:24
> **上次更新**：2026-05-22（COSTRA-154+150 联合实测手册产出 · qa-planner 归口）

---

## §1 角色身份

装扮型 subagent · 每次 spawn 全新上下文 · 装扮成 qa-planner 执行测试策略 / 用例 / 发布守门职责。

- 角色文件：`.codebuddy/agents/costra-qa-planner.md`（D-018 SBAI v1.1 §3.4）
- 不走审查 subagent · Human 直审（测试策略不能由另一个 AI 批）
- 拥有发布一票否决权

## §2 当前关注（active tasks）

- 🔜 **COSTRA-154 + COSTRA-150 联合 staging 实测**：手册已落档 `qa/costra-154-150-joint-smoke.md`（707 行 · v1.0）· 等 Human 执行 5 条断言 A~E + `approve:COSTRA-154 + COSTRA-150`
- 🔴 **COSTRA-105 H6 BLOCKED-BY-COSTRA-154**：154+150 approve 后 H6 自动等效回归具备 PASS 条件
- 🔜 **Sprint-3 候选**：FU-105-AUTOMATION-FULL-COVERAGE（5 点 · 14 用例全量自动化 + CI 集成）
- **COSTRA-901**：微信审核自查（五张签字单 · 未来承接）

## §3 交付历史索引

| 时间 | 卡号 | 交付 | 状态 |
|---|---|---|---|
| 2026-05-22 | **COSTRA-154+150 联合实测手册** | `qa/costra-154-150-joint-smoke.md` v1.0 · 707 行 · 5 断言 + 10 FAQ + D-025 自检 | COMMITED 待 commit |
| 2026-05-19 | **COSTRA-105 终审收官** | partial PASS · 5/7 Sprint-2 卡 CLOSED · 22 点 / 61% | ✅ **APPROVED-PARTIAL** |
| 2026-05-12 | COSTRA-105 R1 实装 | strategy.md + cases + human-smoke.md v1.0 + automation + wechat-review + FU-105 | COMMITED `c046d25` |

## §4 最近决策影响

- D-018：SBAI v1.1 装扮档规范（一次性装扮 / 任务销毁 / 持久状态走 state.md）
- D-016：同轮兑现（Card-Review → R1 实装 → review-tech R1 同一对话轮完成）
- D-025 AP-001 首次 Orchestrator 命中：手册事实错误由 qa-planner 归口修正 · 每条命令必须有 Read 验证的事实源
- env.ts mockLogin=false 事实纠正：任务背景说 mockLogin=true 是错的 · 实际源码 env.ts:18 mockLogin=false

## §5 工作区 + 权限

可写目录：`qa/` / `docs/qa/` / `.team/follow-ups/README.md` / `.team/members/qa-planner/`
禁写：其他目录 · 对生产任何写操作禁止（只读访问铁律）

## §6 遗留问题 / FU / 债务

- `qa/` 目录：COSTRA-105 R1+R1.x 交付完整（strategy.md / cases/ / automation/ / checklists/ / defects/ × 2）
- ✅ **FU-104-SYNC-PULL** → COSTRA-154 已实装（review-tech APPROVE 38/40）· 等 Human 实测
- 🟡 FU-105-AUTOMATION-FULL-COVERAGE（5 点 · Sprint-3 候选）
- 🟢 FU-105-DEV-CONSOLE-HOOK P3（miniapp-dev 顺带）
- 🟡 FU-150-FAMILY-CONTEXT-SERVICE（P2 · getActiveFamilyId 永远返 null · 需手动注入 family_id）
- `qa/defects/` 落盘 2 单：D.1 BUG-001/002 已修 · D.2 pull 501 BLOCKER → RESOLVED @ COSTRA-154

## §7 最近更新时间戳

- **2026-05-22T12:00:00+08:00 · COSTRA-154+150 联合实测手册产出**（qa-planner 归口 · D-025 AP-001 反例首次 Orchestrator 命中后的修正版 · 707 行 · 每条命令有事实源）
- 2026-05-19T09:27:00+08:00 · COSTRA-105 Human T1 APPROVED-PARTIAL CLOSED（联合 156 双卡终审 · partial PASS · H1~H5 全绿 · H6 BLOCKED-BY-COSTRA-154 自动等效回归）
- 2026-05-12T14:55:00+08:00 · COSTRA-105 R1 实装完成（qa-planner 首次实装 · 40/40 满分 · D-022 v2.0 第 3 次实战）
