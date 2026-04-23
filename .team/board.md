# Costra 任务看板

> 由 PM-Agent 维护，所有 Agent 可读，状态流转必须经过 Orchestrator。
> 约定流转：`Backlog → Todo → Doing → AI-Review → Human-Review → Done`，Blocked 为横向态。
> **AI-Review 说明**：Backend/MiniApp 产出先走 `Review-Agent-Tech`；PM/Design 产出先走 `Review-Agent-Product`；DevOps/QA/决策类不走 AI-Review。详见 `.team/SOP-REVIEW-LOOP.md`。
> **🆕 自动循环（D-011 · 2026-04-23 生效）**：AI-Review 列内 `Revise↔Review` 自动推进，无需 Human 逐轮触发；打断用 `pause-review` / `stop`，详见 `.team/SOP-REVIEW-AUTOLOOP.md`。
> **🆕 场景分级（D-013 · 2026-04-23 21:15 生效）**：Review 分 T1 准入 / T2 Gate 前 / T3 追溯 / T4 回归 四档。T1/T2 必走 Human-Review；**T3/T4 在 AI-PASS + 残余 P0/P1=0 + 无红线 + 无新阻塞时自动关闭**。Human 随时可发 `reopen-review` 复议。详见 `.team/decisions/D-013-review-scenario-tiering.md`。

最后更新：`2026-04-23 21:15`（Orchestrator · Sprint-0 补审 7 张 skip-review 自动关闭 · D-013 落地）

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

> 📌 COSTRA-106（Sprint-0 Retro）延至 Sprint-2 头部；COSTRA-116（ICP 进度追踪）并入 PM 常规不计点（D-009 §3）。
> 📌 COSTRA-117 新增自 2026-04-23 20:52（commit 29d1849 时观测到 husky v10 DEPRECATED 警告；v10 升级后会 FAIL，现在清理属低成本预防）。**号段说明**：跳过 116（已占用 ICP 追踪），续号 117 属 11x 扩展与基建域 ✅。

**Sprint-1 总估点**：**40 点**（≤ 40 工时约束 ✅ · 顶格）

## 🔄 Doing
- [~] COSTRA-108 @DevOps-Agent · miniprogram-ci 上传演练（04-24 18:00 前）
- [~] COSTRA-109 @PM-Agent · 隐私指引清单（主体字段走 `{{SUBJECT_*}}` 占位）· 04-23 18:00 前
- [~] COSTRA-110 @PM-Agent · 订阅消息 ×3 文案 · 04-23 12:00 前
- [~] COSTRA-111 @PM-Agent · subject-compat-matrix · 04-24 18:00 前
- [~] COSTRA-112 @MiniApp-Agent · subject.ts + 硬编码清扫 · Sprint-1 D3 前
- [~] **COSTRA-114** @DevOps-Agent · 开发服务器 bootstrap（D-009）· 04-25 18:00 前
- [~] **COSTRA-115** @DevOps-Agent · DNS 子记录 + 白名单 CI 校验 · 04-25 18:00 前

## 👀 Review

### ⏳ AI-Review 自动循环中（共 0 张）

_（COSTRA-100 已通过 AI-Review · 20:14 终止自动循环 · 详见下方 Human-Review 队列）_

### 🙋 Human-Review（AI-Review 已通过，等你终审 · 共 2 张）

#### Sprint-1 主线（共 2 张）

- [R] **COSTRA-100** @Backend-Agent · 2026-04-23 20:14 · **AI-Review 终审 PASS**（2 轮 · 3 P0 + 5 P1 闭环 · 终评 30/30）
  - Round-1 Tech：`.team/reviews/COSTRA-100/round-1-tech.md`（REVISE · 26/30）
  - Round-1 Backend 回执：`.team/reviews/COSTRA-100/round-1-backend-response.md`
  - Round-2 Tech：`.team/reviews/COSTRA-100/round-2-tech.md`（PASS-WITH-FOLLOWUP · 29/30）
  - Round-2 Backend 就地修：`.team/reviews/COSTRA-100/round-2-backend-response.md`（升级为 PASS · 30/30）
  - 终结：`.team/reviews/COSTRA-100/FINAL.md`
  - **档位**：D-013 **T1 准入 Review**（解除 COSTRA-101 阻塞）→ 仍需 Human 终审
  - **触发指令**：`approve:COSTRA-100` / `reject:COSTRA-100 <原因>`
- [R] **COSTRA-113** @Backend-Agent · 2026-04-23 17:50 搭车完成 · `server/src/config/subject.ts` + `.env.production.example` SUBJECT 段
  - **档位**：D-013 **T1 准入 Review**（搭车新产出）→ 仍需 Human 终审

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
| Sprint-1 | 2026-04-23 ~ 2026-05-06 | 17 | 40 | 🟢 启动中 | 重点：单人记账端到端 + G3 补齐；COSTRA-117 补入（husky v10 兼容）|

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

- **MODE**：`dispatch-ready`（Sprint-1 Todo 已填充，待 Agents 领单执行）
- **下一动作**：PM-Agent 完成 Sprint-0 Retro → Orchestrator 广播 Sprint-1 开工
- **保存点**：所有产物已落盘，conversation 可随时中断续作
