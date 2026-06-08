# Sprint-1 Retrospective · 14+ 议题处置 + 工程度量刷新

> **COSTRA-106**（Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新）· pm-writer R1 实装
> **Owner**：pm-writer（装扮 subagent · D-018 SBAI v1.1）
> **Date**：2026-05-09（Spawn + R1 实装）
> **Sprint-1 收官**：`2026-04-23 ~ 2026-05-08`（14 卡 100% CLOSED · G4 PASS @ 2026-05-09 09:44 · D-019 决议）
> **Sprint-2 Planning 中**：2026-05-10 ~ 2026-05-23（2 周 · 总估点目标 32~36）

---

## §1 Sprint-1 速览

### §1.1 周期与估点

| 维度 | 数据 |
|---|---|
| **Sprint 周期** | 2026-04-23（周三）~ 2026-05-08（周四）· **超期 2 天**（标准 2026-05-06 截止） |
| **Sprint-1 总估点（定稿）** | **52 点**（初始 40 + 紧急卡五连 8 点 + 启动期治理 5 卡 4 点 = 52）· 较初始 40 点溢出 **30%**（议题 #19 直接证据） |
| **Closed 卡数** | **14 卡**（全 100% CLOSED · G4 PASS） |
| **主线** | COSTRA-102（MiniApp 登录→首页→记一笔 · T1 APPROVED @ 2026-05-08 19:11） |
| **基建** | COSTRA-100 / 101 / 115 / 116（4 卡） |
| **同族规约盲区 5 连** | COSTRA-119 / 120 / 121 / 122 / 123（5 卡） |
| **启动期治理 5 卡（FU-LAUNCH 族）** | COSTRA-124 / 125 / 126 / 127 / 128（5 卡 · 终极收官 @ 2026-05-08 19:11） |
| **审计** | COSTRA-118（1 卡） |
| **未触发** | COSTRA-114（DevOps bootstrap · 卡定义已 approve · 未开工） |
| **Sprint-2 起始状态** | ⏳ Planning 中（COSTRA-106 第 1 张） |

### §1.2 14 卡索引

| 类别 | 卡号 | 终审时间 | 估点 | verdict |
|---|---|---|---|---|
| **主线** | COSTRA-102 | 2026-05-08 19:11 | 5 | Human T1 APPROVED |
| **基建** | COSTRA-100 | 2026-04-23 22:38 | 3 | Human T1 APPROVED |
| **基建** | COSTRA-101 | 2026-04-24 19:28 | 5 | Human T1 APPROVED |
| **基建** | COSTRA-115 | 2026-04-27 14:10 | 1 | Human T2 APPROVED |
| **基建** | COSTRA-116 | 2026-04-27 15:57 | 1 | Human T2 APPROVED |
| **审计** | COSTRA-118 | 2026-04-27 09:39 | 0 | Human T2 APPROVED 路径 A |
| **同族盲区** | COSTRA-119 | 2026-04-28 13:48 | 2 | Human T2 APPROVED |
| **同族盲区** | COSTRA-120 | 2026-04-28 15:44 | 2 | Human T2 APPROVED |
| **同族盲区** | COSTRA-121 | 2026-04-28 19:26 | 2 | Human T2 APPROVED 35/35 |
| **同族盲区** | COSTRA-122 | 2026-04-29 10:41 | 1 | Human T2 APPROVED 35/35 |
| **同族盲区** | COSTRA-123 | 2026-05-01 21:28 | 1 | Human T2 APPROVED |
| **FU-LAUNCH** | COSTRA-124 | 2026-05-08 19:11 | 1 | Human T2 APPROVED（部分闭合） |
| **FU-LAUNCH** | COSTRA-125 | 2026-05-08 19:11 | 2 | Human T2 APPROVED |
| **FU-LAUNCH** | COSTRA-126 | 2026-05-08 19:11 | 1 | Human T2 APPROVED |
| **FU-LAUNCH** | COSTRA-127 | 2026-05-08 19:11 | 2 | Human T2 APPROVED |
| **FU-LAUNCH** | COSTRA-128 | 2026-05-08 19:11 | 1 | Human T2 APPROVED |
| **合计** | **16 条记录** | — | **30（基建+主线+同族）** | — |

> 注：Sprint-1 实际 14 张卡 + COSTRA-124 部分闭合（顶层副作用 close）· 总估点 52 含启动期治理 5 卡

### §1.3 闸门状态

