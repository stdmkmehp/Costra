# Costra · Cross-Session Handoff Anchor

> **用途**：新会话接续 Costra 项目时 · Orchestrator（CodeBuddy 装扮）只需 **Read 本文件** 即可 100% 接上进度 · 无需翻遍 `.team/`。
>
> **维护约定**：本文件由当前会话的 Orchestrator 在**每次重大节点**（卡立/Review PASS/FU 闭合/Sprint 转段/决议落地）**同对话轮**更新 §1 + §3 + §6 + §7。Human 无需主动维护，但 Human 可随时要求 Orchestrator 刷新。
>
> **文件纪律**：
> - 禁止删节 §0-§8 骨架（只改节内内容）
> - 版本 bump 走 §8 版本表（极小改动仅改 §1 时间戳可以不 bump）
> - 本文件本身由本会话 @ 2026-05-03 12:41 立案（随 COSTRA-124 Review 末端节点）

---

## §0 一句话断点（HEAD 之前 = 已兑现 · 之后 = 待做）

> **2026-05-03 12:41 当前断点**：COSTRA-124 R1 两份 Review 全绿（card-review 26/30 · review-tech 33/35 · 均 PASS-WITH-FOLLOWUP · 0 P0）· **等 Human 第 7 次模拟器实测 5 条断言** · 结果出来按三路径走（全 PASS 直走 T2 approve + FU 真 closed · 部分问题走 DoD (c) 路径 ② / ③ · 全挂走 REVISE Round-2）。Sprint-1 收官期 · 最后 1 张 fix · 通过则基建线 8 卡全数 CLOSED。

---

## §1 当前节点与待办（**每次会话结束前必须刷新**）

### §1.1 当前时间戳

- **更新时间**：2026-05-03 12:41
- **更新者**：本会话 Orchestrator（HEAD = `20b0e48`）
- **Sprint**：Sprint-1（2026-04-23 ~ 2026-05-06 · **收官期 · 剩 3 天**）

### §1.2 当前在办卡

| 卡号 | Owner | Type | Points | 阶段 | 下一步 |
|---|---|---|---|---|---|
| **COSTRA-124** | miniapp-dev | fix | 1 | **R1 Review 全绿 · 等 Human 实测** | Human E2 触发模拟器第 7 次启动 |
| COSTRA-102 | miniapp-dev | feature | - | 等 Human 人验（长期挂起） | Human 本地验证 |
| COSTRA-117 | devops-ops | fix | - | Todo（未动） | Sprint-2 或 Sprint-1 末扫一下 husky v10 |

### §1.3 Human 下一步动作（**预期**）

Human 方便时（不急）：微信开发者工具 → 清缓存 → 编译 → **首次冷启动** · 对照 `.team/dispatch/COSTRA-124-miniapp-fix-startup-storage-timing.md §9` **5 条检查清单** 逐条贴结果。

5 条断言：

| # | 验证项 | 通过标准 |
|---|---|---|
| 1 | `getGlobalStorage fail: too eayly` | 0 次上报 |
| 2 | `Expected updated data but get first rendering data` | 0 次上报 |
| 3 | Launch Time | ≤ 900 ms（基线 865 ± 35 · 900-935 ms AMBER · Human 个案裁决） |
| 4 | `wx.login` 成功 | Console 出现 `auth.ts:157 [auth] wx.login ok` |
| 5 | 业务链路 | 首页 → 记一笔可进入 |

### §1.4 Orchestrator 接收 Human 实测结果后的三路径响应契约

