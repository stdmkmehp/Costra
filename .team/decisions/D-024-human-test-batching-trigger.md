# D-024 · Human 实测批量触发条件 SOP（攒批验收 · 反节奏碎片化）

> **立案时间**：2026-05-19 14:30（Human 反馈"实测接入太频繁"触发）
> **生效日期**：**2026-05-19**（随本决议落盘生效 · 立即对当前积压 157+158 适用）
> **替代**：无（原范式 = 单卡 R1 APPROVE 即让 Human 实测 · 隐性 SOP · 从未显式立案）
> **关联**：D-014（Card-Review + 自动 Review-Auto-Loop）· D-016（同轮兑现）· D-018（SBAI 双装扮档）· D-022 v2.0（runtime 类 T2 卡 Human 实测前置铁律）

---

## §1 立案背景

### §1.1 反模式现象（2026-05-19 Human 反馈）

> "让 human 实测接入的太频繁了，阶段性进展之后，再让我来实测验收"

**节奏问题样本**（Sprint-2 后半段）：

| 卡号 | R1 review APPROVE 时间 | Human 实测触发节奏 |
|---|---|---|
| COSTRA-105 | 2026-05-18 ~17:00 | 即时（3 模式 A/B/C 各跑） |
| COSTRA-156 | 2026-05-18 ~18:00 | 即时（同 105 联合实测 · 唯一一次攒批） |
| COSTRA-157 | 2026-05-18 ~19:1x | 即时（5 步 mock 实测） |
| COSTRA-158 | 2026-05-19 ~13:0x | 即时（6 步 mock 实测） |

→ Human 在 24 小时内被要求实测 4 次 · context switch 4 次 · server/模拟器 setup 重复成本 4×。

### §1.2 漏检根因

**SBAI 自动化收益 vs Human 实测纪律的矛盾**：

- D-014 SOP 让 R1 实装→Card-Review→R1 Review→Human 终审在同一对话轮内连续 spawn（D-016 同轮兑现）· **目的是缩短"机器侧"循环时间**
- 但 Orchestrator 把 R1 review APPROVE 后的 disposition 默认更新为"等 Human 实测 + approve" · **隐性把"机器侧节奏"传染到"Human 侧节奏"**
- 单卡实测 ≠ 单卡价值：每次实测固定开销 = server 启动 + 模拟器 setup + DB seed + storage 重置（≥ 8~15 min）· 4 卡串行实测 = 4× setup 重复

### §1.3 既有先例：105 + 156 联合实测（2026-05-19 09:27 双卡 APPROVE）

- 105 R1 + 156 R1 在同一会话窗口内被 Human 联合实测 + 双卡同轮 approve
- Sprint-2 5/7 卡 CLOSED 历史记录 · 范式有效但**未被显式 SOP 化**
- 本决议 = 把 105+156 范式立死成 SOP

---

## §2 SOP 正文

### §2.1 默认行为：攒批

> **R1 review APPROVE 后** · Orchestrator **不主动催 Human 实测** · 只把 backlog disposition 更新为 `AWAITING-BATCH-HUMAN-TEST` · 卡入"实测队列"。

**实测队列维护**：

- 队列字段（隐式）：`backlog.json` 中所有 `status="Doing" + disposition contains "AWAITING-BATCH-HUMAN-TEST"` 的卡
- 每张入队卡必须附 `commit_hash` + `human_smoke_ref`（指向单卡 §9 实测清单或合并清单文件）

### §2.2 触发条件（满足任一 → 出队 + 主动通知 Human）

| # | 条件 | 触发动作 |
|---|---|---|
| **C1** | 队列累计 ≥ 2 张 R1-APPROVE 卡 | 落"批量实测清单"`docs/qa/sprint-N-batch-human-smoke.md` + 通知 Human |
| **C2** | 卡含强外部依赖（wx 平台真机 / 真支付 / 真隐私授权 / DNS+SSL+ICP runtime / 微信白名单等无法 mock 链路）| 单卡实测立即触发（即使队列只有 1 张）· 例：COSTRA-105 H 族真机烟测 |
| **C3** | 上游 release 节点（Sprint 收官 / 提审包 / DNS+SSL 上线 / 微信审核提交）| 强制清空队列 · 出"Sprint 收官实测清单"或"提审前回归清单" |
| **C4** | Human 主动召唤（"现在测一批" / "我有空了" / "出实测清单" 或显式列任意卡号）| 立即出清当前队列 + 给统一实测清单 |
| **C5** | 阻断后续派单（A 卡未 approve 物理阻塞 B 卡 dispatch · 强依赖关系）| 单卡实测立即触发 · 极少触发 · 必须在 dispatch 显式标注 `BLOCKING-DISPATCH` |