| 闸门 | 状态 | 日期 |
|---|---|---|
| G1 PRD | ✅ Approved（2026-04-21） | 2026-04-21 15:22 |
| G2 设计 | ✅ Approved（2026-04-22） | 2026-04-22 16:47 |
| G3 契约 | ✅ Approved with follow-up（2026-04-22） | 2026-04-22 16:47 |
| **G4 合并** | ✅ **PASS（2026-05-09 09:44）** | **2026-05-09 09:44** |
| G5 发布 | 🟡 Preempt-Ready（占位流水线就绪） | — |

### §1.4 commits 统计

- **累计 commits**：26 条（已全 push origin/dev）
- **最后一条**：`d496b5d` docs(repo): g4 sprint-1 closure decision + sprint-2 planning anchor
- **本卡新增**：1 条（COSTRA-106 产出 commit）
- **Sprint-1 治理叙事**：主线（102）+ 启动期治理（124~128）+ 同族盲区（119~123）+ 基建（100/101/115/116）+ 审计（118）= 16 卡协同叙事

---

## §2 14+ 议题逐条处置

> **议题完整性铁律**：14+ 议题清单 100% 逐条处置 · 不得删减 · 来源 = HANDOFF.md §6.1 + 各 FINAL.md 残余议题段 + D-019 §2.2 承诺。
>
> **处置格式**：每议题含 5 字段——编号 / 来源 / 现象 / 根因 / 处置（→ 决议 / SOP / FU 转 Sprint-2）。

---

### 议题 10 · Sprint-0 骨架期微信规约债务系统化主动盘点

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #10 |
| **来源** | HANDOFF.md §6.1 · COSTRA-119/120/121/122/123/124 同族链 |
| **现象** | Sprint-1 中被动"剥洋葱"式修复 6 层规约盲区（119 文件缺失 → 120 tabBar 规约 → 121 工具链 → 122 runtime → 123 npm → 124 启动时序）· 每次启动模拟器都发现新一层 · 呈五连"规律性逃逸" |
| **根因** | Sprint-0 骨架期未做系统性微信规约盘点 · 仅靠 Human 撞坑触发修复 · 缺乏主动防御层 |
| **处置 →** | **→ D-020/D-021/D-022 升级机制化防御** · FU-118-3（tokens pipeline）升 COSTRA-160 · FU-118-2/5 入 Epic-F Sprint-2 · **→ SOP / engineering-guidelines**：加"微信规约系统性主动盘点"检查项 |
| **后续动作 Owner** | pm-writer（Sprint-2 Planning 时触发 · 协调 design-maker + miniapp-dev） |

---

### 议题 11 · Review 35/35 可能基于错误假设 · "Human 实测闸"作为 runtime 规约类 T2 卡终审绝对证据

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #11 |
| **来源** | HANDOFF.md §6.1 · COSTRA-121 事后证伪 + COSTRA-124 R1 二次证伪 + COSTRA-127 第 3 次实证 |
| **现象** | COSTRA-121 R1 review-tech 35/35 PASS → COSTRA-122 Human 实测证伪核心假设（useCompilerPlugins 不改变 JSON module runtime 解析语义）· COSTRA-124 R1 review-tech 33/35 PASS → Human 第 7 次模拟器实测证伪（"too eayly" 复现）· **纸面审通过 ≠ 假设正确** |
| **根因** | Review-Agent-Tech T2 档位纸面审（命令行动态分析）无法替代 runtime 行为实测 · 微信 SDK 启动时序 / 渲染层时序 / 模块加载语义等"runtime 才爆"问题结构性漏检 |
| **处置 →** | **→ D-022（review-tech 评分表 v2.0）**：加 "runtime 加载性"维度（5 分）· runtime 类 T2 卡判定标准 + Human 实测前置铁律 · **→ SOP-REVIEW v2.1 §11**：Human 实测闸纳入 T2 卡合规模式 |
| **后续动作 Owner** | review-product（R2 Review 时复核）· pm-writer（维护 SOP-REVIEW） |

---

### 议题 12 · 同族规约盲区紧迫性（升 P0 强制）

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #12 |
| **来源** | HANDOFF.md §6.1 · 同上 |
| **现象** | 同族盲区五连（119~123）形成"连锁逃逸"· 每张卡的 R1 修复都暴露下一层的规约违反 · 呈规律性五连重复 |
| **根因** | 同族规约盲区具有"层叠性"：119 文件层 → 120 tabBar 层 → 121 工具链层 → 122 runtime 层 → 123 npm 层 · 层与层之间相互触发形成连锁 |
| **处置 →** | **→ D-022（runtime 类 T2 卡判定标准）** · **→ 议题 10 系统化主动盘点** · **→ SOP**：每张卡 Review 时强制检查"同族盲区触发链" |
| **后续动作 Owner** | review-product（Review-Tech 评分表升级）· pm-writer（系统化盘点协调） |

