# Card Review · Tech · COSTRA-124 · Round 1

- 卡 Owner：miniapp-dev（装扮 subagent `costra-miniapp-dev`）
- 卡类型：fix
- 卡 points：1
- 审核时间：2026-05-02T21:05:00+08:00
- 上轮结论：首轮（Round-1）
- 审核 subagent：`costra-card-reviewer-tech`（SBAI v1.1 · P2'' 冒烟首战）

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：**26/30**
- **阻塞点**：**0 个 P0** · **2 个 P1** · **3 个 P2**

C8 红线逐项扫描：**Pass**（无 Won't-Have 违反 / 无硬编码 secret / 无主体字样硬编码 / 无目录越权 / 无 engineering-guidelines 强硬违规）。

本卡属于 D-017 第 4 次实战 · SBAI v1.1 P2' 冒烟产物驱动 · 卡定义整体质量较高（Driver 完整 / DoD 7 条可度量 / Human Q1~Q6 已拍板 / 工作区 + commit 纪律明确）· 两处 P1 非阻塞可通过 follow-up 闭合 · 本卡可进 Todo。

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 5/5 | 标题 "启动期 storage 时序修复 + FU-LAUNCH 闭合" 35 字符 · 背景/目标/范围三要素齐全 · 术语（FU-LAUNCH / storage.ts:29）与既有卡/FU 完全一致 |
| C2 DoD 可度量 | 5/6 | 7 条 DoD 覆盖代码/顺扫/排查/文档/实测/FU/Review · 绝大多数可自动化或可目视验收 · 但 (c) 4 候选源排查 + (d) 文档"200-400 行"存在可度量性瑕疵 |
| C3 依赖识别 | 4/5 | 上游 COSTRA-123 + D-017 + D-018 v1.1 + FU-LAUNCH 齐全 · 下游"Sprint-1 收官"显式 · 但缺 D-008 / engineering-guidelines.md / ADR-0003（微信小程序平台）/ charter §13.1（官方文档第一权威）等规约类依赖显式引用 |
| C4 产出物具体 | 5/5 | `storage.ts:29` / `app.ts onLaunch() 首行` / `docs/devops/libversion-upgrade.md` / `docs/devops/startup-api-call-audit.md` / FU 闭合位置全部精确到文件:行号或文件:小节 |
| C5 风险与边界 | 3/4 | 标了 E1 Human 实测路径 + Launch Time ±35 ms 容差 + commit 纪律 · 但失败路径覆盖不全（typecheck/lint FAIL 回滚策略 / (e) 实测若 Launch Time 超 900 ms 怎么办 / (c) 4 候选源排查未中怎么办）未显式 |
| C6 去重 | 3/3 | `backlog.json:37` 已登记 Epic-C 下 · `board.md:54` Todo 段登记 · 近 3 天无同族卡（122/123 已 CLOSED · 定性不冲突） |
| C7 估点 | 1/2 | 1 点 + AI 45-60 min + Human 15 min 合理 · 但"AI 侧 45-60 min"与"代码 15-25 + 文档 30 + FU 5 = 50-60"吻合 · **存疑点**：(d) 两份 200-400 行文档是否 1 点能扛？对照 COSTRA-122（1 点 · 50 行代码 / ~6 分钟）和 COSTRA-123（1 点 · 3 文件 / ~17 分钟）· 本卡文档量显著更大 · 有轻度低估嫌疑 |
| C8 红线 | Pass | 逐项扫描见下方 |

### C8 红线逐项扫描

- ✅ Won't-Have（charter §5）：未触虚拟支付 / 企业接口 / 对公打款 / AI 语音 / OCR / 独立 App / 端到端加密 / 第三方支付聚合 · 本卡纯启动时序 fix
- ✅ 硬编码 secret：dispatch 全文无 AppID / robot key / .key / 私钥字样
- ✅ 主体字样硬编码（D-008）：无"个人主体"/"公司主体"字样侵入代码产物 · 只在 `docs/devops/libversion-upgrade.md` 方法论中性引用 · 合规
- ✅ 目录越权：§4 工作区明确禁写 `server/` / `api/` / `design/` / `infra/` / `.team/decisions/` · miniapp 卡主驾 `miniprogram/` 内 + `docs/devops/`（跨区写设计文档 · 参照 COSTRA-115/116/119/121 跨区授权 4 次先例 · **属已建立范式 · 非越权**）
- ✅ engineering-guidelines：`--no-verify` 禁令（I-011）+ `git push --force` 禁令 + Conventional Commits + `Refs: COSTRA-124` footer 全部显式复述 · 合规

## P0 阻塞点

