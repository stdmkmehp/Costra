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

> **2026-05-08 20:16 当前断点**：🏆 **Sprint-1 主线 + 启动期治理叙事终极收官** · 5 卡合并终审 APPROVED CLOSED（102/125/126/127/128 @ 19:11）· FU-LAUNCH 族 5 卡完整闭环（124 顶层副作用 + 125 业务全 async + 126 lib 升级 + 127 业务时序 + 128 注释清洗）· 4 次定性翻转 v1→v2→v3→v4→v5 · v5 唯一定稿 · Sprint-1 14 卡 100% CLOSED · 26 commits 已 push origin/dev · 工作树 clean · **下一步 = Human 主动决策 G4 合并闸门 + Sprint-2 立卡（COSTRA-103 本地持久化优先）**。本会话因上下文过长 · Human 决定开新会话接续 · 本 HANDOFF 用作锚点。

---

## §1 当前节点与待办（**每次会话结束前必须刷新**）

### §1.1 当前时间戳

- **更新时间**：2026-05-09 09:44
- **更新者**：本会话 Orchestrator（HEAD 待本轮 commit 落盘 D-019 + HANDOFF v1.4 + board · 上一 HEAD = `8c93c73` HANDOFF v1.3 落盘 · 已 push origin/dev · 工作树本轮新增 3 文件改动）
- **Sprint**：✅ **Sprint-1 收官 @ 2026-05-09 09:44**（2026-04-23 ~ 2026-05-08 · 14 卡 100% CLOSED · G4 PASS · D-019 决议）/ ⏳ **Sprint-2 Planning 中**（2026-05-10 ~ 2026-05-23 · 周期 2 周 · 总估点目标 32~36）

### §1.2 当前在办卡

| 卡号 | Owner | Type | Points | 阶段 | 下一步 |
|---|---|---|---|---|---|
| **无在办卡** | — | — | — | Sprint-2 Planning 中 | 等 Human 触发 `run pm COSTRA-106`（Retro · Sprint-2 第 1 张）|

#### Sprint-1 全数 CLOSED 索引（14 卡）

| 类别 | 卡号 | 终审时间 |
|---|---|---|
| **主线** | COSTRA-102 | 2026-05-08 19:11 (T1 APPROVED · Mock + 本地 server 实测) |
| **基建** | 100 / 101 / 115 / 116 | Sprint-1 中前期 |
| **同族盲区** | 119 / 120 / 121 / 122 / 123 | Sprint-1 中前期 |
| **启动期治理 5 卡（FU-LAUNCH 族）** | **124 / 125 / 126 / 127 / 128** | **2026-05-08 19:11（5 卡合并终审）** |
| **审计** | 118 | 已 CLOSED |
| **未触发** | 114（DevOps bootstrap 卡定义已批 · 未开工） | 留 Sprint-2 |

### §1.3 Human 下一步动作（**预期 · 按优先级**）

1. **🟡 Sprint-1 末 G4 合并闸门决策**（已超期 2 天 · 议题 14+ 条就绪 · 见 §6.1）
2. **🟢 Sprint-2 立卡**：COSTRA-103（本地持久化 + outbox · 已解锁）/ Epic-D 家庭共享 / Epic-E 预算 / Epic-F 报表
3. **🟢 真 staging 验证**（COSTRA-102 方式 C · 留 Sprint-2 提审前 · ICP 下证 + 白名单后跑手册步骤 1/2/5）
4. **🟢 被动等**：ICP 备案首审短信 / 订阅消息文案 v0.1 / 隐私指引清单
5. **ICP 下证日（估 5 月中下旬）**：配 `api.costra.cloud` 微信白名单 → 发 `close:R-013`

### §1.4 Sprint-1 治理范式资产（5 卡簇定稿 · v5）

**FU-LAUNCH 族 4 次定性翻转**（重要事故学习记录）：

| 版本 | 定性 | 卡号 | 状态 |
|---|---|---|---|
| v1~v2 | 误判 · 见 history | 124 | 已修正 |
| v3 | SDK + 业务共责（onLaunch 同步 storage） | 125 | 被 v4 证伪 |
| v4 | SDK race · 业务无责 | 126 | 被 v5 证伪 |
| **v5（定稿）** | 双因（SDK race · lib 3.8+ 修复 + 业务 onShow setData 时序竞速 · COSTRA-127 修复） | **127** | **唯一定稿** |

**v5 定稿存于**：`docs/devops/libversion-upgrade.md §3.4`（COSTRA-128 已清洗 · 删除 v3/v4 全文 · 仅留 v5 + 4 行版本演进表）

---

## §2 必读清单（新 Orchestrator 接续时按优先级 Read）

> **约定**：下表从上到下优先级递减 · 首 6 份是**必读** · 剩余是**按需读**（遇到具体问题再查）。

### §2.1 必读（**每次新会话启动都读**）

1. **`.team/HANDOFF.md`** — 本文件 · 锚点入口
2. **`.team/board.md`** — 最后更新行 + Sprint-1 Done 段（14 卡终审记录）
3. **5 张 FINAL.md**（5 卡合并终审 · 含 SOP 偏差合规说明）：
   - `.team/reviews/COSTRA-102/FINAL.md`（T1 主线 · Mock + 本地 server 实测）
   - `.team/reviews/COSTRA-125/FINAL.md`（T2 fix · 跨 lib 实测兜底）
   - `.team/reviews/COSTRA-126/FINAL.md`（T3 chore 自动关闭）
   - `.team/reviews/COSTRA-127/FINAL.md`（**T2 fix · review-tech R1 跳过 · Human 终审吸收 R1 职责** · 议题 17 实战二次兑现）
   - `.team/reviews/COSTRA-128/FINAL.md`（T3 chore · 删比加多 -57/+17）
