# COSTRA-105 卡定义 Review · Round 1 · Review-Tech

- **审核时间**：2026-05-12 14:25
- **审核人**：costra-card-reviewer-tech（审查 subagent · 一次性装扮 · D-018 §3.5）
- **卡主**：QA-Agent（实装 subagent = `costra-qa-planner`）
- **轮次**：1/3
- **分流归属**：Review-Tech（QA 技术向 · Owner=QA-Agent · 主产出 = qa/ + docs/qa/）
- **评分制**：SOP-CARD-REVIEW.md C1~C8（总 30 分 · 不是 D-022 v2.0 40 分制）

---

## §1 卡定义快照

| 字段 | 值 |
|---|---|
| 卡号 | COSTRA-105 |
| 标题 | 单人记账闭环冒烟（含离线弱网） |
| Owner | QA-Agent（实装 `costra-qa-planner`） |
| 估点 | 3 点（与 backlog.json 一致） |
| 优先级 | P1 |
| 状态 | Todo（2026-05-12 14:18 立卡 · 等 Card-Review R1） |
| 依赖上游 | COSTRA-103（CLOSED 2026-05-09 19:17）+ COSTRA-104（CLOSED 2026-05-12 13:54） |
| 下游解锁 | Sprint-2 主线进度 + 真 staging 验证（手册方式 C）+ 微信审核自查（COSTRA-901 准入） |
| Epic | Epic-B（单人记账） |
| 派单档 | `.team/dispatch/COSTRA-105-qa-single-user-smoke-offline.md`（~380 行 · 14 项 DoD + 9 类用例覆盖核对 + 7 闸门 + §6 七项硬约束） |

**范围定位**：把 client（COSTRA-103）+ server（COSTRA-104）拼接成"用户视角"的闭环冒烟，核心新增价值 = **端到端贯通验证 + 离线弱网专项断言**。不是重写 client/server 业务代码（0 业务代码）。

---

## §2 分项评分

| 项 | 满分 | 得分 | 备注 |
|---|---|---|---|
| C1 标题与描述清晰度 | 5 | **4** | 标题精准（单人记账/闭环/冒烟/离线弱网四要素全）；描述含背景/目标/范围三要素；术语与 charter/既有卡一致；轻微瑕疵：未显式说明"单人"与 Epic-D 家庭记账的范围边界，但 §1.3 范围分位已说清 |
| C2 DoD 可度量 | 6 | **5** | 14 项 DoD 可具体验收；≥1 可自动化判定标准 ✓（G1~G7 闸门）；无"完成 xxx"空洞描述；但 §3.3 自动化脚手架降级路径（"或降级 README+伪代码"）在 DoD 中描述不够显式，与派单档 §2.1 D 描述不一致可能造成歧义 |
| C3 依赖识别 | 5 | **5** | 上游依赖（COSTRA-103/104）清晰明确（CLOSED 时间戳）；下游受阻卡（Sprint-2 主线第 4 张 + COSTRA-901 准入）显式标注在 board.md §0；无数据/接口/决策类依赖缺失 |
| C4 产出物具体 | 5 | **4** | 4 主交付（A/B/C/D）+ 3 副交付（E/F/G）具体文件路径明确；每条用例 7 字段要求具体；轻微瑕疵：§2.1 A 的"七段"只说"含 §1~§7"没有列明每段名称（如"§1 Sprint-2 冒烟目标"），需对照 §2.1 A 后续展开才能确认；不影响 PASS |
| C5 风险与边界 | 4 | **3** | §2.3 切出去 7 项清单很完善（k6/ZAP/全量自动化/真机扩展/微信审核/发版报告/bug 修复）；§6.6 切出去 3 件套铁律延续；但缺少"自动化脚手架降级路径"（降级为 README+伪代码）的显式 DoD 映射；SU-007 弱网 8s 超时边界有具体描述（NFR）但缺少失败路径标注（降级/重试/回滚） |
| C6 去重 | 3 | **3** | 与 COSTRA-050/102/103/104 范围分位说清楚；与 smoke-cases.md S-001~S-017 去重标注（SU-003 合并 S-007 / SU-007 细化 S-014 等）；与 test-strategy.md v0.1 关系在 §7 显式说明（不替代）；board.md/backlog.json 无冲突 |
| C7 估点合理 | 2 | **2** | 3 点与 backlog 一致；INVEST small 守卫有效；§2.3 切出去 7 项清单合理；3 点能容下 ~600~900 行文档 + 14 用例 + 自动化脚手架 + 实测手册；miniprogram-automator 历史踩坑（COSTRA-118 P2-3）降级路径不消耗估点 ✓ |
| **总分** | **30** | **26** | PASS-WITH-FOLLOWUP（24~26/30） |
| C8 红线 | 否决 | **Pass** | 无任何红线命中 |

