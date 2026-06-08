# Tech Review · COSTRA-124 · Round 1

- 被审 Agent：**miniapp-dev**（装扮 subagent `costra-miniapp-dev` · SBAI v1.1 P2' 实战第 2 回）
- 本轮产出 commit：`a296be0`（代码）+ `221b074`（文档/FU/state）
- 审核时间：2026-05-03T12:02:00+08:00
- 审查 subagent：`costra-review-tech`（SBAI v1.1 审查档第 2 次冒烟）
- 上轮结论：**首轮**（Round-1 · R1 交付产出 Review · 与 card-review Round-1 是两条独立审查线）

---

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：**33/35**
- **阻塞点**：**0 P0** · **1 P1** · **2 P2**

C8 红线逐项扫描：**Pass**（无 Won't-Have 违反 / 无硬编码 secret / 无 AppID 进打包源码 / 无目录越权 / 无 `--no-verify` / 无主体字样硬编码业务字面量）。

Grep 自证（F.2）三条命令结果与 DoD (b) 审计报告完全一致（0/0 + ensureVersion 仅 storage.ts + app.ts 两处）· storage.ts 迁移语义严格等价 · app.ts onLaunch 首行位置精确 · 两份新文档 4 节硬性条目逐条达标 · FU f.1/f.2 追写完整。本 R1 属**高完成度一次交付** · 1 P1 非阻塞 · 2 P2 记入 Sprint-1 末 Retro 或 Sprint-2。

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| 契约一致性 | 5/5 | 无 API/DB 契约变更 · 启动时序修复不触碰 openapi.yaml 与 error-codes · 合规 |
| 架构与分层 | 5/5 | `ensureVersion` 保持职责单一 · 从顶层副作用迁入 `App.onLaunch` 首行符合微信生命周期范式 · 未引入新依赖 |
| 数据与持久化 | 5/5 | 迁移前后 `VERSION_KEY` / `STORAGE_VERSION` 语义等价 · 不改版本号不改 key · 不触发 `wx.clearStorageSync` 逻辑变更 |
| 离线与同步 | N/A | miniapp 本卡不涉及 outbox / client_req_id / 弱网降级（纯启动时序修复） |
| 安全与合规 | 5/5 | 无 secret 泄漏 · 无 AppID 进打包源码 · console.warn 仅打错误对象（无 token/session）· D-008 主体红线仅注释中性引用（已知豁免） |
| 可测与可观测 | 4/5 | 单测环境 `typeof wx === 'undefined'` 分支静默跳过 · `npm run typecheck/lint` PASS · 但本卡无 app.ts/storage.ts 新增单测覆盖"onLaunch 首行调用"路径（P1-1） |
| 工程纪律 | 5/5 | 2 commit 与 dispatch §5 策略一致 · footer `Refs: COSTRA-124` · 无 `--no-verify` · 单文件最大 libversion-upgrade.md 279 行（远低于 500 行红线）· Conventional Commits 合规 |

**合计**：5+5+5+N/A+5+4+5 = **29/30**（6 维有效）→ 按 35 分制折算为 `29/30 × 35 ≈ 33.8` → 取 **33/35**（保守取整）。

---

## Grep 自证（F.2 独立复现）

| # | Pattern | 预期 | 实测 | 与 DoD (b) 报告一致？ |
|---|---|---|---|---|
| 1 | `^wx\.` in `miniprogram/**/*.ts` | 0 命中 | **0** | ✅ 一致 |
| 2 | `^(const\|let\|var).*\bwx\.` | 0 命中 | **0** | ✅ 一致 |
| 3 | `ensureVersion` in `miniprogram` | 仅 storage.ts + app.ts | storage.ts（3 处注释/签名/log）+ app.ts（3 处注释/import/调用）**两处文件 · 符合预期** | ✅ 一致 |
| 4 | `^setTimeout\|^setInterval`（增值项） | 0 命中 | **0** | ✅ 一致 |
| 5 | 分包目录覆盖 | `pages-family/*` + `pages-stat/*` 均被 `*.ts` glob 覆盖 | 4 个分包页面 ts 全数被 Grep 扫到 | ✅ 顺扫范围无遗漏 |

**结论**：audit 报告所述"0 命中"**独立可复现** · 顺扫覆盖面包含分包（pages-family/pages-stat 实体存在且已扫）· DoD (b) 完整兑现。

---

## DoD 7 条交付核查表