4. **`docs/devops/libversion-upgrade.md`** — v5 定稿（COSTRA-128 清洗后唯一定稿 · §3.4 + §3.5 反模式 #5 + §3.6 反模式 #6 + §4 跨 lib 对照表）
5. **`.team/follow-ups/README.md`** — Sprint-2 转移 FU 队列（FU-DB-OPS-AUDIT 首位 + FU-LIBVERSION-DEV-GUARD + FU-102-* 5 条 + 旧 FU-118-* 等）
6. **`.team/members/miniapp-dev/state.md`** — 装扮 subagent 当前状态（active tasks 已清空 · §6 已大幅清洗）

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
| **装扮档**（6 个） | `costra-miniapp-dev` · `costra-backend-dev` · `costra-pm-writer` · `costra-design-maker` · `costra-devops-ops` · `costra-qa-planner` | `Read, Write, Edit, MultiEdit, Bash, Grep, Glob, LS, TodoWrite, WebFetch` | **`bypassPermissions`**（2026-05-08 改造 · 见 commit `4399ee9`）|
| **审查档**（4 个） | `costra-review-tech` · `costra-review-product` · `costra-card-reviewer-tech` · `costra-card-reviewer-product` | `Read, Grep, Glob, LS, Bash, WebFetch`（**物理无文件写权 · Bash 仅只读语义**）| **`bypassPermissions`** |

> **2026-05-08 改造**：原 `acceptEdits` / `default` 全部改为 `bypassPermissions` · 4 个 reviewer 加 `Bash`（仅只读纪律）· 全员追加破坏性命令禁令段（push --force / reset --hard / rm -rf 项目根 / npm publish 等）· devops-ops 加生产高危 Human 显式拍板红线（terraform apply / kubectl apply / miniprogram-ci upload）。
>
> **冒烟记录**：本 Sprint-1 累计 5 次实战（miniapp-dev × 5 · card-reviewer-tech × 1 · 详见各卡 history）。审查档物理隔离稳定成立。

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

## §5 本会话 commits 溯源（2026-05-04 ~ 2026-05-08 · 26 commits 已 push origin）

```
fbac38a chore(db): extract ops audit todo to docs/db prework + ignore .cloudbase  ← HEAD（已 push）
a7a4d3a chore(repo): 5-card merged approval · sprint-1 final closure (COSTRA-102/125/126/127/128)
a77ffce docs(repo): costra-128 libversion v5 finalize + state.md cleanup (COSTRA-128)
d321b58 chore(miniapp): cleanup v3/v4 narrative comments in storage/home/mine/app (COSTRA-128)
fd7302e chore(repo): costra-127 human verify pass · fu-launch-c true closed (COSTRA-127)
737595a docs(repo): costra-127 fu-launch-c true-close + libversion v5 + anti-pattern #6
1c640f0 fix(miniapp): replace switchTab with reLaunch + onShow bootstrap gate
4399ee9 chore(repo): subagent bypassPermissions + reviewer Bash readonly
3903b9c docs(repo): costra-126 libversion-upgrade v4 + anti-pattern #5 + costra-125 close (COSTRA-126)
c52fd7f chore(miniapp): bump libversion 2.32.3 to 3.8.12 dev (COSTRA-126)
d85d040 docs(repo): costra-125 r1 fu-launch f.4 + startup-audit r2 audit
4643f89 fix(miniapp): migrate storage/auth/sync to async api + bootstrap promise (COSTRA-125)
ca27d88 docs(repo): costra-125 card-review-1-tech pass-31/35 + 4 p2 followup
6d1a6c2 docs(repo): costra-125 立卡 + costra-124 r2 诊断 + fu-launch 分裂 a/b/c
42494f1 docs(repo): add cross-session handoff anchor for orchestrator continuity
20b0e48 docs(repo): costra-124 review-tech round-1 pass-with-followup 33/35  ← v1.0 立案点
... (更早 v1.0 之前 commit 见 git log)
```

**累计**：5 卡簇治理（124~128）+ 主线终审（102）+ subagent 改造 + DB ops 搬迁 = **26 commits 已 push origin/dev**。

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
| FU-LAUNCH-FIRST-RENDER-RACE | **分裂为 A/B/C** · **A closed** @ COSTRA-124（commit `a296be0` · 顶层副作用分支）· **B open** · 等 COSTRA-125 修复 · **C open** · 等实测判定 | COSTRA-124 / 125 |
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
| v1.1 | 2026-05-03 20:32 | 本会话 Orchestrator | R1 假设 Human 第 7 次实测证伪 → R2 诊断定性翻转 v3 → Human 全按推荐 → COSTRA-125 立卡 + COSTRA-124 部分闭合 + FU-LAUNCH 分裂 A/B/C + libversion-upgrade §3 反模式 #4 追写 · §0/§1/§2.1/§6 全面刷新 |
| **v1.2** | **2026-05-04 08:30** | 本会话 Orchestrator | **COSTRA-125 Card-Review R1 PASS 31/35**（第 3 次 spawn 成功 · 前 2 次 Idle timeout 后 Human 选 P1 再试）· dispatch §0 补响应段 + 4 P2 记 state.md §6 · §0/§1.1/§1.2 刷新 · 下一步 spawn miniapp-dev R1 实装 |

---

**本文件由 Orchestrator 在断点时刻维护 · Human 无需直接编辑 · 新会话接续只需 Read 即可。**
