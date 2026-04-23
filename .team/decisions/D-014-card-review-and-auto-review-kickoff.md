# D-014 · 卡定义 Review + Review 自动拉起（Card-Def Review & Auto Review Kickoff）

- **状态**：Accepted
- **决策日期**：2026-04-23 22:26
- **决策人**：Human（"新增两个项目规约：…卡的内容也需要 review…Agent 完成后自动交由 review-agent 来 review，不需要我触发" · "go"）
- **落地人**：Orchestrator
- **优先级**：🟠 P1 · 规约升级（局部豁免 SOP-HUMAN-TRIGGER 铁律，新增环节自动拉起）
- **影响范围**：Orchestrator 调度、Review-Agent-Tech / Review-Agent-Product、卡生成流程（PM/Tech-Lead 产出）、Human 触发频次
- **关联决策**：D-011（方案 B 环内自动）、D-012（单卡交付即提交）、D-013（Review 场景分级）
- **关联 SOP**：`SOP-REVIEW-LOOP.md` v1.2 → v1.3、`SOP-HUMAN-TRIGGER.md`（例外条款追加）、`SOP-CARD-REVIEW.md`（新建）、`SOP-REVIEW-AUTOLOOP.md`（不改）

---

## 1. 背景与问题观察

### 1.1 问题 A · "卡的内容"本身从未被审

现行 Review 体系只审 **Agent 的产出**（代码 / 文档 / 配置），不审 **卡定义本身**（标题 / 描述 / 验收标准 / 依赖 / 边界）。后果：

- 垃圾卡进入 Doing 后才被发现（"这卡到底要做啥？DoD 在哪？"）
- 依赖识别错误导致下游卡连环返工
- "做个东西"类模糊描述让 Agent 自由发挥，产出偏离预期
- PM/Tech-Lead 写卡时的隐性假设从未被挑战

### 1.2 问题 B · Review 启动还要 Human 手动触发

D-011 方案 B 把"Review 闭环内 Revise↔Review"的自动推进做了。但**闭环启动的第一步**（被审 Agent 首次产出 → Review-Agent 启动）仍要 Human 一句 `run review-tech COSTRA-xxx`。

实测 Sprint-0 补审 7 张、COSTRA-100 共 8 次 Review 启动 = 8 次 Human 打扰。D-013 把"Review 通过后的 Human 终审"在 T3/T4 场景免掉了，但"Review 启动"这环仍然是 Human 瓶颈。

### 1.3 根因

| 环节 | D-011 前 | D-011 后 | D-013 后 | D-014 本次 |
|---|---|---|---|---|
| 被审 Agent 首次开干 | Human 触发 | Human 触发 | Human 触发 | **Human 触发（不变）** |
| 被审 Agent 交付 → Review 启动 | Human 触发 | Human 触发 | Human 触发 | 🆕 **自动拉起** |
| Review Round N → Revise Round N | Human 触发 | 🆕 自动 | 自动 | 自动 |
| Revise → Review Round N+1 | Human 触发 | 🆕 自动 | 自动 | 自动 |
| Review PASS → Human 终审（T1/T2） | Human 介入 | Human 介入 | Human 介入 | **Human 介入（不变）** |
| Review PASS → 自动关闭（T3/T4） | — | — | 🆕 自动 | 自动 |
| **卡定义本身是否被审** | ❌ 从未 | ❌ 从未 | ❌ 从未 | 🆕 **自动审** |

D-014 补齐两个空白：**卡定义 Review 从无 → 有** + **Review 启动从手动 → 自动**。

---

## 2. 决策

### 2.1 规约 A · 卡定义 Review（Card-Def Review）

**所有新创建的卡**在进入 `Todo` 之前，**必须**先经过一次**卡定义 Review**（由 Review-Agent 按卡的技术/产品属性分流执行）。

#### 分流规则