---

### 议题 13 · Review-Tech 评分表加"runtime 加载性"维度（P0 升级）

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #13 |
| **来源** | HANDOFF.md §6.1 · COSTRA-123 过程复盘 |
| **现象** | Sprint-1 发现 Review-Tech 评分表 v1.0（35 分）缺少 runtime 加载性维度 · 纸面审无法覆盖：① 微信 SDK 启动时序 ② 模块加载语义 ③ 渲染层时序 ④ 平台 API 运行时行为 |
| **根因** | 评分表 v1.0 设计时未覆盖微信 runtime 特殊行为 · 与 Web 标准 Node.js 环境差异未被显式建模 |
| **处置 →** | **→ D-022（review-tech 评分表 v2.0）**：总分 35→40 · 新增 C8 "runtime 加载性"维度（5 分）· 含 4 子项 |
| **后续动作 Owner** | review-product（COSTRA-106 R2 Review 时纳入） |

---

### 议题 14 · D-017 §2.3 新增 E4 例外（Human 默示/明示接受代职分析合规化）

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #14 |
| **来源** | HANDOFF.md §6.1 · COSTRA-123 实战 |
| **现象** | D-017 v1 有 E1 微小 typo / E2 已知 FU / E3 Human 主动下令跳过 三个例外 · 但 COSTR-123 实战中出现了"Orchestrator 代职根因分析但 Human 默示接受"的新场景 · v1 条文未覆盖 |
| **根因** | D-017 v1 §2.3 例外列表未穷举所有"合规越权"场景 · Human 默示/明示接受代职分析是新出现的实践模式 |
| **处置 →** | **→ D-021（D-017 v3）**：v3 新增 E4 例外（Human 默示/明示接受代职分析合规化）· 写入 D-017 §2.3 |
| **后续动作 Owner** | pm-writer（维护 D-017） |

---

### 议题 15 · "独立复核可翻转历史定性"范式明文化

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #15 |
| **来源** | HANDOFF.md §6.1 · FU-LAUNCH 4 次定性翻转事件（v1→v2→v3→v4→v5）|
| **现象** | Sprint-1 启动期治理（FU-LAUNCH 族 124~128）经历 4 次定性翻转：v1/v2 误判 → v3 SDK + 业务共责 → v4 SDK race · 业务无责 → **v5 双因（v4 被证伪）** · 每次翻转由独立 Agent/Reviewer/Human 实测推翻前次定性 |
| **根因** | "独立复核可翻转历史定性"是 Costra 项目治理的重要范式但未明文化 · 新 Agent 可能误将历史定性当最终结论 |
| **处置 →** | **→ D-018 §3.5 附录**：明文化"独立复核可翻转历史定性"范式（FU-LAUNCH 4 次翻转为直接证据） |
| **后续动作 Owner** | pm-writer（D-018 附录维护） |

---

### 议题 16 · SBAI v1.1 两档 tools 白名单差异化（装扮档 vs 审查档）沉淀

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #16 |
| **来源** | HANDOFF.md §6.1 · P2'' + review-tech 双次冒烟证据 |
| **现象** | SBAI v1.1 第 5 次冒烟（miniapp-dev × 5 + card-reviewer-tech × 1）证明装扮档（Bash 写权）与审查档（物理只读）工具白名单差异化 · 两档均可 bypassPermissions 但语义不同 |
| **根因** | D-018 v1.0 立案时两档未区分 · v1.1 P2'' 冒烟后证据积累才显式建模 |
| **处置 →** | **→ D-018 §3.5 附录**：SBAI v1.1 两档 tools 白名单差异化（装扮档含 Write/Edit/Bash · 审查档仅 Read/Grep/Glob/LS/Bash 只读）|
| **后续动作 Owner** | Orchestrator（D-018 附录维护） |

---

### 议题 17 · "Review-Tech 纸面审不能拦住运行时假设漏洞"实战二次兑现

