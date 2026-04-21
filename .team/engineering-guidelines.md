# Costra 工程约束（Engineering Guidelines）

> **状态**：Accepted · 2026-04-21（Orchestrator 固化自 Human 指令）
> **适用范围**：Sprint-0 起所有 Agent 与 Human。
> **权威来源**：`docs/charter.md §13`；本文件是可落地的执行手册。
> **变更流程**：任何修改需经 ADR 或 G4 PR Review 通过。

---

## 1. 知识来源：微信小程序官方文档优先

### 1.1 第一权威
- **微信官方开发手册**：<https://developers.weixin.qq.com/miniprogram/dev/framework/>
- **微信开放文档（API / 组件 / 工具 / 运营）**：<https://developers.weixin.qq.com/miniprogram/dev/api/>
- **小程序审核规范**：<https://developers.weixin.qq.com/miniprogram/product/>

### 1.2 必须先查文档的场景清单
| 场景 | 对应 Agent | 官方文档关键字 |
|---|---|---|
| 框架与运行时 | MiniApp | MINA 框架、生命周期、page/component、Skyline |
| 路由与分包 | MiniApp | `subpackages`、`preloadRule`、独立分包、分包预下载 |
| 登录与会话 | MiniApp / Backend | `wx.login`、`code2Session`、`session_key`、UnionID |
| 网络与域名 | MiniApp / Backend / DevOps | 合法域名、`wx.request`、`wx.connectSocket`、`downloadFile`/`uploadFile` |
| 本地存储 | MiniApp | `wx.storage`、文件系统、数据库缓存 |
| UI 组件 | Design / MiniApp | WeUI、原生组件层级、自定义组件、`scroll-view` 虚拟化 |
| 分享 | MiniApp / Design | `onShareAppMessage`、`onShareTimeline`、卡片规范、审核禁止类目 |
| 订阅消息 | MiniApp / Backend | `wx.requestSubscribeMessage`、一次性 vs 长期性模板、下发时效 |
| 隐私合规 | MiniApp / PM / QA | 2023-09 隐私新规、`PrivacyAuthorize`、`getPrivacySetting`、《用户隐私保护指引》 |
| 性能与体积 | MiniApp / DevOps | 主包 ≤ 2MB、分包总 ≤ 20MB、性能助手、启动耗时面板 |
| 安全 | Backend / DevOps | `session_key` 生命周期、`checkSession`、加密传输、防重放 |
| 审核 | PM / QA | 类目准入、自查问卷、违规案例库 |

### 1.3 引用规范
- 在 PR 描述、ADR、设计稿或 Story 实现注释中引用官方文档，**必须带具体锚点 URL** + 访问日期（因为微信文档会随平台迭代）。
- 示例：
  > 本 Story 依据《分包加载 · preloadRule》实现（<https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/preload.html>，访问于 2026-04-21）。
- 若官方文档在实现期间发生变更，由 DevOps-Agent 在月度《平台变更监听周报》中提示，PM-Agent 评估影响面。

---

## 2. Git 提交与分支纪律

### 2.1 关键节点必须提交（触发条件）
以下任一事件发生后 **必须产生 Git commit**（无 commit 等同于未完成）：

1. 单个 Story（如 `STORY-A1`）的验收条件 AC 全部通过；
2. 单个 ADR 从 Proposed 变更为 Accepted，或新增 ADR；
3. 跨 Agent 契约（OpenAPI / DB Schema / 设计 Token / 消息 Schema）冻结或重大变更；
4. CI 流水线 / 基础脚手架 / 骨架工程初次跑通；
5. 一次压测 / 审核自查 / 安全扫描 / E2E 冒烟跑通并出报告；
6. 闸门 G1~G5 通过或驳回；
7. PRD / Charter / Backlog 的里程碑级更新（本次 G1 通过即属此例）。

### 2.2 提交格式（Conventional Commits 子集 · 强制）

```
<type>(<scope>): <subject>

<body（可选，说明动机 / 做了什么 / 没做什么）>

<footer（推荐）：Refs / Gate / Breaking-Change>
```

| 字段 | 可选值 |
|---|---|
| `type` | `feat` · `fix` · `refactor` · `chore` · `docs` · `test` · `ci` · `perf` · `revert` · `sprint`（里程碑聚合） |
| `scope` | `miniapp` · `server` · `api` · `infra` · `design` · `qa` · `docs` · `team`（跨 Agent 协作物） |
| `subject` | 祈使句 ≤ 72 字符，中英皆可，句尾不加句号 |
| `footer` | `Refs: STORY-A1, ADR-0004` / `Gate: G1-approved` / `Breaking-Change: <说明>` |

**示例**：
```
sprint(team): G1 通过，Sprint-0 上半段收口

- charter §9 回填生产 AppID + 类目
- PRD v0.1 冻结，ADR-0004 Accepted
- 新增 engineering-guidelines.md

Refs: COSTRA-001, COSTRA-002, COSTRA-003
Gate: G1-approved
```

```
feat(miniapp): COSTRA-030 骨架工程（TS + 分包 + ESLint）

Refs: STORY-MINIAPP-SKELETON, ADR-0004
```

### 2.3 分支策略
| 分支 | 用途 | 合并条件 |
|---|---|---|
| `main` | 生产（受保护） | 仅接受已过 G4 的 PR，需两位 Agent 会签 |
| `dev` | 当前主开发分支（你本地即此分支） | Agent 功能分支 squash 合入 |
| `feature/<agent>/<COSTRA-ID>-<slug>` | 单任务开发 | PR 合入 `dev`；PR 标题 = 首行 Conventional Commit |
| `hotfix/<issue>` | 线上热修 | 直接合入 `main` + backport 到 `dev` |

### 2.4 Agent 提交前自检 Checklist
1. `git status` 检查**仅**包含自己工作区的文件（越界改动会被 Orchestrator 驳回）。
2. `git diff` 自审：有无泄漏 secret、有无 IDE 临时文件、行尾是否统一。
3. PR 描述必须写明：
   - 关联 Story / ADR / Epic
   - 闸门影响（是否触发 G2/G3/G4/G5）
   - 测试结论（单测 / 集成 / 冒烟 / 审核自查）
   - NFR 是否变更
4. 提交后向 `.team/messages/YYYY-MM-DD.jsonl` 写 `status_report` 消息，Orchestrator 才会把看板从 Doing 推到 Review。

### 2.5 禁止事项
- 禁止 `git push --force` 到 `main` / `dev`（允许到个人 `feature/*` 分支）。
- 禁止提交：密钥、token、真机截图含个人信息、体积 > 1MB 的二进制（改用对象存储）。
- 禁止跨工作区改他人目录（权限见 `charter.md §7` 工作区矩阵）。

---

## 3. 例外与升级
- 发现官方文档与 ADR 冲突 → 写 ADR 修订案，G4 决策。
- 发现提交规范妨碍紧急修复 → hotfix 分支可先修复后补 ADR 与测试，24h 内回补齐全。
- Human 可直接改任何文件，但建议仍走 commit + PR，保持审计链完整。

---

## 4. 工具链推荐（DevOps-Agent 在 COSTRA-040 落地）
- **commitlint**：强制 Conventional Commits 格式。
- **husky + lint-staged**：pre-commit 跑 eslint / prettier / 类型检查。
- **Dangerfile**：PR 描述缺失关联 Story / ADR 时给出自动评论。
- **miniprogram-ci**：体验版 / 生产版自动上传（robot key 由 Human 填入 Vault）。

---

> **版本历史**
>
> - 2026-04-21 v1.0 · Orchestrator 固化，Human 在 G1 通过时下达。

