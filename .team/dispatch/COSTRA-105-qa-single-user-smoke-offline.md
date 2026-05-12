# COSTRA-105 · 单人记账闭环冒烟（含离线弱网）· Sprint-2 主线第 4 张

> **派单时间**：2026-05-12 14:18（Orchestrator 同对话轮 D-016 兑现）
> **触发**：Human `run qa COSTRA-105`
> **依赖**：COSTRA-103（client outbox · CLOSED 2026-05-09 19:17）+ COSTRA-104（server `/sync/push` + `/entries` POST/GET · CLOSED 2026-05-12 13:54）
> **下游解锁**：Sprint-2 主线 4/7 卡进度 + 真 staging 验证（手册方式 C）+ 微信审核自查（COSTRA-901 准入）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech`（D-014-a · 审查档第 7 次实战 · D-022 v2.0 评分） | 等 Orchestrator 同轮 spawn |
| **R1 实装** | `costra-qa-planner`（**首次实装实战** · SBAI v1.1 装扮档第 9 次冒烟） | 等卡审 PASS / PASS-WITH-FOLLOWUP |
| **R1 Review** | `costra-review-tech`（D-014-b 自动拉起 · 审查档第 7 次 · **D-022 v2.0 评分表第 3 次实战**） | 等 R1 实装完 |
| **Human 实测前置** | 模拟器 + curl/seed 联调（≥ 5 步 + ≥ 5 硬断言 · D-022 §4.1 runtime 类 T2 强制铁律） | 等 R1 Review APPROVE |
| **Human T1 终审** | `approve:COSTRA-105` | 等 Human 实测全 PASS |

---

## §1 背景

### 1.1 PRD 锚点

PRD AC-4（COSTRA-113 离线）：「无网也能保存 → 写入本地队列 → 联网后**自动上传**；本地状态以"小云朵"图标提示」
PRD COSTRA-122 AC-3（同步幂等）：「同步过程中断（网络切换/后台）可恢复，不产生重复写入（幂等键 `client_op_id`）」
PRD NFR：「冷启 TTI ≤ 2s · 单笔保存 ≤ 300ms（有网）」

### 1.2 上游事实源

| 来源 | 文件 | 用途 |
|---|---|---|
| **PRD** | `docs/PRD.md` Epic-A/B/C AC | 用例需求追溯 |
| **既有冒烟用例** | `docs/qa/smoke-cases.md`（S-001~S-017） | Sprint-0 基线 · 本卡需扩展+对齐当前 server 通路 |
| **测试策略** | `docs/qa/test-strategy.md` | 分层 / 真机矩阵 / 工具链 |
| **103 实测手册** | `docs/qa/costra-103-human-verify.md`（client outbox 5 步实测） | 客户端断言/起点重置范式 |
| **104 实测手册** | `docs/qa/costra-104-curl-verify.md`（server curl 5 步实测） | server 通路 + dev DX 三件套 |
| **协议事实源** | `server/api/openapi.yaml` + `docs/api/sync-protocol.md` + `docs/api/error-codes.md` + `docs/api/id-strategy.md` | 接口断言 |
| **dev DX 三件套** | `scripts/dev/migrate.sh` + `seed-curl-test.sh` + `reset-data.sh`（COSTRA-104 R1 落盘） | server 端备数 |
| **WX_MOCK_LOGIN** | `server/src/plugins/mock-login.ts`（COSTRA-104） | dev 联调免登 |

### 1.3 范围分位（与 050 / 102 / 103-human-verify 区分）

- **COSTRA-050（Sprint-0）**：冒烟用例**模板** + 17 条骨架（S-001~S-017）· 仅纸面 · 无端到端实跑
- **COSTRA-102（Sprint-1）**：MiniApp 登录→首页→记一笔 E2E **手册**（Mock + 本地 server 双模式 · Human 已通）
- **COSTRA-103（Sprint-2）**：client outbox 5 步实测手册（Human 已通）
- **COSTRA-104（Sprint-2）**：server curl 5 步实测手册（Human 已通）
- **COSTRA-105（本卡）**：把 client（103）+ server（104）拼接成**单人记账完整闭环**的冒烟集 + Human 真机/模拟器实测手册 + 自动化脚本（如可行）

**核心新增价值**：**端到端贯通验证 + 离线弱网专项断言** · 把 103/104 两手册合并成"用户视角"的闭环冒烟。

---

## §2 Scope（≤ 3 点估点 · 净增 ~ 600~900 行 · 0 业务代码 · 仅 qa/ 与 docs/qa/ 写权）

### 2.1 主交付（4 项）

#### A `qa/strategy.md`（新建 · ~ 120 行）

> **位置**：`qa/strategy.md`（按 qa-planner §1 工作区铁律 · 不与 `docs/qa/test-strategy.md` 冲突 · `docs/qa/` 是 Sprint-0 基线 / Human 人验材料 · `qa/` 是 qa-planner 自有工程档）

**内容**：

1. **§1 Sprint-2 冒烟目标**（覆盖 Epic-A 登录 + Epic-B 单人记账 + Epic-C 离线优先架构 client+server 闭环）
2. **§2 用例分层映射**（S-001~S-017 哪些已被 102/103/104 手册覆盖 · 本卡新增哪些）
3. **§3 自动化覆盖规划**（哪些用例可 `miniprogram-automator` 自动跑 / 哪些必须 Human 手动 · ≥ 80% 核心链路自动化目标可分阶段达成 · 本卡仅交付**自动化脚手架**与 1~2 个示例用例 · 非全量）
4. **§4 真机矩阵 v1**（iOS/Android 各 2 款 + 基础库三档 · 现实约束：Human 持微信开发者工具模拟器 + 1 台真机 · 真机覆盖延后 Sprint-3）
5. **§5 缺陷流转**（按 qa-planner §5.2 缺陷单格式 + Orchestrator 转介责任 Agent · 不自派）
6. **§6 进度看板**（本卡为起点 · 后续每个发布前必跑）
7. **§7 与 `docs/qa/test-strategy.md` 关系**（旧策略 v0.1 仍是 PR QA Gate 模板基线 · 本策略 sprint-2 只补 Sprint-2 冒烟新增维度 · 不替代）

#### B `qa/cases/single-user-smoke.md`（新建 · ~ 250~400 行 · **本卡核心交付**）

**用例结构**（12~16 条 · 九类覆盖 · 每条含 7 字段 · qa-planner §5.1）：

| Case ID | 类别 | 严重度 | PRD 锚点 | 状态 |
|---|---|---|---|---|
| **SU-001** 冷启动 + 登录闭环（Mock + WX_MOCK_LOGIN 双通） | 等价类 | P0 | COSTRA-101 AC-1 | new |
| **SU-002** 在线记一笔（POST /entries 直写 · 端到端） | 等价类 | P0 | COSTRA-113 AC-1 | new |
| **SU-003** 离线记一笔（飞行模式 · outbox 入队） | **离线弱网** | P0 | COSTRA-113 AC-4 | new（合并 S-007）|
| **SU-004** 联网恢复 → outbox 自动 push（POST /sync/push） | **离线弱网** | P0 | COSTRA-113 AC-4 + 122 AC-3 | new |
| **SU-005** 同 client_ref_id 重放 → server 防重（idempotency_key 24h 强幂等） | **幂等** | P0 | sync-protocol §2.5 + 122 AC-3 | new |
| **SU-006** version conflict 三态消费（base_version 不匹配 → conflict） | **并发** | P1 | sync-protocol §3 + 123 AC-1 | new |
| **SU-007** 弱网 8s 超时（网络限速 50KB/s）→ 错误降级 + 本地兜底不丢 | **弱网 + 异常** | P1 | NFR + S-014 | new（细化 S-014）|
| **SU-008** 金额边界（0 / 0.005 截断 / 999999999.99 / 负数 / decimal.js） | 边界 | P1 | COSTRA-111 AC-3 + ADR-0004 §4 | new（合并 S-006）|
| **SU-009** 冷启 TTI ≤ 2s（NFR） | **性能** | P1 | NFR + S-001 | new（合并 S-001）|
| **SU-010** Token 过期自动续签（强制 exp 过期 → /auth/refresh） | 异常 | P1 | COSTRA-103 AC-1 + S-004 | new（合并 S-004）|
| **SU-011** 授权拒绝（隐私授权拒绝 → 只读演示） | **授权拒绝** | P1 | PRD AC-4 + S-002 | new（细化 S-002 拒绝路径）|
| **SU-012** 兼容性（基础库 2.32.3 vs 3.8.12 双版本最小冒烟） | **兼容** | P2 | D-022 §3.1 微信基础库版本差异 | new |
| **SU-013** 安全（Token 不入 URL/日志 grep 自查） | **安全** | P2 | COSTRA-103 AC-3 + 安全风险点 | new |
| **SU-014（可选）** 主包体积 ≤ 1.5MB / 总包 ≤ 16MB | 性能/合规 | P1 | ADR-0004 §2 + S-013 | new（合并 S-013）|

> **九类覆盖核对**：等价类 ✅（SU-001/002）· 边界 ✅（SU-008）· 异常 ✅（SU-007/010）· **幂等 ✅（SU-005）** · **并发 ✅（SU-006）** · 兼容 ✅（SU-012）· 安全 ✅（SU-013）· **弱网 ✅（SU-003/004/007）** · 授权拒绝 ✅（SU-011）

> **每条用例字段**（qa-planner §2.1 + §5.1 · 严格执行）：
> - 前置条件（含真机/模拟器信息 + 基础库版本）
> - 步骤（含 storage 重置 / WX_MOCK_LOGIN env / 网络模拟方式 · 参照 103/104 范式）
> - 预期（断言可度量 · 附 `wx.storage` key / Console 关键日志 / curl 输出 / DB 行）
> - 实际（首次执行留空 · Human 填）
> - 责任（用例失败时由谁修：Backend / MiniApp / DevOps）
> - 严重度（P0~P3 · 分级见 smoke-cases.md 约定）
> - PRD 锚点（COSTRA-xxx AC-Y · 必填）

#### C `docs/qa/costra-105-human-smoke.md`（新建 · ~ 250 行 · Human 真机/模拟器实测手册）

**结构**（参照 `costra-103-human-verify.md` v1.1 + `costra-104-curl-verify.md` v1.4）：

1. **§0 前置环境**（工具 / 凭证 / `npm install` / `cd server && npm run dev` / `scripts/dev/migrate.sh` 跑 · WX_MOCK_LOGIN=1 · 模式说明）
2. **§0.1 R1 范围声明**（本卡仅交付用例 + 手册 + 自动化脚手架 · 不重写 client/server 业务）
3. **§0.2 实测起点重置**（参照 103 §0.5 · `wx.clearStorageSync()` + `bash scripts/dev/reset-data.sh`）
4. **§1~§5 五步实测**（A 启动登录 / B 在线记账 / C 离线记账 + 联网回放 / D 冲突三态 / E 边界与降级）
5. **§6 ≥ 5 硬断言**（H1~H5 全 PASS · 与 §1~§5 的 SU-xxx 一一对应）
6. **§7 真机矩阵填充表**（iOS/Android 列 + 基础库列 + 通过/失败标识 · Human 完成时填）
7. **§8 失败分流**（哪条 fail → 转介哪个 Agent · 责任明示）
8. **§9 与 102/103/104 手册关系**（前置/复用/差异）

#### D `qa/automation/single-user-smoke.spec.ts`（新建脚手架 · ~ 60~120 行 · **可选交付 · INVEST small 守卫**）

`miniprogram-automator` 1~2 个用例自动化雏形（**仅脚手架 · 不要求全量自动化**）：

- 自动化用例 1：**SU-001 冷启动 + 登录闭环**（自动模拟点击"一键微信登录" → 断言 storage 有 token + URL 跳转 home）
- 自动化用例 2（可选）：**SU-002 在线记一笔**（自动填表 + 提交 + 断言列表新增 1 条）

**FU 立件**：剩余用例自动化转 Sprint-3 候选 `FU-105-AUTOMATION-FULL-COVERAGE`（P2 · 5 点）

> 若实装时发现 `miniprogram-automator` 在当前 microsoft-developer-tools 1.06.x 上 setup 困难（需启动 IDE + 端口暴露 · 历史踩坑 COSTRA-118 P2-3），降级为**脚手架占位 README + 用例伪代码**，转 FU-105。**不消耗 INVEST small 估点。**

### 2.2 副交付（3 项 · 文档同步）

#### E `qa/checklists/wechat-review.md`（**仅占位骨架** · ~ 30 行 · 真填表延后 COSTRA-901）

按 qa-planner §2.5 / 050 既有 `docs/qa/wechat-review-checklist.md` 摘出 12 大类（A~L）骨架 · 标注「真填表 → COSTRA-901 提审前由 Human + qa-planner 联合产出」。**本卡不深耕**。

#### F `.team/follow-ups/README.md` 追加 1 条 FU

- **FU-105-AUTOMATION-FULL-COVERAGE** P2 · Sprint-3 候选 5 点 · owner=qa-planner+miniapp-dev · 全量 14 用例自动化 + CI 集成

#### G `.team/members/qa-planner/state.md` + history（SBAI §3.3 收尾必做）

- state.md §2/§3/§7 刷新
- `.team/members/qa-planner/history/2026-05-12-costra-105-r1-implement.md`（5 段模板）

### 2.3 不属于本卡 Scope（明确切出去 · 防止 scope creep）

| 不实装项 | 切出去理由 | FU/卡 |
|---|---|---|
| 全量 14 用例自动化 + CI 集成 | INVEST small 守卫（3 点） | FU-105-AUTOMATION-FULL-COVERAGE → Sprint-3 |
| 微信审核自查清单深填 | 提审前才需 · COSTRA-901 主责 | COSTRA-901 |
| 真机矩阵 ≥ 4 机型实跑 | 现实约束（Human 仅模拟器 + 1 真机）| 真机扩展延 Sprint-3 |
| `qa/reports/release-v0.x.md` 回归报告 | 提审前发版才有 | COSTRA-901 / 902 |
| k6 性能压测脚本 | NFR 性能仅在用例 SU-009 出 TTI 断言 · 不跑 k6 | COSTRA-903 候选 |
| ZAP 安全扫描 | 提审前才需 | COSTRA-901 候选 |
| 修 client / server 任何 bug | qa-planner 禁写 miniprogram/ + server/ · 仅发缺陷单 | 转介 miniapp-dev / backend-dev |

---

## §3 DoD（可度量 · 14 项）

### §3.1 文档交付（5 项）

- [ ] `qa/strategy.md` 落盘 · 含 §1~§7 七段
- [ ] `qa/cases/single-user-smoke.md` 落盘 · ≥ 12 条用例 · 九类覆盖核对表存在
- [ ] `docs/qa/costra-105-human-smoke.md` 落盘 · §0~§9 完整 · ≥ 5 步 + ≥ 5 硬断言
- [ ] `qa/checklists/wechat-review.md` 占位骨架落盘
- [ ] `.team/follow-ups/README.md` 追加 FU-105-AUTOMATION-FULL-COVERAGE

### §3.2 用例质量（4 项 · qa-planner §2.1）

- [ ] 每条用例 7 字段全填（PRD 锚点 / 步骤 / 预期 / 责任 / 严重度 / 真机信息 / 实际留空）
- [ ] 九类覆盖齐全（等价类 / 边界 / 异常 / 幂等 / 并发 / 兼容 / 安全 / 弱网 / 授权拒绝）
- [ ] P0 用例 ≥ 5 条（SU-001~005 已规划）
- [ ] 每条用例必引用 ≥ 1 个 PRD AC（COSTRA-xxx AC-Y）

### §3.3 自动化（2 项 · INVEST small 守卫）

- [ ] `qa/automation/single-user-smoke.spec.ts` 脚手架落盘（含 1~2 个示例用例 · 或降级为 README + 伪代码占位）
- [ ] FU-105-AUTOMATION-FULL-COVERAGE 立件

### §3.4 与既有卡对齐（3 项）

- [ ] 不与 `docs/qa/test-strategy.md`（v0.1）冲突 · §7 关系说明显式
- [ ] 不重复 102/103/104 手册既有断言 · 仅做"端到端拼接"扩展
- [ ] 复用 103/104 实测手册的"实测起点重置 + WX_MOCK_LOGIN env"范式（参照不复制）

---

## §4 闸门（≥ 5 项 · 同轮兑现绿才提交）

| # | 闸门 | 命令 | 期望 |
|---|---|---|---|
| G1 | typecheck（root + server） | `npm run typecheck` && `cd server && npm run typecheck` | exit 0 |
| G2 | vitest（既有用例不破坏） | `npm test` && `cd server && npm test` | exit 0 / 21~34 tests pass（不应受本卡影响）|
| G3 | check:appjson | `npm run check:appjson` | exit 0 |
| G4 | check:tooling | `npm run check:tooling` | exit 0 |
| G5 | check:whitelist | `npm run check:whitelist` | exit 0 |
| G6 | git diff 跨域校验 | `git diff HEAD -- miniprogram/ server/ api/ infra/` | **空**（qa-planner 禁写区域） |
| G7（可选） | `qa/automation/single-user-smoke.spec.ts` 语法 check | `node --check qa/automation/single-user-smoke.spec.ts` 或 `tsc --noEmit qa/automation/*.ts` | exit 0（若实装）|

---

## §5 强制阅读清单（subagent spawn 时 §G inline）

### §5.1 必读（按顺序）

1. `.team/agents/COMMON-CONTRACT.md` §0 / §0-Bis / §4 / §8ter
2. `.codebuddy/agents/costra-qa-planner.md` 全文（角色规则 + bypassPermissions 红线）
3. `.team/SOP-CARD-REVIEW.md`（卡定义 Review 流程）
4. `.team/decisions/D-014-card-review-and-auto-review-kickoff.md`
5. `.team/decisions/D-016-final-canonical.md`（同轮兑现）
6. `.team/decisions/D-017-verification-problem-response-sop.md` v3
7. `.team/decisions/D-018-spawn-based-agent-isolation.md` v1.1
8. `.team/decisions/D-022-review-tech-runtime-dimension.md`（v2.0 评分表 + runtime 类铁律）
9. `docs/PRD.md`（Epic-A/B/C AC · 重点 COSTRA-101/103/111/113/121/122/123）
10. `docs/qa/smoke-cases.md`（S-001~S-017 现状）
11. `docs/qa/test-strategy.md`（v0.1 旧策略 · 不替代）
12. `docs/qa/costra-103-human-verify.md`（client outbox 实测范式）
13. `docs/qa/costra-104-curl-verify.md`（server curl 实测范式）
14. `server/api/openapi.yaml` + `docs/api/sync-protocol.md`（接口断言依据）
15. `scripts/dev/README.md`（dev DX 三件套 · COSTRA-104 R1 落盘）

### §5.2 按需

- `.team/SOP-REVIEW.md` v2.1（产出 Review 流程）
- `.team/board.md`（Sprint-2 段 · 105 状态）
- `.team/backlog.json`（105 元数据）
- `.team/follow-ups/README.md`（FU 队列 · 立 FU-105 在此追加）
- `.team/decisions/D-013-review-scenario-tiering.md`（T1/T2 档位）
- `.team/reviews/COSTRA-103/FINAL.md` + `.team/reviews/COSTRA-104/FINAL.md`（Sprint-2 主线两 Final · 范式参考）

---

## §6 硬约束（不可违反）

### §6.1 工作区铁律（qa-planner §1 + COMMON-CONTRACT §0-Bis）

- ✅ 可写：`qa/` / `docs/qa/` / `.team/follow-ups/README.md`（追加 FU 段）/ `.team/members/qa-planner/`
- ❌ 禁写：`miniprogram/` / `server/` / `api/` / `infra/` / `design/` / `docs/PRD.md` / 其他 `.team/members/{role}/`（**G6 闸门把死**）

### §6.2 SBAI 装扮档铁律（D-018 §3）

- 每次 spawn 全新 context · 任务结束销毁 · 持久状态走 state.md
- final message 必含：摘要 + state.md 已更新 + history 已落盘 + 缺陷清单（若有）

### §6.3 D-016 同轮兑现（强制）

- Card-Review R1 → 实装 R1 → review-tech R1 在同一对话轮内完成
- 不允许"派完单等下轮人工触发"

### §6.4 D-017 v3 §2.4（验证问题响应 SOP）

- 若 R1 实装/Review 中出现验证失败 · 走 ① 责任领域识别 → ② 责任 Agent 根因分析（不改文件）→ ③ 多方案对比 → ④ Human 评估 → ⑤ 派单实装
- E1 例外路径（≤ 5 分钟单 commit 收尾）适用于：用例错字 / 文档锚点漂移 / 链接失效（非 P0/P1 问题）

### §6.5 D-022 v2.0 评分表（review-tech R1 时适用）

总分 40 分 · 含 C8 runtime 加载性维度（5 分）：

| 维度 | 满分 | 备注 |
|---|---|---|
| C1 合约合规 | 5 | 用例 PRD 锚点正确性 |
| C2 架构正确 | 5 | 用例分层 / 文件结构合理 |
| C3 数据处理 | 5 | 金额边界 / 三态消费 / 幂等用例正确性 |
| C4 同步时序 | 5 | 离线弱网 / version conflict 用例正确性 |
| C5 安全性 | 5 | Token 不入日志 / 隐私授权拒绝用例覆盖 |
| C6 可测性 | 5 | 用例步骤可复现 / 真机矩阵明示 |
| C7 工程纪律 | 5 | typecheck / 9 类覆盖核对表 / 跨域 0 改动 |
| **C8 runtime 加载性** | **5** | **手册中是否含 Human 实测 + 跨基础库（2.32.3/3.8.12）对照 + SDK 假设标注（C8-3）** |
| **C10 SBAI 流程合规**（D-022 评分表保留位）| ※ | state.md/history/同轮兑现 |

### §6.6 严守"切出去 3 件套铁律"（COSTRA-104 范式延续）

本卡虽不写 OpenAPI，但若发现用例需要的 endpoint 不存在或行为非预期：
1. 不擅自要求实装（不属本卡 owner）
2. 立 FU + 标 PRD 锚点 + 转 Sprint-3 候选
3. 在用例文档中以 `[BLOCKED-BY-FU-xxx]` 注记 · 不静默

### §6.7 不擅改 docs/PRD.md（qa-planner 只读铁律）

若发现 PRD AC 不清晰 / 矛盾，立 blocker 给 Orchestrator · 不擅改。

---

## §7 提交（D-012 单卡即提交 · D-018 commit footer）

```
test(qa): single-user smoke cases + offline manual + automation scaffold (COSTRA-105 R1)

- qa/strategy.md (sprint-2 smoke strategy)
- qa/cases/single-user-smoke.md (12+ cases with 9-category coverage)
- docs/qa/costra-105-human-smoke.md (5 steps + 5 hard assertions)
- qa/automation/single-user-smoke.spec.ts (scaffold or readme placeholder)
- qa/checklists/wechat-review.md (skeleton; deferred to COSTRA-901)
- .team/follow-ups/README.md (FU-105-AUTOMATION-FULL-COVERAGE)
- .team/members/qa-planner/state.md + history/2026-05-12-costra-105-r1-implement.md

Refs: COSTRA-105
```

**husky hooks**：commit-msg 走 commitlint（subject 全小写 · scope `qa`）· pre-commit 走 lint-staged（不应触动 qa/ 之外文件 · G6 闸门已守）

---

## §8 估点 / 时间盒

- **估点**：3 点（与 backlog/board 一致）
- **时间盒**：AI 流水（Card-Review + R1 实装 + Review）≤ 25 分钟（参照 COSTRA-103/104 节奏）
- **Human 终审排队**：本对话轮内 Human 等 review-tech APPROVE → 模拟器实测（手册 5 步 ~ 30 分钟）→ `approve:COSTRA-105`

---

## §9 上下文注入（subagent §F 用 · 同步 §1.1/1.3/2/3/4/5/6 inline）

派单时 §F 仅含本卡卡号 + DoD 摘要 + Round-N + diff inline（subagent 只读派单档与磁盘 · 不依赖 Orchestrator 记忆）。