| 卡类型 | 判定特征 | 归属 Review-Agent |
|---|---|---|
| 技术向卡 | Owner ∈ {Backend, MiniApp, DevOps, QA}；产物是代码/脚本/配置/CI | **Review-Tech** |
| 产品向卡 | Owner ∈ {PM, Design}；产物是 PRD/文档/视觉稿/用户流程 | **Review-Product** |
| 混合卡 | 跨域产出（如 COSTRA-107 ICP 备案 = PM + DevOps 配合） | **主 Owner 所在归属**（上例归 Review-Product） |

**禁止**同时派两个 Review-Agent 审同一张卡定义（保持单一归属，避免双头管理）。

#### 审什么（checklist · 详见 `SOP-CARD-REVIEW.md`）

- C1 标题/描述是否清晰、无歧义
- C2 验收标准是否可度量（DoD 明确、可自动化判定最佳）
- C3 依赖是否识别（阻塞关系 / 被阻塞关系 / 数据依赖）
- C4 产出物是否具体（文件路径、函数签名、接口、页面等实体，不是"做个东西"）
- C5 风险/边界条件是否标注（失败路径、降级方案、性能/安全边界）
- C6 是否与已有卡重复/冲突（查 `backlog.json` + board.md）
- C7 估点是否合理（对照已完工卡的历史数据）
- C8 是否触碰红线（Won't-Have 清单、主体字样、硬编码 secret 等）

#### Verdict

- `PASS` — 卡定义合格，可进 Todo
- `PASS-WITH-FOLLOWUP` — 合格但有小瑕疵，卡主改进后可进 Todo（不强制再审）
- `REVISE` — 有 P0/P1 问题，卡主必须改，改完再审
- `REJECT` — 卡定义根本性缺陷（违反宪章 / 红线）→ 不允许进 Todo，冒泡 Human
- `ESCALATE` — 卡定义涉及决策分歧 → 冒泡 Human

#### 产物路径

```
.team/reviews/COSTRA-XXX/
├── card-review-round-1-{tech|product}.md    # 卡定义 Review 第 1 轮报告
├── card-review-round-1-response.md          # 卡主修订回应（如果 REVISE）
├── card-review-round-2-{tech|product}.md    # 第 2 轮（如有）
├── ...
├── card-review-FINAL.md                     # 卡定义 Review 最终结论
│
├── round-1-{tech|product}.md                # 产出 Review 第 1 轮（既有规约，不变）
├── ...
└── FINAL.md                                 # 产出 Review 最终结论（既有规约，不变）
```

**命名空间隔离**：卡定义 Review 用 `card-review-*` 前缀；产出 Review 保持现有 `round-*` / `FINAL.md` 命名，两者互不污染。

#### 触发时机（与 Q1 对应，方案 A1）

卡**一创建就自动审**。具体触发点：

- PM-Agent / Tech-Lead 在 `backlog.json` 新增卡条目 → Orchestrator 识别 → 自动拉起 Review-Agent
- Sprint Planning 阶段批量创建的卡 → 逐一入队、并行 Review（不必串行）
- Human 直接命令 "新增一张卡 COSTRA-xxx" → 卡落盘后立即自动拉 Review

#### 历史卡处置（与 Q2 对应，方案 Q2-a）

- **只对 D-014 立案后（2026-04-23 22:26）新建的卡生效**
- 历史卡（COSTRA-001 ~ 现存全部）**豁免**卡定义 Review
- 豁免依据：与 D-013 T3 追溯哲学一致（历史已走过 Human 审批流程、已入执行状态，补审无增量价值）
- Human 若需对某张历史卡做卡定义 Review，手动发 `review-card COSTRA-xxx` 即可（见 §4 触发指令）

---

### 2.2 规约 B · Review 自动拉起（Auto Review Kickoff）

**被审 Agent 交付完成后，Orchestrator 必须自动拉起对应 Review-Agent 启动首轮 Review**，无需 Human 触发。

#### 自动拉起覆盖范围

