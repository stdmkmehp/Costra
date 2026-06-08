# COSTRA-106 · Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新

- 卡号：COSTRA-106
- Owner：pm-writer（装扮 subagent · D-018 SBAI v1.1）
- Type：retro / 工程治理
- 估点：**2 点**（升自原 1 点 · Q5-b 拍板 · 议题 14+ 条 + 3 决议 + metrics 重写）
- 优先级：P0（Sprint-2 第 1 张 · 议题热度趁此一次性沉淀）
- Sprint：**Sprint-2**（2026-05-10 ~ 2026-05-23）
- 依赖（已闭合）：Sprint-1 全 14 卡 / D-019 G4 决议
- 立卡时间：2026-05-09 10:09（Human `run pm COSTRA-106` 触发）

---

## §0 SBAI 路径

- **卡定义 Review**：Q1-a 拍板 · 走 `costra-card-reviewer-product`（D-014 严格路径 · PM 卡走 product 档）
- **R1 实装**：Q4-a 拍板 · spawn `costra-pm-writer` 装扮 subagent（SBAI 第 6 次冒烟 · pm-writer 首次实战）
- **R1 Review**：D-014-b 自动拉起 `costra-review-product`
- **Human 终审**：T2 单轨（Retro 文档类 · 无代码改动 · 不需 T1 双签）

---

## §1 背景

Sprint-1（2026-04-23 ~ 2026-05-08 · 超期 2 天）14 卡 100% CLOSED · G4 PASS @ 2026-05-09 09:44（D-019 决议落盘）。Sprint-1 累计 14+ 条 Retro 议题已在 HANDOFF.md §6.1 + 各 FINAL.md + state.md 沉淀 · D-019 路径 A 决策"全部转 COSTRA-106 一次性处置"· 本卡兑现该承诺。

议题热度未消 · 趁此沉淀避免 Sprint-2 主线（103/104）启动后议题被搁置。

---

## §2 范围（Scope）· 7 项交付物

### §2.1 主报告（A）

**`docs/retrospectives/sprint-1-retro.md`**（新建 · 一次成稿 · 不分章节碎片）

必含段落：

- **§1 Sprint-1 速览**（周期 / 估点 / 14 卡索引 / 闸门状态 / commits 统计）
- **§2 14+ 议题逐条处置**（议题 10/11/12/13/14/15/16/17 + D-016 升定稿 + D-017 v3 升级 + 紧急卡五连溢出 + SBAI v1.1 冒烟复盘 + FU-LAUNCH 4 次定性翻转复盘 + T1/T2 档位边界教训）
  - 每议题统一格式：编号 / 来源 / 现象 / 根因 / 处置（→ 决议 D-020/D-021/D-022 / → SOP / → engineering-guidelines / → FU 转 Sprint-2）/ 后续动作 owner
- **§3 工程度量复盘**（关联 `.team/metrics.json` · 见 §2.5 E 项）
  - Review 通过率 / Human 终审通过率 / D-016 同轮兑现实战次数 / D-017 实战次数 / SBAI 冒烟次数 / CI 对账族扩展 / 紧急卡五连溢出量化
- **§4 范式与反模式归档**（FU-LAUNCH 治理范式 / 同族盲区五连闭环范式 / 跨卡治理反哺范式 / FU 专项卡范式 / 审计类专项卡范式 / Review-Tech 纸面审漏检反模式）
- **§5 Sprint-2 输入**（COSTRA-103 主线 + 同步 COSTRA-104 协议对齐前置 + 残余 FU 顺位 + 紧急卡 buffer 12~16 点机制）
- **§6 议题→决议映射表**（议题 N → D-020/D-021/D-022 / SOP-REVIEW v2.1 / engineering-guidelines / Sprint-2 FU 队列）

预估行数：400~600 行。

### §2.2 决议 1（B）· `docs/retrospectives/` 旁路 · `.team/decisions/`

**`.team/decisions/D-020-d-016-final-canonical.md`**（D-016 同轮兑现升定稿规约）

必含段落：

