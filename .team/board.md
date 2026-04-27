# Costra 任务看板

> 由 PM-Agent 维护，所有 Agent 可读，状态流转必须经过 Orchestrator。
> 约定流转：`Backlog → Todo → Doing → AI-Review → Human-Review → Done`，Blocked 为横向态。
> **AI-Review 说明**：Backend/MiniApp 产出先走 `Review-Agent-Tech`；PM/Design 产出先走 `Review-Agent-Product`；DevOps/QA/决策类不走 AI-Review。详见 `.team/SOP-REVIEW.md`（2026-04-24 合并版 · 原 SOP-REVIEW-LOOP + SOP-REVIEW-AUTOLOOP 已降为 stub）。
> **🆕 自动循环（D-011 · 2026-04-23 生效 · D-016 同轮兑现 · 2026-04-24 19:10）**：AI-Review 列内 `Revise↔Review` 自动推进，无需 Human 逐轮触发；打断用 `pause-review` / `stop`，详见 `.team/SOP-REVIEW.md §10`。
> **🆕 场景分级（D-013 · 2026-04-23 21:15 生效）**：Review 分 T1 准入 / T2 Gate 前 / T3 追溯 / T4 回归 四档。T1/T2 必走 Human-Review；**T3/T4 在 AI-PASS + 残余 P0/P1=0 + 无红线 + 无新阻塞时自动关闭**。Human 随时可发 `reopen-review` 复议。详见 `.team/decisions/D-013-review-scenario-tiering.md`。
> **🆕 卡定义 Review + Review 自动拉起（D-014 · 2026-04-23 22:26 生效）**：(a) 2026-04-23 22:26 后新建的卡**必须**经卡定义 Review（技术向→Review-Tech / 产品向→Review-Product）；(b) 被审 Agent 交付后**产出 Review 首轮自动拉起**（无需 Human 触发）；(c) 历史卡豁免；(d) DevOps/QA/决策类豁免；(e) Human 打断指令（`pause-review` / `skip-card-review` / `force-card-pass` / `stop`）最高优先级。详见 `.team/decisions/D-014-card-review-and-auto-review-kickoff.md` + `.team/SOP-CARD-REVIEW.md`。
> **🔄 D-011 实战验证三次通过**（2026-04-23）：COSTRA-100（2 轮 · 69 min） + Sprint-0 补审（7 卡 × 2 轮 · 29 min 并行） + **COSTRA-101 Round 1 刚自动拉起（22:49 · D-014-b 首次实战）**

最后更新：`2026-04-27 14:10`（Orchestrator · **COSTRA-115 整卡 Human APPROVED CLOSED** · T2 Tech 28/30 · 0 P0 逃逸 · Sprint-1 DevOps 基建第二卡收官 · R-013 保持 Mitigated · D-016 第六次实战完整闭环 · 🟡 COSTRA-102 等 04-30 本地验证 · ⚠️ 建议 04-30 前修 FU-COMMON-DEV-URL-DRIFT）

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

> 📌 COSTRA-106（Sprint-0 Retro）延至 Sprint-2 头部；COSTRA-116（ICP 进度追踪）并入 PM 常规不计点（D-009 §3）。
> 📌 COSTRA-117 新增自 2026-04-23 20:52（commit 29d1849 时观测到 husky v10 DEPRECATED 警告；v10 升级后会 FAIL，现在清理属低成本预防）。**号段说明**：跳过 116（已占用 ICP 追踪），续号 117 属 11x 扩展与基建域 ✅。
> 📌 **COSTRA-118 新增自 2026-04-24 19:30**（Human 触发 · 专项审计卡 · 不计估点 · 参照 COSTRA-106 "审计/Retro 性质" 先例 · D-014 审计类特殊路径 · Sprint-1 总估点保持 40）。

**Sprint-1 总估点**：**40 点**（≤ 40 工时约束 ✅ · 顶格 · COSTRA-118 不计点）

