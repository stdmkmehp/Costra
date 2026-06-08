# COSTRA-128 · FU-LAUNCH 族 124~127 治理收尾清洗

## §0 SBAI 路径

跳 `card-review`（chore + P3 + 0 行为变更 + Orchestrator 已完成审视）。

## §1 范围

6 项，每项一行：

- **A**：`services/storage.ts` 注释清洗（删除 v1/v2/v3 叙事 + 误导的"业务必须 gate storage"措辞）—— Orchestrator 审视报告"storage.ts v3 残留注释"项
- **B**：`pages/home/index.ts` onLoad 注释第 2 行（v3 残留·与 onShow 实装矛盾）删除—— Orchestrator 审视报告"home.ts:30 注释矛盾"项
- **C**：`home/index.ts` + `mine/index.ts` onLoad gate 标注"冗余兜底"（1 行）—— Orchestrator 审视报告"onLoad gate 冗余兜底标注"项
- **D**：`app.ts` bootstrap 末尾 reLaunch 加 1 行注释—— Orchestrator 审视报告"app.ts reLaunch 与 Page gate 重叠"项
- **E**：`docs/devops/libversion-upgrade.md` §3.4 v4 全文删除·只留 v5 + 4 行版本演进表—— Orchestrator 审视报告"libversion-upgrade.md v4 文档过时"项
- **F**：`.team/members/miniapp-dev/state.md` §6 FU-LAUNCH 段清理（长篇定性描述→1 行指针）—— Orchestrator 审视报告"state.md §6 v3 时代 FU-LAUNCH 长篇描述"项

## §2 工作区

### 可写

- `miniprogram/services/storage.ts`（A）
- `miniprogram/pages/home/index.ts`（B、C）
- `miniprogram/pages/mine/index.ts`（C）
- `miniprogram/app.ts`（D）
- `docs/devops/libversion-upgrade.md`（E）
- `.team/members/miniapp-dev/state.md`（F）
- `.team/members/miniapp-dev/history/2026-05-08-costra-128-cleanup.md`（新建·≤60行）
- `.team/dispatch/COSTRA-128-cleanup-flu-launch-narrative.md`（新建·≤100行）

### 禁写

- `server/` `api/` `design/` `infra/`
- `docs/PRD.md` / `docs/qa/test-strategy.md` / `docs/qa/smoke-cases.md` / `docs/qa/wechat-review-checklist.md`
- `.team/decisions/*.md`
- `project.config.json` / `project.private.config.json`
- `miniprogram/services/auth.ts` / `sync.ts` / `request.ts` / `storage.spec.ts` / `pages/login/index.ts`
- 其他 `miniprogram/pages-*/`
- `.codebuddy/agents/`

## §3 commit + 闸门 + 验收

### commit（分 2 · footer 必含 `Refs: COSTRA-128`）

- **commit 1**：`chore(miniapp): cleanup v3/v4 narrative comments in storage/home/mine/app (COSTRA-128)`
  - 范围：`miniprogram/`
- **commit 2**：`docs(repo): costra-128 libversion v5 finalize + state.md cleanup (COSTRA-128)`
  - 范围：`docs/` + `.team/`

### 闸门（全 exit 0）

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run check:appjson`
- `npm run check:tooling`
- `npm run check:whitelist`

### 验收

- diff 行数：`-x ≥ +x`（删比加多）
- 0 行为变更
- 6 项 A~F 全完成