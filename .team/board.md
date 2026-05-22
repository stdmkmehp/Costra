# Costra 任务看板

> 由 PM-Agent 维护，所有 Agent 可读，状态流转必须经过 Orchestrator。
> 约定流转：`Backlog → Todo → Doing → AI-Review → Human-Review → Done`，Blocked 为横向态。
> **AI-Review 说明**：Backend/MiniApp 产出先走 `Review-Agent-Tech`；PM/Design 产出先走 `Review-Agent-Product`；DevOps/QA/决策类不走 AI-Review。详见 `.team/SOP-REVIEW.md`（2026-04-24 合并版 · 原 SOP-REVIEW-LOOP + SOP-REVIEW-AUTOLOOP 已降为 stub）。
> **🆕 自动循环（D-011 · 2026-04-23 生效 · D-016 同轮兑现 · 2026-04-24 19:10）**：AI-Review 列内 `Revise↔Review` 自动推进，无需 Human 逐轮触发；打断用 `pause-review` / `stop`，详见 `.team/SOP-REVIEW.md §10`。
> **🆕 场景分级（D-013 · 2026-04-23 21:15 生效）**：Review 分 T1 准入 / T2 Gate 前 / T3 追溯 / T4 回归 四档。T1/T2 必走 Human-Review；**T3/T4 在 AI-PASS + 残余 P0/P1=0 + 无红线 + 无新阻塞时自动关闭**。Human 随时可发 `reopen-review` 复议。详见 `.team/decisions/D-013-review-scenario-tiering.md`。
> **🆕 卡定义 Review + Review 自动拉起（D-014 · 2026-04-23 22:26 生效）**：(a) 2026-04-23 22:26 后新建的卡**必须**经卡定义 Review（技术向→Review-Tech / 产品向→Review-Product）；(b) 被审 Agent 交付后**产出 Review 首轮自动拉起**（无需 Human 触发）；(c) 历史卡豁免；(d) DevOps/QA/决策类豁免；(e) Human 打断指令（`pause-review` / `skip-card-review` / `force-card-pass` / `stop`）最高优先级。详见 `.team/decisions/D-014-card-review-and-auto-review-kickoff.md` + `.team/SOP-CARD-REVIEW.md`。
> **🆕 验证问题响应 SOP（D-017 · 2026-04-28 13:59 Human 立案 · 14:15 落盘）**：项目遇到验证失败时标准流程 —— ① 责任领域识别（Orchestrator 30s） → ② 责任 Agent 根因分析（只诊断不改文件） → ③ 多方案对比（≥2~3 方案 · 列成本/价值/风险 + Human 决策点 Qn） → ④ Human 评估裁决 → ⑤ 派单实装。**禁止 Orchestrator 自行分析根因**（反模式 A） · E1/E2/E3 例外 · 反模式 ABCD 禁令 · COSTRA-120 首次实战。详见 `.team/decisions/D-017-verification-problem-response-sop.md`。
> **🔄 D-011 实战验证三次通过**（2026-04-23）：COSTRA-100（2 轮 · 69 min） + Sprint-0 补审（7 卡 × 2 轮 · 29 min 并行） + **COSTRA-101 Round 1 刚自动拉起（22:49 · D-014-b 首次实战）**

最后更新：`2026-05-22 20:45`（Orchestrator · 🚀 **Sprint-3 头部双卡 152+153 R1 + R1.x.1 全闭环 · D-014 同轮范式第 3 次实战完美收官 · 105+156 / 154+150 / 152+153 三连**）· **R1 实装** commit `513dd5a` (152 + P0 跨 family 守门补丁 13 files +1035/-138) + `ccd80b9` (153 6 files +272/-35) · server **70/70 全绿**（含 entries-patch 9 测 + entries-delete 6 测 + T-CROSS-FAMILY 守门测）· **守门反向验证铁证**：临时移除 fm.user_id = $2 → 3 测全 FAIL（PATCH T7 + DELETE T6 + GET T-CROSS-FAMILY）→ revert → 70/70 全绿（COSTRA-104 R1 漏 + review-tech 36/40 漏检的真 P0 补完）· **review-tech R1 双卡同 spawn**：152 PASS-WITH-FOLLOWUP 37/40 + 153 PASS-WITH-FOLLOWUP 39/40（D-022 v2.0 第 9+10 次实战 · D-016 100% 修订率连续第 7~8 张 · D-025 AP-003 第 4+5 次正向兑现）· **R1.x.1 双胞胎 P1 同 commit `167bf17` 修订**（D-017 v3 §2.4 E1 极窄修复第 10+11 次实战 · OpenAPI PATCH+DELETE 双端点加 403 Forbidden 响应 · doc-only 1 行 × 2）· R1.x.1 后期望升 38+40 · **22 commits 已 push origin/dev** · 编排层 5 commits 同对话轮：① `db7affa` Card-Review R1+R2 闭环（4 reviews + 2 dispatch v2.0）② `513dd5a` 152 R1 实装（PATCH + K3 + P0 守门）③ `ccd80b9` 153 R1 实装（DELETE + query version）④ `167bf17` R1.x.1（双胞胎 OpenAPI 403）⑤ 本编排层 commit · **下一步 = Human 联合 152+153 staging/curl 实测 + `approve:COSTRA-152 + COSTRA-153` 联合双卡同轮 approve（D-024 §2.2 C1 第 4 次实战 · 与 154+150 解耦不依赖 staging）** · Sprint-3 头部累计 4/9 卡（CLOSED 后） · 估点累计 15/29 = 52%）

> （上一条归档）`2026-05-22 19:00`（Orchestrator · 🔍 **Sprint-3 头部双卡 152+153 Card-Review 闭环 · 同对话轮 R1+R2 同轮范式第 3 次复刻**（105+156 / 154+150 / 152+153 三连）· **152 R1 PASS-WITH-FOLLOWUP 25/30 → R2 PASS 28/30**（5 项 FU-152-001~005 全落地）· **153 R1 REVISE 22/30 → R2 PASS-WITH-FOLLOWUP 26/30**（6 项 FU-153-001~006 全落地）· **§LINKAGE 联合决策双锚点全落地**：决策 1 K3 + 决策 2 query `?version=N` · **R2 暴露真 P0 跨 family 越权守门盲区** · commit `db7affa`）