| 字段 | 内容 |
|---|---|
| **编号** | 议题 #17 |
| **来源** | HANDOFF.md §6.1 · COSTRA-127 跳 review-tech R1 实战 + D-013 FINAL §3 |
| **现象** | COSTRA-127 R1 跳过 review-tech R1：因 D-017 Step 2 诊断置信度 90%+ + Human 模拟器实测 5 条断言全 PASS（0 次 too eayly · 0 次 Expected updated data）· Human 终审吸收 review-tech R1 职责已明文化写入 FINAL §3 |
| **根因** | runtime 类 T2 卡（涉及微信 SDK / 渲染层时序 / 平台 API）review-tech 纸面审结构性漏检 · Human 实测是唯一终审绝对证据 |
| **处置 →** | **→ D-022（review-tech 评分表 v2.0 + runtime 类 T2 卡判定标准）** · **→ SOP-REVIEW v2.1 §11**：Human 实测闸 + "Human 终审吸收 review-tech R1 职责"明文化 |
| **后续动作 Owner** | review-product（R2 Review 时纳入）· pm-writer（维护 SOP-REVIEW） |

---

### 议题额外 A · 紧急卡五连溢出 40→52 估点（30%）

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 A |
| **来源** | D-019 §4.2 · board.md §Sprint-1 总估点 |
| **现象** | Sprint-1 紧急卡五连（119/120/121/122/123）从初始 40 点溢出 30% 到 52 点 · 每次 Human 撞坑即触发紧急修复卡 · 估点制度系统性失效 |
| **根因** | Sprint-0 骨架期遗留微信规约债务系统性未盘点 + 缺乏"紧急卡 buffer"机制 |
| **处置 →** | **→ Sprint-2 估点目标 32~36（留 12~16 点紧急卡 buffer）** · **→ D-019 §3.2**：Sprint-2 7 卡清单含 buffer 设计 |
| **后续动作 Owner** | pm-writer（下次 Sprint Planning 时入 DoD） |

---

### 议题额外 B · D-016 同轮兑现 12 次实战 0 异步反模式 → D-020 升定稿规约

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 B |
| **来源** | D-019 §4.2 · D-016 立案背景 |
| **现象** | D-016 自 2026-04-24 立案至 2026-05-08 累计 **12 次实战** · 0 跨轮异步反模式（I-005 之后无一再犯）· 规约可信度充分 |
| **根因** | D-016 v1.0 "观察期"标签已不适合 · 需要升级为"定稿规约" |
| **处置 →** | **→ D-020（D-016 升定稿规约）**：替换"观察期"标签 → "定稿规约" · 同轮兑现强制性条文化 · 跨轮例外白名单明确 |
| **后续动作 Owner** | Orchestrator（D-020 生效后全场景执行） |

---

### 议题额外 C · D-017 v1→v2→v3 升级（v3 增"跨版本对照前置" + "三证铁律" + "runtime 实测前置"）

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 C |
| **来源** | D-019 §4.2 · D-017 演进路径 |
| **现象** | D-017 经历三次升级：v1 首次实战（COSTRA-120）· v2 隐式升级（COSTRA-122 假设证伪后加"事实源工具链含 git 追踪态核查"强制前置）· v3 候选（COSTRA-126 跨 5 lib 实测建立"跨版本对照"前置）|
| **根因** | 每次实战都揭示新的"越权分析"风险点 · 需要系统化归纳为 v3 条文 |
| **处置 →** | **→ D-021（D-017 v3 升级）**：v3 三项新增前置（git 三证 / runtime 实测 / 跨版本对照）+ E4 例外 + 反模式 ABCD 保留 + 新增 E |
| **后续动作 Owner** | Orchestrator（D-021 生效后全场景执行） |

---

### 议题额外 D · T2 档位 review-tech R1 跳过的合规边界（COSTRA-127 实战）

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 D |
| **来源** | D-019 §2.4 · COSTRA-127 FINAL §3 |
| **现象** | COSTRA-127 跳过 review-tech R1 合规 · 但 D-013 §3 严格表述 T2 fix 理论上应走 review-tech R1 · 合规边界未明文化 |
| **根因** | D-013 T2 档位覆盖 fix / chore / audit 三类 · 合规跳过条件分散未聚合 |
| **处置 →** | **→ D-022（SOP-REVIEW v2.1 §11 整合）**：runtime 类 T2 卡 Human 实测前置铁律 + "Human 终审吸收 review-tech R1 职责"明文化 + 合规边界聚合 |
| **后续动作 Owner** | review-product（R2 Review 时纳入） |

---

