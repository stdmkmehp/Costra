# SOP · 卡定义 Review（Card-Definition Review）

> 登记时间：2026-04-23 22:26
> 登记人：Human（规约 A · D-014）
> 适用范围：Orchestrator、Review-Agent-Tech、Review-Agent-Product、所有卡创建者（PM-Agent / Tech-Lead / Human）
> 优先级：**P0 · 铁律** · 与 SOP-REVIEW / SOP-HUMAN-TRIGGER 并列
> 依据：`.team/decisions/D-014-card-review-and-auto-review-kickoff.md`

---

## 1. 目标

> **SBAI v1.0 对齐**（2026-05-02 · D-018）：术语 "Review-Agent" → "card-reviewer-{tech|product}-{card}-r{N} 审查 subagent"（一次性装扮 · 每轮新实例 · 无写权 · Context Injection Contract 约束 · 详见 `.team/decisions/D-018-spawn-based-agent-isolation.md §3`）。流程与 checklist 本体不变。

在卡**进入执行（Todo → Doing）之前**，由 card-reviewer 审查 subagent 对卡定义本身做一次质量把关，确保：

- 卡描述清晰、可执行
- DoD 可度量、可验收
- 依赖识别完整
- 产出物具体不模糊
- 无违反宪章 / Won't-Have / 红线
- 估点合理

**与产出 Review 的分工**：

| 维度 | 卡定义 Review（本 SOP） | 产出 Review（SOP-REVIEW.md） |
|---|---|---|
| 审对象 | 卡本身（标题/描述/DoD/依赖） | Agent 产出（代码/文档/配置） |
| 时机 | 卡创建后，进 Todo 之前 | Agent 交付后，进 Human-Review 之前 |
| 产物命名空间 | `card-review-*` | `round-*`（既有不变） |
| 轮次上限 | 3 轮（比产出 Review 紧） | 5 轮 |
| Verdict 分级 | 同 SOP-REVIEW.md | 同 SOP-REVIEW.md |

---

## 2. 分流规则（MUST）

| 卡类型 | 判定特征 | 归属 Review-Agent |
|---|---|---|
| 技术向卡 | Owner ∈ {Backend-Agent, MiniApp-Agent, DevOps-Agent, QA-Agent}；主产物是代码/脚本/配置/CI/基建 | **Review-Tech** |
| 产品向卡 | Owner ∈ {PM-Agent, Design-Agent}；主产物是 PRD/文档/视觉稿/用户流程/运营材料 | **Review-Product** |
| 混合卡 | 跨域产出（例：COSTRA-107 ICP 备案 = PM 主导 + DevOps 配合） | 按**主 Owner**归属，单侧审 |
| 决策类 | `.team/decisions/D-xxx.md` / ADR | **不走卡定义 Review**（Human 直接决策） |
| Human 直发卡 | Human 命令"新增一张 COSTRA-xxx" 且明确免审 | 按 `skip-card-review` 处理 |

**铁律**：禁止同时派两个 Review-Agent 审同一张卡定义（单一归属，避免双头）。

---

## 3. Checklist（Review-Agent MUST 逐项打分）

### C1 · 标题与描述清晰度（5 分）

- [ ] 标题简洁无歧义（长度 ≤ 60 字符，无"做个 xxx"类模糊动词）
- [ ] 描述包含背景 / 目标 / 范围三要素
- [ ] 术语与宪章 / 既有卡一致（不新造概念，除非明确立项）

**评分**：5 满分 / 3 合格 / < 3 REVISE

### C2 · 验收标准（DoD）可度量（6 分）

- [ ] 明确列出 ≥ 1 条可自动化判定的标准（如 "接口返回 200" / "文件 A 存在 + 内容包含 X"）
- [ ] 或列出 ≥ 2 条可人工验收的具体标准（如 "屏幕截图 + 字段对照表"）
- [ ] 无"完成 xxx" / "实现 xxx" 类空洞描述

**评分**：6 满分 / 4 合格 / < 4 REVISE

### C3 · 依赖识别（5 分）

