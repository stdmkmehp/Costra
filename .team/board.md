# Costra 任务看板

> 由 PM-Agent 维护，所有 Agent 可读，状态流转必须经过 Orchestrator。
> 约定流转：`Backlog → Todo → Doing → AI-Review → Human-Review → Done`，Blocked 为横向态。
> **AI-Review 说明**：Backend/MiniApp 产出先走 `Review-Agent-Tech`；PM/Design 产出先走 `Review-Agent-Product`；DevOps/QA/决策类不走 AI-Review。详见 `.team/SOP-REVIEW.md`（2026-04-24 合并版 · 原 SOP-REVIEW-LOOP + SOP-REVIEW-AUTOLOOP 已降为 stub）。
> **🆕 自动循环（D-011 · 2026-04-23 生效 · D-016 同轮兑现 · 2026-04-24 19:10）**：AI-Review 列内 `Revise↔Review` 自动推进，无需 Human 逐轮触发；打断用 `pause-review` / `stop`，详见 `.team/SOP-REVIEW.md §10`。
> **🆕 场景分级（D-013 · 2026-04-23 21:15 生效）**：Review 分 T1 准入 / T2 Gate 前 / T3 追溯 / T4 回归 四档。T1/T2 必走 Human-Review；**T3/T4 在 AI-PASS + 残余 P0/P1=0 + 无红线 + 无新阻塞时自动关闭**。Human 随时可发 `reopen-review` 复议。详见 `.team/decisions/D-013-review-scenario-tiering.md`。
> **🆕 卡定义 Review + Review 自动拉起（D-014 · 2026-04-23 22:26 生效）**：(a) 2026-04-23 22:26 后新建的卡**必须**经卡定义 Review（技术向→Review-Tech / 产品向→Review-Product）；(b) 被审 Agent 交付后**产出 Review 首轮自动拉起**（无需 Human 触发）；(c) 历史卡豁免；(d) DevOps/QA/决策类豁免；(e) Human 打断指令（`pause-review` / `skip-card-review` / `force-card-pass` / `stop`）最高优先级。详见 `.team/decisions/D-014-card-review-and-auto-review-kickoff.md` + `.team/SOP-CARD-REVIEW.md`。
> **🆕 验证问题响应 SOP（D-017 · 2026-04-28 13:59 Human 立案 · 14:15 落盘）**：项目遇到验证失败时标准流程 —— ① 责任领域识别（Orchestrator 30s） → ② 责任 Agent 根因分析（只诊断不改文件） → ③ 多方案对比（≥2~3 方案 · 列成本/价值/风险 + Human 决策点 Qn） → ④ Human 评估裁决 → ⑤ 派单实装。**禁止 Orchestrator 自行分析根因**（反模式 A） · E1/E2/E3 例外 · 反模式 ABCD 禁令 · COSTRA-120 首次实战。详见 `.team/decisions/D-017-verification-problem-response-sop.md`。
> **🔄 D-011 实战验证三次通过**（2026-04-23）：COSTRA-100（2 轮 · 69 min） + Sprint-0 补审（7 卡 × 2 轮 · 29 min 并行） + **COSTRA-101 Round 1 刚自动拉起（22:49 · D-014-b 首次实战）**

最后更新：`2026-05-09 10:39`（Orchestrator · 🏆 **COSTRA-106 Human T2 APPROVED CLOSED @ 10:39** · `approve:COSTRA-106` · Sprint-2 第 1 张 Retro 卡满分收官 · 双 30/30 满分范式（Card-Review 30/30 + R1 Product Review 30/30）· pm-writer 首次实战 0 漏项 · SBAI v1.1 第 6 次冒烟成功 · 审查档第 3 次实战 · D-016 第 13~14 次实战合规 · 立卡到终审 30 分钟 · 20 项议题全落地（含 D-020/D-021/D-022 三决议产出）· 解锁 Sprint-2 主线 COSTRA-103 立卡 · `.team/reviews/COSTRA-106/FINAL.md` 落盘）
>
> （上一条归档）`2026-05-09 09:44`（Orchestrator · ✅ **G4 合并闸门 PASS · Sprint-1 收官 · Sprint-2 Planning 中** · 路径 A 决议落盘 `.team/decisions/D-019-g4-sprint-1-closure.md`（议题 10~17 + D-016 升定稿 + D-017 v3 升级 + 紧急卡五连溢出 14+ 议题转 COSTRA-106 Retro 卡 · Sprint-2 周期 2026-05-10~05-23 · 总估点目标 32~36）· FU-102-* 5 条 + FU-DB-OPS-AUDIT + FU-LIBVERSION-DEV-GUARD 等转 Sprint-2 · 下一步 Human 触发 `run pm COSTRA-106`（Retro · Sprint-2 第 1 张）· 接续 `run miniapp COSTRA-103`（本地持久化 · 5 点 · Sprint-2 主线）· HANDOFF v1.4 + board 同轮刷新）
>
> （上一条归档）`2026-05-03 20:32`（Orchestrator · 🆕 **COSTRA-125 立卡**：启动期 storage 异步化 · onLaunch 内同步调用根因解决 · 2 点 · P1 · 方案 B'+E' 合并版（异步 API 全量 + bootstrap Promise）· **COSTRA-124 R1 假设 Human 第 7 次模拟器实测证伪** · R2 诊断翻转为定性 v3（SDK + 业务共责 · 渲染层 storage group `_prepare` 就绪晚于 App.onLaunch）· **COSTRA-124 部分闭合**（顶层副作用子目标 close · commit `a296be0` 架构正确保留）· FU-LAUNCH 分裂为 A/B/C 三子 FU · A close · B/C open 交棒 COSTRA-125 · D-017 第 5 次实战 · SBAI v1.1 P2' 冒烟第 3 回产物）
>
> （上一条归档）`2026-05-02 20:58`（Orchestrator · 🆕 **COSTRA-124 立卡**：启动期 storage 时序修复 + FU-LAUNCH 闭合 · 1 点 · P1 · SBAI v1.1 P2' 冒烟产物驱动 · D-017 第 4 次实战 · 装扮 subagent `costra-miniapp-dev` 独立核查推翻前 3 次 FU 定性 · 坐实 `storage.ts:29` 顶层副作用 · 本卡 Sprint-1 收官最后一张 fix · 走 `costra-card-reviewer-tech` 预审 + `costra-miniapp-dev` 实装 + `costra-review-tech` R1 审查 · Human E1 路径末端实测）
>
> （上一条归档）`2026-05-01 21:28`（Orchestrator · 🏆 **COSTRA-123 Human T2 APPROVED CLOSED @ 2026-05-01 21:28** · 第 6 次模拟器启动实测贯通 · `auth.ts:157 [auth] wx.login ok {codeLen: 32}` · decimal.js 运行时错误彻底消失 · Launch Time 865 ms · **同族规约盲区第 5 次完整闭环**（119 文件 + 120 tabBar + 121 工具链 + 122 .json loader + 123 npm 包 loader）· D-017 第 3 次实战**完整闭环 · 首次完整走完 Step 1~5 含 Review-Agent-Tech 过程复盘独立产出** · D-016 第 12 次实战合规 · AI 全流程 11 分钟 · Human 终审 15 分钟 · Sprint-1 基建线 7 卡全数 CLOSED · Sprint-1 总估点 47→48）

---

## 🗂 Backlog（需求池，详见 backlog.json）
- Epic-A 账号体系（微信登录）
- Epic-B 单人记账
- Epic-C 本地存储 + 云同步
- Epic-D 家庭共享（邀请码 + 微信分享 + 订阅消息）
- Epic-E 预算 / 周期账单
- Epic-F 统计报表
- Epic-G 上线与运营（微信审核 / 分阶段发布）

## 📋 Todo · Sprint-1（2026-04-23 ~ 2026-05-06，2 周）