> （上一条归档）`2026-05-20 13:25`（Orchestrator · 🚀 **Sprint-3 头部双卡 R1 全闭环 · COSTRA-154 + COSTRA-150 双卡 review-tech APPROVE 等 Human 联合 staging 实测** · 154 R1 commit `7e87bad` + R1.x.1 `8eecd4c` APPROVE 38/40 · **150 R1 commit `ee97a7a` + R1.x.1 `5ac8153` APPROVE 38/40** · D-014 同轮范式连续 2 次 · D-016 反例第 9~10 次预防成功（合规第 2~3 次连续）· D-017 v3 §2.4 E1 第 8~9 次实战 · D-022 v2.0 第 7~8 次实战（38/40+38/40 双卡同分稳定）· D-025 反模式扫描清单第 1~2 次套用 · 150 卡审 R1 抓 5 处 dispatch API 漂移 + entry 页非 tabBar 等 · 150 R1 复用 sync.ts 已封装 pushDelta+syncPull · 调度器仅 158 行（vs 原 200~250）· 8 测全绿 · 联合 staging 实测条件具备 · D-024 §2.2 C1 第 3 次实战候选 · 等 Human `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve 收 Sprint-3 头部 2/9）

> （上一条归档）`2026-05-19 20:50`（Orchestrator · 🚀 **Sprint-3 启动 · COSTRA-154 R1 实装完成 + R1.x.1 修订 + Sprint-3 8 张 follow-up 转正立卡 dispatch 落档** · commit `7e87bad` + `8eecd4c` + `7160724`）

> （上一条归档）`2026-05-19 09:27`（Orchestrator · 🏆🏆 **COSTRA-156 + COSTRA-105 双卡 Human T1 APPROVED CLOSED · Sprint-2 主线 4/7+5/7 双卡同轮收官**（D-014 SOP 联合双卡同轮 approve）· **156 APPROVED 40/40 满分** + **105 APPROVED-PARTIAL** · D-022 v2.0 第 3+4 次实战 40/40+40/40 连续满分 · CI 对账族第 5 张规则 D 落地 · D-016 反例第 8 次首次预防成功 + 第 9 次触发+补救）

> （上一条归档）`2026-05-18 20:4x`（Orchestrator · ✅ **COSTRA-105 R1 Human 实测 partial PASS · 等双卡 approve 收官** · H1~H5 🟢 全 PASS · §4.2 D.2 + H6 🔴 BLOCKED-BY-COSTRA-154 · 方式 C ⏸️ M2 跳过 · 3 文件 doc-only 落盘 · commit 16fd1a0）

> （上一条归档）`2026-05-18 20:1x`（Orchestrator · ✅ **COSTRA-105 R1.x BUG 双修完成 + 手册 v1.7 精简整理** · R1.x.1 commit `33dbdea` + R1.x.2 commit `db488b9` + commit `9be5e84` 补漏 state/history · 手册 v1.6→v1.7 精简 846→525 行 / -38%）

> （上一条归档）`2026-05-18 18:4x`（Orchestrator · 📘 **COSTRA-105 手册 v1.5 D-023 路径升级 · prod/staging URL 收敛根域 `https://costra.cloud/v1`** · commit 2e79950 · §0.5 新增 §0.5.0 D-023 升级路径 6 子节 · 不破坏 D-009/D-023 决策不可变性）

> （上一条归档）`2026-05-13 13:5x`（Orchestrator · 📘 **COSTRA-105 R1.2 手册 v1.4 补强 · H6 硬断言新增 + SU-004 拆 A/B + 十类覆盖** · Human 触发讨论 "curl 验证 vs 小程序连 server" 价值边界 · 经分析二者互补不重叠（curl 验 server 内核数学幂等 vs 小程序连 server 验集成层契约对齐）· 落地 5 处文档：`docs/qa/costra-105-human-smoke.md` v1.3→v1.4（步骤 D 拆 D.1 push 链路诊断 + D.2 client 视角端到端回环 4 条断言 · §6 H1~H5→H1~H6 · §0.1/§0.6/§7/§8/§10 同步）· `qa/cases/single-user-smoke.md` v1.0→v1.1（SU-004 拆 SU-004A push + SU-004B 冷启 pull 回环 · 九类覆盖→十类含集成层契约对齐 · 标题 14→15 条）· `qa/strategy.md`（Epic-C 加 SU-004A/B + S-007 加 SU-004B + 14→15 条 + 9/9→10/10）· `qa/automation/README.md`（14→15 条）· **立意**：兑现 D-022 §4.1 runtime 类 T2 卡 Human 实测前置铁律真正立意（COSTRA-156 修的 `/v1` URL prefix mismatch 类集成 bug · server 单测 + curl 都漏不出来 · 唯一手动捕获路径 = 小程序连 server 端到端回环）· 等 Human 联合实测时序：156 review-tech APPROVE 后跑 105 手册 v1.4 含 H6 → 双卡 approve）

> （上一条归档）`2026-05-13 11:30`（Orchestrator · 🟢🟢 **COSTRA-156 R1 review-tech APPROVE 40/40 满分 @ 11:27 · D-022 v2.0 评分表第 4 次实战连续两卡满分**（105 40/40 + 156 40/40 · 装扮档评分稳定趋势确立 · qa-planner + backend-dev 双满分） · commit `edca8da`（15 文件 +762/-75 行 · server `/v1` prefix + 24 inject + CI 规则 D + 文档同步 + state/history 同 commit）· **D-016 反例第 8 次首次预防成功**（累计 7 次反例后首次合规 · 议题升 P0 · 卡审 §4.8 DoD M 项强制度量效果显著）· **CI 对账族第 5 张规则 D 落地**（whitelist-check.mjs · fastify prefix vs OpenAPI servers path 静态对账）· FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 🟢 `closed`（resolved_by COSTRA-156 R1）· **立 FU-156-OUTBOX-FLAKY**（族 F · Sprint-3 头部 P2 miniapp-dev · pre-existing client outbox 时间 race · 156 0 改动 miniprogram 独立诊断 5 次跑 2/5 fail）· **D-017 v3 §2.4 验证问题响应 SOP 第 6 次完整实战**（105 R1.1 手册修订 → 156 立卡 → R1 实装 → review-tech APPROVE 五步走完）· 105 手册 v1.2 → v1.3（10 处 BLOCKED 注记清除 + INFO-2 联合实测时序明示已兑现）· 104 curl-verify v1.4 → v1.5（8 处 URL 文档同步 · Human 不需重跑 · 105 方式 B 真链路实测 = 等效回归）· backlog v0.2.6 → v0.2.7（156 Todo → Doing · 等 Human 实测）· metrics cards 21 → 22（156 PENDING-HUMAN-VERIFY）· 等 Human 跑 105 手册 v1.3 联合实测 5 步 + H1~H5 → 双卡 `approve:COSTRA-156` + `approve:COSTRA-105` · Sprint-2 主线 4/7 + 5/7 双卡 CLOSED · 累计 14 → 22 点 / 32~36 = **47% → 61%**）