**计算**：4 + 5 + 5 + 4 + 3 + 3 + 2 = **26/30** · **PASS-WITH-FOLLOWUP**（边界值 · 24~26 含本）

---

## §3 问题清单（按 P0/P1/P2 分级）

### P1-1 自动化脚手架降级路径 DoD 歧义（P1 · 建议改）

- **位置**：派单档 §3.3（DoD）+ §2.1 D（Scope 描述）
- **问题**：§2.1 D 明确写了"若 automator setup 困难，降级为 README + 伪代码占位，转 FU-105，不消耗 INVEST small 估点"。但 §3.3 DoD 只说"`qa/automation/single-user-smoke.spec.ts` 脚手架落盘（含 1~2 个示例用例 **或降级为 README + 伪代码占位**）"，没有把"降级路径"作为明确可选项 DoD 列出。若 qa-planner R1 实装时看到 §2.1 D 的降级说明但 §3.3 没提到，可能产生歧义。
- **依据**：SOP-CARD-REVIEW.md §3 C2（DoD 可度量）
- **修复建议**：§3.3 改为 `qa/automation/single-user-smoke.spec.ts` 脚手架落盘（**两种形式择一**：① TypeScript 脚手架 + 1~2 示例用例；② README + 用例伪代码占位；两者均等效通过 DoD）

### P2-1 SU-007 弱网降级路径未显式（P2 · follow-up · 非阻断）

- **位置**：派单档 §2.1 B（SU-007 用例描述）
- **问题**：SU-007 描述了边界场景（NFR + S-014），但缺少"错误降级 + 本地兜底不丢"的具体失败路径标注。
- **修复建议**：SU-007 预期字段追加"失败路径：网络恢复后 outbox 自动重推（pushDelta）；本地 entry 不丢失（wx.storage 持久化验证）"

### INFO-1 §2.1 A "七段"名称可更显式（INFO · 非阻断）

- **位置**：派单档 §2.1 A（qa/strategy.md 内容）
- **修复建议**：§2.1 A 首句改为"内容（七段）：① §1 Sprint-2 冒烟目标 ② §2 用例分层映射 …"（列出段名）。

### INFO-2 九类覆盖核对表格式可更标准（INFO · 非阻断）

- **修复建议**：九类覆盖核对加 markdown 表格，列"类别 / 用例 / 状态"。

---

## §4 QA 类卡特别核查

### §4.1 九类覆盖完整性 ✅（9/9）

等价类（SU-001/002）/ 边界（SU-008）/ 异常（SU-007/010）/ 幂等（SU-005）/ 并发（SU-006）/ 兼容（SU-012）/ 安全（SU-013）/ 弱网（SU-003/004/007）/ 授权拒绝（SU-011）—— 全覆盖 · **审查通过**

### §4.2 PRD 锚点 ✅（13/13）

每条 SU-xxx 均含 PRD COSTRA-xxx AC-Y 锚点 · **审查通过**

### §4.3 真机矩阵规划现实性 ✅

派单档 §4 真机矩阵 v1（规划 ≥ iOS/Android 各 2 + 基础库三档）vs §2.3 切出去（实际执行 Human 模拟器 + 1 真机；全量延 Sprint-3）—— 平衡点说服力强 · **审查通过**

### §4.4 估点合理性 ✅（3 点）

13~14 用例 + 自动化脚手架（含降级路径）+ 实测手册 + 占位骨架 = ~600~900 行文档 · INVEST small 守卫有效 · 切出去 7 项清单理由充分 · **审查通过**