- 立案背景（D-016 自 2026-04-24 立案至 2026-05-08 累计 12 次实战 · 0 跨轮异步反模式 · 议题 #19 子项）
- 实战证据汇总（12 次实战逐条索引 · 卡号 + 时间 + 合规说明）
- 升定稿规约条文（同轮兑现强制性 / 跨轮例外白名单 / 违反即记 `I-cross-turn-async-violation`）
- 与 D-011 / D-013 / D-014 / D-018 的关系（D-016 现已涵盖 D-011 自动循环的执行层 · D-018 SBAI 落地后保持有效）
- 生效声明（自 2026-05-09 起 · 替换 D-016 v1.0 "观察期" 标签 → "定稿规约"）

预估行数：100~150 行。

### §2.3 决议 2（C）· `.team/decisions/D-021-d-017-v3-cross-version-precheck.md`

D-017 v3 升级 · 跨版本对照前置：

必含段落：

- 升级背景（D-017 v1 立案 2026-04-28 · v2 隐式升级 2026-04-29 COSTRA-122 · v3 候选自 COSTRA-126 跨 5 lib 实测）
- v3 新增前置项（① 事实源工具链含 git ls-files / git log / git show HEAD: 三证（COSTRA-121 教训）② runtime 实测作为 runtime 规约类 T2 卡终审绝对证据（COSTRA-124 R1 假设证伪 + COSTRA-127 跳 R1 二次实战教训）③ 跨版本对照（lib / 工具链 / SDK 版本）作为运行时根因诊断标准前置（COSTRA-126 4 条独立证据链建立的范式））
- v3 反模式 ABCD 保留 + 新增 E（Orchestrator 自行下结论而不前置实测）
- 实战索引（5 次实战 · COSTRA-120/121/122/123/124 → 完整列表）
- 生效声明（自 2026-05-09 起）

预估行数：150~200 行。

### §2.4 决议 3（D）· `.team/decisions/D-022-review-tech-runtime-dimension.md`

议题 17 · review-tech 评分表加 runtime 维度 + runtime 类 T2 卡 Human 实测前置纳入 SOP-REVIEW：

必含段落：

- 立案背景（COSTRA-121 R1 35/35 后被 122 实测证伪 · COSTRA-124 R1 33/35 后被 Human 第 7 次实测证伪 · 议题 11 + 议题 17 二次兑现）
- 评分表升级（review-tech 总分 35 → 40 · 新增 C8 "runtime 加载性"维度 5 分 · 含 ① runtime 实测必须性 ② 跨版本对照覆盖 ③ 平台 SDK 假设标注 ④ 错误路径 runtime 触达验证）
- runtime 类 T2 卡判定标准（涉及微信 SDK / 运行时模块加载 / 渲染层时序 / 平台 API 任一即判 runtime 类）
- runtime 类 T2 卡 Human 实测前置铁律（runtime 类 T2 卡终审绝对证据 = Human 模拟器实测 ≥ N 条断言全 PASS · review-tech 纸面审仅作为辅助证据）
- 与 SOP-REVIEW v2.1 §11 的整合（COSTRA-127 跳 review-tech R1 范式纳入合规边界 · "Human 终审吸收 review-tech R1 职责"明文化）
- 实战索引（COSTRA-121 第 1 次纸面审漏检 + COSTRA-124 第 2 次纸面审漏检 + COSTRA-127 第 1 次合规跳过实战）
- 生效声明（自 2026-05-09 起 · review-tech 评分表 v1.0 → v2.0）

预估行数：150~200 行。

### §2.5 metrics 重写（E）· `.team/metrics.json`

**当前停留在 COSTRA-116（2026-04-27）· 缺 11 卡（119/120/121/122/123/124/125/126/127/128/102）+ 1 卡定义重写（106 自身）**

必做：

- 补齐 11 卡的完整 metrics 记录（参照 COSTRA-115/116 完整字段格式 · 含 review_type / total_rounds / verdict / scores / human_final_decision / final_report 等）
- COSTRA-106 自身 metrics 记录（card_review + review-product 双段）
- 顶层 `_description` 字段重写为 Sprint-1 收官摘要 + Sprint-2 启动锚点
- 顶层 `_updated_at` 刷到 2026-05-09
- Sprint-1 聚合度量段（新建顶层字段 `sprint_1_summary`）：14 卡总数 / 总估点 52 / 平均 review 通过率 / 平均 Human 终审耗时 / 紧急卡比例 / D-016 实战次数 / D-017 实战次数 / SBAI 冒烟次数 / CI 对账族扩展数 / commits 数