> （上一条归档）`2026-05-13 10:25`（Orchestrator · 🟢 **COSTRA-105 R1.1 手册 v1.2 落盘 + URL mismatch Human 决策方案 A 落实 + COSTRA-156 占位卡入 Sprint-3 P0 头部** · 105 R1.1 手册修订时显式暴露 client/server `/v1` URL 前缀 mismatch 根因三层 · Human 决策方案 A · 立 FU + COSTRA-156 占位卡 · 议入 Retro 3 项议题）
>
> （上一条归档）`2026-05-12 15:10`（Orchestrator · 🟢 **COSTRA-105 review-tech R1 APPROVE 40/40 满分 @ 15:05** · D-022 v2.0 评分表第 3 次实战首次满分（vs 103 38/40 · 104 36/40 · 趋势回升）· qa-planner 首次实装即满分 · Card-Review PASS-WITH-FOLLOWUP 26/30 路径下 P1/P2/INFO 修订率 100% · 0 业务代码 0 协议改动 · 6/6 + 1 N/A 闸门全绿 · C8 runtime 加载性 5/5 满分 · 等 Human 跑 `docs/qa/costra-105-human-smoke.md` → `approve:COSTRA-105`）
>
> （上一条归档）`2026-05-12 14:18`（Orchestrator · 🟢 **COSTRA-105 立卡 + 派单** · `run qa COSTRA-105` Human 触发 · Sprint-2 主线第 4 张 · QA-Agent · 3 点 · P1 · 派单档 380 行 · D-014 Card-Review + D-016 同轮兑现）
>
> （上一条归档）`2026-05-12 13:54`（Orchestrator · 🏆 **COSTRA-104 Human T1 APPROVED CLOSED** · Sprint-2 主线第 3 张收官 36/40 · 切出去 3 件套铁律首次实战 9/9 + dev DX 治理三件套）
>
> （上一条归档）`2026-05-09 19:17`（Orchestrator · 🏆 **COSTRA-103 Human T1 APPROVED CLOSED** · Sprint-2 主线主头 38/40 · D-022 v2.0 + D-017 v3 双范式首次实战）
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
| ~~COSTRA-107~~ | ~~ICP 备案发起辅助文档（域名/主体/准备材料清单）~~ | ~~PM-Agent~~ | ~~-~~ | ~~1~~ **（2026-05-13 · ICP 实际下证 · 整卡 CLOSED · 移至 Sprint-1 Done · 沪ICP备2026017253号-1X / 沪ICP备2026017253号-2）** |
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
- [~] **COSTRA-157** @miniapp-dev + backend-dev · 用户资料完善 + 登录链路鲁棒性（5 FU 合并修复）· backend 段完成 · 等 miniapp-dev 接手 B/C/D/E + 统一 commit
- [🟢] **COSTRA-154** @backend-dev · GET /sync/pull 增量拉取实装 · **R1 + R1.x.1 完成 @ 2026-05-19 20:35** · commit `7e87bad` + `8eecd4c` · review-tech APPROVE 38/40 · 等 Human 联合 150 实测 + approve（D-024 §2.2 C1 攒批）
- [🟢] **COSTRA-150** @miniapp-dev · client sync 调度器（4 触发源 + mutex + debounce）· **R1 + R1.x.1 完成 @ 2026-05-20 13:20** · commit `ee97a7a` + `5ac8153` · review-tech APPROVE 38/40 · 等 Human 联合 154 实测 + approve（D-024 §2.2 C1 第 3 次实战）

## 📋 Todo · Sprint-3（2026-05-19 启动 · 估点目标 30~36 含 buffer）

| 卡号 | 标题 | Owner | 估点 | 优先级 | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| **COSTRA-150** | client sync 调度器（onShow / 网络恢复 / 周期 / 启动）| miniapp-dev | 5 | P1 | COSTRA-154 R1 APPROVE（已等 Human）| dispatch-ready · 等 `start:COSTRA-150` |
| **COSTRA-152** | PATCH /entries/{entry_id} 实装（替代 stub 501）| backend-dev | 3 | P1 | COSTRA-104 ✅ | **Doing** · R1 commit `513dd5a` + R1.x.1 `167bf17` · review-tech R1 PASS-WITH-FOLLOWUP 37/40 → R1.x.1 后期望 ≥38 · 含 P0 跨 family 守门补丁 · 等 Human T1 终审（联合 153）|
| **COSTRA-153** | DELETE /entries/{entry_id} 软删（替代 stub 501）| backend-dev | 2 | P1 | COSTRA-104 ✅ + COSTRA-152 K3 决策延续 | **Doing** · R1 commit `ccd80b9` + R1.x.1 `167bf17` · review-tech R1 PASS-WITH-FOLLOWUP 39/40 → R1.x.1 后期望 ≥40 满分趋势 · 等 Human T1 终审（联合 152）|
| **COSTRA-159** | outbox.spec.ts fake timers 重构（FU-156-OUTBOX-FLAKY）| miniapp-dev | 1 | P2 | 无 · 与 150 同链路顺手 | dispatch-ready · 等 `start:COSTRA-159` |
| **COSTRA-161** | whitelist-check 规则 E（OpenAPI paths vs fastify register · D-025 AP-003 自动检测）| devops-ops | 1 | P2 | COSTRA-156 规则 D ✅ + 154/152/153 全 CLOSED 后启 | dispatch-ready · 等 `start:COSTRA-161` |
| **COSTRA-162** | dev mockLogin runtime toggle | miniapp-dev | 1 | P3 | 无 | dispatch-ready · 等 `start:COSTRA-162` |
| **COSTRA-163** | whitelist-check ICP 强等值校验 | devops-ops | 1 | P2 | COSTRA-107 ✅ · 与 161 同节奏批 | dispatch-ready · 等 `start:COSTRA-163` |
| **COSTRA-155** | 全量 15 用例自动化 + CI 集成 | qa-planner + miniapp-dev | 5 | P2 | 154+150+152+153 全 CLOSED 后启 | dispatch-ready · Sprint-3 中后段 |
| **COSTRA-151** | conflict 合并 UI（FU-103-CONFLICT-MERGE-UI）| miniapp-dev + design-maker | 5 | P2 | COSTRA-104 ✅ + COSTRA-150 CLOSED | dispatch-ready · Sprint-3 中后段 |