| 自动拉起场景 | 触发条件 | 归属 | 在本规约前 |
|---|---|---|---|
| 产出 Review 首轮 | 被审 Agent 发 `status_report` 且 task 进入 `AI-Review` 列 | D-014-b | Human 需发 `run review-tech COSTRA-xxx` |
| 卡定义 Review 首轮 | 卡落盘至 `backlog.json` | D-014-a | 无此环节 |
| Review→Revise 环内循环 | D-011 方案 B 既有规则 | D-011 | 无需 Human（已豁免） |

#### 不自动拉起的场景（Human 仍需触发，铁律不变）

| 环节 | 是否需 Human 触发 | 说明 |
|---|---|---|
| 被审 Agent 首次开干（`run backend COSTRA-xxx`） | ✅ **必须** | SOP-HUMAN-TRIGGER §2 铁律 |
| Human-Review approve（T1/T2） | ✅ **必须** | D-013 保留铁律 |
| 跨卡编排（Sprint 内排期） | ✅ **必须** | 跨越单卡生命周期的决策 |
| 发布决策 / Gate 放行（G1~G5） | ✅ **必须** | 决策类，不走 Review-Agent |
| 红线处置（冒泡 Human） | ✅ **必须** | 已触发红线必须 Human 介入 |
| DevOps / QA 产出 | ✅ **必须** | SOP-REVIEW-LOOP §2 规则保持，Human 直审 |
| 决策类文档（D-xxx / ADR） | ✅ **必须** | 决策类不走 Review-Agent |

#### Human 打断机制（与 Q3 对应，方案 Q3-b）

自动拉起前**不**设置冷却窗口（不拖节奏），Human 可随时用以下指令打断：

| Human 指令 | 效果 | 优先级 |
|---|---|---|
| `pause-review COSTRA-xxx` | 立即停止该卡的 Review（含卡定义 + 产出两种），冒泡 Human | 🔴 最高 |
| `skip-review COSTRA-xxx` | 跳过 Review-Agent 直推 Human 终审 | 🔴 最高 |
| `force-pass COSTRA-xxx` | Human 强制通过（覆盖 Review-Agent 意见） | 🔴 最高 |
| `stop` | 全局停止所有 Review 活动 | 🔴 最高 |

打断指令与 D-011 方案 B 已有的机制完全一致、复用语义，不新增冲突。

---

## 3. 新增触发指令（合入 SOP-HUMAN-TRIGGER §3）

| 用户说 | Orchestrator 行为 | 说明 |
|---|---|---|
| 🆕 `review-card COSTRA-xxx` | 强制对某卡做一次卡定义 Review | 适用于历史卡人工补审 |
| 🆕 `skip-card-review COSTRA-xxx` | 跳过卡定义 Review，直接进 Todo（需标注原因） | 记 daily |
| 🆕 `force-card-pass COSTRA-xxx` | Human 强制通过卡定义 Review（覆盖 Review-Agent） | 慎用 |

原有 `run review-tech/product` 系列指令**保留**，用途转为"对已在 AI-Review 列的卡强制重跑"（常规场景已由自动拉起覆盖）。

---

## 4. Orchestrator 调度变更

### 4.1 卡创建 → 卡定义 Review 自动流

```text
PM/Tech-Lead/Human 创建卡 → 落盘到 backlog.json
   │
   ▼
Orchestrator 监听到新卡 → 按 Owner 分流
   │
   ├─ 技术向 ─► 自动拉 Review-Tech → 产出 card-review-round-1-tech.md
   │
   └─ 产品向 ─► 自动拉 Review-Product → 产出 card-review-round-1-product.md
   │
   ▼
Verdict 分支：
   ├─ PASS / PASS-WITH-FOLLOWUP → 卡进 Todo，正常排期
   ├─ REVISE → 通知卡主修订，修订后自动再审（D-011 环内逻辑复用）
   ├─ REJECT → 冒泡 Human，卡挂起到 `Blocked`
   └─ ESCALATE → 冒泡 Human
```

### 4.2 产出交付 → 产出 Review 自动流