### §2.6 board.md 更新（F · pm-writer 自有可写权）

- "最后更新" 段刷新到 COSTRA-106 R1 完成态
- COSTRA-106 卡定义内嵌：从 Sprint-1 Todo 段（原 Sprint-0 Retro · 1 点）**重写**为 Sprint-2 Todo 段（Sprint-1 Retro · 2 点 · P0）
- Sprint-2 段开建（**Todo · Sprint-2** 表头 · 含 D-019 §3.2 完整 7 卡建议清单 · 但仅 COSTRA-106 状态 = Doing · 其他保持 Backlog）

### §2.7 backlog.json 更新（G · pm-writer 自有可写权）

- COSTRA-106 卡定义重写（原"Sprint-0 Retro"→"Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新"· 估 1→2 · Sprint sprint-1 → sprint-2）
- COSTRA-103/104/105/112/114 卡状态从 Sprint-1 Todo → Sprint-2 Backlog（D-019 §3.2 ）
- 新增 COSTRA-160 卡占位（FU-118-3 设计 tokens pipeline · Sprint-2 候选 · Backlog）

---

## §3 工作区 + 权限

### 可写

- `docs/retrospectives/sprint-1-retro.md`（新建 · 主报告 A）
- `.team/decisions/D-020-d-016-final-canonical.md`（新建 · B）
- `.team/decisions/D-021-d-017-v3-cross-version-precheck.md`（新建 · C）
- `.team/decisions/D-022-review-tech-runtime-dimension.md`（新建 · D）
- `.team/metrics.json`（重写 · E）
- `.team/board.md`（F · pm-writer 自有可写权）
- `.team/backlog.json`（G · pm-writer 自有可写权）
- `.team/members/pm-writer/state.md`（§2/§3/§7 收尾）
- `.team/members/pm-writer/history/2026-05-09-costra-106-sprint-1-retro.md`（新建 · ≤ 100 行 · SBAI 第 6 次冒烟产物）

### 禁写

- `miniprogram/` / `server/` / `api/` / `design/` / `infra/` / `qa/` / `scripts/`
- `docs/PRD.md`（不动 · 议题不涉及需求变更）
- `docs/devops/libversion-upgrade.md`（v5 唯一定稿 · COSTRA-128 已锁）
- 其他 `.team/decisions/D-001~D-019`（已有决议不修改 · D-020~D-022 仅新建）
- 其他 `.team/members/{other-role}/`
- `.codebuddy/agents/`
- `project.config.json` / 任何业务代码

---

## §4 DoD（必达 · pm-writer 自检 · review-product 复核）

| # | DoD | 验收方式 |
|---|---|---|
| (a) | 主报告 A 落盘 · 含 §1~§6 全段落 · 14+ 议题逐条处置（每议题含 5 字段：编号/来源/现象/根因/处置）| `wc -l docs/retrospectives/sprint-1-retro.md` ≥ 400 行 · grep "议题 1[0-7]" 出现次数 = 8（议题 10~17 各 1 次）|
| (b) | 决议 B/C/D 三份落盘 · 各含立案背景 / 条文 / 实战索引 / 生效声明四段 | 三文件存在 · 每文件 ≥ 100 行 |
| (c) | metrics.json 重写 · 含 11 卡补齐 + 106 自身 + Sprint-1 聚合段 | `jq '.cards | length' .team/metrics.json` ≥ 18（原 7 + 11 + 1 - 重复修正）· `jq '.sprint_1_summary' .team/metrics.json` 非 null |
| (d) | board.md Sprint-2 段开建 + COSTRA-106 流转到 Doing | grep "## 📋 Todo · Sprint-2" + grep "COSTRA-106.*Doing" 命中 |
| (e) | backlog.json COSTRA-106 重写 + 5 卡 Sprint 流转 | `jq '.cards[] \| select(.id=="COSTRA-106") \| .points' .team/backlog.json` = 2 |
| (f) | pm-writer state.md §2/§3/§7 收尾追写 | `grep "2026-05-09" .team/members/pm-writer/state.md` 命中 |
| (g) | history 落盘（≤ 100 行）| 文件存在 + 含 SBAI 第 6 次冒烟字样 |
| (h) | 议题→决议映射表（主报告 §6）完整 · 14+ 议题映射完整无遗漏 | 主报告 §6 表格行数 ≥ 14 |