**Sprint-3 总估点**：5（150）+ 3（152）+ 2（153）+ 1（159）+ 1（161）+ 1（162）+ 1（163）+ 5（155）+ 5（151）= **24 点 · + 154 已实装 5 点 = 累计 29 点 · + 紧急卡 buffer 3~7 点 = 30~36 点目标**

> 📌 **Sprint-3 启动批量整理**（2026-05-19 20:50）：8 张 follow-up 转正立卡 dispatch 一次性落档 · COSTRA-154 R1 实装完成等 Human 联合 150 实测 · D-024 §2.2 C1 攒批节奏（154+150 联合 approve 优选 · 152+153 联合 · 161+163 联合 · 159+162 顺手）· Sprint-3 启动序列推荐：①154+150 联合 → ②152+153 联合 → ③155 全量自动化 → ④151 conflict UI → ⑤159+162+161+163 顺手批

---

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
- [D] **🏆 COSTRA-107** ICP 备案发起辅助文档（域名/主体/准备材料清单）    @PM-Agent  · **2026-05-13 实际下证 · 整卡 CLOSED**（下证日 2026-05-13 · 实际窗口符合预估 2026-05-18±5）· 小程序 `沪ICP备2026017253号-1X` + 后端服务 `沪ICP备2026017253号-2` · 主体上海 · 主域 `costra.cloud` / 公网 IP `49.235.216.20` · **PM 同轮交付合规登记**（新建 SSOT `docs/legal/compliance-registry.md` v0.1 · 更新 `docs/devops/icp-filing.md` 状态为已下证归档参考 · `infra/wechat/domains.md` 同轮 R-013 关闭条件满足）· **R-013 关闭** + **R-019 新增**（公安联网备案 30 日窗口截止 2026-06-12 · owner=Human · 🟠 · R-014 已在 D-008 占用为主体切换债务，故顺延至 R-019）· 5 处备案号悬挂位置已对齐（小程序「我的」/「隐私」页 footer + 后端 `GET /v1/legal/icp` + `/healthz` icp 字段 + `infra/wechat/domains.md §0` SSOT）

### Sprint-2

- [D] **🏆 COSTRA-106** Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新（**Sprint-2 第 1 张 · Retro 启动期治理**）    @pm-writer  · 2026-05-09 10:39 **Human T2 approve** · 整卡 CLOSED · **双 30/30 满分范式**（Card-Review 30/30 by `costra-card-reviewer-product` + R1 Product Review 30/30 by `costra-review-product`）· 主报告 `docs/retrospectives/sprint-1-retro.md`（558 行 · 20 项议题全处置）+ **D-020/D-021/D-022 三决议**（D-016 升定稿 · D-017 v3 升级 · review-tech 评分表 v2.0）+ metrics.json 重写（11 卡补齐 + sprint_1_summary）+ board/backlog Sprint-2 流转 · 9 文件 · 1891 行净增 · 8 闸门全绿（jq×2 + 3 CI check + typecheck + lint + test 21/21）· 0 业务代码（C8 红线零触碰）· **SBAI v1.1 第 6 次冒烟 · pm-writer 首次实战 0 漏项 · 审查档第 3 次实战** · D-016 第 13~14 次实战合规 · 立卡到终审 30 分钟（10:09→10:39）· commit `9fe5430` + `03422fa` · `.team/reviews/COSTRA-106/FINAL.md`

- [D] **🏆 COSTRA-103** 本地 KV 持久化 + outbox + 冲突三态消费（**Sprint-2 主线主头 · Epic-C 离线优先架构客户端层**）    @miniapp-dev  · 2026-05-09 19:17 **Human T1 approve** · 整卡 CLOSED · **D-022 v2.0 评分表 35→40 分制首次实战 · APPROVE 38/40**（C8 runtime 加载性 + C10 SBAI 流程合规两个新增维度成功检出 2 处 minor）· **D-017 v3 完整流程首次实战**（Step 1~5 + Q1~Q4 Human 拍板 · R1.3 残留 2 问题诊断 + 方案 A 实装）· Card-Review 26.5/30 PASS-WITH-FOLLOWUP（P1-1 R1 已合并）· Human 模拟器实测 5 步 A/B/C/D/E + 5 硬断言 H1~H5 全 PASS · 2 条 FU 立件（FU-103-CLIENT-SYNC-SCHEDULER · FU-103-CONFLICT-MERGE-UI · Sprint-3 候选 COSTRA-150/151 · 守住 INVEST small）· 8 文件主代码（db.ts 273 + outbox.ts 296 + id.ts 33 + sync.ts 重构 103 + entry/index.ts 90 + 2 spec 228 + 手册 v1.1 277）+ 调度元数据 5 文件 = ~ 1330 行净增 · 6 闸门全绿（typecheck 0 / lint 0 warn / test 34-34 / appjson/tooling/whitelist 全 ✅）· 0 后端外溢（git diff HEAD~7..HEAD -- server/ api/ docs/api/ 空）· 协议 100% 对齐 sync-protocol.md + id-strategy.md + error-codes.md · **SBAI v1.1 第 7 次冒烟 · miniapp-dev 第 6 次实战 · 审查档第 4 次实战 · D-016 第 15~17 次实战合规** · 8 commits（cb3a83b feat → 1e723c7 + acfcf0a docs → 6c0b404 R1.3 fix → c8b6c06 chore → 561e884 backlog → 3a8623b review → f125f05 v1.1 + 2 FU）· `.team/reviews/COSTRA-103/FINAL.md`