```text
被审 Agent 发 status_report（任务进入 AI-Review 列）
   │
   ▼
Orchestrator 自动识别归属（SOP-REVIEW-LOOP §2 矩阵）
   │
   └─► 自动拉对应 Review-Agent 启动首轮 Review
        │
        ▼
       既有 SOP-REVIEW-LOOP / SOP-REVIEW-AUTOLOOP 流程照走
```

### 4.3 Orchestrator 的新增 MUST

- **MUST** 在卡落盘 60 秒内启动卡定义 Review（不得拖延）
- **MUST** 在被审 Agent 交付 60 秒内启动产出 Review 首轮
- **MUST** 在进度汇报中列"⏳ 自动 Review 进行中"段，给出可立即打断指令
- **MUST NOT** 自己扮演 Review-Agent（角色隔离铁律保持）
- **MUST NOT** 合并卡定义 Review 与产出 Review 的产物
- **MUST NOT** 在 Human 发 `pause-review` / `stop` 后继续自动拉

---

## 5. 汇报格式补丁（Orchestrator MUST）

每次进度汇报中必须新增一段，明确自动 Review 状态：

```markdown
## ⏳ 自动 Review 进行中（共 N 张 · D-014）

| 卡号 | Review 类型 | Review-Agent | 当前轮次 | 打断指令 |
|---|---|---|---|---|
| COSTRA-xxx | 卡定义 | review-tech | 1/5 | `pause-review COSTRA-xxx` |
| COSTRA-yyy | 产出 | review-product | 2/5 | `pause-review COSTRA-yyy` |
```

**缺失此段 = 违规，记 incident。**

---

## 6. 默认配置（项目级）

| 配置项 | 默认值 | 可覆盖 |
|---|---|---|
| 新卡是否自动审卡定义 | ✅ 开 | 单卡 `skip-card-review` / 全局 Human 发 `disable-card-review`（未实装） |
| Agent 交付后是否自动启动产出 Review | ✅ 开 | 单卡 `skip-review` / 全局 `pause-review-all`（未实装） |
| 历史卡（D-014 前）是否回溯审 | ❌ 关 | 单卡 `review-card` 手动触发 |
| 冷却窗口 | 0 秒 | — |
| Human 打断最高优先级 | 保留 | 铁律 |

---

## 7. 度量（`.team/metrics.json` 新增字段）

### 7.1 卡定义 Review 度量

```json
{
  "card": "COSTRA-xxx",
  "card_review_rounds": 1,
  "card_review_terminal_verdict": "PASS",
  "card_review_p0_caught": 2,
  "card_review_time_cost_minutes": 3,
  "auto_kickoff": true
}
```

### 7.2 自动拉起度量

```json
{
  "card": "COSTRA-xxx",
  "output_review_auto_kickoff": true,
  "human_kickoff_count": 0,
  "pause_review_triggered": false
}
```

### 7.3 每周聚合观察

- 卡定义 Review 的平均拦截 P0 数（过低 → checklist 偏松）
- 自动拉起失败率（过高 → 监听器/识别规则有 bug）
- Human 打断（`pause-review`）率（过高 → 自动规约偏激进）

---

## 8. 与既有 SOP / ADR 的关系