| DoD | 状态 | 证据 |
|---|---|---|
| (a) storage.ts 顶层调用移除 + app.ts onLaunch 首行 | **PASS** | `miniprogram/services/storage.ts:26-39`（函数 export 保留，无顶层调用）+ `miniprogram/app.ts:24-28`（`onLaunch()` 第一条非注释语句即 `ensureVersion()` · 位置精确符合"首行"语义） |
| (b) 顺扫 0 命中 + audit 报告 | **PASS** | Grep 自证 1/2/4 全部 0 命中 · `docs/startup-api-call-audit.md:38-51` §2.2 表格 2 条命令与本次独立复现结果一致 · §4 逐模块排除分析合理 |
| (c) FU-LAUNCH 路径 ① 延后 Human 实测 | **PASS** | `history/2026-05-02-costra-124-r1-implement.md:57-64` §3.1 明文声明走路径 ① · `.team/follow-ups/README.md:578-593` f.1.B 5 条断言清单占位 + `pending` 标识 · 未越权进路径 ②/③ 硬修范围 |
| (d) libversion-upgrade.md 4 节硬性条目 | **PASS** | §1（L32-93）≥4 项：错误原文/错误栈/L1-L4 根因链/修复路径 commit（含 sha 占位）✅；§2（L96-169）= 4 子步，每步均含"命令行 / 预期产出 / 红线判定"三要素 ✅；§3（L172-243）= 3 反模式，每条含"坏例/好例/原因"三段 ✅，§3.3 明确标注"从本次追查过程自识别"✅；§4（L247-258）包含观察 1-5 完整族关系表 ✅ |
| (e) Human 模拟器第 7 次实测 | **DEFER-TO-HUMAN** | R1 范围外 · subagent 无模拟器访问 · dispatch §6/§9 明确由 Human 触发 · 坑位已在 `.team/follow-ups/README.md:586-592` 5 条断言位布好 |
| (f) FU 预闭合 f.1 + f.2 · status=open | **PASS** | `.team/follow-ups/README.md:515` `FU-LAUNCH-FIRST-RENDER-RACE` status 仍 **`open`** · L559 观察次数行追加"第 4 次/第 5 次预计" · L563-636 f.1/f.2 两小段齐备 · f.2 含完整翻转链 + 议题 15/16 · 严格遵守"Human 实测未通过前 FU 不真 closed"铁律 |
| (g) Review 流程 Round-1 | **IN-PROGRESS** | 本报告即 Round-1 产出 · 审完由 Orchestrator 落盘 `.team/reviews/COSTRA-124/round-1-tech.md` |

---

## P0 阻塞点

**无 P0**。

---

## P1 应改

### P1-1 `onLaunch` 生命周期内首行显式调用无单测/e2e 兜住

- **证据**：`miniprogram/app.ts:24-28` `onLaunch() { ensureVersion(); ... }` · 仓库内未见 `app.test.ts` / `storage.test.ts`（Grep `ensureVersion` 仅命中 app.ts + storage.ts · 无 test 文件）
- **问题**：本卡修复的因果链是"ensureVersion 调用时机必须在 App() 注册之后" · 但当前**唯一的行为保证**是"人肉 code review 看 app.ts 有没有那一行"。若未来某次重构（比如有人把 `ensureVersion()` 挪到 `initAuth().then()` 回调里 · 或有人把 `onLaunch` 的第一行改为别的初始化）· **无任何自动化闸会发现回归** · FU-LAUNCH 第 6 次复现的风险复生。Sprint-1 允许"可测设计 + 用例清单"替代完整测试（system prompt §3.6）· 但当前连"用例清单"都未落地。
- **依据**：`.team/engineering-guidelines.md`（Sprint-1 可测设计条款）· `docs/devops/startup-api-call-audit.md §5` 本身已列出 `scripts/devops/startup-top-level-call-check.mjs` Sprint-2 候选 · 但"首行位置约束"比"顶层裸调"更难静态检查 · 需补单测
- **修复建议**（Sprint-1 末不强制 · Sprint-2 认领）：
  1. **最小成本**（0.2 点）：补 `miniprogram/services/storage.test.ts` · mock `wx.getStorageSync` · 断言 `ensureVersion` 幂等 + 新版清库 + 版本写入
  2. **更完整**（Sprint-2）：配合 `startup-top-level-call-check.mjs` 追加 AST 规则 · 识别 `App({...})` 里 `onLaunch` 的 **第一条非注释语句** 是否为 `ensureVersion()` 调用 · 不是则 exit 1
  3. **最低门槛**：至少在 `.team/follow-ups/README.md` 新建 `FU-124-TEST-COVERAGE` 条目登记本缺口（当前 R1 无此登记 · 属遗漏）

---

## P2 建议

### P2-1 libversion-upgrade.md §1.4 `commit sha` 占位字符串未回填