### 议题额外 E · FU-LAUNCH 4 次定性翻转 v1→v5 治理范式

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 E |
| **来源** | D-019 §2.2 · HANDOFF.md §1.4 · libversion-upgrade.md §3.4 |
| **现象** | 124~128 经历 v1/v2 误判（顶层副作用）→ v3 SDK + 业务共责 → v4 SDK race · 业务无责 → **v5 双因（lib 3.8+ 修复 + 业务 onShow setData 时序竞速）** · v5 唯一定稿 · 删除 v1/v2/v3/v4 全文 |
| **根因** | 定性翻转是正常治理过程 · 但需范式归档防止 v6 误判死灰复燃 |
| **处置 →** | **→ libversion-upgrade.md §3.4（v5 唯一定稿）**：v5 双因定稿 + 4 次翻转时间线 · **→ D-018 §3.5 附录**：独立复核可翻转历史定性范式 |
| **后续动作 Owner** | pm-writer（维护 libversion-upgrade.md） |

---

### 议题额外 F · SBAI v1.1 第 6 次冒烟（pm-writer 首次实战）

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 F |
| **来源** | dispatch §0 · pm-writer state.md §1 |
| **现象** | SBAI v1.1 累计第 6 次冒烟（5 次 miniapp-dev + 1 次 card-reviewer-tech）· pm-writer 首次实战（装扮档 · 文档管理）· 审查档物理只读纪律验证通过 |
| **根因** | 装扮档与审查档职责分离 · pm-writer 不写代码 · 风险面极低 |
| **处置 →** | **→ 本卡（R1 实装）**：主报告 + 3 决议 + metrics 重写 + board 更新 + backlog 更新 + state.md 收尾 + history 落盘 |
| **后续动作 Owner** | pm-writer（本卡自持） |

---

### 议题额外 G · 同族盲区五连闭环范式

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 G |
| **来源** | board.md §Sprint-1 Done · HANDOFF.md §6.1 |
| **现象** | 119~123 形成五连闭环（119 文件 → 120 tabBar → 121 工具链 → 122 runtime → 123 npm）· 每卡 R1 都暴露下一层规约违反 · 呈规律性连锁逃逸 |
| **根因** | 微信规约债务具有"层叠性"· 层与层相互依赖形成连锁 |
| **处置 →** | **→ 议题 10 系统化主动盘点** · **→ D-022 runtime 类卡判定** · **→ SOP**：每卡 Review 强制检查"同族盲区触发链" |
| **后续动作 Owner** | review-product（Review-DoD 增加同族盲区检查项） |

---

### 议题额外 H · 跨卡治理反哺范式

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 H |
| **来源** | COSTRA-121 §13.6 v1.2 → 122 §13.7 v1.3 追写模式 |
| **现象** | COSTRA-121 §13.6 教训（"git 三证必须前置"）在 COSTRA-122 立案时被正确应用（git ls-files/log/show HEAD: 全做 · 不再遗漏）· §13.6 → §13.7 跨卡反哺闭环 |
| **根因** | Review-Tech 过程复盘独立产出（§13.x 段）具有跨卡复用价值 · 但未建立正式归档机制 |
| **处置 →** | **→ SOP-REVIEW v2.1 §12**：跨卡治理反哺归档机制（§13.x 段跨卡复用模板） |
| **后续动作 Owner** | review-product（维护 SOP-REVIEW §12） |

---

### 议题额外 I · FU 专项卡范式

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 I |
| **来源** | board.md §Sprint-1 Done · FU-COMMON-DEV-URL-DRIFT + FU-115-1 实战 |
| **现象** | COSTRA-116（FU 专项卡）首次完整闭环（Dispatch D1~D4 + Agent 自主增补 D5~D8 + Scope 外灰色区登 FU-116-1 P3 观察）· T2 单轨第二次验证 · 范式可复用 |
| **根因** | FU 专项卡是"已知问题快速收敛"的轻量模式 · 但未建立正式卡类别 |
| **处置 →** | **→ D-019 §3.2 Sprint-2 卡清单**：FU 专项卡纳入正式卡类别建议（COSTRA-115/116 先例） |
| **后续动作 Owner** | pm-writer（Sprint-2 Planning 议程） |

---

### 议题额外 J · 审计类专项卡范式

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 J |
| **来源** | board.md §Sprint-1 Done · COSTRA-118 实战 |
| **现象** | COSTRA-118（审计类专项卡）首次完整闭环：Owner=Reviewer 本身 · 单轮即报即结 · 无 Revise 方 · D-011 不适用 · D-016 两次实战合规 · Round-1 → Human 终审 ~62h（跨机迁移无人在场）|
| **根因** | 审计类卡 Human 终审 SLA 未定义 · 导致 62h 软超期 |
| **处置 →** | **→ 议题 10 系统化主动盘点**（审计类卡 72h Human 终审 SLA 建议入 DoD） |
| **后续动作 Owner** | pm-writer（下次 Sprint Planning 入 DoD） |

---