| 路径 | 触发条件 | 响应动作 |
|---|---|---|
| **α · 全 PASS** | 5 条全绿（含 Launch Time ≤ 900 ms 硬门槛或 AMBER Human approve） | (1) 回填 `docs/devops/libversion-upgrade.md §1.4` commit sha 完整（P2-1 修复）· (2) 改 `.team/follow-ups/README.md` FU-LAUNCH-FIRST-RENDER-RACE `status: open → closed` + 补闭合依据 commit sha + 追写 f.1.B 实测结果 · (3) 更新 `.team/board.md` COSTRA-124 状态到 Done + 划删除线 · (4) 请 Human 走 T2 `approve:COSTRA-124` · CLOSED · Sprint-1 基建线 8 卡全收官 |
| **β · storage PASS 但 "Expected updated data" 复现** | 断言 1+3+4+5 PASS · **断言 2 FAIL** | 走 dispatch DoD (c) 路径 ② · **不在 COSTRA-124 内硬修** · 立 COSTRA-125（新卡）走 D-017 Step 2-4 二次派单诊断不修复 · COSTRA-124 只闭合 storage.ts:29 部分 · FU-LAUNCH 部分 close（仅关 too eayly 分支）· 另一半另起 FU-LAUNCH-FIRST-RENDER-RACE-B |
| **γ · storage 那条复现** | 断言 1 FAIL（仍有 `too eayly`） | R1 修复未达到预期 · spawn `costra-miniapp-dev` 做 `revise-round-2`（D-015）· 按新观察重做根因 · 可能不是 storage.ts:29 唯一触发点 · 或方案 A 未覆盖全部时序路径 |

---

## §2 必读清单（新 Orchestrator 接续时按优先级 Read）

> **约定**：下表从上到下优先级递减 · 首 6 份是**必读** · 剩余是**按需读**（遇到具体问题再查）。

### §2.1 必读（**每次新会话启动都读**）

1. **`.team/HANDOFF.md`** — 本文件 · 锚点入口
2. **`.team/board.md`** — 最后更新行 + COSTRA-124 📌 段（看上轮 Orchestrator 留的节点备注）
3. **`.team/dispatch/COSTRA-124-miniapp-fix-startup-storage-timing.md`** — 当前在办卡完整 dispatch（含 §0 card-review 响应 + §3 修订后 DoD 7 条 + §9 Human 实测清单）
4. **`.team/reviews/COSTRA-124/`** — 两份 Review 全文（`card-review-1-tech.md` 26/30 + `round-1-tech.md` 33/35）· 理解"为什么放行进 Human 终审队列"
5. **`.team/follow-ups/README.md`** — 搜 `FU-LAUNCH-FIRST-RENDER-RACE` 跳到 §519-636（主 FU · 含 f.1.A/f.1.B/f.2 全部预闭合内容）
6. **`.team/members/miniapp-dev/state.md`** — 装扮 subagent 当前状态（§2 active tasks · §6 遗留 · §7 最新时间戳 21:30 / 21:07）

### §2.2 按需（**遇到对应场景才读**）

| 场景 | 文件 |
|---|---|
| 理解 SBAI 框架 | `.team/decisions/D-018-spawn-based-agent-isolation.md` v1.1 |
| 理解验证问题 SOP | `.team/decisions/D-017-verification-problem-response-sop.md` |
| 理解 Review 流程 | `.team/SOP-REVIEW.md` §3/§4/§5 · `.team/SOP-CARD-REVIEW.md` |
| 理解 Human 触发铁律 | `.team/SOP-HUMAN-TRIGGER.md` |
| 理解 revise/response 格式 | `.team/decisions/D-015-unify-respond-revise.md` |
| 看本次 COSTRA-124 根因报告 | `.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`（183 行 · L1-L4 四层根因） |
| 看本次 R1 实装报告 | `.team/members/miniapp-dev/history/2026-05-02-costra-124-r1-implement.md`（122 行 · 5 段模板） |
| Q12 踩坑记录（Subagent frontmatter）| `.team/members/README.md §7` |
| 金额红线 | `.team/decisions/ADR-0002.md` · 本卡不涉金额 |
| 主体红线 | `.team/decisions/D-008.md` · 本卡已合规 |

---

## §3 SBAI v1.1 框架速查（新会话直接可用）

### §3.1 10 个 subagent 已注册（`.codebuddy/agents/costra-*.md`）

| 类型 | Subagent 列表 | 工具白名单 | permissionMode |
|---|---|---|---|
| **装扮档**（6 个） | `costra-miniapp-dev` · `costra-backend-dev` · `costra-pm-writer` · `costra-design-maker` · `costra-devops-ops` · `costra-qa-planner` | `Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite, WebFetch` | `acceptEdits` |
| **审查档**（4 个） | `costra-review-tech` · `costra-review-product` · `costra-card-reviewer-tech` · `costra-card-reviewer-product` | `Read, Grep, Glob, LS, WebFetch`（**物理无写权**） | `default` |