- [D] **🏆 COSTRA-104** /entries CRUD + /sync/push 批量通道（**Sprint-2 主线第 3 张 · Epic-C 离线优先架构 server 侧**）    @backend-dev  · 2026-05-12 13:54 **Human T1 approve** · 整卡 CLOSED · **D-022 v2.0 评分表第 2 次实战 · APPROVE 36/40**（vs COSTRA-103 38/40 -2 分：C8 followup_id 措辞 -1 + C10 D-016 漏 commit 反例 -1）· **切出去 3 件套铁律首次实战 9/9 完整性**（OpenAPI x-deferred + FU 立件 + route stub 501 不静默 · 3 stub × 3 件套）· **dev DX 治理三件套范式建立**（WX_MOCK_LOGIN env switch + psql seed + npm scripts 三件套）· **D-017 v3 §2.4 E1 例外路径 4 次实战**（R1.x · R1.x.1 · R1.x.2 · R1.x.3 · 4 轮 P1/P2 修复全部 ≤ 5 分钟单 commit 收尾）· Card-Review 29/30 PASS · Human curl 实测 5 步 A/B/B.5/C/D/E + 3 硬断言 H1~H3 全 PASS · **4 条 Sprint-3 候选 FU 立件**（FU-104-ENTRIES-PATCH/DELETE/SYNC-PULL · COSTRA-152/153/154 + FU-EPIC-FAMILY-LEDGER-CRUD COSTRA-155 P0 8 点 scope gap）· 主代码 11 文件 1517 行净增（sync.ts 244 + entries.ts 192 + entryService 235 + idempotencyService 124 + entryRepo 296 + 2 test 345 + setup 增强 + openapi +14 + app +6 + 0004 migration 24）+ 文档 320+ 行（curl-verify v1.4 + scripts/dev/README）+ devops 脚本 218 行 · 6 闸门全绿（typecheck 0 / test 20/20 / lint exit 0 / x-deferred=3 / deferred_card≥3 / 跨域 diff 空）· 协议 100% 对齐 sync-protocol.md + id-strategy.md + error-codes.md · **SBAI v1.1 第 8 次冒烟 · backend-dev 首次实装实战 · 审查档第 6 次实战** · D-018 §3.5 越权例外路径多次实战（state/history × 2 + 1 行 fix × 2）· 16 commits（6d395bd feat → 6c17085 / 212f181 chore → 363efa1 R1.x → 54cd931 chore → 3a8623b review → db1f1fc / 95e00c6 / 454cb82 / 6b242e4 R1.x.1 → b4544d5 / 929942f / 9845d82 R1.x.2 → a575a4a R1.x.3 → 5279343 devops scripts）· **累计 7 项 Sprint-2 末 Retro 议题**（D-016 反例 6 次升级 + schema gap CI + setup.ts 反模式 + review-tech 评分维度 ×2 + scope gap 审查 + migrate.sh 幂等）· `.team/reviews/COSTRA-104/FINAL.md`

- [D] **🏆 COSTRA-156** server 加 /v1 prefix · 让实装服从 OpenAPI 契约（FU-105-CLIENT-SERVER-URL-PREFIX-MISMATCH 转正）（**Sprint-2 主线第 5 张 · Epic-C 工具链层规约**）    @backend-dev  · 2026-05-19 09:27 **Human T1 approve**（联合 105 双卡同轮 approve · D-014 SOP）· 整卡 CLOSED · **D-022 v2.0 评分表第 4 次实战 · APPROVE 40/40 连续满分**（vs 105 40/40 · 装扮档评分稳定趋势确立）· **CI 对账族第 5 张规则 D 落地**（whitelist-check.mjs · fastify prefix vs OpenAPI servers path 静态对账 · 复杂度 INVEST small）· **D-016 反例第 8 次首次预防成功**（累计 7 次反例后首次合规 · 卡审 §4.8 DoD M 项强约束效果显著 · commit 前自检 wc -l = 0）· **D-017 v3 §2.4 验证问题响应 SOP 第 6 次完整实战**（105 R1.1 → 156 立卡 → R1 实装 → review-tech APPROVE → Human 联合 105 实测 approve · 五步走完）· Card-Review 29/30 PASS（P2-1+INFO-1+INFO-2+§4.8 全采纳）· Human 实测路径：不要求重跑 104 curl（COSTRA-105 方式 B 真链路实测 = 端到端等效回归 · D-022 §4.2 范式）· FU-105-URL closed（resolved_by COSTRA-156 R1）· 立 FU-156-OUTBOX-FLAKY（族 F · Sprint-3 P2 miniapp-dev · pre-existing client outbox 时间 race · 156 0 改动 miniprogram 仅独立诊断 5 次跑 2/5 fail）· commit `edca8da`（15 文件 +762/-75 行 · server `/v1` prefix + 24 inject + CI 规则 D + 文档同步 + state/history 同 commit）· 闸门 10/10（含 G9 反向验证删 prefix exit 1 + G10 静态 grep）· `.team/reviews/COSTRA-156/FINAL.md`

- [D] **🏆 COSTRA-105** 单人记账闭环冒烟（含离线弱网）（**Sprint-2 主线第 4 张 · Epic-B 端到端冒烟 + 自动化脚手架**）    @qa-planner  · 2026-05-19 09:27 **Human T1 approve-partial**（联合 156 双卡同轮 approve · D-014 SOP）· 整卡 CLOSED · **APPROVED-PARTIAL**（H1~H5 🟢 全 PASS · H6 🔴 BLOCKED-BY-COSTRA-154 自动等效回归 · 不阻 R1 双卡 approve · v1.4 BLOCKED-BY-COSTRA-156 范式同款第 2 次实战）· **D-022 v2.0 评分表第 3 次实战首次满分 · APPROVE 40/40**（qa-planner 首次实装即满分）· **D-022 §4.1 真兑现立意首次实测**（自动化+curl+server 单测 30+ 全绿 · Human ~30 min 真链路实测捕获 5 发现：4 文档 gap + 1 联合 P0 BUG 双责）· **R1.x BUG 双修**：BUG-001（client `pages/entry/index.ts` 硬编码 `ledger_id: 'default'` · commit `33dbdea`）+ BUG-002（server `routes/sync.ts` payload schema 不校验 UUID format · commit `db488b9` 含 T9 单测 25/25）+ state/history 补漏（commit `9be5e84` · D-016 反例第 9 次触发+补救）· 手册 v1.0 → v1.8 跨 7 天 8 次迭代（Human 反馈驱动 · 多 gap 渐进暴露）· Human 实测覆盖：方式 A Mock + 方式 B 本地 server 双跑 · 方式 C ⏸️ M2 Phase-2（Human 决策跳过）· 缺陷单 2 张：D.1 BUG-001/002 已修 + D.2 pull 501 BLOCKER 转 Sprint-3 COSTRA-154· **4 条 Sprint-3 FU 转入**（FU-104-SYNC-PULL P0 → COSTRA-154 BLOCKED-BY 本卡 H6 自动回归 · FU-103-CLIENT-SYNC-SCHEDULER P1 → COSTRA-150 · FU-105-AUTOMATION-FULL-COVERAGE P2 → COSTRA-155 · FU-105-DEV-CONSOLE-HOOK P3）· commit 链：c046d25 + 73d38d6（R1 实装 + state/history 补漏）+ 33dbdea + db488b9 + 9be5e84（R1.x 双修 + 补漏）+ 16fd1a0（v1.8 + D2 BLOCKER + HANDOFF v1.15）· **累计 5 项 Sprint-2 末 Retro 议题**（议题 18~20 联合 156 兑现 + D-016 反例第 9 次升级 + 实测期 BUG 处置 SOP）· `.team/reviews/COSTRA-105/FINAL.md`