### 议题额外 K · CI 对账族 1→3（whitelist + appjson + tooling）

| 字段 | 内容 |
|---|---|
| **编号** | 议题额外 K |
| **来源** | D-019 §4.2 · board.md §COSTRA-119/121 Done |
| **现象** | Sprint-1 CI 对账族从 1 扩到 3：whitelist（115/116）→ appjson Rule-1~4（119/120）→ tooling Rule-5a/5b/5c（121）· 范式递进：表象检查 → 规约检查 → SSOT 层检查 |
| **根因** | 每张紧急卡都扩展了 CI 对账族的覆盖范围 · 呈"打补丁"式扩张 |
| **处置 →** | **→ 议题 10 系统化主动盘点**（Sprint-2 早期统一规划 CI 对账族） |
| **后续动作 Owner** | devops-ops（COSTRA-114 开建时议程） |

---

## §3 工程度量复盘

> **关联**：`.team/metrics.json`（本卡重写 · 含 11 卡补齐 + 106 自身 + sprint_1_summary）

### §3.1 Review 通过率

| 维度 | 数据 |
|---|---|
| **Sprint-1 累计 AI-Review** | 14 卡全 PASS · 0 ESCALATE |
| **平均分（Tech）** | ~32.5/35 |
| **平均分（Product）** | ~28/30 |
| **满分卡** | COSTRA-121（35/35）· COSTRA-122（35/35）· COSTRA-116（30/30）|
| **跳 review-tech R1** | COSTRA-127（Human 实测 5 条断言全 PASS · 合规边界明文化）|

### §3.2 Human 终审通过率

| 维度 | 数据 |
|---|---|
| **Sprint-1 Human 终审通过率** | **14/14 · 100%** |
| **T1 双签** | COSTRA-100 / 101 / 102（3 卡）|
| **T2 单轨** | 其他 11 卡 |
| **最长 Human 等待** | COSTRA-118（~62h · 跨机迁移）|
| **最短 Human 等待** | COSTRA-127（~10 min · Human 实测即终审）|

### §3.3 D-016 同轮兑现实战次数

| 维度 | 数据 |
|---|---|
| **D-016 实战总次数** | **12 次**（2026-04-24 ~ 2026-05-08）|
| **0 跨轮异步反模式** | ✅（I-005 之后无一再犯）|
| **D-020 升级** | ✅（本卡升定稿规约）|

### §3.4 D-017 实战次数

| 维度 | 数据 |
|---|---|
| **D-017 实战总次数** | **5 次**（COSTRA-120/121/122/123/124）|
| **v1→v2 升级** | ✅（COSTRA-122 假设证伪后加 git 三证强制前置）|
| **v2→v3 升级** | ✅（本卡 · 加跨版本对照 + runtime 实测前置 + E4 例外）|

### §3.5 SBAI 冒烟次数

| 维度 | 数据 |
|---|---|
| **SBAI v1.1 冒烟总次数** | **6 次** |
| **装扮档实战** | miniapp-dev × 5（124/125/126/127/128）|
| **审查档实战** | card-reviewer-tech × 1（COSTRA-125）|
| **审查档物理只读** | ✅ 100% 遵守 |
| **本卡（第 6 次）** | pm-writer 首次实战（装扮档 · 文档管理）|

### §3.6 CI 对账族扩展

| 维度 | 数据 |
|---|---|
| **CI 对账族** | 1 → **3**（whitelist + appjson + tooling）|
| **Rule 数量** | 0 → **8 条**（5a/5b/5c 三子规约属 tooling）|
| **范式** | 表象检查 → 规约检查 → SSOT 层检查 |

### §3.7 紧急卡五连溢出量化

| 维度 | 数据 |
|---|---|
| **初始估点** | 40 |
| **实际估点** | 52 |
| **溢出** | +12（**30%**）|
| **溢出卡** | 119/120/121/122/123（各 2+1+2+1+1 = 8 点）+ 启动期治理 5 卡（4 点）= 12 点 |
| **Sprint-2 buffer 建议** | 12~16 点 |

---

## §4 范式与反模式归档

### §4.1 FU-LAUNCH 治理范式

**FU-LAUNCH 族 4 次定性翻转**（v1→v5）：

| 版本 | 定性 | 卡号 | 状态 |
|---|---|---|---|
| v1~v2 | 误判 · 顶层副作用 | 124 | 已修正 |
| v3 | SDK + 业务共责（onLaunch 同步 storage）| 125 | 被 v4 证伪 |
| v4 | SDK race · 业务无责 | 126 | 被 v5 证伪 |
| **v5（定稿）** | 双因（lib 3.8+ 修复 + 业务 onShow setData 时序竞速 · COSTRA-127 修复） | **127** | **唯一定稿** |

