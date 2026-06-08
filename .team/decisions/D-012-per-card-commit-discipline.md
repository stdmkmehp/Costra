# D-012 · 单卡交付即提交（Per-Card Commit Discipline）

- **状态**：Accepted
- **决策日期**：2026-04-23 20:54
- **决策人**：Human（直接指令）
- **落地人**：Orchestrator
- **优先级**：🔴 P0 · 铁律
- **影响范围**：所有 Agent（Backend / MiniApp / DevOps / PM / Design / QA / Review-Tech / Review-Product）+ Orchestrator 自身

---

## 1. 决策

> **每个 Agent 完成单张任务卡（COSTRA-xxx）的产物后，必须立即产生一次 Git commit；禁止把多卡产物攒批后统一提交。**

## 2. 背景与动机

### 2.1 现状观测（问题）

截至本决策登记时，仓库近 11 次提交中存在两次明显的"攒批提交"反例：

```
29d1849 chore(repo): ship sprint-0 G1-G3 deliverables and sprint-1 W1 progress
f420f26 chore(repo): 归档 Sprint-0 团队调度与协作记录
```

特别是 `29d1849` —— 一次 commit 囊括了 Sprint-0 全部 G1-G3 产物 + Sprint-1 第一周进度。这种颗粒度带来的具体问题：

| 维度 | 攒批提交的代价 |
|---|---|
| **可审计性** | 无法从 git log 定位"COSTRA-020 到底在哪次提交落地" |
| **可回滚性** | 想回滚 COSTRA-103 必须手工 cherry-pick，无法 `git revert <sha>` |
| **Review 对齐** | Review-Agent 审某张卡时，diff 里混着其他卡的代码，无法聚焦 |
| **Gate 追溯** | G3 审契约时，commit 里同时出现 UI 骨架和 DNS 脚本，责任边界糊掉 |
| **事故定位** | 线上问题 bisect 时，定位到的 commit 可能包含 10+ 张卡的改动，无法收敛 |
| **Sprint 统计** | `.team/metrics.json` 的"单卡提交间隔"失真，影响估点校准 |

### 2.2 为什么之前没做好

- `engineering-guidelines.md v1.0 §2.1` 原文是 "**关键节点**必须提交"，**但未明确"每张卡即一个关键节点"**。
- 导致 Agent 实际执行时理解为"一个 Sprint 才算一个关键节点"。
- Orchestrator 本身（含本次 COSTRA-117 落卡）也在默认攒批习惯中。

## 3. 具体规则（MUST）

### 3.1 一卡一 commit
Agent 交付某张卡的 Done-of-Done 瞬间就必须 commit。即使是文档卡、配置卡、小改动卡也不能例外。

### 3.2 Commit message 规范
- **subject**（建议）：`<type>(<scope>): COSTRA-xxx <动作摘要>`
- **footer**（必填）：`Refs: COSTRA-xxx`，可额外带 `Gate: Gx-approved` / `Review: round-N-revise`

**示例**：
```
feat(api): COSTRA-101 账本创建接口 + Zod 校验

- POST /ledgers 契约落地，符合 OpenAPI §3.2
- 单测覆盖 4 条 AC，通过率 100%
- DB schema 已对齐 COSTRA-020 冻结版本

Refs: COSTRA-101
Gate: G3-compliant
```

### 3.3 Review 驱动的修改独立 commit
Review-Agent 出 REVISE 后，被审 Agent 按报告 revise 的产出必须单独 commit：
```
fix(api): COSTRA-101 按 Review Round-2 修订（P0×2 + P1×1）

Refs: COSTRA-101
Review: round-2-revise
```

### 3.4 唯一允许的多卡合并 commit
仅限 Sprint / Gate 聚合收口：
- `type=sprint`（例：`sprint(team): G1 通过，Sprint-0 上半段收口`）
- body **必须**逐条列出所含卡号（`Refs: COSTRA-001, COSTRA-002, COSTRA-003`）

### 3.5 看板/元数据文件（board.md / STATE / messages / tool_calls）
两种允许模式：
- **（A）附带模式**：随本次交付卡一起提交，在 commit body 注明"含看板同步"
- **（B）日终聚合模式**：`chore(team): YYYY-MM-DD 看板与 STATE 日终同步`，**禁止与主产物混提**

## 4. 例外

| 场景 | 是否例外 | 处理方式 |
|---|---|---|
| Hotfix 紧急修复 | ✅ 允许先修复后补规范化 commit message（24h 内 amend） | 见 `engineering-guidelines.md §3` |
| Sprint / Gate 聚合收口 | ✅ 允许多卡同 commit | body 列出所有卡号 |
| 看板/STATE 维护类 | ✅ 可附带或日终聚合 | 见 §3.5 |
| Agent 单卡内发现需要级联改动他卡 | ❌ 不例外 | 应先拆成两张卡或走 PM-Agent 重新排期 |
| "小改动不值得一次 commit" | ❌ 不例外 | 铁律无大小豁免 |

## 5. 强制执行机制

| 层级 | 机制 | 触发时机 |
|---|---|---|
| **Agent 自检** | 交付前 `git diff` 自审 + commit message 含 `Refs:` 检查 | 每次交付 |
| **Orchestrator 审计** | 每次收到 `status_report` 消息后，校验上一次 commit 是否已含该卡号 | 实时 |
| **CI（COSTRA-117 之后）** | commitlint 规则增强：footer 必须含 `Refs: COSTRA-\d{3}` | pre-push |
| **Review-Agent** | 审稿时发现"本卡改动在历史 commit 里还混着其他卡" → 自动 P1 违规 | Review 每轮 |
| **Human 抽检** | 每周末 `git log --oneline` 扫一遍近 7 天 commit | 每周 |

## 6. 回溯处理

- 已存在的 `29d1849` 和 `f420f26` 两次攒批提交 **不做 rewrite**（保留历史 + 本 ADR 作为审计注脚）。
- 本决策自 **2026-04-23 20:54 起生效**，之后所有 commit 均须合规。
- 首次违规 → Orchestrator 在 `.team/incidents/` 登记 + 当事 Agent 下一轮交付必须附带 retrospective。
- 连续 2 次违规 → 升级给 Human，该 Agent 当前 Sprint 剩余卡全部转 plan 模式。

## 7. 落地动作（本次决策同步完成）

- [x] 更新 `.team/engineering-guidelines.md §2.1` 为 v1.1，新增"单卡交付即提交"章节与反例
- [x] 更新 `.team/agents/COMMON-CONTRACT.md §9` 增加铁律索引项
- [x] 创建本文件 `.team/decisions/D-012-per-card-commit-discipline.md`
- [x] 更新 `.team/STATE` 铁律段 + 时间戳
- [ ] （延后）DevOps-Agent 在 COSTRA-117 顺带强化 commitlint footer 规则（合并到该卡验收标准）

## 8. 反向约定：本 ADR 自身如何提交

按本 ADR §3.5 模式（A），合并到**下一张被触发的卡**的交付 commit 中，或单独以：
```
docs(team): D-012 登记单卡交付即提交铁律

- engineering-guidelines.md §2.1 v1.0 → v1.1
- COMMON-CONTRACT.md §9 强化
- 新增 decisions/D-012-per-card-commit-discipline.md

Refs: D-012
```
形式提交（推荐，因为 meta-governance 类改动不依附任何具体 COSTRA 卡）。

---

## 版本历史
- 2026-04-23 20:54 · v1.0 · Accepted · Human 指令 + Orchestrator 落盘