| 卡号 | 标题 | Owner | 依赖 | 估点 |
|---|---|---|---|---|
| COSTRA-100 | G3-gaps-plus 补齐（error-codes / ErrorCode 枚举 / TTL / id-strategy / sync-protocol） | Backend-Agent | D-006 | 3 |
| COSTRA-101 | 微信登录 `/auth/login` + `/auth/refresh` + `/auth/logout` 实装 | Backend-Agent | COSTRA-100 | 5 |
| COSTRA-102 | MiniApp 登录 → 首页 → 记一笔 端到端（非 Mock） | MiniApp-Agent | COSTRA-101 | 5 |
| COSTRA-103 | 本地 SQLite/IndexedDB 持久化 + outbox_queue | MiniApp-Agent | COSTRA-100 | 5 |
| COSTRA-104 | `/entries` CRUD + `/sync/push` 批量通道 | Backend-Agent | COSTRA-100/103 | 6 |
| COSTRA-105 | 单人记账闭环冒烟（含离线弱网） | QA-Agent | COSTRA-102/104 | 3 |
| COSTRA-106 | Sprint-0 Retro + 工程度量刷新 | PM-Agent | D-006 | 1 |
| COSTRA-107 | ICP 备案发起辅助文档（域名/主体/准备材料清单） | PM-Agent | - | 1 |
| COSTRA-108 | miniprogram-ci 上传演练（key 已落位） | DevOps-Agent | D-007 | 3 |
| COSTRA-109 | 隐私指引填写辅助清单（对照微信后台表单） | PM-Agent | D-007 | 1 |
| COSTRA-110 | 订阅消息 ×3 文案草稿（邀请/超支/新增记账） | PM-Agent | D-007 | 1 |
| COSTRA-111 | 主体可替换字段清单 `docs/ops/subject-compat-matrix.md` | PM-Agent | D-008 | 1 |
| COSTRA-112 | `miniprogram/config/subject.ts` + 硬编码主体字样清扫 | MiniApp-Agent | D-008 | 1 |
| COSTRA-113 | `server/src/config/subject.ts` + `.env.production.example` 补 SUBJECT 段 | Backend-Agent | D-008/COSTRA-100 | 1 |
| COSTRA-114 | 开发服务器 bootstrap（SSH 加固/防火墙/docker/nginx+自签 HTTPS） | DevOps-Agent | D-009 | 2 |
| COSTRA-115 | `costra.cloud` DNS 子记录 + 白名单一致性 CI 校验 | DevOps-Agent | D-009 | 1 |
| COSTRA-117 | husky v10 兼容：清理 `.husky/{pre-commit,commit-msg}` DEPRECATED header（删 shebang + `_/husky.sh` 引用两行） | DevOps-Agent | - | 1 |
| 🆕 COSTRA-118 | miniprogram 技术债专项普查（审计类 · 单轮即报即结 · Owner=Review-Tech） | Review-Agent-Tech | COSTRA-030/100/101 | **0**（不计估点） |
| ~~COSTRA-119~~ | ~~app.json 分包声明↔文件系统一致性修复 + CI 对账（FU-COMMON-APP-JSON-DRIFT 专项）~~ | ~~MiniApp-Agent~~ | ~~COSTRA-115/116~~ | ~~2~~ **（2026-04-28 13:48 · 整卡 CLOSED · 移至 Done · ⚠️ P0 逃逸 ×2 由 120/121 修复）** |
| ~~COSTRA-120~~ | ~~tabBar 分包规约违反修正 + CI Rule-4 规约级升级（FU-COMMON-APP-JSON-DRIFT-TABBAR 专项 · P0 逃逸修复卡）~~ | ~~MiniApp-Agent~~ | ~~COSTRA-119~~ | ~~2~~ **（2026-04-28 15:44 · 整卡 CLOSED · 移至 Done · ⚠️ 同族盲区第 3 次由 121 修复）** |
| ~~COSTRA-121~~ | ~~**project.config.json 工作区恢复 + miniprogram 子副本删除 + CI Rule-5 工具链单源兜底**（FU-COMMON-PROJECT-CONFIG-DRIFT 专项 · 同族规约盲区第 3 次 · D-011 SSOT 工具链层首次实战）~~ | ~~MiniApp-Agent（跨区第 4 次）~~ | ~~COSTRA-119/120~~ | ~~2~~ **（2026-04-28 19:26 · 整卡 CLOSED · 移至 Done · ⚠️ 核心假设被 122 实测证伪 · 物理修复仍必要）** |
| ~~COSTRA-122~~ | ~~**tokens/index.ts JSON import runtime 兼容性修复**（FU-TOKENS-JSON-RUNTIME-IMPORT 专项 · 同族规约盲区第 4 次 · 121 假设证伪的 runtime 层补位 · 单文件内联常量）~~ | ~~MiniApp-Agent~~ | ~~COSTRA-121（物理前置）· COSTRA-011（tokens SSOT）~~ | ~~1~~ **（2026-04-29 10:41 · 整卡 CLOSED · 移至 Done · 🏆 D-017 v2 升级双重强证据收官）** |
| ~~COSTRA-123~~ | ~~**MiniApp npm 构建桥接 + 验证手册补丁**（FU-MINIAPP-NPM-BRIDGE 专项 · 同族规约盲区第 5 次 · `packNpmRelationList` 桥接根 `package.json` → `./miniprogram/` + 手册 §0.3.1）~~ | ~~MiniApp-Agent~~ | ~~COSTRA-102 R1 · COSTRA-121（工具链前置）· COSTRA-122（runtime 先例）~~ | ~~1~~ **（2026-05-01 21:28 · 整卡 CLOSED · 移至 Done · 🏆 D-017 第 3 次实战首次完整走完五步 · Tech 34/35）** |
| ~~COSTRA-124~~ | ~~**启动期 storage 时序修复 + FU-LAUNCH 闭合**~~（移至 Sprint-1 Done · COSTRA-127/128 终极收官 · 见下） | ~~MiniApp-Agent~~ | ~~COSTRA-123~~ | ~~1~~ **（2026-05-08 19:11 · 整卡完全闭合 · 移至 Done）** |
| ~~COSTRA-125~~ | ~~**启动期 storage 异步化 · onLaunch 内同步调用根因解决**~~（移至 Sprint-1 Done · 见下） | ~~MiniApp-Agent~~ | ~~COSTRA-124~~ | ~~2~~ **（2026-05-08 19:11 · 整卡 CLOSED · 移至 Done）** |

> 📌 **🆕 COSTRA-123 新增自 2026-05-01 21:02**（Human 触发 · 方案 A · **同族规约盲区第 5 次紧急修复** · Human 按 `costra-102-human-verify.md §1.1` 验证时 `import Decimal from 'decimal.js'` 撞 `module 'utils/decimal.js' is not defined` · D-017 第 3 次实战 · 首次完整走完 Step 1~5 含 Review-Agent-Tech 过程复盘独立产出 · 号段续 11x~12x 域 ✅）。
>
> 📌 **🆕 COSTRA-124 新增自 2026-05-02 20:58**（Human 触发 · 方案 A · **启动期 storage 时序修复 + FU-LAUNCH 闭合** · D-017 第 4 次实战 · **SBAI v1.1 P2' 冒烟产物驱动**（装扮 subagent `costra-miniapp-dev` 独立核查推翻前 3 次"SDK 内部 bug · 非业务"定性 · 坐实 `storage.ts:29` 顶层副作用因果链 · L1-L4 四层根因 + 方案 A/B/C + Q1-Q6 Human 20:31 全按推荐拍板）· card-reviewer-tech **P2'' 冒烟合一** · 号段续 12x 域 ✅）。**🚨 2026-05-03 20:09 Human 第 7 次模拟器实测 R1 假设证伪**（`too eayly` 复现 ×7 + Launch Time 1864 ms · onLaunch 时渲染层 storage group `_prepare` 仍未就绪）· **本卡部分闭合**（顶层副作用子目标 close · 架构价值保留）· 剩余根因交棒 **COSTRA-125**。
>
> 📌 **🆕 COSTRA-125 新增自 2026-05-03 20:32**（Human 触发 D1/D2/D3 全按推荐 · **方案 B'+E' 合并版** · D-017 第 5 次实战 · **SBAI v1.1 P2' 冒烟第 3 回产物驱动**（装扮 subagent `costra-miniapp-dev` R2 诊断定性翻转 v2→v3 · L3 普查发现 R1 漏网点 `auth.ts:70 getItem(TOKEN_KEY)` 在 `async initAuth` 体内 await 前同步执行 · 6 方案对比 + 8 Q 决策点）· 定性 v3："SDK 2.32.3+ 渲染层 storage group `_prepare` 就绪晚于 App.onLaunch · 任何 onLaunch 内同步 storage 调用必撞 `too eayly` · SDK + 业务共同责任" · FU-LAUNCH 分裂 A/B/C 三子 FU · COSTRA-124 R1 commit `a296be0` 保留不撤回 · 号段续 12x 域 ✅）。