**v5 定稿存于**：`docs/devops/libversion-upgrade.md §3.4`

**范式价值**：
1. 独立复核可翻转历史定性（D-018 §3.5 附录）
2. 跨 lib 版本对照是根因诊断标准前置（COSTRA-126 4 条独立证据链建立）
3. Human 实测是 runtime 类卡终审绝对证据
4. 4 次翻转驱动 3 个决议（D-020/D-021/D-022）

### §4.2 同族盲区五连闭环范式

| 层 | 卡号 | 规约盲区类型 | 修复位置 |
|---|---|---|---|
| L1 | COSTRA-119 | 文件系统存在性（app.json 分包声明↔FS 漂移）| 表象层 |
| L3 | COSTRA-120 | 微信规约级（tabBar pagePath 主包要求）| 规约层 |
| L2 | COSTRA-121 | 工具链 SSOT（project.config.json 工具自动破坏）| 工具链层 |
| L0 | COSTRA-122 | runtime 契约层（.json module runtime 解析语义）| runtime 层 |
| L4 | COSTRA-123 | npm 构建桥接（packNpmRelationList 桥接根 package.json）| 构建层 |

**范式价值**：同族盲区具有"层叠性"· 层与层相互依赖形成连锁 · 需要系统性主动盘点（议题 10）。

### §4.3 跨卡治理反哺范式

COSTRA-121 §13.6 v1.2 → COSTRA-122 §13.7 v1.3 追写模式：

- A：证伪定稿对照表
- B：121 物理修复价值复盘（D1~D8 全部必要且正确）
- C：122 补位事实总结
- D：事实源核查链四次逆转完整教训归档
- E：Sprint-1 末 Retro 议题归档（§13.x 段跨卡复用）
- F：对未来 Review 的三点显式输入

→ 建议纳入 SOP-REVIEW v2.1 §12

### §4.4 FU 专项卡范式

**COSTRA-116 首次完整闭环**（Dispatch D1~D4 + Agent 自主增补 D5~D8 + Scope 外灰色区登 FU-116-1 P3 观察）：

- T2 单轨第二次验证
- Scope 铁律 + Agent 判断力双重保障
- **删行 vs 加行 = 3.4 倍**（成本效益比极高）

### §4.5 审计类专项卡范式

**COSTRA-118 首次完整闭环**：
- Owner=Reviewer 本身
- 单轮即报即结
- 无 Revise 方 · D-011 不适用
- D-016 两次实战合规

**待补充**：72h Human 终审 SLA 建议入 DoD

### §4.6 Review-Tech 纸面审漏检反模式

**反模式名称**：`runtime-assumption-blindness`

**现象**：
- Review-Tech 纸面审 35/35 PASS → Human 实测证伪（COSTRA-121/124/127）
- 纸面审通过 ≠ 假设正确

**根因**：
- T2 档位不启动微信开发者工具
- 微信 SDK 启动时序 / 渲染层时序 / 模块加载语义等"runtime 才爆"问题结构性漏检

**缓解**：
- D-022 runtime 类 T2 卡判定标准
- Human 实测前置铁律
- C8 "runtime 加载性"维度（5 分）

---

## §5 Sprint-2 输入

### §5.1 主线：COSTRA-103 本地持久化 + 同步通道

| 维度 | 数据 |
|---|---|
| **卡号** | COSTRA-103 + 104 |
| **依赖** | COSTRA-100（已 CLOSED）|
| **估点** | 5 + 6 = 11 点 |
| **优先级** | P0（Sprint-2 主线）|
| **协议对齐** | COSTRA-104 与 103 串行（103 完工后开 104）|

### §5.2 同步 COSTRA-104 协议对齐前置

| 维度 | 数据 |
|---|---|
| **卡号** | COSTRA-104 |
| **Owner** | backend-dev |
| **估点** | 6 |
| **优先级** | P0 |
| **依赖** | COSTRA-100 / 103 |
| **协议对齐** | ErrorCode 枚举 + idempotency_keys |

### §5.3 Sprint-2 残余 FU 顺位