## 🔄 Doing（清洗后仅列真正 in-flight · 其余为 Todo-等触发）
- [~] **COSTRA-114** @DevOps-Agent · 开发服务器 bootstrap **手册**（D-009）· **🟠 卡定义已 approve 但实际未开工**（I-003 · 04-24 17:00 澄清 · `docs/ops/` 目录不存在）· 等 Human 真正触发 `run devops COSTRA-114`

## 👀 Review

### ⏳ AI-Review 自动循环中（共 0 张）

_（COSTRA-101 §6.1.b R4 · 04-24 19:10 D-011 环内收敛 APPROVE · 19:28 Human T1 终审放行 · 整卡收官）_
_（COSTRA-118 审计类专项卡 · 单轮模型 · 2026-04-27 09:39 Human T2 APPROVED 路径 A · 整卡收官）_
_（COSTRA-102 R1 实装 · 2026-04-27 10:14 双签 APPROVE · 无 R2 需求 · 转 Human-Review 等终审）_

### 🙋 Human-Review（AI-Review 已通过，等你终审 · 共 2 张 · R1 实装段）

- [R1] **COSTRA-102** · MiniApp 登录→首页→记一笔端到端（R1 实装 Review） · 2026-04-27 10:14 · **Tech APPROVE-WITH-FOLLOWUPS 31/35 + Product APPROVE 27/30 · 双签通过** · 双闸全绿（tsc exit 0 · vitest 13/13 pass 161ms）· COSTRA-118 16/16 实测落地 · 2 条 P1 非阻塞 FU（err.message 红线 + avatar onerror handler）交 FU 放行 · **Human 下一步**：2026-04-30 Sprint 中点按 `docs/qa/costra-102-human-verify.md` 执行 20 分钟本地验证 → 发 `approve:COSTRA-102` · 详情 `.team/reviews/COSTRA-102/round-1-miniapp-response.md` + `.team/reviews/COSTRA-102/round-1-tech.md` + `.team/reviews/COSTRA-102/round-1-product.md`
- [R1] **COSTRA-115** · `costra.cloud` DNS 子记录 + 白名单一致性 CI 校验（R1 交付 Review · 1 点卡） · 2026-04-27 10:51 · **Tech APPROVE 28/30 · T2 单轨** · P0=0 P1=0 P2=2 INFO=2 · 四闸全绿（node --check · `npm run check:whitelist` exit 0 · tsc exit 0 · vitest 13/13）· **首跑即暴露** server 侧 dev-url 漂移（env.ts `127.0.0.1:3000` vs openapi.yaml `localhost:8080` vs `.env.example PORT=8080` vs `server/src/config/env.ts parsePort` 默认 `3000`）→ 登记 `FU-COMMON-DEV-URL-DRIFT` 专项卡 · 豁免机制保本卡可 commit · **Human 下一步**：审批成本极低可即时 `approve:COSTRA-115` · 详情 `.team/reviews/COSTRA-115/round-1-devops-response.md` + `.team/reviews/COSTRA-115/round-1-tech.md`

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

---

## 🚦 闸门状态

| 闸门 | 状态 | 发起者 | 链接 |
|---|---|---|---|
| **G1 PRD** | ✅ **Approved** · 2026-04-21 15:22 | PM-Agent | `docs/PRD.md` v0.1 |
| **G2 设计** | ✅ **Approved** · 2026-04-22 16:47 | Design-Agent | `docs/design/` |
| **G3 契约** | ✅ **Approved (with follow-up)** · 2026-04-22 16:47 | Backend-Agent | `docs/api/` · `api/openapi.yaml` · 补齐见 COSTRA-100 |
| **G4 合并** | ⏳ Sprint-1 末 | — | — |
| **G5 发布** | 🟡 **Preempt-Ready** · 占位流水线已落地 | DevOps-Agent | `.github/workflows/*` · `docs/devops/` |

---

## 📦 Sprint 历史