**默认优先级**：C2 > C3 > C5 > C4 > C1（强约束 > 节点 > 阻断 > Human 主动 > 攒批）。

### §2.3 触发条件**不满足**时 Orchestrator 必须做的事

R1 review APPROVE 后 · Orchestrator 必须做（不是不做）：

1. **立即更新 backlog**：`status: Doing` · `disposition: "R1 commit <hash> APPROVE X/Y · AWAITING-BATCH-HUMAN-TEST · 队列 N 张待出"`
2. **立即更新 follow-ups**：本卡涉及的 FU 标 `closed @ <卡号>`（实测前可标 closed · Human 实测发现回滚则改 `reopened-by-test`）
3. **不 commit 实测请求 prompt**：不要落实测清单 md 文件 · 等触发条件满足才落（避免文件污染）
4. **可继续派单**：无依赖的下游卡可继续 dispatch + Card-Review + 实装 + Review · 直至下次触发条件满足

### §2.4 批量实测清单生成规范

触发 C1 / C3 / C4 后 · Orchestrator 必须落盘 `docs/qa/<scope>-batch-human-smoke.md`，命名规则：

| scope | 命名 |
|---|---|
| 多卡攒批（C1）| `docs/qa/sprint-{N}-batch-human-smoke.md`（同 Sprint 内累积清单 · 可分 round 后缀如 `-round-1.md`）|
| Sprint 收官（C3）| `docs/qa/sprint-{N}-closure-smoke.md` |
| 提审前回归（C3）| `docs/qa/wechat-review-regression-{date}.md` |
| Human 主动（C4）| 复用 C1 命名（多张）或单卡 `docs/qa/costra-{id}-human-smoke.md`（单张） |

**清单内容必须**：

- §0 前置去重：合并多卡的 setup 步骤（server 启动 + 模拟器编译 + storage 重置 + DB migrate / mock 模式选择）· 一次 setup 跑全套
- §1~§N 步骤合并：相同操作（如"冷启拒绝授权"在 157 步骤 3 + 158 步骤 2）合并为一步 · 双卡断言并列
- 末尾"批量 approve 触发命令"：`approve:COSTRA-X + approve:COSTRA-Y`（Human 单次输入触发多卡 CLOSED）
- 失败分流表：哪一步 FAIL 转介哪张卡哪个 Agent

**禁止**：复制粘贴各单卡 §9 不去重（这会让 Human 在合并清单里重复跑一样的步骤）。

### §2.5 Orchestrator 通知模板（C1/C3/C4 触发时）

```
当前实测队列已满足 D-024 §2.2 C{N} 条件，已出清并落"批量实测清单"：

- 路径：docs/qa/{file}.md
- 涉及卡：COSTRA-X (commit <hash>) + COSTRA-Y (commit <hash>) + ...
- 预计实测耗时：M 分钟（vs 单卡串行 M' 分钟 · 节省 ΔM）
- 一次 setup：server 启 1 次 + 模拟器编译 1 次
- 批量 approve 命令：approve:COSTRA-X + approve:COSTRA-Y

实测前请确认：
- [ ] 准备好 ~M 分钟连续时间窗
- [ ] 项目根 dev 分支 HEAD 含全部目标 commit
- [ ] 微信开发者工具已打开

无空则继续攒批。Orchestrator 同时不阻塞 · 可继续推进无依赖下游卡。
```

---

## §3 实施细节

### §3.1 现存隐性 SOP 反兼容（防遗漏）

以下既有 SOP 与本决议**不冲突**但需声明：

- **D-014 自动 Review-Auto-Loop**：仍然 R1 实装→Card-Review→R1 Review 同轮 spawn · 不变
- **D-016 同轮兑现**：仍然要求"机器侧"链路在同对话轮内完成 · 不变
- **D-022 v2.0 §4.1 runtime 类 T2 卡 Human 实测前置**：runtime 类卡（涉及微信 runtime / wx.request / 真机时序）落 D-024 C2 路径（单卡立即触发 · 不攒批）
- **隐性铁律"Human 实测未通过前 FU 不真 closed"**（follow-ups README §15 行）：本决议 §2.3 步骤 2 写的"实测前可标 closed"**不破此铁律** · 因为 follow-ups 状态字段 `closed @ <卡号>` 表"由本卡负责闭合"· 真闭环要等 Human 实测过 · `closed-pending-human-test` 是更精确状态 · 但当前 follow-ups 范式未引入此中间态 · D-024 §3.3 留 follow-up 议入