> 📌 COSTRA-106（Sprint-0 Retro）延至 Sprint-2 头部；COSTRA-116（ICP 进度追踪）并入 PM 常规不计点（D-009 §3）。
> 📌 COSTRA-117 新增自 2026-04-23 20:52（commit 29d1849 时观测到 husky v10 DEPRECATED 警告；v10 升级后会 FAIL，现在清理属低成本预防）。**号段说明**：跳过 116（已占用 ICP 追踪），续号 117 属 11x 扩展与基建域 ✅。
> 📌 **COSTRA-118 新增自 2026-04-24 19:30**（Human 触发 · 专项审计卡 · 不计估点 · 参照 COSTRA-106 "审计/Retro 性质" 先例 · D-014 审计类特殊路径 · Sprint-1 总估点保持 40）。
> 📌 **COSTRA-119 新增自 2026-04-27 20:28**（Human 触发 · 方案 B · Human 按 costra-102-human-verify.md §1.1 打开微信开发者工具时模拟器启动失败 · 跨区交付由 MiniApp 主驾 · 参照 COSTRA-116 先例）。
> 📌 **🆕 COSTRA-120 新增自 2026-04-28 14:22**（Human 触发 · 方案 A · **COSTRA-119 P0 逃逸紧急修复** · Human 模拟器二次启动失败暴露 tabBar 规约违反 · D-017 首次实战 · 跨区交付由 MiniApp 主驾 · 号段说明：续号 120 属 11x~12x 扩展与基建域 ✅）。
> 📌 **🆕 COSTRA-121 新增自 2026-04-28 16:55**（Human 触发 · 方向 A · **119/120 同族规约盲区第 3 次紧急修复** · Human 模拟器**第三次启动失败**暴露工具链 SSOT 双向破坏 · D-017 第 2 次实战 · D-011 SSOT 规约**工具链层首次实战** · 跨区交付由 MiniApp 主驾第 4 次 · 号段续 11x~12x 域 ✅）。

**Sprint-1 总估点**：**48 点**（40 + 2 [119] + 2 [120] + 2 [121] + 1 [122] + 1 [123] · **连续五张紧急卡溢出 40 工时顶格约束** · Sprint-0 骨架期遗留微信规约债务同族**五连** · Sprint-1 末 Retro 议题升级：紧急卡五连溢出 / D-017 v1→v2 升级（四次实战完整证据 · 候选新增 E4 代职边界例外）/ D-016 升定稿规约（12 次实战）/ T2 档位结构性局限 / Review-Tech 评分表增"runtime 加载性"维度（议题 13 升 P0）/ CI 引入 miniprogram-ci 真实编译冒烟（议题 15 新增）/ 同族盲区系统性预防 Epic-F 立案（议题 10 升 P0））

## 🔄 Doing（清洗后仅列真正 in-flight · 其余为 Todo-等触发）
- [~] **COSTRA-114** @DevOps-Agent · 开发服务器 bootstrap **手册**（D-009）· **🟠 卡定义已 approve 但实际未开工**（I-003 · 04-24 17:00 澄清 · `docs/ops/` 目录不存在）· 等 Human 真正触发 `run devops COSTRA-114`

## 👀 Review

### ⏳ AI-Review 自动循环中（共 0 张）

_（COSTRA-101 §6.1.b R4 · 04-24 19:10 D-011 环内收敛 APPROVE · 19:28 Human T1 终审放行 · 整卡收官）_
_（COSTRA-118 审计类专项卡 · 单轮模型 · 2026-04-27 09:39 Human T2 APPROVED 路径 A · 整卡收官）_
_（COSTRA-102 R1 实装 · 2026-04-27 10:14 双签 APPROVE · 无 R2 需求 · 转 Human-Review 等终审）_

### 🙋 Human-Review（AI-Review 已通过，等你终审 · 共 0 张）

_（COSTRA-102 已 Human T1 APPROVED CLOSED @ 2026-05-08 19:11 · 见下方 Sprint-1 Done 段 + `.team/reviews/COSTRA-102/FINAL.md`）_

#### 🔒 Sprint-0 AI-Review 补审（共 7 张 · D-013 **T3 追溯 · 全部 SKIP-REVIEW-AUTOCLOSED**）

> **2026-04-23 21:15**：按 Human 指令 "方案 B+C 可以的 执行吧"，本批 7 张应用 D-013《Review 场景分级》T3 档位自动关闭。AI-Review PASS + 残余 P0/P1=0 + 无红线 + 无新阻塞 四条件全数命中，**不进 Human 终审**。已迁至下方 Done · Sprint-0 补审归档段。
> **复议指令**：`reopen-batch sprint-0-review` 或 `reopen-review COSTRA-xxx`（D-013 §5）
> **详见**：`.team/reviews/SPRINT-0-SKIP-REVIEW.md`（skip 归档） · `.team/reviews/SPRINT-0-SUMMARY.md`（Review 汇总） · `.team/decisions/D-013-review-scenario-tiering.md`（规约）

> 📌 COSTRA-113 是 COSTRA-100 搭车产出，性质为配置加载器，Human 可独立审。
> 📌 **D-011 方案 B 首次落地验证通过**：Review↔Revise 全自动推进，Human 零触发消耗 69 分钟完成 2 轮闭环（19:47 → 20:14）。
> 📌 新卡从 2026-04-23 起走 AI-Review → Human-Review 两段式，默认启用自动循环；**T3/T4 追溯/回归按 D-013 自动关闭**。

## 🚧 Blocked
_（无强阻塞。COSTRA-040 "真实上传链路激活" 仍依赖外部资源，详见 docs/devops/secrets.md §激活清单；占位流水线不受影响。）_

## ✅ Done