| SOP / ADR | 关系 |
|---|---|
| `SOP-HUMAN-TRIGGER.md` | **局部豁免追加**：在 D-011 Revise↔Review 环内自动之上，增加两条例外——卡定义 Review 自动拉起、产出 Review 首轮自动拉起。其他触发点铁律**完全不变** |
| `SOP-REVIEW-LOOP.md` v1.2 → v1.3 | **§1 约束 7 新增** · **§3 流程补环首自动段** · **§9 触发指令新增 `review-card` / `skip-card-review` / `force-card-pass`** · **§11 关系表加 D-014** · **§12 版本史追加 v1.3** |
| `SOP-CARD-REVIEW.md` | **新建**：卡定义 Review 的完整 SOP（checklist / 产物模板 / 流程） |
| `SOP-REVIEW-AUTOLOOP.md` | **不改**：D-011 豁免环内 Revise↔Review；D-014 豁免环首启动 + 卡定义 Review；D-013 豁免环后 Human 终审（T3/T4）。四者正交叠加 |
| `D-011 方案 B 自动循环` | **互补**：D-011 管环内自动，D-014 管环首自动 |
| `D-012 单卡交付即提交` | **叠加**：D-014 的规约改动按 D-012 §3.5 元治理类 commit 规则提交（本次 commit 即是）|
| `D-013 Review 场景分级` | **正交**：D-013 管 Review 结束后的 Human 终审分档；D-014 管 Review 的启动；互不干扰 |

**自动化链路全景**（D-011 + D-013 + D-014 合体后）：

```
[新卡] ──自动(D-014-a)──► [卡定义 Review] ──自动环内(D-011)──► PASS
                                                                │
                                                                ▼
[Human 触发 run xxx] ──► [Agent 开干] ──► [交付]
                                           │
                                           ▼
                     ──自动(D-014-b)──► [产出 Review 首轮]
                                           │
                                ──自动环内(D-011)──► 若干 Round
                                           │
                                           ▼
                                        [Verdict PASS]
                                           │
                                ──按 D-013 分档──►
                                  ├─ T1/T2 ─► Human 终审（必需）
                                  └─ T3/T4 ─► 自动关闭（§3 四条件）
```

**Human 介入点收敛为 4 处**：启动 run xxx · T1/T2 approve · 跨卡决策 · 红线处置。

---

## 9. 落地动作（与本次 commit 同步完成）

- [x] 创建本文件 `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`
- [x] 创建 `.team/SOP-CARD-REVIEW.md`（卡定义 Review 完整 SOP）
- [x] 更新 `.team/SOP-REVIEW-LOOP.md` v1.2 → v1.3
- [x] 更新 `.team/SOP-HUMAN-TRIGGER.md`（追加例外条款 + 触发指令词典补丁）
- [ ] （下一次 commit）更新 Memory 90067452：把铁律例外从 1 条（D-011）扩到 3 条（+D-014-a 卡定义自动 + D-014-b 产出首轮自动）
- [ ] （下一次 commit）更新 `.team/STATE`、`.team/board.md` 抬头、`.team/daily/2026-04-23.md`

---

## 10. 反例（避免误用）

- ❌ 不允许因为"卡小/简单"就跳过卡定义 Review（对新卡一刀切，豁免必须显式 `skip-card-review` 并记 daily）
- ❌ 不允许自动拉起产出 Review 的同时也自动拉起 Human 终审（T1/T2 的 Human 终审铁律不变）
- ❌ 不允许把 DevOps / QA 的产出也自动拉起 Review-Agent（SOP-REVIEW-LOOP §2 规则保持，仍 Human 直审）
- ❌ 不允许自动拉起时合并两个 Review-Agent（技术向 + 产品向混审）
- ❌ 不允许在 Human 发 `stop` / `pause-review` 后继续任何自动拉起（打断指令最高优先级）

---

## 11. 生效

- **即刻对"D-014 立案后新建的所有卡"生效**（2026-04-23 22:26 之后）
- **即刻对所有 Agent 的产出 Review 生效**（被审 Agent 交付后自动拉起首轮）
- **历史卡豁免**（与 D-013 追溯哲学一致，需要时走 `review-card` 手动触发）
- **与 D-011 / D-013 正交叠加**，四条自动化规约不冲突

---

## 12. 签字

- **Human**：✅ 2026-04-23 22:00 提规约（2 条）· ✅ 22:26 对 Orchestrator 落地方案回复 "go"
- **Orchestrator**：已落盘 · 即刻生效 · Memory 更新在下一个 commit 同步（D-012 合规）

---

## 版本历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 22:26 | Human 指令确立 · Orchestrator 成文落盘 |