- [ ] 明确列出**上游依赖卡**（阻塞本卡的前置工作）
- [ ] 明确列出**下游受阻卡**（如本卡延期会影响谁）
- [ ] 数据 / 接口 / 决策类依赖显式写明（如 "依赖 D-009 域名锁定"）

**评分**：5 满分 / 3 合格 / < 3 REVISE

### C4 · 产出物具体（5 分）

- [ ] 列出具体的文件路径 / 函数签名 / 接口 URL / 页面路径
- [ ] 避免"做个组件" / "写个文档" 类模糊措辞
- [ ] 若是配置类，列出配置 key 与生效范围

**评分**：5 满分 / 3 合格 / < 3 REVISE

### C5 · 风险与边界（4 分）

- [ ] 标注失败路径处理（降级 / 重试 / 回滚）
- [ ] 标注性能 / 安全 / 合规边界（如"登录态 TTL ≤ 7 天"）
- [ ] 已知的未知项（Unknown）是否暴露（"待 D-008 决策后确定"）

**评分**：4 满分 / 2 合格 / < 2 REVISE

### C6 · 与既有卡去重（3 分）

- [ ] 查 `.team/backlog.json` 无重复
- [ ] 查 `.team/board.md` 无覆盖 / 冲突
- [ ] 查最近 3 天 daily 无相似描述

**评分**：3 满分 / 2 合格 / 0 REVISE

### C7 · 估点合理性（2 分）

- [ ] 对照类似历史卡的耗时
- [ ] 估点落在项目既定区间（1~8 点）
- [ ] 不是显著低估（< 1 点）或高估（> 8 点需拆分）

**评分**：2 满分 / 1 合格 / 0 REVISE

### C8 · 红线检查（否决项）

以下任一命中 **→ REJECT**：

- [ ] 违反 Won't-Have 清单（如涉及支付组件）
- [ ] 包含硬编码 secret / 密钥 / 账号
- [ ] 产出包含主体字样硬编码（D-008）
- [ ] 目录越权（如 PM 卡要改 `server/` 代码）
- [ ] 违反 engineering-guidelines 的强硬规则

---

**总分**：30 分（C1-C7 满分 + C8 否决）· 与产出 Review 评分标准对齐。

**Verdict 阈值**：

- ≥ 27 → `PASS`
- 24~26 → `PASS-WITH-FOLLOWUP`（小瑕疵列 follow-up，不强制再审）
- 18~23 → `REVISE`（P0/P1 问题，必须改）
- < 18 → `REJECT`（根本性缺陷，冒泡 Human）
- C8 任一命中 → `REJECT` 不论总分

---

## 4. 流程（MUST）

```text
[卡创建] → 落盘到 backlog.json（或 board.md Todo 预备区）
   │
   ▼（Orchestrator 60 秒内监听到）
[分流识别] → 按 Owner 判断技术向 / 产品向
   │
   ▼
[自动拉起 Review-Agent · D-014 规约 B]
   │
   ▼
[Review-Agent 产出 card-review-round-1-{tech|product}.md]
   │
   ▼
Verdict 分支：
   ├─ PASS / PASS-WITH-FOLLOWUP → 卡进 Todo（PASS-WITH-FOLLOWUP 需卡主确认 follow-up）
   ├─ REVISE → 通知卡主修订 → 修订后自动再审（D-011 环内逻辑复用）
   ├─ REJECT → 卡挂 Blocked + 冒泡 Human（incident 归档）
   └─ ESCALATE → 冒泡 Human
   │
   ▼
[修订闭环]
   被审卡主产 card-review-round-N-response.md → 自动拉下一轮
   │
   ▼
[停止条件]
   · PASS / PASS-WITH-FOLLOWUP → 写 card-review-FINAL.md，卡进 Todo
   · round == 3（硬上限）→ 冒泡 Human
   · 触发红线 → 立即停 + 冒泡
   · Human 发 pause-review / skip-card-review / force-card-pass → 立即停
```

---

## 5. 产物目录结构