---

## 📋 Todo · Sprint-2（2026-05-10 ~ 2026-05-23 · 2 周 · 估点目标 32~36）

> 📌 **Sprint-2 7 卡建议清单**（D-019 §3.2 · Human 待触发立卡）：

| 卡号 | 标题 | Owner | 估点 | 优先级 | 依赖 | 备注 |
|---|---|---|---|---|---|---|
| ~~COSTRA-106~~ | ~~**Sprint-1 Retro · 14+ 议题处置 + 工程度量刷新**~~ | ~~pm-writer~~ | ~~2~~ | ~~**P0**~~ | ~~—~~ | **🏆 Human T2 APPROVED CLOSED @ 2026-05-09 10:39 · 移至 Done** |
| **COSTRA-103** | ~~**本地 KV 持久化 + outbox + 冲突三态消费**（Epic-C 主线）~~ | ~~MiniApp-Agent~~ | ~~5~~ | ~~**P0**~~ | ~~COSTRA-100~~ | **🏆 Human T1 APPROVED CLOSED @ 2026-05-09 19:17 · 移至 Done** |
| **COSTRA-104** | ~~`/entries` CRUD + `/sync/push` 批量通道（含切出去 3 件套铁律）~~ | ~~Backend-Agent~~ | ~~7~~ | ~~**P0**~~ | ~~COSTRA-100/103~~ | **🏆 Human T1 APPROVED CLOSED @ 2026-05-12 13:54 · 移至 Done** |
| **COSTRA-105** | ~~**单人记账闭环冒烟（含离线弱网）**~~ | ~~qa-planner~~ | ~~3~~ | ~~P1~~ | ~~COSTRA-103/104~~ | **🏆 Human T1 APPROVED-PARTIAL CLOSED @ 2026-05-19 09:27 · 移至 Done**（H6 BLOCKED-BY-COSTRA-154 自动等效回归）|
| **COSTRA-156** | ~~**server 加 /v1 prefix · 让实装服从 OpenAPI 契约**~~ | ~~backend-dev~~ | ~~2~~ | ~~**P0**~~ | ~~COSTRA-104/105~~ | **🏆 Human T1 APPROVED CLOSED @ 2026-05-19 09:27 · 移至 Done** |
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
| **Sprint-2** | **2026-05-10 ~ 2026-05-23** | 7（建议）| 32~36（目标）| 🟢 **进行中** · 3/7 卡已 CLOSED + 1 卡 review-tech APPROVE 等 Human 实测（COSTRA-106 Retro @ 2026-05-09 10:39 + COSTRA-103 主线主头 @ 2026-05-09 19:17 + COSTRA-104 主线第 3 张 @ 2026-05-12 13:54 + **COSTRA-105 review-tech 40/40 满分 @ 2026-05-12 15:05 等 Human 实测**）· 累计 14 点 CLOSED + 3 点 pending（**总 17 点 / 47%**）| Epic-C 主线（103 ✅ + 104 ✅ + 105 🟢）+ Sprint-1 残债（112/114）+ COSTRA-106 Retro ✅ + COSTRA-160 设计 tokens pipeline · 详见 D-019 §3.2 |

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
| ICP 备案（个人主体） | 🟢 **已下证 2026-05-13**（小程序 `沪ICP备2026017253号-1X` · 后端 `沪ICP备2026017253号-2` · 主体上海 · 详见 `docs/legal/compliance-registry.md`） |
| 服务器域名白名单 | ⏳ 等 Human 配 `https://costra.cloud`（D-023 · 不再依赖子域 DNS） |
| `miniprogram-ci` robot key | ✅ **已落位** `key/private.wxf8b0d3e3a83f9941.key` · DevOps 演练中（COSTRA-108） |
| 《用户隐私保护指引》 | 🟢 **PM 起草辅助清单中**（COSTRA-109，04-23 18:00 前 v0.1），Human 届时按清单到微信后台在线填写 |
| 对外名称 | ✅ **Costra**（MVP 阶段不拆分内部代号与上架名） |
| 后端部署平台 | 🟡 **延后至 Sprint-2 末决策** · 开发/部署统一走 docker 镜像（ADR-0002 §部署策略补丁） |

---

## 🧭 Human 下一次介入节点