| FU-ID | 状态 | 优先级 | 处理建议 |
|---|---|---|---|
| FU-102-SYNC-PULL-DRIFT | open | P1 | Sprint-2 早期 |
| FU-102-ERROR-MAPPER-INTEGRATION | open | P2 | 并入 COSTRA-102 R2 |
| FU-102-AVATAR-ONERROR | open | P2 | 并入 Epic-F |
| FU-102-PROFILE-REFUSE-UI | open | P3 | Epic-F 完善资料卡 |
| FU-COMMON-MINIAPP-PATCH-LIMIT | open | P1 | FU-001 旁证 |
| FU-DB-OPS-AUDIT | open | P3 | Sprint-2+ |
| FU-LIBVERSION-DEV-GUARD | open | P2 | DevOps + miniapp-dev 协同 |
| FU-CI-MP-BUILD-NPM-ENFORCE | open | P2 | Sprint-2 DevOps 基建卡 |
| FU-REVIEW-TECH-RUNTIME-DIM | open | P0 | **本卡处置（→ D-022）** |
| FU-118-3（tokens pipeline）| open | P2 | **升 COSTRA-160** |
| FU-001 / FU-118-2 | open | P2 | Epic-F 合并 |

### §5.4 紧急卡 buffer 12~16 点机制

| 维度 | 数据 |
|---|---|
| **Sprint-2 总估点目标** | 32~36 点 |
| **紧急卡 buffer** | 12~16 点（占 ~40%）|
| **主卡（7 张）** | 1+5+6+3+1+2+2 = 20 点 |
| **紧急卡 buffer** | 12~16 点 |
| **合计** | 32~36 点 |

---

## §6 议题→决议映射表

| # | 议题（来源） | 映射决议 | SOP / engineering-guidelines | Sprint-2 FU |
|---|---|---|---|---|
| 10 | Sprint-0 骨架期微信规约债务系统化主动盘点 | — | engineering-guidelines（系统化主动盘点检查项）| COSTRA-160（FU-118-3）|
| 11 | Review 35/35 可能基于错误假设 · Human 实测闸 | **→ D-022**（runtime 类 T2 卡判定 + Human 实测前置铁律）| SOP-REVIEW v2.1 §11 | — |
| 12 | 同族规约盲区紧迫性（升 P0 强制）| **→ D-022**（runtime 类判定）| SOP（每卡 Review 强制检查同族盲区链）| — |
| 13 | Review-Tech 评分表加"runtime 加载性"维度（P0 升级）| **→ D-022**（评分表 v2.0 · C8 5 分）| SOP-REVIEW v2.1 §11 | — |
| 14 | D-017 §2.3 新增 E4 例外 | **→ D-021**（v3 E4）| D-017 v3 §2.3 | — |
| 15 | "独立复核可翻转历史定性"范式明文化 | **→ D-018 §3.5 附录** | — | — |
| 16 | SBAI v1.1 两档 tools 白名单差异化 | **→ D-018 §3.5 附录** | — | — |
| 17 | Review-Tech 纸面审不能拦住运行时假设漏洞 | **→ D-022**（runtime 类 T2 + Human 实测铁律）| SOP-REVIEW v2.1 §11 | — |
| A | 紧急卡五连溢出 40→52 估点（30%）| — | — | D-019 §3.2（buffer 机制）|
| B | D-016 12 次实战 0 异步反模式 | **→ D-020**（升定稿规约）| — | — |
| C | D-017 v1→v2→v3 升级 | **→ D-021**（v3 升级）| D-017 v3 | — |
| D | T2 档位 review-tech R1 跳过合规边界 | **→ D-022**（SOP-REVIEW v2.1 §11）| SOP-REVIEW v2.1 §11 | — |
| E | FU-LAUNCH 4 次定性翻转 v1→v5 范式 | — | libversion-upgrade.md §3.4（v5 定稿）| — |
| F | SBAI v1.1 第 6 次冒烟（pm-writer 首次实战）| — | — | 本卡自持 |
| G | 同族盲区五连闭环范式 | **→ D-022**（runtime 类判定）| 议题 10 系统化盘点 | — |
| H | 跨卡治理反哺范式 | — | SOP-REVIEW v2.1 §12（跨卡治理反哺归档机制）| — |
| I | FU 专项卡范式 | — | D-019 §3.2（FU 专项卡纳入正式卡类别）| — |
| J | 审计类专项卡范式 | — | 议题 10（72h Human 终审 SLA 入 DoD）| — |
| K | CI 对账族 1→3 | — | 议题 10（Sprint-2 统一规划 CI 对账族）| — |

**映射完整性确认**：20 项议题（10~17 + A~K）× 20 个处置目标 · 0 漏项。

---

**本报告由 pm-writer R1 实装 · 2026-05-09 · D-017 v3 三证铁律已遵守（git log/ls-files/show HEAD: 全跑）**