```
.team/reviews/COSTRA-XXX/
├── card-review-round-1-tech.md           # 第 1 轮 Review-Tech 报告（或 product）
├── card-review-round-1-response.md       # 第 1 轮卡主修订回应（若 REVISE）
├── card-review-round-2-tech.md           # 第 2 轮（如有）
├── card-review-round-2-response.md
├── card-review-round-3-tech.md           # 第 3 轮（封顶）
├── card-review-FINAL.md                  # 卡定义 Review 最终结论
│
├── round-1-tech.md                       # 产出 Review 第 1 轮（既有规约）
├── ...
└── FINAL.md                              # 产出 Review 最终结论（既有规约）
```

**`card-review-FINAL.md` 模板**：

```markdown
# COSTRA-XXX 卡定义 Review · 最终结论

- 终止时间：YYYY-MM-DD HH:MM
- 终止原因：PASS | PASS-WITH-FOLLOWUP | REJECT | ROUND-LIMIT | RED-LINE | HUMAN-OVERRIDE
- 总轮次：N/3
- 最后一轮 verdict：...
- 最终得分：X/30
- 分流归属：Review-Tech | Review-Product
- Follow-up（如有）：...
- Human 决策（如冒泡）：approve | reject | 重写 | ...
- 进 Todo 时间：...
```

---

## 6. Review-Agent 报告格式

```markdown
# COSTRA-XXX 卡定义 Review · Round N · Review-{Tech|Product}

- 审核时间：...
- 审核人：Review-Agent-{Tech|Product}
- 卡主：PM-Agent / Tech-Lead / Human
- 轮次：N/3

## 分项评分

| 项 | 满分 | 得分 | 备注 |
|---|---|---|---|
| C1 标题与描述清晰度 | 5 | 4 | 描述缺少"范围"段 |
| C2 DoD 可度量 | 6 | 3 | "完成登录对接" 不可度量 |
| C3 依赖识别 | 5 | 5 | 依赖清晰 |
| C4 产出物具体 | 5 | 4 | 未指明接口 URL |
| C5 风险与边界 | 4 | 2 | 未标失败路径 |
| C6 去重 | 3 | 3 | 无重复 |
| C7 估点合理 | 2 | 2 | 合理 |
| **总分** | **30** | **23** | REVISE |

## 问题清单

### P0-1 DoD 不可度量
- **位置**：卡 DoD 段
- **问题**：仅写 "完成登录对接"，无可自动化判定标准
- **建议**：改为 "1) POST /auth/login 返回 200 + openid + token；2) token 可用于 /user/me；3) 单测覆盖成功 + 失败两路径"

### P1-1 未指明接口 URL
- ...

## Verdict

**REVISE** · 23/30

## 强制阅读清单

- docs/api/auth.md
- engineering-guidelines.md §3.2（DoD 规范）
- D-008 主体策略（若涉及）
```

---

## 7. 卡主回应格式

每轮 REVISE 后，卡主必须产出 `card-review-round-N-response.md`：

```markdown
# COSTRA-XXX 卡定义修订 · Round N

## 对 Round-N Review 的回应

### P0-1 DoD 不可度量
- **采纳 / 反驳**：✅ 采纳
- **修订位置**：backlog.json 该卡 DoD 段
- **修订后内容**：
  1. POST /auth/login 返回 200 + openid + token
  2. token 可用于 /user/me
  3. 单测覆盖成功 + 失败两路径
- **提交引用**：commit xxx（若已改）

### P1-1 ...
...

## 求再审
请 Review-{Tech|Product} 进入 Round N+1。
```

---

## 8. Orchestrator 调度规则

### 8.1 何时自动拉起（MUST）

| 触发条件 | 动作 |
|---|---|
| 新卡落盘到 `backlog.json` 或 `board.md` Todo 段 | 60 秒内识别归属 → 自动拉起对应 Review-Agent |
| 卡主产出 `card-review-round-N-response.md` 且 round < 3 | 自动拉起 Round N+1 |

### 8.2 何时**不**拉起（MUST NOT）