1. **🟢 立即可做（推荐 · runtime 类 T2 强制铁律）**：跑 `docs/qa/costra-105-human-smoke.md` 5 步实测（A/B/C/D/E ~ 30 分钟 · 先 Mock 模式 §方式 A · 再本地 server 模式 §方式 B · 真 staging 留 Sprint-2 提审前）+ H1~H5 硬断言全 PASS → 发 `approve:COSTRA-105` 整卡收官 · **Sprint-2 主线 4/7 卡 CLOSED**
2. **🟢 接续**：Sprint-2 残债（COSTRA-112 主体清扫 1 点 · COSTRA-114 DevOps bootstrap 2 点 · COSTRA-160 设计 tokens pipeline 2 点）
3. **🟢 真 staging 验证**：Sprint-2 提审前 / ICP 备案下证 + `api.costra.cloud` 白名单配置完成时 · 复跑 `docs/qa/costra-102-human-verify.md` 步骤 1/2/5（手册 §0.2 方式 C）+ 复跑 `docs/qa/costra-105-human-smoke.md` 方式 C
4. **🟢 被动等**：ICP 备案首审短信 / 订阅消息文案 v0.1 / 隐私指引清单
5. **ICP 下证日（估 5 月中下旬）**：把 `api.costra.cloud` 配进微信后台"服务器域名"白名单，发 `close:R-013`
6. **2026-07-16**：开发服务器到期前 7 日决策（续费 vs 迁移云托管）
7. **Sprint-3 候选**（待 Sprint-2 收官 + Retro · 累计 23 点候选）：FU-103-CLIENT-SYNC-SCHEDULER（COSTRA-150 P1 5 点）+ FU-103-CONFLICT-MERGE-UI（COSTRA-151 P2 5 点）+ FU-104-ENTRIES-PATCH/DELETE/SYNC-PULL（COSTRA-152/153/154 · 共 10 点）+ FU-EPIC-FAMILY-LEDGER-CRUD（COSTRA-155 P0 8 点）

> **Sprint-2 主线 Epic-C 双卡收官** ✅✅：COSTRA-103 客户端 + COSTRA-104 server 端协议对齐通路打通 · 共 12 点（5+7）· **+ COSTRA-105 review-tech 40/40 满分等 Human 实测 = Sprint-2 累计 17 点 / 47%**（103/104/105 = 5+7+3 = 15 点主线 + 106 Retro 2 点 = 17 点）。剩余 3 卡（112/114/160）共 5 点 · 距离目标 32~36 还差 ~ 10~14 点（属合理收官区间）。

---

## 💤 Orchestrator 状态

- **MODE**：`sprint-2-in-progress`（🟢🟢 **COSTRA-105 + COSTRA-156 双卡 review-tech APPROVE 40/40 + 40/40 满分** · D-022 v2.0 评分表第 4 次实战连续两卡满分 · 等 Human 联合实测 → 双卡 `approve` → Sprint-2 主线 4/7 + 5/7 双卡 CLOSED · 累计 14 → 22 点 / 32~36 = **47% → 61%**）
- **下一动作**：等 Human 跑 105 手册 v1.3 联合实测（5 步 + H1~H5 ~ 30 分钟 · 步骤 D 现可跑 · 156 R1 review-tech APPROVE 已兑现联合时序前置条件）→ 双卡 approve → Sprint-2 主线 4/7 + 5/7 双卡 CLOSED → 顺位等 Human 触发 COSTRA-112/114/160
- **保存点**：156 dispatch + 卡审 PASS 29/30 + R1 Review APPROVE 40/40 全落盘 · 105 手册 v1.3 时序兑现 · 104 curl-verify v1.5 文档同步 · whitelist-check 规则 D 落地 · FU-105-URL closed + FU-156-OUTBOX-FLAKY 立件 · backlog v0.2.6 → v0.2.7（156 Doing · 22 卡）· metrics cards 21 → 22 · HANDOFF v1.10 待本轮 commit · 4 commits（c046d25 + 73d38d6 + fb4c79b + 625417a + 1b8baf3 + edca8da）+ 本轮 1 commit 待落盘
- **Sprint-2 范式累计建立** 🏆🏆🏆🏆🏆：
  - **D-022 v2.0 评分表第 4 次实战连续两卡满分**（103 38/40 → 104 36/40 → **105 40/40 + 156 40/40** 趋势确立）
  - **D-016 反例第 8 次首次预防成功**（累计 7 次反例后首次合规 · 卡审 §4.8 DoD M 项强制度量效果显著）
  - **D-017 v3 §2.4 验证问题响应 SOP 第 6 次完整实战**（105 R1.1 手册修订 → 156 立卡 → R1 实装 → review-tech APPROVE 五步走完）
  - **CI 对账族第 5 张规则 D 落地**（whitelist-check.mjs · fastify prefix vs OpenAPI servers path 静态对账）
  - **Card-Review PASS-WITH-FOLLOWUP 路径修订率 100%** 连续两卡兑现（COSTRA-105 4/4 + COSTRA-156 4/4）
  - **scope gap 主动识别机制延续**（COSTRA-103/104/105/156 · 立 8 条 FU）
  - **D-018 §3.5 越权例外路径成熟使用**（state/history 漏 commit 多次接管 + E1 路径 await fix 修复）
  - **SBAI v1.1 第 10 次冒烟 · backend-dev 第 2 次实装实战 · 审查档第 8 次实战**
  - **联合实测范式建立**（156 + 105 联合实测 · 156 R1 review-tech APPROVE 是 105 步骤 D 前置 · 手册 v1.3 §10 时序明示）
- **Sprint-2 末 Retro 议题清单**（累计 14 项 · 议题升级中）：
  - **🆕 议题 21 · D-016 v2.0 升定稿规约**：装扮档实装 final message 必含 `git status -s | grep .team/members/ | wc -l = 0` 自检结果（卡审 §4.8 DoD M 项强约束效果显著实证）
  - **🆕 议题 22 · D-022 v2.0 评分表满分趋势观察**：连续两卡满分（105+156）· 装扮档评分表稳定 · 未来卡是否回归 36~38 常态需观察
  - **🆕 议题 23 · D-017 v3 §2.4 验证问题响应 SOP 第 6 次实战归档**：105 R1.1 手册修订作为典型触发源 · 范式可复用
  - 议题 18 升 P0 · CI 漏检反模式（已部分兑现 · whitelist-check 规则 D 落地 · 但 path 维度仍未全面覆盖）
  - 议题 19 升 P0 · server 单测 inject 反模式（议题待 Sprint-3 立 supertest + jest-openapi 真 HTTP 集成测试）
  - 议题 20 · D-022 v2.0 C8-5 端到端契约联调可达性子项扩展（156 后归档证据）
  - D-016 反例累计 7 次（议题 18 升 P0）+ 第 8 次首次预防（议题 21 沉淀）
  - 装扮档 6+ 点卡分阶段 commit 机制
  - G3 OpenAPI vs DB schema 列对账 CI（COSTRA-115/116 CI 对账族第 4 张候选）
  - test/setup.ts 维护两套 schema 真相反模式
  - review-tech 评分应增"测应有 request → response 全字段保真断言"维度
  - review-tech 评分应增"create UNIQUE 触发 conflict 端到端路径覆盖"维度
  - scope gap 审查机制（审查档应额外评 PRD AC 链路完整性）
  - migrate.sh 幂等性 + 状态化 migrations 议题
  - SOP-CARD-REVIEW v1.1 PASS-WITH-FOLLOWUP 路径下 follow-up 强制 R1 一并修订（连续两卡 100% 修订率证据）