- **证据**：`docs/devops/libversion-upgrade.md:89` `**commit sha**：`a296be0`（由 Orchestrator commit 后补 · 格式 ...）` — 注意此处**已经写出 `a296be0`**（代码 commit）但同时保留了"由 Orchestrator commit 后补"的元注释 · 语义含混；且 history §2.4 L50 "本轮不 commit"与 L27-28 实际已存在 commit `a296be0` + `221b074` 的事实冲突
- **问题**：事实源漂移风险——文档声称"待 commit 后回填"但实际 commit 已在 R1 前落地 · 读者无法判断 `a296be0` 是否就是**最终** commit（还是占位示例）· 且未登记第 2 个 commit sha `221b074`
- **依据**：D-017 Step 2 事实源对账铁律（"git ls-files/git log/git show HEAD:" 三证齐全）
- **修复建议**（下次 revise 或收尾 commit 同步修）：
  1. §1.4 把元注释"（由 Orchestrator commit 后补 · 格式 ...）"删掉 · 直接列 2 个 commit sha（代码 `a296be0` + 文档 `221b074`）
  2. history §2.4 L49 "本轮不 commit"更正为"本轮已 2 commit（列 sha）"

### P2-2 启动期日志级别建议统一为 `[costra-startup]` 前缀

- **证据**：`miniprogram/app.ts:31` `console.info('[Costra] onLaunch ...')` + `storage.ts:37` `console.warn('[storage] ensureVersion failed')` + `app.ts:40/53/61` 三处 `[Costra]`
- **问题**：启动期错误可观测性——当前前缀 `[Costra]` vs `[storage]` 两套 · Human 第 7 次实测时若仍复现 `too eayly` · 需在一堆微信 SDK 内部日志里人眼捞 · 建议统一启动期前缀 `[costra-startup]` 便于 Console 搜索（与 dispatch `[COSTRA-124-diag]` 前缀同族）
- **依据**：FU-118-5（`miniprogram/pages/ console.* 统一日志封装` · Sprint-2 已登记）
- **修复建议**：**不在本卡改** · 合入 FU-118-5 Sprint-2 统一 logger 封装卡（`utils/logger.ts` 包装 `wx.getRealtimeLogManager()`）

---

## 与上轮的差异

**N/A**（本 R1 Round-1 · 无上轮产出 Review · card-review Round-1 是独立的**卡定义 Review** · 已 PASS-WITH-FOLLOWUP 26/30 · 2 P1 就地采纳进 dispatch · 3 P2 本 R1 按 history §3.5 决策：P2-1/P2-2 不合并（属 dispatch 元数据层）· P2-3 已合并为 f.1/f.2 · 处理合理）。

---

## 给被审 Agent 的回执指令

**本 R1 Verdict = `PASS-WITH-FOLLOWUP` · 可进 Human T2 终审门前队列（等 DoD (e) Human 模拟器实测后一并走终审）**。

Orchestrator 拉起 `costra-miniapp-dev` 做任何后续动作时，请附上本文件全文，并要求其按以下清单处理：

1. **P1-1**（可选 · 建议补 · 非阻塞）：在 `.team/follow-ups/README.md` 新建 `FU-124-TEST-COVERAGE` 条目（Sprint-2 认领 · 0.2-0.5 点 · 方案见 P1-1 修复建议 1/2）· 若 Human 认为 Sprint-1 末已封板则直接推到 Sprint-2 backlog
2. **P2-1**（建议顺手修）：收尾 commit 或下次 revise 时 · 更新 `docs/devops/libversion-upgrade.md §1.4` + `history §2.4` 两处的 commit sha 回填 · 消除事实源漂移
3. **P2-2**（Sprint-2）：合入 FU-118-5 统一 logger 封装 · 本卡不动

**特别说明**（对 Human）：

- DoD (e) Human 第 7 次模拟器实测 **必须由 Human 触发** · 审查 subagent 无法替代 · 按 dispatch §9 附录 5 条检查清单执行
- 若 (e) 实测 5 条全 PASS → Orchestrator 改 FU status `open → closed` + 补闭合依据 commit sha `a296be0`/`221b074` · 本 R1 可走 T1/T2 Human 终审 approve 路径
- 若 (e) 实测仍复现 `Expected updated data but get first rendering data` → 走 dispatch DoD (c) 路径 ②（诊断不修复 · 另起卡） · 不自动 REVISE 本 R1（因 (a) 修复对 `too eayly` 因果链已独立成立 · 另一半问题属不同因果域）
- 若 Launch Time ∈ [900ms, 935ms] AMBER 区间 → 按 card-review P2-2 已采纳条款走 Human 个案裁决 · 不自动 REVISE

---

## §8 DoD 交付核查表总结

见上方专表（7 条 DoD · 5 PASS + 1 DEFER-TO-HUMAN + 1 IN-PROGRESS）。