### Sprint-0
- [D] COSTRA-001 项目章程与目标对齐    @PM-Agent       · 2026-04-21 G1 通过 · charter.md v2.2
- [D] COSTRA-002 PRD v0.1（MVP · 小程序版）    @PM-Agent       · 2026-04-21 G1 通过 · docs/PRD.md
- [D] COSTRA-003 技术栈 ADR 评审      @PM-Agent       · 2026-04-21 G1 通过
- [D] COSTRA-010 信息架构 + 用户故事地图    @Design-Agent   · 2026-04-22 G2 通过 · docs/design/ia.md & user-story-map.md & flows/*
- [D] COSTRA-011 设计系统 v0.1 + 分享卡片    @Design-Agent   · 2026-04-22 G2 通过 · docs/design/design-system.md & tokens.json & share-cards/*
- [D] COSTRA-020 OpenAPI v0.1 + 错误/冲突/审计    @Backend-Agent  · 2026-04-22 G3 approve-with-follow-up（5 项补齐 → COSTRA-100）
- [D] COSTRA-021 DB Schema v1 + docker-compose    @Backend-Agent  · 2026-04-22 G3 通过
- [D] COSTRA-030 小程序工程骨架 + 登录 Mock 闭环    @MiniApp-Agent  · 2026-04-22 G2/G3 同步通过
- [D] COSTRA-040 CI/CD 占位流水线 + mp-ci 脚本    @DevOps-Agent   · 2026-04-22 G5 Preempt · 真实链路待外部资源
- [D] COSTRA-050 测试策略 + 冒烟 + 微信审核自查    @QA-Agent       · 2026-04-22 G2/G3 同步通过

### 🔒 Sprint-0 AI-Review 补审归档（2026-04-23 · D-013 T3 追溯 · 全部 SKIP-REVIEW-AUTOCLOSED）
- [D] COSTRA-001-review  charter v2.1→v2.3   @PM-Agent     · Round-2 Product PASS 29/30 · `.team/reviews/COSTRA-001/FINAL.md`
- [D] COSTRA-002-review  PRD v0.1→v0.2       @PM-Agent     · Round-2 Product PASS 29/30 · `.team/reviews/COSTRA-002/FINAL.md`
- [D] COSTRA-010-review  IA/flows v0.1.1     @Design-Agent · Round-2 Product PASS 30/30 🏆 · `.team/reviews/COSTRA-010/FINAL.md`
- [D] COSTRA-011-review  design-system 0.1.1 @Design-Agent · Round-2 Product PASS 30/30 🏆 · `.team/reviews/COSTRA-011/FINAL.md`
- [D] COSTRA-020-review  openapi v0.1        @Backend-Agent· Round-2 Tech PASS 30/30 🏆 · `.team/reviews/COSTRA-020/FINAL.md`
- [D] COSTRA-021-review  schema v1.1         @Backend-Agent· Round-2 Tech PASS 30/30 🏆（方案 B 反驳成立）· `.team/reviews/COSTRA-021/FINAL.md`
- [D] COSTRA-030-review  miniapp 骨架补正    @MiniApp-Agent· Round-2 Tech PASS 29/30 · `.team/reviews/COSTRA-030/FINAL.md`

> **关闭说明**：Human 2026-04-23 21:08 指令"方案 B+C 可以的 执行吧"→ 本批应用 D-013《Review 场景分级》T3 档位自动关闭。平均分 29.57/30 · 4 张满分 · 0 ESCALATE · 0 红线 · 0 残余 P0/P1。Follow-up 4 项已合入 Sprint-1 现有卡的验收项（不另立卡，详见 `.team/reviews/SPRINT-0-SKIP-REVIEW.md §5`）。
> **复议**：`reopen-batch sprint-0-review` / `reopen-review COSTRA-xxx`

### Sprint-1
- [D] **COSTRA-100** G3-gaps-plus 补齐    @Backend-Agent  · 2026-04-23 22:38 **Human approve** · AI-Review 2 轮 PASS 30/30 · 3 P0 + 5 P1 闭环 · Follow-up 5 项入 D-010（不阻断）· `.team/reviews/COSTRA-100/FINAL.md`
  - **解除阻塞**：COSTRA-101 `run backend COSTRA-101` 依赖可触发
  - **度量**：`.team/metrics.json` 首条记录（D-011 方案 B 首次真实闭环）
- [D] **COSTRA-113** `server/src/config/subject.ts` + `.env.production.example` SUBJECT 段    @Backend-Agent  · 2026-04-24 12:54 **Human approve** · 搭车 COSTRA-100 · D-013 T1 准入 Review 一次过 · 残余 0 · `.team/reviews/COSTRA-113/FINAL.md`
  - **D-008 对齐**：个人主体先行 + 公司主体兼容模板就位，切换剧本内联在 `.env.production.example` 注释
  - **下游解锁**：COSTRA-112（MiniApp 清扫）/ COSTRA-111（subject-compat-matrix）模板占位规约可对齐
- [D] **COSTRA-101 §6.1.a** 微信登录骨架 + JWT + 错误处理    @Backend-Agent  · 2026-04-24 17:18 **Human T1 approve** · AI-Review 2 轮 PASS 29/30（R1 REVISE 25/30 → R2 PASS 29/30）· 1 P0 + 3 P1 + 2 P2 闭环 · Follow-up 1 项（FU-001 Sprint-2）· `.team/reviews/COSTRA-101/FINAL.md`
  - **部分段**：仅 §6.1.a 骨架放行 · §6.1.b Verify 实跑仍 Doing（等 `verify backend COSTRA-101`）
  - **三规约首次实战收口**：D-011 方案 B 第五次 · **D-014-b 首次**（Orchestrator 60s 内自动拉起 R1）· **D-015 首次**（Agent 6 条全采纳 · 零仲裁）
  - **I-003 附带发现**：Round 2 实际由 Human 17:00 直触发后才发生（调度状态 ≠ 执行状态 · 见 STATE §Incident）
- [D] **COSTRA-101 §6.1.b** 微信登录 Verify 实跑 + R3/R4 净化修复    @Backend-Agent  · 2026-04-24 19:28 **Human T1 approve** · 整卡收官 · AI-Review 4 轮（R1 Verify FAIL → R2/R3 Revise 三绿灯 → R3 Review REVISE 1 P1-NEW → R4 Revise 文档补丁 → R4 Review APPROVE）· `.team/reviews/COSTRA-101/FINAL.md`
  - **代码变更 5 处**：`server/test/setup.ts` / `server/tsconfig.json` / `server/tsconfig.test.json`（新）/ `server/package.json` / `server/src/plugins/jwt.ts`（access jti nonce）
  - **文档变更 1 处**：`docs/api/ttl-policy.md §4.2`（access payload 加 jti + 3 项超额消歧义说明）
  - **三绿灯**：install + typecheck（src+test 双份）+ vitest 8/8 全绿
  - **四规约首次实战累积收官**：D-011 方案 B 第六次 · **D-014-b 首次 + D-015 首次 + D-016 首次**（同轮兑现合规 · I-005 反模式未复现）
  - **下游解锁**：COSTRA-102 端到端（MiniApp 登录 → 首页 → 记一笔）依赖链打通
- [D] **COSTRA-118** miniprogram 技术债专项普查（审计类专项卡）    @Review-Agent-Tech  · 2026-04-27 09:39 **Human T2 approve 路径 A** · 整卡收官 · 单轮 Round-1 REJECT 15/35（10 P0 + 5 P1 + 4 P2）· `.team/reviews/COSTRA-118/FINAL.md`
  - **分流结果 · 零悬挂**：10 P0 → COSTRA-102 × 8 / COSTRA-109 × 1 链上 / P0-9 快修入 COSTRA-102；5 P1 → COSTRA-102 × 3 + COSTRA-103 × 1 + COSTRA-108 × 1；4 P2 → FU-118-2~5 Sprint-2；灰色区 AppID README → FU-118-1 engineering-guidelines 澄清
  - **审计类专项卡首次完整闭环**：Owner=Reviewer 本身 · 单轮即报即结 · 无 Revise 方 · D-011 不适用 · **D-016 两次实战合规**（Round-1 2026-04-24 19:35 + FINAL 2026-04-27 09:39）· 为 Sprint 末期技术债扫描建立范式
  - **跨机迁移延迟观察**：Round-1 → Human 终审 ~62h（04-25~04-27 Mac 迁移无人值守）· 议入 Sprint-1 Retro：审计类卡 72h 软 SLA
  - **下游解锁**：COSTRA-102 扩展 DoD 正式化（含 8 P0 + 3 P1）· 即刻可触发 `run miniapp COSTRA-102`
- [D] **COSTRA-115** `costra.cloud` DNS 子记录 + 白名单一致性 CI 校验（1 点卡 · DevOps 基建第二卡）    @DevOps-Agent  · 2026-04-27 14:10 **Human T2 approve** · 整卡收官 · 单轮 R1 APPROVE 28/30（P0=0 P1=0 P2=2 INFO=2）· `.team/reviews/COSTRA-115/final.md`
  - **交付**：`infra/README.md` + `infra/wechat/domains.md`（SSOT · 四环境 URL 矩阵 + DNS 子记录规划 + Human 下证白名单手册）+ `scripts/devops/whitelist-check.mjs`（零依赖三方对账）+ `package.json check:whitelist` + `pr-check.yml` 新 step + `risks.md` R-013 注记
  - **四闸全绿**：node --check / `check:whitelist` exit 0（2 豁免 warning）/ typecheck / vitest 13/13 pass
  - **价值兑现** 🏆：脚本首跑即真实捕获 server 侧潜伏 dev-url 漂移（env.ts 127.0.0.1:3000 vs openapi.yaml localhost:8080 vs .env.example PORT=8080 vs config/env.ts parsePort 默认 '3000'）· 按 Scope 铁律不擅改 · 加 `EXEMPTED_ENVS_FROM_RULES_AB={dev}` 豁免保 commit 可过 · 升 **FU-COMMON-DEV-URL-DRIFT** 专项卡（P1 · Sprint-1 末 Retro · ⚠️ 建议 04-30 Human 本地验证前修）
  - **范式建立**：**T2 单轨 Review 首次完整跑通**（Tech 单轨 + Human 终审 · 比 T1 双签省 ~40% 耗时）· 首次落地 `infra/` 目录 · 首次 CI 脚本零依赖三方 SSOT 对账
  - **D-016 第六次实战合规**：Human 10:45 `run devops COSTRA-115` → Orchestrator 同 tool call 循环内交付 10 产物（派单→R1→Review 全程 6 分钟）· 连续六次零跨轮异步反模式
  - **FU（3）**：FU-COMMON-DEV-URL-DRIFT（P1 · 跨 Backend/MiniApp）/ FU-115-1（豁免收紧 · P2）/ FU-115-2（Human · ICP 下证日配 api.costra.cloud · R-013 关闭条件）
  - **R-013**：保持 Mitigated · CI 强制一致性已落地 · 等 ICP 下证日 Human 按 `infra/wechat/domains.md §4` 关闭
- [D] **COSTRA-116** 开发期三源 dev URL / 端口漂移收敛（FU-COMMON-DEV-URL-DRIFT 专项 · 1 点卡 · Backend/DevOps 串联第 3 卡）    @Backend-Agent  · 2026-04-27 15:57 **Human T2 approve** · 整卡收官 · 单轮 R1 APPROVE 30/30（P0=0 P1=0 P2=0 INFO=1）· `.team/reviews/COSTRA-116/final.md`
  - **交付**：server parsePort 默认 '3000'→'8080' · miniprogram env.ts dev 127.0.0.1:3000→localhost:8080 · whitelist-check.mjs 豁免集合清空 + EXEMPTION_REASON 删 · docs/qa/costra-102-human-verify.md 方式 A 同步 · miniprogram/README.md env 表 · server/test/setup.ts 注释 · .team/follow-ups/README.md FU 流转（3 处）
  - **四闸全绿**：node --check / `check:whitelist` exit 0 **零 warning**（从 115 末 2 豁免 warning 收敛）/ root+server tsc exit 0 / root vitest 13/13 + server vitest 8/8
  - **价值兑现** 🏆：① 主干 CI 闸门从"豁免 warning"恢复到**全量强度零 warning** ② SSOT 三源对齐 `http://localhost:8080/v1` ③ 解锁 04-30 COSTRA-102 Human 本地验证前置条件（dev 地址 = server 真实启动地址）④ **FU-COMMON-DEV-URL-DRIFT + FU-115-1 双闭环达成**
  - **范式建立**：**FU 专项卡首次完整闭环**（Dispatch D1~D4 核心 + Agent 自主增补 D5~D8 Scope 边界内文档镜像 + Scope 外灰色区登 FU-116-1 P3 观察 · Scope 铁律 + Agent 判断力双重保障）· **T2 单轨第二次验证**（115 首次 · 116 二次 · 建议 D-013 补充"FU 专项 / SSOT 对齐"典型触发场景）
  - **D-016 第七次实战合规**：Human 15:15 `run backend fix-dev-url-drift` → 同 tool call 循环内完成派单 + 7 文件实装 + 四闸 + Tech Review（派单→R1→Review 10 分钟 · Human 终审排队 32 分钟 · **全程 42 分钟**）· 连续七次零跨轮异步反模式
  - **FU 变更**：FU-COMMON-DEV-URL-DRIFT `open`→🟢`closed` · FU-115-1 `open`→🟢`closed` · 新增 FU-116-1 P3 观察（根目录 `.env.example APP_PORT/APP_BASE_URL` 边界外漂移 · Sprint-1 末 DevOps 0.5 点小卡认领）
  - **commit**：`bddbd4a` · 14 files · +805/-51
- [D] **COSTRA-119** app.json 分包声明↔文件系统一致性修复 + CI 对账（FU-COMMON-APP-JSON-DRIFT 专项 · 2 点卡 · Backend/DevOps/MiniApp 串联第 4 卡）    @MiniApp-Agent  · 2026-04-28 13:48 **Human T2 approve** · 整卡收官 · 单轮 R1 Tech APPROVE 33/35（P0=0 P1=0 P2=0 INFO=2）· `.team/reviews/COSTRA-119/round-1-tech.md`
  - **交付**：`miniprogram/pages-stat/overview/` 四件套 + `miniprogram/pages-family/dashboard/` 四件套（文案统一"功能建设中 · Sprint-3 落地"）· 新增 `scripts/devops/appjson-pages-check.mjs` 零依赖 CI 脚本 · `package.json` 挂 `check:appjson` · `pr-check.yml` 新 step 带 `if: success() || failure()` · `miniprogram/README.md §4.1` 顺手清 FU-118-4 同族幻觉卡号（COSTRA-501→COSTRA-401）
  - **五闸全绿**：node --check / **`check:appjson` 首跑 exit 0 · 10 pages matched**（核心闸价值验证）/ `check:whitelist` 回归 exit 0 / typecheck exit 0 / vitest 13/13 pass
  - **价值兑现** 🏆：① **CI 对账族从 1 扩到 2**（whitelist + appjson）永久闸死 L4 盲区 ② 修复 Human 本地验证首步即撞坑的 app.json↔FS 漂移 ③ 吸取 FU-115-WHITELIST-STEP-ALWAYS 教训 CI step `if: success() || failure()` 直接到位 ④ **FU-COMMON-APP-JSON-DRIFT 同轮登记 + 同轮 closed** ⑤ 顺手清 FU-118-4 同族幻觉卡号 1 例（为 Sprint-2 COSTRA-106 Retro 减工作量）
  - **跨区授权范式第二次兑现**：MiniApp 主驾跨区写 `scripts/devops/` + `.github/workflows/` · 参照 COSTRA-116 Backend 跨区先例 · 主产出属性归 MiniApp · 跨区授权 + 回归兜底范式稳固
  - **D-016 第八次实战合规**：Human 20:24 打开微信开发者工具撞坑 → 20:27 选定方案 B → Orchestrator 20:28 派单 → R1 20:31（3 分钟完工）→ Tech Review 20:33 APPROVE（端到端 AI 流水 9 分钟）→ Human 04-28 13:47 过夜终审 `approve:COSTRA-119`（Human 侧 17h14min 属正常节奏）· 连续八次零跨轮异步反模式 · **建议 Sprint-1 末 Retro 将 D-016 从"观察期"升级为"定稿规约"**
  - **FU 变更**：FU-COMMON-APP-JSON-DRIFT `open`→🟢`closed`（同轮）· FU-118-4 同族清 1 例
  - **commit**：`8bcc5d0` · 18 files · +982/-148 · pre-commit+commit-msg hooks pass
  - **未纳入 commit 的工作区噪声**：`project.config.json`（工具自动格式化 + 追加 swc/disableSWC 等无实质字段）· `miniprogram/project.config.json`（工具打开 miniprogram/ 作为项目根时自建的第二份配置）· 均非本卡 Scope · 按 D-012 单卡即提交铁律剥离 · 留待后续独立 chore 卡或 .gitignore 决策
- [D] **COSTRA-120** tabBar 分包规约违反修正 + CI Rule-4 规约级升级（FU-COMMON-APP-JSON-DRIFT-TABBAR 专项 · 2 点卡 · 119 P0 逃逸修复 · D-017 首次实战）    @MiniApp-Agent  · 2026-04-28 15:44 **Human T2 approve** · 整卡收官 · 单轮 R1 Tech APPROVE 34/35（P0=0 P1=0 P2=0 INFO=1）· commit `d08333e` 19 files +1174/-43 · `.team/reviews/COSTRA-120/round-1-tech.md`
  - **核心价值**：CI 对账族从文件存在性（Rule-1/2/3）升级到微信规约级（Rule-4 · tabBar.pagePath 必须主包）· L3 规约盲区永久机制化兜死 · D-017 规约立案首次实战完整闭环
  - **⚠️ 留下同族盲区第 3 次**：工具链 SSOT 由 COSTRA-121 修复
- [D] **🏆 COSTRA-121** project.config.json 工作区恢复 + miniprogram 子副本删除 + CI Rule-5 工具链单源兜底（FU-COMMON-PROJECT-CONFIG-DRIFT 专项 · 2 点卡 · 同族规约盲区第 3 次 · **D-011 SSOT 规约工具链层首次实战**）    @MiniApp-Agent（跨区第 4 次）  · 2026-04-28 19:26 **Human T2 approve** · 整卡收官 · 单轮 R1 Tech APPROVE **35/35**（P0=0 P1=0 P2=0 OPTIONAL=2 非阻断）· `.team/reviews/COSTRA-121/round-1-tech.md`
  - **交付 8 处**：D1 根 `project.config.json` 工作区恢复（自然到位 · HEAD 58 行完整含 `miniprogramRoot: "miniprogram/"` + `useCompilerPlugins: ["typescript"]`）· D2 `miniprogram/project.config.json` 删除（自然到位 · 从未被 git 追踪）· D3 `.gitignore` +5 行精确路径兜底 · D4 新建 `scripts/devops/miniapp-tooling-check.mjs` ~160 行零依赖三子规约 · D5 `package.json scripts +1 check:tooling` · D6 `README.md §本地开发 · 微信开发者工具` ~15 行 · D7 `.team/follow-ups/README.md` 新 FU-COMMON-PROJECT-CONFIG-DRIFT 同轮 closed + 前两 FU 同族备注（三连 FU 串联）· D8 `.team/reviews/COSTRA-119/round-1-tech.md §13.6 v1.2 补遗` ~60 行五段位跨卡治理反哺
  - **九闸全绿 + 三向反向验证双向证据闭环**：Rule-5a（移走根 config）· Rule-5b（关闭 TS 插件）· Rule-5c（复制子 config）各篡改 → exit 1 + 规约文案含卡号 + 6 条修复指引 → revert → exit 0 · Reviewer 独立复核 Rule-5a/5c + 传递推断 Rule-5b
  - **价值兑现** 🏆：① **D-011 SSOT 规约工具链层首次实战 · 五位一体兜底范式建立**（物理 D1+D2 / 追踪 D3 / 机制 D4+D5 / 认知 D6 / 治理 D7+D8）· 可复用模板 ② **CI 对账族从 2 扩到 3**：whitelist（115/116）→ appjson Rule-1~4（119/120）→ tooling Rule-5a/5b/5c（121）· 范式递进：表象检查 → 规约检查 → SSOT 层检查 ③ **同族规约盲区三连完整闭环**（119 文件 + 120 tabBar + 121 工具链）④ FU-COMMON-PROJECT-CONFIG-DRIFT 同轮登记 + 同轮 closed ⑤ Scope 铁律 100% 严守：业务代码 zero touch + 根 config 内容红线守住（git status 输出空）
  - **跨区授权范式第四次兑现**：MiniApp 主驾跨区写 `scripts/devops/` + `.gitignore` + 根 `README.md` + `.team/reviews/COSTRA-119/` 追写 + `.team/follow-ups/README.md` · 参照 116/119/120 先例 · 主产出属性归 MiniApp · 跨区授权 + 回归兜底范式稳固
  - **D-016 第十次实战合规**：Human 15:58 立案 → Orchestrator 事实源核查三轮（二次逆转定稿）→ 方向 A 裁决（16:03）→ 打开姿势确认（16:52）→ 派单（16:55）→ R1 完工（17:10）→ Tech APPROVE（17:12）· **AI 全流程 17 分钟同 tool call 循环** + Human 终审 ~2h14min（19:26）· 连续十次零跨轮异步反模式 · **Sprint-1 末 Retro 强推 D-016 升定稿规约（10 次实战证据充足）**
  - **D-017 第 2 次实战完整闭环**：三次事实源核查逆转教训沉淀（第 1 次误判 require 改造 · 第 2 次误判双 config 漂移 · 第 3 次加入 git ls-files / log / show HEAD: 定稿）· 为 D-017 v1→v2 升级提供直接证据（建议"事实源工具链必须含 git 追踪态核查"写成强制前置步骤）
  - **Orchestrator "工具噪声暂留"判断纠偏**：COSTRA-119 收官建议属误判 · 120 继承该错误一轮 · 121 三层防护（`.gitignore` + Rule-5c CI + README §本地开发）永久消除
  - **FU 变更**：新 FU-COMMON-PROJECT-CONFIG-DRIFT `closed` 同轮（resolved_by COSTRA-121）· 前两 FU（119/120）追加同族备注 · **三连 FU 完整追溯链**
  - **commit**：`8a9c947` · 11 files · +1451/-156 · pre-commit + commit-msg hooks 全过
- [D] **🏆 COSTRA-122** tokens/index.ts JSON import runtime 兼容性修复（FU-TOKENS-JSON-RUNTIME-IMPORT 专项 · 1 点极小卡 · 同族规约盲区第 4 次 · 121 假设证伪的 runtime 层补位 · 单文件内联常量）    @MiniApp-Agent  · 2026-04-29 10:41 **Human T2 approve** · 整卡收官 · 单轮 R1 Tech APPROVE **35/35**（P0=0 P1=0 P2=0 OPTIONAL=1 非阻断）· `.team/reviews/COSTRA-122/round-1-tech.md`
  - **交付 1 文件**：`miniprogram/tokens/index.ts` +50/-2 · 从 `import tokensJson from './tokens.json'` 改写为 `const tokensData = {...} as const` 内联 TS 常量 · 导出签名（tokens/Tokens/color/spacing/radius）100% 保持 · 顶部 4 行硬约束注释（禁止回退 JSON import + 真因解释 + 正确做法）· tokens.json 零改动（仍作 SSOT · Sprint-2 FU-118-3 构建脚本根治）
  - **六闸全绿 + 静态对账双重 + 反向验证三向**：tsc/lint/vitest 13-13/check:appjson/check:tooling/check:whitelist 全 exit 0 · grep 源码无 `.json` import 遗留（唯一命中是注释警告字符串 · 反面教材）· tokens.json vs 内联字段递归排序严格字节对齐 ✅ YES · Reverse-1（改回 JSON import 触发静态对账告警）+ Reverse-2（丢字段触发 diff-tokens.mjs DIFF）+ Reverse-3（去 `as const` 当前非硬拦截 · 记 OPTIONAL · Sprint-2 FU-118-3 机制化根治）
  - **价值兑现** 🏆：① **121 核心假设证伪事实定稿**：`useCompilerPlugins:["typescript"]` 只管 `.ts→.js` 转译 · **不改变 JSON 模块 runtime 解析语义** · 微信 CommonJS require loader **不识别 `.json` 扩展名** · 真根因在 runtime 契约层 ② **121 物理修复价值完整保留**：D1~D8 全部必要且正确 · D-011 SSOT 工具链层 + 五位一体兜底范式结论不受证伪影响 · 只有"121 单卡即解决"狭义假设被证伪 ③ **两卡累加范式建立**：121 工具链 SSOT + 122 runtime 契约层 · 首次实战揭示"规约盲区可能有多个语义层次"· 未来类似问题必须运行期 + 工具链 + 物理 + 规约多层核查 ④ **D-017 v2 升级双重强证据就位**（121 二次逆转 + 122 假设证伪）⑤ **Orchestrator 跨卡治理反哺闭环首次验证**：121 §13.6 v1.2 教训在 122 立案时第一次被正确应用（git 三工具齐跑不再漏）· §13.6 v1.2 → §13.7 v1.3 追写模式议入 SOP-REVIEW v2.1 §12
  - **Scope 铁律 100% 严守**：1 文件改动（`tokens/index.ts`）· tokens.json 零改动 · 无 CI 扩展 · 无 .gitignore 变更 · 无跨区（与 121 跨区第 4 次形成对比 · 122 回归单点精修模式）
  - **D-016 第十一次实战合规**：Human 2026-04-28 20:14 触发 `run miniapp COSTRA-122` → Orchestrator 同 tool call 循环 R1 实装 + 五闸 + 静态对账 + Tech Review 拉起 · **AI 全流程 ~6 分钟**（20:14→20:20）+ Human 终审 ~14h（含夜间休息 · 04-29 10:41）· 连续十一次零跨轮异步反模式 · **Sprint-1 末 Retro 强推 D-016 升定稿规约（11 次实战证据超充足）**
  - **D-017 第 3 次实战完整闭环**：Human 2026-04-28 19:5x 第四次模拟器启动失败立案 → Orchestrator 事实源三证齐全核查（git ls-files/log/show HEAD: 全做 · 121 教训沉淀后**第一次正确前置**）→ 定稿 121 假设证伪 · 真根因 runtime 契约层 → 派单 → R1 → Review → Human 终审 · **D-017 v1→v2 升级两条必加项铁证**：① 事实源工具链必须含 git 追踪态核查为强制前置 ② runtime 实测必须作为 runtime 规约类 T2 卡终审绝对证据（Review 35/35 ≠ 假设正确）
  - **§13.7 v1.3 跨卡治理反哺追写**（~80 行 · 承接 121 §13.6 v1.2）：A 证伪定稿对照表 · B 121 物理修复价值复盘（D1~D8 全部必要且正确）· C 122 补位事实总结 · D 事实源核查链四次逆转完整教训归档 · E Sprint-1 末 Retro 议题 13 条（新增第 13 条 Review 机制增强 · 运行期契约对账表）· F 对未来 Review 的三点显式输入
  - **FU 变更**：FU-TOKENS-JSON-RUNTIME-IMPORT 同轮 closed · FU-COMMON-PROJECT-CONFIG-DRIFT 升级为 closed（两卡累加完整闭环 · 121 物理 + 122 runtime）· 新立 FU-LAUNCH-FIRST-RENDER-RACE（P2 观察 · Sprint-1 候选 · 非 122 引入 · 含类 A 微信 SDK 启动时序 Bug 族 + 类 B 首渲染时序警告）
  - **Human 第五次模拟器启动验证证据**：登录页完整渲染（钱袋 emoji + Costra 品牌 + 一键微信登录按钮）· app.ts:6 `module 'tokens/tokens.json.js' is not defined` **彻底消失** · onLaunch `env= dev` 正常 · `wx.reLaunch('/pages/login/index')` 成功 · Launch Time 3547ms · Console 残留全部与 122 无因果关系（类 A/B/C 三类分流完毕 · 截图已递交）
  - **同族规约盲区四连完整闭环** 🎯：119 文件（L1）+ 120 tabBar（L3）+ 121 工具链 SSOT（L2）+ 122 runtime 契约（L0）· Sprint-1 末 Retro 第 10 条议题升级为最高紧迫性（系统化盘点必须启动 · 当前被动剥洋葱式已到第 4 层 · 不排除第 5 层存在可能性）
  - **commit**：待 Orchestrator 同轮提交
- [D] **🏆 COSTRA-124** 启动期 storage 时序修复 + FU-LAUNCH 闭合（FU-LAUNCH-FIRST-RENDER-RACE-A · 同卡簇第 1 卡）    @MiniApp-Agent  · 2026-05-08 19:11 **Human T2 approve** · 整卡完全闭合（v3 假设被 COSTRA-126 跨 lib 实测兜底证伪 · 顶层副作用消除架构治理价值保留）· commit `a296be0` + `221b074` · `.team/reviews/COSTRA-124/FINAL.md`（`a77ffce` 同卡簇收尾合并落盘）
- [D] **🏆 COSTRA-125** 启动期 storage 异步化 · onLaunch 内同步调用根因解决（FU-LAUNCH-FIRST-RENDER-RACE-B · 同卡簇第 2 卡）    @MiniApp-Agent  · 2026-05-08 19:11 **Human T2 approve** · 整卡 CLOSED · Card-Review R1 PASS 31/35 · 业务侧 storage/auth/sync 全 async + bootstrapPromise + 3 Page onLoad gate + storage.spec.ts 8 测 · 六闸全绿 · COSTRA-126 跨 lib 实测兜底（lib 升级 too eayly 整族消失 · 业务侧 async 是充分必要正确实践）· commit `4643f89` + `d85d040` · `.team/reviews/COSTRA-125/FINAL.md`
- [D] **🏆 COSTRA-126** libVersion 升级 2.32.3→3.8.12 + 反模式 #4 v4 + 反模式 #5（同卡簇第 3 卡）    @MiniApp-Agent  · 2026-05-08 19:11 **Human T2 approve** · 整卡 CLOSED · 跨 5 lib 实测对照（2.33.0/3.8.12/3.14.3/development）+ 业务代码 grep 三重 0 命中 → 4 条独立证据链证伪 v3 "SDK + 业务共责" 假设 · 修正 v4 · 反模式 #5 立案（禁 development lib）· commit `c52fd7f` + `3903b9c` · `.team/reviews/COSTRA-126/FINAL.md`
- [D] **🏆 COSTRA-127** switchTab→reLaunch + onShow bootstrap gate · FU-LAUNCH-C 真闭合（同卡簇第 4 卡）    @MiniApp-Agent  · 2026-05-08 19:11 **Human T2 approve** · 整卡 CLOSED · D-017 Step 2 诊断 90%+ 置信 + Step 4 实装 + Human 模拟器实测 5 条断言全 PASS（0 次 `Expected updated data` + 0 次 `too eayly`）· **Human 终审吸收 review-tech R1 职责**（Sprint-1 末 Retro 议题 17 实战教训）· v4 修正 v5 双因定稿 · 反模式 #6 立案 · commit `1c640f0` + `737595a` + `fd7302e` · `.team/reviews/COSTRA-127/FINAL.md`
- [D] **🏆 COSTRA-128** FU-LAUNCH 族 124~127 治理收尾清洗（注释 + 文档 v5 唯一定稿 · 同卡簇第 5 卡 · 终极收官）    @MiniApp-Agent  · 2026-05-08 19:11 **Human T2 approve** · 整卡 CLOSED · D-013 T3 追溯档自动关闭路径（chore + P3 + 0 行为变更）· 6 项清洗（A~F）· **删比加多原则严格执行**（纯改动文件 -57/+17 = 净删 -40 行 · 删行 vs 加行 = 3.4 倍）· FU-LAUNCH 族 5 卡治理叙事终极收官 · commit `d321b58` + `a77ffce` · `.team/reviews/COSTRA-128/FINAL.md`
- [D] **🏆 COSTRA-102** MiniApp 登录→首页→记一笔端到端（**Sprint-1 主线**）    @MiniApp-Agent  · 2026-05-08 19:11 **Human T1 approve** · 整卡 CLOSED · Tech 31/35 + Product 27/30 双签 APPROVE @ 2026-04-27 · Human 实测 Mock + 本地 server 双模式贯通（手册 §0.2 推荐路径全覆盖）· 真 staging 模式延后到 Sprint-2 提审前 · 5 条 P1 FU 转 Sprint-2（FU-102-* 段）· **首张 T1 双签 + Human 实测 5 步贯通的纯前端卡范式**（FU-102-HUMAN-VERIFY-PARADIGM）· 同卡簇 13 卡协同收官（100/101/116/119/120/121/122/123/124/125/126/127/128）· `.team/reviews/COSTRA-102/FINAL.md`

### Sprint-2

- [D] **🏆 COSTRA-106** Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新（**Sprint-2 第 1 张 · Retro 启动期治理**）    @pm-writer  · 2026-05-09 10:39 **Human T2 approve** · 整卡 CLOSED · **双 30/30 满分范式**（Card-Review 30/30 by `costra-card-reviewer-product` + R1 Product Review 30/30 by `costra-review-product`）· 主报告 `docs/retrospectives/sprint-1-retro.md`（558 行 · 20 项议题全处置）+ **D-020/D-021/D-022 三决议**（D-016 升定稿 · D-017 v3 升级 · review-tech 评分表 v2.0）+ metrics.json 重写（11 卡补齐 + sprint_1_summary）+ board/backlog Sprint-2 流转 · 9 文件 · 1891 行净增 · 8 闸门全绿（jq×2 + 3 CI check + typecheck + lint + test 21/21）· 0 业务代码（C8 红线零触碰）· **SBAI v1.1 第 6 次冒烟 · pm-writer 首次实战 0 漏项 · 审查档第 3 次实战** · D-016 第 13~14 次实战合规 · 立卡到终审 30 分钟（10:09→10:39）· commit `9fe5430` + `03422fa` · `.team/reviews/COSTRA-106/FINAL.md`

---

## 📋 Todo · Sprint-2（2026-05-10 ~ 2026-05-23 · 2 周 · 估点目标 32~36）

> 📌 **Sprint-2 7 卡建议清单**（D-019 §3.2 · Human 待触发立卡）：

| 卡号 | 标题 | Owner | 估点 | 优先级 | 依赖 | 备注 |
|---|---|---|---|---|---|---|
| ~~COSTRA-106~~ | ~~**Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新**~~ | ~~pm-writer~~ | ~~2~~ | ~~**P0**~~ | ~~—~~ | **🏆 Human T2 APPROVED CLOSED @ 2026-05-09 10:39 · 移至 Done** |
| **COSTRA-103** | **本地 SQLite/IndexedDB 持久化 + outbox_queue**（Epic-C 主线）| MiniApp-Agent | 5 | **P0**（Sprint-2 主线主头）| COSTRA-100 | Sprint-1 已解锁 · 等 Human 触发 `run miniapp COSTRA-103` |
| **COSTRA-104** | `/entries` CRUD + `/sync/push` 批量通道 | Backend-Agent | 6 | **P0** | COSTRA-100/103 | 与 103 协议对齐 |
| **COSTRA-105** | 单人记账闭环冒烟（含离线弱网）| QA-Agent | 3 | P1 | COSTRA-103/104 | Sprint-2 中段 |
| **COSTRA-112** | `miniprogram/config/subject.ts` + 硬编码主体字样清扫 | MiniApp-Agent | 1 | P1 | D-008 | 主体红线最后一公里 |
| **COSTRA-114** | 开发服务器 bootstrap 手册 | DevOps-Agent | 2 | P2 | D-009 | Sprint-1 未开工 · 转入 |
| **COSTRA-160** | miniapp 设计 tokens pipeline（FU-118-3 根治）| Design-Agent + MiniApp-Agent | 2 | P2 | COSTRA-011 | 构建脚本 `scripts/gen-wxss-tokens.mjs` |

**Sprint-2 总估点（建议）**：2 + 5 + 6 + 3 + 1 + 2 + 2 = **21 点 + 紧急卡 buffer 12~16 点 = 32~36 点**

> 📌 **Sprint-2 紧急卡 buffer 机制**（议题 A 处置）：留 12~16 点紧急卡 buffer · 占 ~40% 总估点 · 应对 Sprint-0 骨架期遗留微信规约债务系统性预防（议题 10）

---

## 🚦 闸门状态

| 闸门 | 状态 | 发起者 | 链接 |
|---|---|---|---|
| **G1 PRD** | ✅ **Approved** · 2026-04-21 15:22 | PM-Agent | `docs/PRD.md` v0.1 |
| **G2 设计** | ✅ **Approved** · 2026-04-22 16:47 | Design-Agent | `docs/design/` |
| **G3 契约** | ✅ **Approved (with follow-up)** · 2026-04-22 16:47 | Backend-Agent | `docs/api/` · `api/openapi.yaml` · 补齐见 COSTRA-100 |
| **G4 合并** | ✅ **PASS（2026-05-09 09:44 · D-019）** | 2026-05-09 09:44 |
| **G5 发布** | 🟡 **Preempt-Ready**（占位流水线就绪 · 等 ICP + 主体定型 + 真 staging 实测）| — |

---

## 📦 Sprint 历史

| Sprint | 周期 | 卡数 | 估点 | 状态 | 备注 |
|---|---|---|---|---|---|
| Sprint-0 | 2026-04-21 ~ 2026-04-22 | 10 | 28 | ✅ 收官 | execute-now 模式，2 小时完成 7 张 Review 卡 |
| Sprint-1 | 2026-04-23 ~ 2026-05-08 | 21 | 52 | ✅ **收官 @ 2026-05-09 09:44**（G4 PASS · D-019）| 主线 102 + 启动期治理 5 卡（124~128）+ 同族盲区 5 连（119~123）+ 基建 4 卡 · 紧急卡五连溢出 40→52（30%）· 14+ 议题转 COSTRA-106 |
| **Sprint-2** | **2026-05-10 ~ 2026-05-23** | **7（建议）** | **32~36（目标）** | ⏳ **Planning 中** | Epic-C 主线（103/104/105）+ Sprint-1 残债（112/114）+ COSTRA-106 Retro + COSTRA-160 设计 tokens pipeline · 详见 D-019 §3.2 |

---

## 📶 外部资源进度（charter §9 同步 · D-007 更新）

| 资源 | 状态 |
|---|---|
| 微信小程序 AppID（生产） | ✅ `wxf8b0d3e3a83f9941` |
| 小程序类目 | ✅ 生活 → 记账工具 |
| 微信小程序 AppID（体验） | 🟡 **临时共用生产号**（D-007；R-012 跟踪，首次提审前必须拆号） |
| 主体类型 | 🟢 **个人主体先行 · 公司主体兼容就绪**（D-008 · 2026-04-23 生效 · 见 `subject-compat-matrix.md`） |
| 企业主体认证 | ⏸ **延后至人力补齐后启动主体变更**（D-008） |
| 订阅消息模板 ×3 | 🟢 **PM 起草中**（COSTRA-110，04-23 12:00 前 v0.1） |
| 生产域名 | 🟢 **`costra.cloud`** 已注册 · DNS → `49.235.216.20`（D-009） |
| 开发服务器 | 🟢 **腾讯云 3 个月期** `49.235.216.20` · 2026-07-23 到期（R-017） |
| ICP 备案（个人主体） | 🟡 **已提交接入商，等通管局短信审核**（3~5 日出首审） |
| 服务器域名白名单 | ⏳ 备案下证后立即配 `api.costra.cloud`（R-013 关闭条件） |
| `miniprogram-ci` robot key | ✅ **已落位** `key/private.wxf8b0d3e3a83f9941.key` · DevOps 演练中（COSTRA-108） |
| 《用户隐私保护指引》 | 🟢 **PM 起草辅助清单中**（COSTRA-109，04-23 18:00 前 v0.1），Human 届时按清单到微信后台在线填写 |
| 对外名称 | ✅ **Costra**（MVP 阶段不拆分内部代号与上架名） |
| 后端部署平台 | 🟡 **延后至 Sprint-2 末决策** · 开发/部署统一走 docker 镜像（ADR-0002 §部署策略补丁） |

---

## 🧭 Human 下一次介入节点

1. **🟢 立即可做（推荐）**：`run miniapp COSTRA-103`（**Sprint-2 主线主头** · 本地 SQLite/IndexedDB 持久化 + outbox_queue · 5 点 · Epic-C 主线 · COSTRA-106 已解锁）
2. **🟢 接续**：`run backend COSTRA-104`（`/entries` CRUD + `/sync/push` 批量通道 · 6 点 · 与 103 协议对齐 · 串行）
3. **🟢 Sprint-2 其他立卡**（D-019 §3.2 建议清单）：COSTRA-105（单人冒烟 · 3 点 · 中段）/ COSTRA-112（主体清扫 · 1 点）/ COSTRA-114（DevOps bootstrap · 2 点）/ COSTRA-160（设计 tokens pipeline · 2 点）
4. **🟢 真 staging 验证**：Sprint-2 提审前 / ICP 备案下证 + `api.costra.cloud` 白名单配置完成时 · 复跑 `docs/qa/costra-102-human-verify.md` 步骤 1/2/5（手册 §0.2 方式 C）
5. **🟢 被动等**：ICP 备案短信审核到达时 5 分钟内回验证码（通常 3~5 日首审）
6. **🟢 被动等**：订阅消息文案 v0.1 + 隐私指引辅助清单到手后 → 微信后台填写
7. **ICP 下证日（估 05 月中下旬）**：把 `api.costra.cloud` 配进微信后台"服务器域名"白名单，发 `close:R-013`
8. **2026-07-16**：开发服务器到期前 7 日决策（续费 vs 迁移云托管）

> **Sprint-2 启动期治理已兑现** ✅：COSTRA-106 Sprint-1 Retro 双 30/30 满分收官 · 14+ 议题全落地（D-020/D-021/D-022 三决议 + Sprint-2 FU 队列 + libversion v5 锁定）· 解锁主线 COSTRA-103/104。

---

## 💤 Orchestrator 状态

- **MODE**：`sprint-2-in-progress`（🏆 **COSTRA-106 Sprint-1 Retro 双 30/30 满分收官 @ 2026-05-09 10:39** · `approve:COSTRA-106` Human T2 一次性裁决 · Sprint-2 第 1/7 卡 CLOSED · **D-020/D-021/D-022 三决议生效** · metrics.json 工程度量定稿 · 解锁 Sprint-2 主线 COSTRA-103/104 立卡 · 等 Human 触发 `run miniapp COSTRA-103`）
- **下一动作**：等 Human 触发 Sprint-2 主线（首选 COSTRA-103 本地持久化 · 5 点 · Epic-C 主线主头）
- **保存点**：FINAL.md（COSTRA-106 终审记录）+ metrics.json（COSTRA-106 terminal_verdict APPROVED）+ board.md（Sprint-2 段开建 + 106 流转 Done + 最后更新 + Human 节点 + Orchestrator 状态全部刷新）+ backlog.json（106 status Done）+ HANDOFF v1.5（待本轮 commit 落盘）+ 1 commit 待落盘
- **Sprint-2 启动期治理范式建立** 🏆：
  - **双 30/30 满分范式**（Card-Review 30/30 + R1 Product Review 30/30）· Sprint-2 后续 PM 卡参考
  - **SBAI v1.1 第 6 次冒烟成功 · pm-writer 首次实战 0 漏项**（D-018 装扮档累计 6 次 + 审查档累计 3 次）
  - **D-016 第 13~14 次实战合规**（card-review 同轮 + R1 Review 同轮 · 累计 14 次 0 跨轮异步反模式）
  - **立卡到终审 30 分钟新纪录**（10:09→10:39）
- **三决议生效**（自 2026-05-09 起）：
  - **D-020**（D-016 同轮兑现升定稿规约 · 12 次实战证据）
  - **D-021**（D-017 v3 升级 · 跨版本对照前置 + 三证铁律 + runtime 实测前置 · E1~E4 例外）
  - **D-022**（review-tech 评分表 v1.0→v2.0 · C8 runtime 加载性维度 · runtime 类 T2 卡 Human 实测前置）
- **工程度量定稿**：metrics.json 18 卡 + sprint_1_summary（Sprint-1 14 卡 / 52 点 / D-016 12 次 / D-017 v3 / SBAI 6 次 / CI 对账 1→3 / Human 终审 14/14 100%）
- **Sprint-1 总估点定稿**：48 + 1（126）+ 2（127）+ 1（128）= **52 点**（紧急卡五连 + 启动期治理五连 + 主线 1 卡）
- **FU-LAUNCH 族 5 卡治理叙事终极收官** 🏆（已归档 · 不再修改）：124（顶层副作用）+ 125（业务全 async）+ 126（lib 升级 + 跨版本实测）+ 127（业务时序）+ 128（注释清洗）· 4 次定性翻转 v1→v2→v3→v4→v5 · v5 唯一定稿存于 `docs/devops/libversion-upgrade.md §3.4`
