# COSTRA-155 · 全量 14/15 用例自动化 + CI 集成

> **派单时间**：2026-05-19 20:50（Orchestrator · Sprint-3 follow-up 转正 · FU-105-AUTOMATION-FULL-COVERAGE 转正）
> **状态**：dispatch 已落盘 · 不主动 spawn · 等 Human 拍板启动（D-024 §2.3）
> **依赖**：COSTRA-104（server 端点稳定）· COSTRA-150（client 调度器实装 · APPROVE 后启）· COSTRA-152/153（PATCH/DELETE entries · 自动化覆盖完整链路所需）
> **下游解锁**：CI 端到端自动化覆盖 ≥ 80% · 真链路实测频次降低 · D-022 §4.1 runtime 实测前置铁律的工程支撑

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | 等启动 |
| **R1 实装** | `costra-qa-planner` + `costra-miniapp-dev`（双装扮档单 commit · 158 范式延续）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech` | 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-155` | 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- COSTRA-105 R1 Card-Review P1-1（自动化脚手架降级路径）+ DoD §3.3（形式 ② README 占位）
- 当前 `qa/automation/README.md` 仅 SU-001 + SU-002 伪代码（行 33~155）· 实际用例 15 条（含 SU-004A/B v1.1 拆分）
- root package.json **未含** miniprogram-automator
- `.github/workflows/pr-check.yml` **无** test:e2e step

### 1.2 ⚠️ CI 端跑不了 miniprogram-automator 的关键阻塞（Card-Review 决策）
- miniprogram-automator 依赖微信开发者工具 IDE 端口 9427
- GitHub Actions runner 无 IDE 支持 → 全量自动化无法在 CI 上跑
- **Card-Review 阶段决策**：
  - **方案 A**：本地手动跑 + 报告上传 PR（半自动化 · 不彻底）
  - **方案 B**：纯逻辑层 vitest + headless mock（完全跳过 UI · 但失去集成层验证）
  - **方案 C**：分两段 · CI 跑逻辑层 vitest + 手动跑 IDE 端 + Sprint-3 末决策是否升级到自托管 runner
- **推荐方案 C**：本卡只做"自动化框架就绪 + 15 用例占位 + 本地可跑 + CI 跑非 UI 部分"· 不强求 CI 跑 IDE

---

## §2 Scope（6 项 · 估点 5 · INVEST small）

### 2.1 主交付

#### A · 安装 miniprogram-automator + 配置端口（qa-planner 段）
- root package.json 加 devDependency miniprogram-automator
- 微信开发者工具配置端口 9427 暴露
- `qa/automation/automator.config.json` 配置档（appId / projectPath / wsEndpoint）
- 文档：`qa/automation/README.md` v0.2 安装指引

#### B · 实装 15 条用例自动化（qa-planner 主驾 · miniapp-dev 协助 selector / 数据 hook）
- SU-001~014（含 SU-004A/B v1.1 拆分）= 15 条
- 复用 105 R1 已落 SU-001 / SU-002 伪代码 · 转真实装
- 每条用例 ≤ 30 行 · 共 ~450 行
- 覆盖率目标：核心链路 ≥ 80%（Epic-B 单人记账 + Epic-C 离线同步）

#### C · CI 集成（DevOps 协助 · qa-planner 主驾）
- `.github/workflows/pr-check.yml` 加 test:e2e step（条件：仅 PR + 标签 e2e）
- 本地命令：`npm run test:e2e:local`（启动 IDE + 跑全量）
- CI 命令：`npm run test:e2e:ci`（跳过 UI · 仅跑数据契约层 · 方案 C 简版）

#### D · 测试报告输出
- JSON 报告 `qa/automation/results/<timestamp>.json`
- HTML 报告（可选）

#### E · 文档同步
- `qa/strategy.md` Epic-B / Epic-C 自动化覆盖率目标 ≥ 80% 写实
- `qa/automation/README.md` v0.2 完整文档（安装 + 跑测 + CI + 限制说明）
- `qa/cases/single-user-smoke.md` 15 条用例每条加"自动化状态"标记（Automated / Manual-Only / Pending）

#### F · follow-ups
- FU-105-AUTOMATION-FULL-COVERAGE: open → closed @ COSTRA-155

### 2.2 不在本卡范围
- ❌ 多用户 / 家庭模式自动化 → Sprint-4+
- ❌ 性能 / 压力测试 → 留 FU-PERF-AUTOMATION
- ❌ CI 自托管 runner（带微信 IDE）→ 留 FU-CI-SELF-HOSTED-RUNNER

---

## §3 DoD（≥ 12 项）

包括 6 闸门 + G7（test:e2e:local 本地全绿）+ G8（CI test:e2e:ci 跑过 · 即使 UI 跳过也要 exit 0）+ G15。反向验证：① 临时改某 selector → 对应用例 FAIL · ② 临时关 server → 用例报错 fail-fast · ③ 临时停 IDE → automator 连不上报错明示。

D-025 扫描预测：AP-001/002/003 全不命中（纯工程治理卡）。

---

## §4 强制阅读清单

1. 本派单档 + Card-Review 报告
2. **现有自动化**：`qa/automation/README.md`（v0.1 · SU-001/002 伪代码）
3. **15 条用例**：`qa/cases/single-user-smoke.md`（SU-001~014 + SU-004A/B v1.1）
4. **CI 现状**：`.github/workflows/pr-check.yml`
5. **测试策略**：`qa/strategy.md`
6. **D-022 v2.0 §4.1**：runtime 实测前置铁律（本卡是工程支撑）
7. **miniprogram-automator 官方文档**：https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`qa/automation/` · `qa/cases/` · `qa/strategy.md` · `.github/workflows/pr-check.yml` · `package.json`（root scripts + devDependencies）· `.team/members/qa-planner/` + `.team/members/miniapp-dev/`
- ❌ 不可写：server/ · miniprogram/ 业务代码 · infra/

### §5.2 INVEST small（5 点）
- 时间盒：~~Card-Review + R1 实装 + R1 Review 8 小时（含 15 用例转真实装 ~6h + CI 配置 ~1h + 文档 ~1h）

### §5.3 双装扮档协作（158 范式延续）
- qa-planner 主驾 · miniapp-dev 协助（仅查 selector / 业务数据 hook · 不改业务代码）
- 单 commit 收尾（D-018 单装扮档单 commit · 双装扮档时单 commit 含两段 Co-Authored-By）

### §5.4 D-016 同轮兑现 · commit footer
- `closes: FU-105-AUTOMATION-FULL-COVERAGE`
- `Co-Authored-By: qa-planner <subagent>` + `Co-Authored-By: miniapp-dev <subagent>`

---

## §6 估点 / 时间盒
- 估点 5 点 · AI ~8 小时 · Human 实测：CI run 通过 + 本地 IDE 跑 15 条全绿截图

---

**派单档结束 · 等 Human `start:COSTRA-155`（建议 154+150+152+153 全 CLOSED 后启动）。**
