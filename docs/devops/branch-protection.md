# Costra · 分支保护与合并策略

> Refs: COSTRA-040, `.team/engineering-guidelines.md`

本文是**给 Human 的配置手册**，自动化部分由 `.github/workflows/*.yml` 覆盖；GitHub Repo Settings 需 Human 在 UI 中手工开启。

---

## 1. 分支拓扑

```
main     ← 生产版本（tag v*.*.*）
 ^
 │ PR (squash)
 │
dev      ← 集成分支，默认目标
 ^
 │ PR (rebase or squash)
 │
feat/<issue>-<slug>    ← 功能开发
fix/<issue>-<slug>     ← 修复
chore/<...>            ← 工程/杂项
docs/<...>             ← 文档
```

## 2. 分支保护规则

### 2.1 `main`

Settings → Branches → Add rule，pattern = `main`：

- [x] Require a pull request before merging
  - Required approvals: **1**
  - Dismiss stale approvals when new commits are pushed
- [x] Require status checks to pass before merging
  - Required: `ci/pr-check`（由 `pr-check.yml` 产出，status check 名已固定）
  - Strict (require branches up to date)
- [x] Require conversation resolution before merging
- [x] Require signed commits（可选，强烈推荐）
- [x] Require linear history
- [x] Include administrators
- [ ] Allow force pushes：**禁止**
- [ ] Allow deletions：**禁止**

**合并方式**：仅允许 **Squash and merge**。

### 2.2 `dev`

pattern = `dev`：

- [x] Require a pull request before merging
  - Required approvals: **1**
- [x] Require status checks to pass before merging
  - Required: `ci/pr-check`
- [x] Require conversation resolution before merging
- [x] Require linear history
- [x] Include administrators
- [ ] Allow force pushes：**禁止**

**合并方式**：允许 **Squash and merge** + **Rebase and merge**。

### 2.3 功能分支（`feat/*` `fix/*` `chore/*` `docs/*`）

无保护。但 PR 必须以 `dev` 为目标。

## 3. Tag 与 Release

- 版本 Tag：`v<MAJOR>.<MINOR>.<PATCH>`（语义化版本）
- Tag 必须从 `main` 打出
- 打 Tag 自动触发 `mp-release.yml`（需 `production` environment 审批）
- 禁止删除已发布 tag；如需作废请发布 `v<MAJOR>.<MINOR>.<PATCH+1>` 覆盖

## 4. 合并消息规范

squash merge 后的 commit 自动使用 PR 标题作为第一行，PR 标题必须符合 Conventional Commits：

```
<type>(<scope>): <subject>

<BLANK LINE>

<body>

<BLANK LINE>

Refs: COSTRA-<card>[, ADR-<id>]
```

- `type ∈ {feat, fix, chore, refactor, docs, test, build, ci, perf}`
- `scope ∈ {miniapp, backend, design, devops, qa, docs, api, db, repo}`
- `subject` 用祈使句，不加句号，≤ 72 字符

## 5. CODEOWNERS（Sprint-1 再补，占位）

```
# .github/CODEOWNERS
/miniprogram/  @miniapp-team
/server/       @backend-team
/docs/design/  @design-team
/docs/qa/      @qa-team
/.github/      @devops-team
```

## 6. PR 模板（推荐，非强制）

路径 `.github/pull_request_template.md`：

```markdown
## 背景 / 动机

## 变更要点

## 自测清单
- [ ] 按 `docs/qa/smoke-cases.md` 过一遍（若涉及 UX）
- [ ] 本地 `npm run lint && npm run typecheck && npm test` 全绿

## 关联
Refs: COSTRA-___
```

## 7. 操作记录

| 操作 | 时间 | 负责人 |
|---|---|---|
| main 保护启用 | ⏳ | Human |
| dev 保护启用 | ⏳ | Human |
| production env 创建并设置 reviewers | ⏳ | Human |