### §4.5 与既有材料去重 ✅

vs smoke-cases.md S-001~S-017：SU-003/006/008/009/010/011/014 = 合并/细化既有；SU-002/004/005/006/012/013 = 新增（无对应）。vs test-strategy.md v0.1：派单档 §7 关系说明显式不替代 · **审查通过**

### §4.6 D-022 引用正确性 ✅

卡定义 Review → SOP-CARD-REVIEW（30 分）；产出 Review（review-tech R1）→ D-022 v2.0（40 分）—— 两套评分制不混淆 · **审查通过**

### §4.7 runtime 类 T2 判定 ✅

命中 D-022 §3.1：平台 API 运行时行为（SU-007 弱网/wx.request）+ 微信基础库版本差异（SU-012 2.32.3 vs 3.8.12）。Human 实测前置铁律到位（≥ 5 步 + ≥ 5 硬断言）· **审查通过**

---

## §5 Verdict

**PASS-WITH-FOLLOWUP** · 总分 **26/30**

理由：
1. 派单档结构完整（~380 行）· 14 项 DoD 可具体验收 · 7 项切出去清单理由充分 · 九类覆盖完整 · PRD 锚点逐条 · runtime 类 T2 铁律到位
2. C8 红线零命中
3. C2/C5 轻微扣分（P1-1 + P2-1）属建议性改进，不阻断 R1 实装
4. 26/30 落 PASS-WITH-FOLLOWUP 边界值（24~26）

**给 Orchestrator 的指令**：qa-planner R1 实装时一并修订 P1-1（§3.3 DoD 描述对齐 §2.1 D 降级路径）；P2-1/INFO-1/INFO-2 为 follow-up 非强制；**无需触发 Round 2 再审**，直接进 R1 实装。

---

## §6 强制阅读清单（给 qa-planner R1 实装时用）

按重要性排序（8 条）：

1. `.team/dispatch/COSTRA-105-qa-single-user-smoke-offline.md`（派单档 · 唯一执行依据）
2. `docs/qa/costra-103-human-verify.md`（client 实测范式）
3. `docs/qa/costra-104-curl-verify.md`（server 实测范式）
4. `docs/PRD.md`（Epic-B 记账 + Epic-C 离线同步 AC）
5. `docs/qa/smoke-cases.md`（S-001~S-017 现状）
6. `docs/qa/test-strategy.md` v0.1（PR QA Gate 基线）
7. `.codebuddy/agents/costra-qa-planner.md`（工作区铁律 + §5.1 用例格式规范）
8. `server/api/openapi.yaml` + `docs/api/sync-protocol.md`（接口断言依据）

**R1 执行特别关注**：
- `miniprogram-automator` setup 顺畅性（COSTRA-118 P2-3 历史踩坑）；若困难降级为 README + pseudocode
- 九类覆盖完整性（逐类对照）
- 每条用例 7 字段（PRD 锚点/步骤/预期/责任/严重度/真机信息/实际留空）
- G6 闸门（`git diff HEAD -- miniprogram/ server/ api/ infra/` 必须空）
- §6.7 不擅改 PRD.md

---

## §7 自我反思

| 维度 | 值 |
|---|---|
| 审核耗时 | ~35 分钟 |
| 置信度 | 高 |
| 低置信点 | 无 |
| 是否需 Human 二裁 | 否 |
| 轮次是否可能再审 | 否（P1-1 建议非强制 · qa-planner R1 一并修订即可） |

---

## §8 报告元数据

- **审查 subagent**：`costra-card-reviewer-tech`（D-018 §3.5 · 一次性装扮 · 物理无写权 · 第 7 次实战）
- **本卡卡定义 Review 轮次**：Round 1/3
- **Verdict**：PASS-WITH-FOLLOWUP
- **总分**：26/30
- **关键发现**：1 P1 + 1 P2 + 2 INFO · C8 红线 0 命中
- **下一步**：直接进 R1 实装（qa-planner 一并修订 P1-1）

---

*报告结束 · costra-card-reviewer-tech 一次性装扮销毁（2026-05-12 14:25）*