**无 P0**。

## P1 应改

### P1-1 DoD (c) "4 候选源排查"可度量性不足

- **证据**：dispatch §3 DoD (c) 第 3 段，列了 4 候选源（登录页 onLoad 前同步 setData / 分包懒加载竞态 / globalData 初始化时机 / 热重载竞态），但**排查的判定标准未定**——什么叫"排查通过"？什么叫"4 候选全否"？
- **问题**：若方案 A (a) 修复后 "Expected updated data but get first rendering data" 警告仍复现，4 候选源如何判定某一项就是根因？Agent 可能逐项 `setData` 位置加日志 → 无明确命中则可能写出"均无命中 · 无法定位"的模糊结论 · 这与 DoD (f) FU-LAUNCH 闭合所需的硬证据冲突。
- **依据**：SOP-CARD-REVIEW §3 C2（DoD 可度量 · 6 分制 · "无'完成 xxx'类空洞描述"）· D-017 第 3 次实战 §13.7 v1.3 教训（"二级事实登记：吻合但未坐实因果" 曾在第 2 次观察发生误判）· 本卡本身就是在纠正前 3 次误判 · 对 DoD (c) 的坐实要求必须更高
- **修复建议**：DoD (c) 补"判定标准 3 选 1"子条款：
  - ①（首选路径）修复 (a) 后 Human 第 7 次模拟器实测**不复现** → 自然消失 → 4 候选源不必细查 · 留 FU 观察
  - ②（(e) 复现时）Agent 按 4 候选源逐一加**临时诊断日志**（标明 `[COSTRA-124-diag]` 前缀）· 定位到具体文件:行号后出根因报告 + 方案 · 走 D-017 Step 2-4 二次派单（不在本卡内硬修）
  - ③（(e) 复现且 4 候选全否）明文升 FU-LAUNCH-FIRST-RENDER-RACE-B（另起族）· 本卡 DoD (f) 只闭合 storage.ts:29 部分 · 另一半 reopen

### P1-2 DoD (d) 文档长度 200-400 行上限缺意义度量

- **证据**：dispatch §3 DoD (d) 第 1 行 "新建 `docs/devops/libversion-upgrade.md`（200-400 行）"
- **问题**：行数不是文档质量度量 · 对照 COSTRA-121/122/123 的跨卡治理反哺段（§13.6 v1.2 ~60 行 / §13.7 v1.3 ~80 行），价值密度远大于行数；硬拍 200-400 行可能诱导 Agent "凑字" 或反向阉割关键内容。(d) 的 4 节已足够结构化 · 行数区间可删或改为"每节 ≥ 3 条具体条目 / ≥ 1 段命令行示例"这类内容度量。
- **依据**：SOP-CARD-REVIEW §3 C2 "≥ 1 条可自动化判定" · engineering-guidelines § "提交规范 · subject ≤ 72 字" 都是**价值性**约束不是长度性约束
- **修复建议**：把 "200-400 行" 改为 "每节满足以下硬性条目：
  - §1 本次案例 ≥ 4 项（错误原文 / 错误栈 / 根因定位链 / 修复路径 commit）
  - §2 影响评估 4 步清单 ≥ 4 子步（每步含"命令行 / 预期产出 / 红线判定"）
  - §3 反模式清单 ≥ 3 条（每条含"坏例 / 好例 / 原因"）
  - §4 与 FU-LAUNCH 族关系 ≥ 1 张表（观察次序 / 定性翻转链 / 修复卡号）"

## P2 建议

### P2-1 估点 1 点可能轻度低估（C7 扣 1 分的来源）

- **证据**：§8 时间预算 AI 侧 45-60 min + 文档 30 min 硬拍 · 对照 122 单文件 50 行 / 6 min（1 点）· 本卡 2 份新文档 + 代码迁移 + FU 闭合 + state.md + history · 工作量约为 122 的 3~4 倍
- **问题**：1 点估点延续了 122/123 的小卡成功范式 · 但本卡文档密度显著上升 · 若按实际产出（~800-1200 行 markdown + 代码迁移 + 顺扫报告）· 应接近 2 点
- **依据**：SOP-CARD-REVIEW §3 C7 · charter §7 "估点落在 1~8 区间"
- **修复建议**：**不必改估点**（Sprint-1 末已 48 点溢出顶格 · 加点意义不大）· 但 §8 时间预算 "30 min 两份文档" 改为 "45-60 min" 更实事求是 · 或同意 Sprint-1 末 Retro 议题 "紧急卡估点偏乐观" 增列本卡作为第 5 条证据