- **Sprint-2 范式累计建立** 🏆🏆🏆🏆：
  - **D-022 v2.0 评分表第 3 次实战首次满分**（COSTRA-103 38/40 → COSTRA-104 36/40 → **COSTRA-105 40/40** · qa-planner 首次实装即满分 · SBAI v1.1 装扮档成熟度证据）
  - **D-017 v3 §2.4 E1 例外路径多次实战**（COSTRA-103 R1.3 + COSTRA-104 R1.x/R1.x.1/R1.x.2/R1.x.3 共 5 次 + COSTRA-105 R1 state/history 补 commit 1 次 = 累计 6 次 · 全部 ≤ 5 分钟单 commit 收尾）
  - **切出去 3 件套铁律首次实战 9/9 完整性**（COSTRA-104 · OpenAPI x-deferred + FU 立件 + route stub 501 不静默）
  - **dev DX 治理三件套范式**（COSTRA-104 · WX_MOCK_LOGIN env switch + psql seed 脚本 + npm scripts 三件套 · 长期 backend 资产）
  - **Card-Review PASS-WITH-FOLLOWUP 路径修订率 100%**（COSTRA-105 4/4 全采纳 · 议入 SOP-CARD-REVIEW v1.1 强制路径）
  - **scope gap 主动识别机制延续**（COSTRA-103/104/105 · 立 5 条 FU · 105 立 FU-105-AUTOMATION-FULL-COVERAGE）
  - **D-018 §3.5 越权例外路径成熟使用**（state/history 漏 commit 多次接管处置 · COSTRA-104 × 4 + COSTRA-105 × 1）
  - **SBAI v1.1 第 9 次冒烟 · qa-planner 首次实装实战 · 审查档第 7 次实战**
  - **D-016 反例累计 7 次升级 P0 议题**（COSTRA-103 × 3 + COSTRA-104 × 3 + COSTRA-105 × 1 · Sprint-2 末 Retro 必升 P0）
- **Sprint-2 末 Retro 议题清单**（累计 12 项 · 议题升级中）：
  - **🆕 议题 18 升 P0 · CI 漏检反模式**：whitelist-check 三方对账"字符串相等"≠"端到端可达性"对账 · 漏 client/server URL `/v1` 前缀 mismatch · CI 对账族第 5 张候选（fastify register prefix vs OpenAPI servers path 强制对账 · 立 D-023 工具链层规约）· 来源 COSTRA-105 R1.1 手册修订发现
  - **🆕 议题 19 升 P0 · server 单测 inject 反模式**：server/test 全部走 `inject({ url: '/...' })` 内部路径 · 不经过 client buildUrl · 漏检 client/server 协议层握手 gap · 议入测试策略 v0.2（建议补 supertest + jest-openapi 真 HTTP 集成测试 · COSTRA-050 §2.2 落地）
  - **🆕 议题 20 · D-022 v2.0 评分表 C8 子项扩展**：C8 runtime 加载性维度增加"端到端契约联调可达性"子项（C8-5 候选 · 含 client buildUrl 拼接结果 vs server 实际监听路径核对）
  - **🆕 D-016 反例第 7 次升 P0**：装扮档 commit 完整性检查清单（state/history 漏 commit · 已超 30% 反例占比阈值）
  - 装扮档 6+ 点卡分阶段 commit 机制（D-016 累计反例 6 次 · 升级版本）
  - G3 OpenAPI vs DB schema 列对账 CI（COSTRA-115/116 CI 对账族第 4 张候选）
  - test/setup.ts 维护两套 schema 真相反模式
  - review-tech 评分应增"测应有 request → response 全字段保真断言"维度
  - review-tech 评分应增"create UNIQUE 触发 conflict 端到端路径覆盖"维度
  - scope gap 审查机制（审查档应额外评 PRD AC 链路完整性 · 同 COSTRA-103 watermark 范式）
  - migrate.sh 幂等性 + 状态化 migrations 议题
  - **🆕 SOP-CARD-REVIEW v1.1**：PASS-WITH-FOLLOWUP 路径下 follow-up 强制 R1 实装时一并修订（COSTRA-105 100% 修订率证据）
- **Sprint-3 候选 FU 累计 28.5 点**（待 Sprint-2 收官 + Retro 升级转正 · 156 已实装等 Human approve · 不在候选清单）：
  - FU-103-CLIENT-SYNC-SCHEDULER（COSTRA-150 P1 5 点）
  - FU-103-CONFLICT-MERGE-UI（COSTRA-151 P2 5 点）
  - FU-104-ENTRIES-PATCH（COSTRA-152 P1 3 点）
  - FU-104-ENTRIES-DELETE（COSTRA-153 P1 2 点）
  - FU-104-SYNC-PULL（COSTRA-154 P0 5 点 · PRD AC-4 核心）
  - FU-EPIC-FAMILY-LEDGER-CRUD（COSTRA-155 P0 8 点 · scope gap）
  - FU-105-AUTOMATION-FULL-COVERAGE（P2 · 5 点 · qa-planner+miniapp-dev · 全量 14 用例自动化 + CI 集成）
  - **🆕 FU-156-OUTBOX-FLAKY**（族 F · P2 · 0.5 点 · miniapp-dev · pre-existing client outbox 时间 race · Sprint-3 头部修）
- **工程度量**：metrics.json 21 卡（含 COSTRA-105 PENDING-HUMAN-VERIFY）+ sprint_1_summary 段（不动）+ Sprint-2 累计 14 点 CLOSED + 3 点 pending（106 2 + 103 5 + 104 7 + **105 3 pending**）/ 目标 32~36 · **47%** 进度
- **Sprint-2 主线第 5+ 张解锁**：COSTRA-112 主体清扫（1 点 · P1）/ COSTRA-114 DevOps bootstrap（2 点 · P2 · 卡定义已批未开工）/ COSTRA-160 设计 tokens pipeline（2 点 · P2）