**0 行业务代码改动 · 0 行微信小程序源码改动 · 0 行 server 代码改动**（pm-writer 工作区铁律）

---

## §5 闸门（pm-writer 自跑 · 全 exit 0）

- `node --check .team/metrics.json`（不适用 · metrics 是 JSON 不是 JS）→ 改用 `python3 -c "import json; json.load(open('.team/metrics.json'))"` 或 `jq . .team/metrics.json > /dev/null`
- `jq . .team/backlog.json > /dev/null`（JSON 合法性）
- `npm run check:appjson`（回归 · 不应受影响）
- `npm run check:tooling`（回归）
- `npm run check:whitelist`（回归）
- `npm run typecheck`（回归 · pm 卡不动代码 · 应不变）
- `npm run lint`（回归）
- `npm run test`（回归 · 13/13 应保持）

---

## §6 commit（D-012 单卡即提交 · footer 必含 `Refs: COSTRA-106`）

**单 commit**（pm 卡产出全文档 · 无源码改动 · 不拆分）：

```
docs(retro): sprint-1 retro + d-020/d-021/d-022 decisions + metrics rewrite (COSTRA-106)

- new: docs/retrospectives/sprint-1-retro.md (主报告 · 14+ 议题处置)
- new: .team/decisions/D-020-d-016-final-canonical.md (D-016 升定稿规约)
- new: .team/decisions/D-021-d-017-v3-cross-version-precheck.md (D-017 v3 升级)
- new: .team/decisions/D-022-review-tech-runtime-dimension.md (review-tech 评分表 v2.0)
- update: .team/metrics.json (sprint-1 11 卡补齐 + 106 + sprint_1_summary)
- update: .team/board.md (sprint-2 段开建 + 106 流转 doing)
- update: .team/backlog.json (106 重写 + 5 卡 sprint-2 流转 + 160 占位)
- update: .team/members/pm-writer/state.md (§2/§3/§7)
- new: .team/members/pm-writer/history/2026-05-09-costra-106-sprint-1-retro.md

Refs: COSTRA-106, D-019, D-020, D-021, D-022
```

**不**触及 `miniprogram/` / `server/` / `api/` 任何业务代码（pm-writer 工作区铁律）。

---

## §7 验收（Orchestrator 同轮代收）

| 项 | 通过条件 |
|---|---|
| diff 行数 | 净增 ≥ 1000 行（主报告 + 3 决议 + metrics + board + backlog 5 文件 · 主报告 400+ 行 + 3 决议 × 150 + metrics ~300 行追加 ~ 总 1000+）|
| 文件数 | 8~9 个（4 新建 + 4~5 更新）|
| 0 行为变更（业务代码） | `git diff miniprogram/ server/ api/ design/ infra/ qa/ scripts/ --stat` = 空 |
| pm-writer state.md §6 是否新增 FU | 允许新增 FU-106-* 列入 §6 · 但不入主 FU-README（FU-README 由 Orchestrator 后续刷新）|
| 议题映射完整性 | 14+ 议题在主报告 §6 表格中 100% 映射到 D-020/D-021/D-022 / SOP / engineering-guidelines / Sprint-2 FU · 0 漏项 |
| 三决议生效声明完整 | D-020/D-021/D-022 均含"自 2026-05-09 起生效" + 与既有决议关系陈述 |

---

## §8 时间预算（pm-writer 自评 · ≤ 60 min）

| 阶段 | 预估 |
|---|---|
| 读 §10 强制阅读清单 | 10 min |
| 主报告 A 撰写（400~600 行）| 25 min |
| 3 决议 B/C/D 撰写（各 100~200 行 · 类似结构可平行）| 15 min |
| metrics.json 11 卡补齐（参照 115/116 字段套模板）| 8 min |
| board.md + backlog.json 流转 + state.md/history 收尾 | 5 min |
| 自跑闸门 + commit + 自检 | 5 min |
| **合计** | **≤ 68 min**（可超 60 8 min · 议题 14+ 体量超原 1 点估）|