### §3.2 队列容量上限

- **软上限 5 张**：队列累计 ≥ 5 张时 Orchestrator 主动提示 Human "积压偏多 · 建议出清" · 不强制（Human 仍可"继续攒批"）
- **硬上限**：无（Human 主导 · Orchestrator 不替 Human 决定）

### §3.3 留 follow-up

- **FU-D024-CLOSED-PENDING-HUMAN-TEST**：follow-ups README 引入 `closed-pending-human-test` 中间态 · 区别于 `closed @ <卡号>`（已实测 verified） · Sprint-3 头部规约升级时做 · P3 不阻塞

### §3.4 Sprint-3 起强制全员遵守

- 本 SOP 自 2026-05-19 立案即生效 · 但 Sprint-2 末已积压 157+158（同轮立案同轮出清）
- Sprint-3 起 Orchestrator 必须默认走攒批 · 任何"R1 APPROVE → 让 Human 实测"的请求必须先勾 §2.2 触发条件 · 不勾则攒批

---

## §4 红线

### §4.1 不可破

- ❌ R1 review APPROVE 后 Orchestrator 不可在同对话轮内主动让 Human 实测（除非 §2.2 C2/C3/C5 命中或 §2.2 C4 Human 主动召唤）
- ❌ 多卡攒批不可省略"去重 setup"步骤 · 必须合并 §0 前置（这是"攒批"价值所在）
- ❌ 不可把 D-022 v2.0 §4.1 runtime 类 T2 卡跟普通 T1 / T2-paper 卡混攒一批（runtime 类立即触发 · 不攒批 · 否则真机现场 setup 干扰其他卡的 mock 路径验证）

### §4.2 可破（但需显式说明）

- ✅ Human 主动召唤可破任意攒批（§2.2 C4 优先级最高 · "你说测就测"）
- ✅ Sprint 收官冲刺时（§2.2 C3）可临时调整队列优先级 · 把所有积压挪到收官清单

---

## §5 反向验证

### §5.1 衡量 D-024 是否生效（落地一周后回看）

- ✅ Human 实测频次：从 Sprint-2 后半段平均 1.5 次/天 → Sprint-3 目标 ≤ 0.5 次/天（攒 2~3 张一次）
- ✅ Sprint-3 内 Orchestrator 是否在每张 R1 APPROVE 后默认走攒批（grep `disposition` 看 `AWAITING-BATCH-HUMAN-TEST` 出现次数）
- ✅ Human 主观体感：实测"不再频繁"（Sprint-3 末 Retro 议题候选）

### §5.2 反例（D-024 不应阻挡的情况）

- COSTRA-105 H 族真机烟测：runtime 类 T2 · §2.2 C2 路径 · 仍然单卡立即实测 · D-024 不阻
- 微信审核提交前回归：§2.2 C3 路径 · 强制清空 · D-024 主动触发
- Human 主动召唤：§2.2 C4 路径 · 不论队列状态 · 立即出清

---

## §6 立案后立即适用：Sprint-2 末 157+158 出清

**当前状态（2026-05-19 14:30）**：

- 队列：COSTRA-157 (commit `ac204e3` · R1 38/40 APPROVE) + COSTRA-158 (commit `c7ea7f7` · R1 38/45 APPROVE) = 2 张
- 触发条件：§2.2 C1（≥ 2 张）+ §2.2 C4（Human 主动反馈节奏）双命中

**出队动作**（同轮兑现 · D-024 §2.4 命名）：

- 落盘 `docs/qa/sprint-2-batch-human-smoke.md`
- 合并 157 §9 6 步 + 158 §9 6 步 → 去重后 8~9 步合并清单
- 双 approve 命令：`approve:COSTRA-157 + approve:COSTRA-158`

---

## §7 修订记录

| 版本 | 时间 | 修订 |
|---|---|---|
| v1.0 | 2026-05-19 14:30 | 初版立案 · Human 反馈"实测接入太频繁"触发 · 同轮对 157+158 出清 |

---

**事实源 / 依据**：

- Human 反馈原文：2026-05-19 14:30 "让 human 实测接入的太频繁了，阶段性进展之后，再让我来实测验收"
- 105+156 联合实测先例：2026-05-19 09:27 双卡同轮 APPROVE（backlog v0.2.9 / 156 R1 APPROVE 40/40 + 105 R1 APPROVE-PARTIAL）
- 既有 SOP 关联：D-014 / D-016 / D-018 / D-022 v2.0
- 实测清单风格基线：`docs/qa/costra-105-human-smoke.md`（v1.8 · 已含三模式合并 + 步骤勾选清单）