| Sprint | 周期 | 卡数 | 估点 | 状态 | 备注 |
|---|---|---|---|---|---|
| Sprint-0 | 2026-04-21 ~ 2026-04-22 | 10 | 28 | ✅ 收官 | execute-now 模式，2 小时完成 7 张 Review 卡 |
| Sprint-1 | 2026-04-23 ~ 2026-05-06 | 18 | 40 | 🟢 启动中 | 重点：单人记账端到端 + G3 补齐；COSTRA-117 补入（husky v10 兼容）；🆕 COSTRA-118 补入（miniprogram 技术债专项普查 · 不计点）|

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

1. **🟢 被动等**：ICP 备案短信审核到达时 5 分钟内回验证码（通常 3~5 日首审）
2. **🟢 被动等**：订阅消息文案 v0.1 今午前到手后 → 扫一眼 → 去微信后台申请 3 条模板
3. **🟢 被动等**：隐私指引辅助清单今晚到手后 → 对照微信后台填写（主体栏填**个人身份证**）
4. **Sprint-1 中点（2026-04-30）**：本地验证 COSTRA-102 真实登录端到端（开发者工具"不校验合法域名"模式）
5. **Sprint-1 末（2026-05-06）**：G4 合并闸门决策
6. **ICP 下证日（估 05 月中下旬）**：把 `api.costra.cloud` 配进微信后台"服务器域名"白名单，发 `close:R-013`
7. **2026-07-16**：开发服务器到期前 7 日决策（续费 vs 迁移云托管）

> **现阶段 Human 无主动推动动作**，所有球都在 Agent 侧。Orchestrator 将在每个关键节点主动冒泡。

---

## 💤 Orchestrator 状态

- **MODE**：`awaiting-human`（**COSTRA-115 R1 T2 Tech APPROVE** @ 2026-04-27 10:51 · 28/30 · 四闸全绿 · CI 首跑暴露 server 侧 dev-url 漂移 → FU-COMMON-DEV-URL-DRIFT 登记 · D-016 第六次实战合规 · 🟡 COSTRA-102 并行等 04-30 本地验证）
- **下一动作**：Human 选择（推荐顺序）：① **`approve:COSTRA-115`**（1 点卡终审 · 审批成本极低） · ② 2026-04-30 本地验证 COSTRA-102 → `approve:COSTRA-102` · ③ `run miniapp COSTRA-103`（本地持久化 · 可并行） · ④ `run devops COSTRA-114`（手册 · 随时）
- **保存点**：COSTRA-115 dispatch（`.team/dispatch/COSTRA-115-devops-dns-whitelist-ci.md`）+ infra/README.md + infra/wechat/domains.md（SSOT）+ scripts/devops/whitelist-check.mjs（~7KB · 零依赖）+ package.json `check:whitelist` + pr-check.yml Whitelist Consistency Check step + risks.md R-013 CI 注记 + devops-response + tech-review 28/30 + metrics 第 6 条 + STATE/board/messages/FU 同步 @ 2026-04-27 10:54
- **D-016 第六次实战结果**：✅ 合规（Human 10:45 `run devops COSTRA-115` → Orchestrator 同一 tool call 循环内交付 10 产物：dispatch + 3 新 + 3 改 + devops-response + tech-review + 收口）· 跨轮异步反模式连续六次未复现 · 规约自身高度可信 · **派单→R1→Review 全程 6 分钟**
- **关键发现**：CI 首跑即真实暴露 server 侧潜伏漂移（多 SSOT 不一致）· 正是本卡价值场景 · 豁免机制（EXEMPTED_ENVS_FROM_RULES_AB={dev}）让本卡 commit 可通过 pr-check 同时不越 Scope 擅改 env.ts / openapi.yaml · 升 FU-COMMON-DEV-URL-DRIFT 专项卡 Sprint-1 Retro 议题
- **隐性预案**：Human 发 `approve:COSTRA-115` 后整卡直接收官 · Sprint-1 DevOps 基建第二卡（115）收官、第一卡（114）仍 Todo · 下证日 Human 按 `infra/wechat/domains.md §4` 执行（R-013 关闭条件 · FU-115-2 跟踪）