若超 90 min 仍未完工 · 立即 BLOCKED + 冒泡 Human · 不擅自压缩 §2 范围。

---

## §9 硬约束（不可违反）

1. **0 行业务代码**：grep `git diff --name-only` 输出不得含 `miniprogram/` / `server/` / `api/` / `design/` / `infra/` / `qa/` / `scripts/` 任何文件路径
2. **0 行决议改写**：D-001~D-019 既有决议**禁止修改** · 仅新建 D-020/D-021/D-022
3. **0 行 PRD 改写**：`docs/PRD.md` 不动（议题不涉及需求变更）
4. **0 行 libversion-upgrade.md 改写**：v5 唯一定稿已锁 · COSTRA-128 已收尾
5. **议题完整性**：14+ 议题清单**不得删减** · 来源 = HANDOFF.md §6.1 + board.md §3 议题段 + 各 FINAL.md 残余议题段
6. **三证铁律（D-017 v3）**：写决议立案背景前 · 必须 `git ls-files` + `git log --oneline -50` + `git show HEAD:` 三证齐跑 · 禁止凭"记忆"写实战次数与时间戳
7. **D-016 同轮兑现**：本卡产出 + state.md 收尾 + history 落盘 + commit 必须同 tool call 循环兑现 · 禁止跨轮异步
8. **Subject 全小写**：commit subject 首字母 + 卡号全小写 · `COSTRA-106` 仅 footer Refs 段大写

---

## §10 强制阅读清单（pm-writer spawn prompt §G 注入）

### 必读（按顺序）

1. **`.team/decisions/D-019-g4-sprint-1-closure.md`** — G4 决议 + Sprint-2 立卡锚点（本卡的直接上游）
2. **`.team/HANDOFF.md`** — §1.4 当前状态 + §6.1 14+ 议题清单
3. **`.team/board.md`** — Sprint-1 14 卡 Done 段 + 闸门状态 + Orchestrator 状态
4. **`.team/follow-ups/README.md`** — FU 队列完整索引
5. **`.team/decisions/D-016-same-turn-review-autoloop.md`** — D-020 升定稿前置
6. **`.team/decisions/D-017-verification-problem-response-sop.md`** — D-021 v3 升级前置
7. **`.team/decisions/D-013-review-scenario-tiering.md`** — D-022 SOP 整合前置
8. **`.team/SOP-REVIEW.md`** — D-022 SOP 整合前置
9. **5 张 FINAL.md**（102/124/125/126/127/128 · 含 SOP 偏差合规说明）
10. **`docs/devops/libversion-upgrade.md` §3.4** — v5 定稿 + 反模式 #4/#5/#6（FU-LAUNCH 治理范式归档源）

### 强制 git 三证（D-017 v3）

```
git log --oneline -50
git ls-files .team/decisions
git show HEAD:.team/HANDOFF.md | head -50
```

### 按需读

- `.team/members/{role}/state.md` × 6（议题 16 SBAI v1.1 两档差异化复盘需要）
- `.team/reviews/COSTRA-{121/124/127}/round-*-tech.md`（议题 11/17 纸面审漏检证据）
- `.team/decisions/D-018-spawn-based-agent-isolation.md`（议题 15/16 SBAI 沉淀前置）

---

## §11 dispatch 元数据

- 立卡发起：Human · 2026-05-09 10:09（`run pm COSTRA-106`）
- 立卡裁决：Orchestrator · 2026-05-09 10:09（5 Q 拍板 · Q1-a/Q2-c/Q3-a/Q4-a/Q5-b）
- 派单 Orchestrator commit：本轮（D-019 + dispatch + card-review 同轮）
- pm-writer spawn 时间：等 card-review-product PASS 后立刻
- 预期 R1 完工：spawn + ≤ 60 min 内
- 预期 R1 review-product：D-014-b 自动拉起
- 预期 Human T2 终审：spawn 后约 1.5~2 h 内（含 Human 排队）

---

**本 dispatch 由 Orchestrator 立卡瞬间落盘 · pm-writer spawn 时由 Orchestrator 注入 §A~§H 八段 Context**（D-018 §3.3）· 其中本文件作为 §F 任务定义 + §G 强制阅读清单的一部分 inline。