- 决策类卡（D-xxx / ADR-*）→ 直接 Human 决策
- Human 显式发 `skip-card-review COSTRA-XXX`（需记 daily）
- 历史卡（D-014 立案 2026-04-23 22:26 前创建的卡）→ 豁免
- DevOps / QA 的卡若性质为"纯操作 / 纯配置"且 Owner 在 backlog 标注 `no-card-review: true` → 豁免（需 Human 确认）

### 8.3 Context 注入模板

```
## Card-Review Task
- card: COSTRA-XXX
- card_owner: backend | miniapp | pm | design | ...
- round: 2/3
- backlog_snapshot: .team/backlog.json (line X-Y)
- board_snapshot: .team/board.md (line X-Y)
- last_review: .team/reviews/COSTRA-XXX/card-review-round-1-tech.md
- last_response: .team/reviews/COSTRA-XXX/card-review-round-1-response.md
- 强制阅读清单: [charter.md, engineering-guidelines.md, ADR-0001~0006, D-008, D-009, D-013, D-014]
```

---

## 9. Human 介入窗口

| 场景 | Human 动作 |
|---|---|
| 卡定义 Review PASS → 卡进 Todo | **无需介入**（与产出 Review 的 T1 路径不同，卡定义 PASS 不再过 Human 手） |
| REJECT / ESCALATE / ROUND-LIMIT | 冒泡 Human，看 `card-review-FINAL.md` 决策 |
| Human 主动覆盖 | `force-card-pass COSTRA-XXX`（强制通过）/ `skip-card-review COSTRA-XXX`（跳过） |
| 历史卡补审 | `review-card COSTRA-XXX`（手动触发） |

**Orchestrator 汇报格式**（每次进度汇报必须在"⏳ 自动 Review 进行中"段列出卡定义 Review 状态）：

```markdown
## ⏳ 自动 Review 进行中（共 N 张 · D-014）

| 卡号 | Review 类型 | Review-Agent | 当前轮次 | 打断指令 |
|---|---|---|---|---|
| COSTRA-xxx | 卡定义 | review-tech | 1/3 | `pause-review COSTRA-xxx` |
| COSTRA-yyy | 产出 | review-product | 2/5 | `pause-review COSTRA-yyy` |
```

---

## 10. 触发指令（合入 SOP-HUMAN-TRIGGER §3）

| 用户说 | Orchestrator 行为 |
|---|---|
| `review-card COSTRA-xxx` | 对某卡强制做一次卡定义 Review（适用于历史卡或已 skip-card-review 的卡） |
| `skip-card-review COSTRA-xxx` | 跳过卡定义 Review，直接进 Todo（需 Human 提供原因，记 daily） |
| `force-card-pass COSTRA-xxx` | Human 强制通过卡定义 Review（覆盖 Review-Agent 意见） |
| `pause-review COSTRA-xxx` | 立即停止该卡的 Review（含卡定义 + 产出），冒泡 Human |

---

## 11. 度量（同步进 `.team/metrics.json`）

```json
{
  "card": "COSTRA-xxx",
  "card_review_type": "tech",
  "card_review_rounds": 2,
  "card_review_terminal_verdict": "PASS-WITH-FOLLOWUP",
  "card_review_score": 28,
  "card_review_p0_caught": 1,
  "card_review_p1_caught": 2,
  "card_review_time_cost_minutes": 5,
  "auto_kickoff": true,
  "human_overrode": false
}
```

每周聚合观察：
- 卡定义 Review 平均拦截 P0 数（越高越说明 PM/Tech-Lead 初稿质量有改进空间）
- 平均轮次（> 2 → 说明初稿质量差）
- Human 复议率（`force-card-pass` / `skip-card-review` 使用频次）

---

## 12. 版本与变更

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-04-23 22:26 | 随 D-014 立案，Orchestrator 成文 |

**本 SOP 由 Human 于 2026-04-23 22:00 提出规约 + 22:26 "go" 指令确立，Orchestrator 即刻生效。**