> **冒烟记录**：`costra-miniapp-dev` 两次实战（P2' 20:20 根因报告 · P2' 2nd 21:10-21:30 R1 实装）· `costra-card-reviewer-tech` 一次（P2'' 21:05 卡审）· `costra-review-tech` 一次（2026-05-03 12:02 产出审）· 审查档两次 Grep 自证 tool 集合 `{Read,Grep,Glob,WebFetch}` 0 写调用 · 物理隔离稳定成立。

### §3.2 Spawn 模板（Context Injection Contract §A~§H · D-018 §3.3）

新会话 spawn 时必含：
- §A 角色规则（inline `.team/agents/0x-*.md` 全文）
- §B 公共契约（COMMON-CONTRACT §0/§0-Bis/§4/§8ter）
- §C 卡主 state.md（审查角色可略）
- §D 最近 history（1-3 份相关）
- §E 项目全景（Sprint 状态 + 最近 commit + 相关决策）
- §F 本次任务（卡号 + DoD + Round-N 要求 + diff inline）
- §G 强制阅读清单
- §H 硬约束

> **Q12 踩坑纪律**：`tools` 字段必须 **逗号分隔字符串** · 不可用 JSON 数组（CodeBuddy 解析失败）· 详见 `.team/members/README.md §7`。

---

## §4 规约铁律速查（必须遵守 · 新会话不可违反）

| 铁律 | 来源 | 核心 |
|---|---|---|
| **Human 唯一触发** | SOP-HUMAN-TRIGGER · D-018 §7 | 跨轮任何动作需 Human 显式触发 · 例外：Review 闭环内 Revise↔Review 同对话轮连续 spawn（D-011 豁免）|
| **事实源三证** | D-017 v1 | 修代码前 `git ls-files` + `git log` + `git show HEAD:` 三证齐全 · 禁止凭"记忆"改 |
| **绕 hooks 禁令** | I-011 | 禁止 `--no-verify` · 禁止 `git push --force` |
| **单卡即提交** | D-012 | 每张卡独立 commit · 允许按 scope 拆 2 个以上 |
| **Subject 全小写** | commitlint | commit subject 首字母 + 卡号全部小写（`COSTRA-124` 放 footer `Refs:` 可大写）|
| **审查档无写权** | D-018 §3.5 + COMMON-CONTRACT §0-Bis | 审查 subagent `tools` 物理白名单排除 Write/Edit/Bash · 仅 final message 返回 |
| **FU 预闭合不真 close** | 本会话 COSTRA-124 范式 | Human 实测未通过前 FU status 保持 `open` · 仅追写 f.1/f.2 段 |
| **金额/主体红线** | ADR-0002 · D-008 | 金额必经 `decimal.js` · 主体字样不进 `miniprogram/.ts/.wxml/.wxss/.json` 打包源码 |

---

## §5 本会话 10 commits 溯源（`e11a58f → 20b0e48`）

```
20b0e48 docs(repo): costra-124 review-tech round-1 pass-with-followup 33/35  ← HEAD
221b074 docs(repo): startup api call audit + libversion upgrade methodology
a296be0 fix(miniapp): move ensureversion from storage top-level to app onlaunch
f2fbd4c docs(repo): costra-124 card-review round-1 response · pass-with-followup 26/30
b66eda8 docs(repo): costra-124 card definition · startup storage timing fix
1c28fb9 docs(repo): sbai v1.1 p1' step 3b · batch 9 subagents
4dcf733 docs(repo): sbai v1.1 frontmatter pitfall · tools must be csv
1391436 docs(repo): sbai v1.1 p1' step 3a sample + p2' smoke evidence
331724b docs(repo): d-018 sbai decision stele (v1.0+v1.1) · fu observation #3
e11a58f docs(repo): sbai v1.0 p1 merge · align sop family with sync subagent
7ad6ea5 fix(repo): add npm bridge config for decimal.js runtime loading (COSTRA-123)  ← 上轮 Sprint-1 收官 commit
```

本会话累计：**10 commits · 68 files · +8163 行**。

---

## §6 Sprint-1 末残留议题 / FU 队列（Sprint-1 末 Retro 必议）

### §6.1 重大议题