**综合交付完成度**：**5/5 AI 可兑现条目全 PASS**（a/b/c/d/f/g 中 g=IN-PROGRESS 属本审查本身）· (e) 等 Human。

---

## §9 SBAI v1.1 审查档第 2 次冒烟反馈

### 1. 实际工具集合

本次审查 subagent `costra-review-tech` 暴露的工具集合：`{Read, Grep, Glob, WebFetch}` · **4 个只读工具**（system prompt 声称 5 个含 LS · 但实际 LS 未暴露 · 与 card-reviewer-tech 首战观察完全一致 · 属两档审查 subagent 共同现象）

### 2. System prompt 审查档物理无写权接收确认

- ✅ System prompt §1.1 "审核范围"接收 · §2 "开工前必读"接收 · §3 "7 维审核 checklist" 接收（C1-C7 + C8 红线）· §4 "Verdict 阈值" 接收（35 分制 · PASS ≥28 / PASS-WITH-FOLLOWUP ≥24 / REVISE <24 或 P0>0 / REJECT 红线）· §5 "输出格式模板" 接收 · §6 "硬约束 7 条"接收（物理无写权 + 证据带路径行号 + 不造新错误码 + 独立性 + 多轮 chain + 信心不足自首 + 审完即销毁）
- ✅ §7 自检清单接收 · 本报告按 7 项清单逐条过

### 3. Write/Edit/Bash 调用次数

- **Write 调用**：0 次
- **Edit 调用**：0 次
- **Bash/execute_command 调用**：0 次
- **delete_file 调用**：0 次
- **越权尝试**：0 次（物理上无此工具入口 · 无从尝试）

### 4. 审查档 SBAI v1.1 第 2 次冒烟结论

**✅ 冒烟通过**。本次审查与 card-reviewer-tech 首战（2026-05-02 21:05）形成**两档审查 subagent 独立隔离的双次证实**：

- card-reviewer-tech（30 分制卡定义审）· 首战 · 独立隔离验证
- review-tech（35 分制产出审）· **第 2 次** · 独立隔离再次验证

两档审查 subagent 的 tools 白名单 `{Read, Grep, Glob, WebFetch}` 在两次独立 spawn 下**完全一致**（均无 Write/Edit/Bash）· 证明 SBAI v1.1 §3.5/§3.6 "审查档永不复用 · 物理无写权 · final message 返回 · Orchestrator 原样落盘" 机制**工程化稳定成立**。

建议 Sprint-1 末 Retro 议题 16 "SBAI v1.1 两档 tools 白名单差异化设计"沉淀为 D-018 §3.5 附录时 · 明文化：**审查档工具集 = `{Read, Grep, Glob, LS?, WebFetch}`（LS 可选 · 两次观察均未暴露）**。

### 5. final message 返回路径验证

- ✅ 本报告完整通过 final message 返回 · 非调用写工具落盘
- ✅ Orchestrator 将原样落到 `.team/reviews/COSTRA-124/round-1-tech.md` · 本审查 subagent 无权感知磁盘落点 · 契约清晰

---

## 自我反思

- **审核耗时估计**：~25 分钟（10 份强制阅读并行 Read + 独立 Grep 自证 4 条 + 分包覆盖面验证 + 7 维打分 + DoD 7 条核查表 + SBAI 冒烟段 + 报告落锤）
- **置信度**：**高**
  - 高信心点：维度 1/2/3/5/7（有直接文件:行号证据 · Grep 独立复现 DoD (b) 结论 · 红线零命中）· DoD (a)(b)(d)(f) 核查（逐条精确到行）
  - 中高信心点：维度 6（可测性）· 判定"无单测兜住"属非阻塞 P1 · 基于 Sprint-1 允许的"可测设计"条款
  - 低信心点：**无**。本卡产出范围清晰 · 无证据模糊处 · 无需转 Human 二裁
- **独立性自证**：本审查仅依据本次 prompt + 磁盘只读 + Grep 工具实际执行结果 · 未引用"记忆中" miniapp-dev 的任何既往产出 · 未参与过 dispatch 起草/R1 实装/card-review · 首次看本卡代码
- **是否建议 Human 二裁**：**否**。Verdict PASS-WITH-FOLLOWUP 明确 · 0 P0 · 1 P1 非阻塞 · 2 P2 可 follow-up · 未触 C8 红线 · (e) DEFER-TO-HUMAN 属设计内 · 无 ESCALATE 必要

---

**报告结束 · 审完即销毁 · 无 state.md / history 累积（SBAI v1.1 §3.5/§3.6 审查 subagent 契约）· final message 返回完整 markdown · 由 Orchestrator 原样落盘到 `.team/reviews/COSTRA-124/round-1-tech.md`。**