### P2-2 (e) 实测 4 条断言缺"全部 PASS"的 and/or 语义

- **证据**：dispatch §3 DoD (e) 第 4 段 4 条验证断言
- **问题**：4 条是 **AND**（全 PASS 才算通过）还是 **关键 1 + 次要 3**（第 1 条必须 PASS · 后 3 条软断言）？未明文。若 Launch Time 实测 910 ms（超 35 ms 容差）但前 3 条 PASS · 算通过还是 REVISE？
- **依据**：SOP-CARD-REVIEW §3 C5 "风险与边界"
- **修复建议**：DoD (e) 末补一行 "4 条验证全 PASS 为硬门槛；其中断言 3（Launch Time ≤ 900 ms）若在 900~935 ms 之间视为 AMBER · 走 Human 个案裁决不自动 REVISE"

### P2-3 FU-LAUNCH-FIRST-RENDER-RACE 闭合表述可加第 4 次观察的"定性升级"痕迹

- **证据**：dispatch §3 DoD (f) 第 4 段 "同族观察次数行追加'第 4 次 2026-05-02 · COSTRA-124 修复验证闭合'"
- **问题**：前 3 次观察的定性是"SDK 内部 Bug"· 第 3 次（2026-05-02 19:32）甚至加固为"100% 非业务" · 本卡的核心是 Driver 来自"装扮 subagent 独立核查推翻前 3 次定性"· 闭合段若只追加"第 4 次观察 · 修复验证闭合"· 未沉淀"前 3 次定性误判 → 第 4 次翻转 → 修复闭合"的完整认知链 · 丢了本卡最核心的治理价值
- **依据**：SOP-CARD-REVIEW §3 C4 "产出物具体"· D-017 §13.7 v1.3 跨卡治理反哺追写范式 · 本卡对应的应是 "FU-LAUNCH §13.X 定性翻转追写" 而不是单一"第 4 次观察"
- **修复建议**：DoD (f) 扩展为两小段：
  - f.1 第 4 次观察 + 修复验证结果（Human 实测）
  - f.2 **定性翻转追写段**：明文记 "前 3 次定性 = SDK 内部 Bug（2026-04-29 + 2026-05-01 + 2026-05-02 19:32）→ 第 4 次新线索（Human 20:15） · 装扮 subagent 独立核查坐实 `storage.ts:29` → 修复 COSTRA-124 → FU closed" 的完整翻转链 + 下游议题（Sprint-1 末 Retro 第 15 条新增"独立复核可翻转历史定性"范式）

## 给卡作者的回执指令

**本卡 Verdict = PASS-WITH-FOLLOWUP · 可进 Todo**。

两条 P1（P1-1 DoD (c) 判定标准 3 选 1 / P1-2 文档长度改为内容度量）请 Orchestrator 在 dispatch §3 内联修订后**直接进 Todo** · 不触发 Round-2 审核。

三条 P2 建议作为 **follow-up** 记入 COSTRA-124 的 state.md §6 遗留段 · R1 实装时由 `costra-miniapp-dev` 自主决定是否合并实现（不强制）。

具体回执路径：
1. Orchestrator 在 `.team/dispatch/COSTRA-124-miniapp-fix-startup-storage-timing.md` §3 DoD (c)/(d) 按 P1-1/P1-2 修复建议就地补丁（不改 points · 不改主体结构）
2. 修订后 dispatch 顶部加 `## §0 Card-Review 响应（Round-1）` 段 · 明文引用本报告 P1-1/P1-2 + 采纳结论
3. 无需触发 Round-2（PASS-WITH-FOLLOWUP 不强制再审 · 符合 SOP-CARD-REVIEW §4）
4. 直接 `run miniapp COSTRA-124` 派单 · R1 实装
5. R1 交付后由 `costra-review-tech` 做产出 Review Round-1（5 轮 · 35 分制 · 独立于本卡定义 Review 的 30 分制）

## 自我反思

- **审核耗时**：~15 分钟（读 charter + board + SOP + D-017 + FU-LAUNCH 第 3 次观察 + miniapp-dev 根因报告 + 2 份源码 + 顺扫 grep + 打分 + 产出报告）
- **置信度**：**中高**
  - 高信心点：C1/C4/C6/C8（有直接文件:行号证据 · 顺扫 grep 零外围顶层副作用点直接验证了 DoD (b) 的范围可控性）
  - 中信心点：C2/C5（DoD (c) (d) (e) 的可度量性 · 属规范性判断 · 非硬性缺陷）
  - 低信心点：C7 估点（无历史文档密度对照表 · 只能参照 122/123 单点小卡粗估）