| # | 议题 | 来源 |
|---|---|---|
| 15 | "独立复核可翻转历史定性"范式明文化 → D-018 §3.5 附录 | 本会话 FU-LAUNCH 定性翻转事件 |
| 16 | SBAI v1.1 两档 tools 白名单差异化（装扮档 vs 审查档）沉淀为 D-018 §3.5 附录 | 本会话 P2'' + review-tech 双次冒烟证据 |
| 13 | Review-Tech 评分表加"runtime 加载性"维度（P0 升级）| COSTRA-123 过程复盘 |
| 10 | Sprint-0 骨架期微信规约债务**系统化主动盘点**（当前被动剥洋葱已到第 6 层）| COSTRA-119/120/121/122/123/124 同族链 |
| 11 | Review 35/35 可能基于错误假设 · "Human 实测闸"作为 runtime 规约类 T2 卡终审绝对证据 | COSTRA-121 事后证伪 |
| 12 | 同族规约盲区紧迫性（升 P0 强制）| 同上 |
| 14 | D-017 §2.3 新增 E4 例外（Human 默示/明示接受代职分析合规化）| COSTRA-123 实战 |

### §6.2 FU 队列（按优先级）

| FU-ID | 状态 | owner_card |
|---|---|---|
| FU-LAUNCH-FIRST-RENDER-RACE | **`open`** · 预闭合 f.1/f.2 齐备 · **等 Human 第 7 次实测** | COSTRA-124（本卡即闭合）|
| FU-124-P2-1/2/3 | `open` · R1 实装时未合并（属 dispatch 元数据层） | Sprint-1 末 Retro 或 Sprint-2 |
| FU-CI-MP-BUILD-NPM-ENFORCE | `open` | Sprint-2 候选 |
| FU-REVIEW-TECH-RUNTIME-DIM | `open` · P0 议题 | Sprint-1 末 Retro |
| FU-102-SYNC-PULL-DRIFT | `open` · 高优 | Sprint-1 末 Retro 头部 |
| FU-102-HUMAN-VERIFY-PARADIGM | `open` | Sprint-1 末 SOP-REVIEW v2.1 §11 |
| FU-118-3/4/5 | `open` | Sprint-2 |
| FU-001 / FU-118-2 | `open` | Sprint-2 Epic-F 合并 |

> 完整列表见 `.team/follow-ups/README.md`（截至 2026-05-02 21:30 · 约 700 行）。

---

## §7 新 Orchestrator 接续 Checklist（**严格按此 7 步进入工作状态**）

> Human 新会话首条消息只需说："**继续 Costra · 读 `.team/HANDOFF.md` 接续**" · Orchestrator 按以下 7 步自检 · 全绿方可发第一个响应：

1. ☐ Read 本 HANDOFF.md 全文
2. ☐ Read §2.1 必读清单 6 份
3. ☐ `git log --oneline -5` 确认 HEAD 与 §5 一致（或更新后）· 若漂移 → 更新 §5 + §0
4. ☐ `git status -s` 确认工作树干净（如非干净 → 先报给 Human）
5. ☐ 对照 §1.2 Human 实测断点 · 理解 §1.4 三路径响应契约
6. ☐ 对照 §4 铁律 · 下意识不违反
7. ☐ 向 Human 发"接续完成"简短 ACK（≤ 5 行）· 明示"已读 HANDOFF + 6 份必读 + 等你实测结果/下一步指令"· **不主动跑任何工具** · 等 Human 明确触发

**接续 ACK 模板**：
```
接续完成 · HEAD 20b0e48 · 工作树 clean · 已读 HANDOFF + board + dispatch +
reviews + FU-LAUNCH + miniapp-dev state.md · 当前断点：COSTRA-124 R1 两份 Review
全绿 · 等你第 7 次模拟器实测 5 条断言结果 · 按 §1.4 三路径 α/β/γ 响应。
```

---

## §8 版本表

| 版本 | 日期 | 维护者 | 变更 |
|---|---|---|---|
| v1.0 | 2026-05-03 12:41 | 本会话 Orchestrator | 立案 · 随 COSTRA-124 R1 Review 末端节点 · 会话 10 commits 末端（HEAD = 20b0e48） |

---

**本文件由 Orchestrator 在断点时刻维护 · Human 无需直接编辑 · 新会话接续只需 Read 即可。**