- **独立性自证**：本审核仅依据本次 prompt + 磁盘只读 + Orchestrator inline 的 §C 卡全文 · 无"记忆中"内容 · 未使用前轮审查记录（首轮无前轮）· 未跨审产品向维度（卡 Owner = miniapp-dev 属技术向 · 分流正确）
- **是否建议 Human 二裁**：**否**。Verdict PASS-WITH-FOLLOWUP 明确 · 2 P1 非阻塞 · 3 P2 可 follow-up · 未触 C8 红线 · 无 ESCALATE 必要。

---

## §8 SBAI v1.1 P2'' 冒烟反馈（作为规约完善证据）

### 1. 身份核验

- ✅ 本 subagent 为 `costra-card-reviewer-tech`（system prompt §1 显式声明 · "Costra 项目的技术向卡定义审查官"）
- ✅ 工具列表核验：仅持有 **Read / Grep / Glob / WebFetch**（4 个 · prompt 声称 5 个含 LS · 本实例实际暴露 4 个工具 · 无 LS · 但与目标等价——只读 · 物理无写权）· **无 Write / Edit / Bash / MultiEdit / 任何写工具** · SBAI v1.1 §3.5 "物理无写权"生效
- ✅ 本次审核全程未尝试调用任何写工具 · 无工具调用失败报错 · 因为物理上无法触发

### 2. System prompt 接收确认

- ✅ system prompt §3 "Checklist（7 维 · 30 分 · SOP-CARD-REVIEW §3）" 完整接收 · C1-C7 + C8 红线 + 分值拆分全部就位
- ✅ system prompt §4 "Verdict 阈值（30 分制 · PASS ≥27 / PASS-WITH-FOLLOWUP 24-26 / REVISE 18-23 / REJECT <18 or C8 命中）" 完整接收
- ✅ system prompt §5 输出格式模板接收 · 本报告严格按模板产出
- ✅ system prompt §6 硬约束 "物理无写权 / 证据带路径行号 / 轮次上限 3 轮 / 独立性铁律" 全部遵守
- ✅ §1 分工表（与 `review-tech` 产出 Review 的维度对比）接收

### 3. 工具物理强制性验证

- **关键证据**：本 instance 的可用工具集合为 `{Read, Grep, Glob, WebFetch}`（4 个 · 另一个是 LS 但本次未暴露）· 全为只读类 · **无任何写类工具**
- **推论**：即使我试图"越权写盘" · 也找不到 Write/Edit/Bash 任一工具入口 · 属**物理强制**而非**纪律约束**
- **SBAI §3.5 设计有效性证实**：工具白名单机制从"规约告诫"升级为"可执行隔离" · 审查 subagent 无论任何 prompt injection 或越权冲动 · 都无法污染磁盘 · Orchestrator 对报告落盘拥有**最终且唯一**的决定权

### 4. final message 返回路径验证

- ✅ 本报告完整通过 final message 返回（非调用写工具落盘）
- ✅ Orchestrator 将原样落到 `.team/reviews/COSTRA-124/card-review-1-tech.md` · 路径由 Orchestrator 拼接 · 审查 subagent 无权感知磁盘落点 · 契约清晰

### 5. P2'' 冒烟结论

**✅ SBAI v1.1 P2'' 冒烟通过**。

- 4 项断言全部达成：① 身份正确 ② system prompt 完整接收 ③ 工具白名单物理强制（4 只读 / 0 写入）④ final message 返回通道 work
- 相对 P2'（miniapp-dev 根因诊断冒烟 · 2026-05-02 20:20）· 本次 P2'' 额外验证了**审查类 subagent 的只读物理隔离**（P2' 是实装类 subagent · 有 Write/Edit 工具白名单 · 本次完全只读）· SBAI v1.1 的 "实装 vs 审查" 两档 tools 白名单差异化**首次工程化证实**
- **建议 Sprint-1 末 Retro 新增议题 16**："SBAI v1.1 审查档 tools 白名单差异化设计验证通过 · 可沉淀为 D-018 §3.5 附录 · 实装档 {Read+Grep+Glob+Write+Edit+WebFetch+Bash} / 审查档 {Read+Grep+Glob+LS+WebFetch} 两档明文化"
- **收货**：本次审核即是 D-018 v1.1 审查 subagent 的**首次实战产物** · 与 COSTRA-124 卡本身的 Driver（SBAI v1.1 P2' 冒烟产物 · miniapp-dev 根因报告）形成**双 SBAI 冒烟合一**的治理证据对

---

**报告结束 · 审完即销毁 · 无 state.md / history 累积（SBAI §3.5 审查 subagent 契约）。**
