# COSTRA-126 · 开发期 libVersion 升级 2.32.3 → 3.8.12 + 反模式 #4 措辞修正 + COSTRA-125 收官

- **Sprint**：Sprint-1 末（2026-04-23 ~ 2026-05-06 · 收官期）
- **Epic**：Epic-C 本地存储 + 云同步（治理反哺 · 衔接 COSTRA-124/125 同卡簇）
- **Owner**：miniapp-dev
- **Type**：chore
- **Priority**：P2
- **Points**：1
- **依赖**：
  - COSTRA-124（部分闭合 · 顶层副作用 · commit `a296be0`）
  - COSTRA-125（R1 已交付 · commit `4643f89` + `d85d040` · 业务侧全 async 化 · 等本卡同步收官）
- **创建**：2026-05-08（by Orchestrator · Human 第 8 次跨 lib 实测后）
- **Driver**：
  - Human 第 8 次模拟器实测 · 5 lib 跨版本对照（2.33.0 / 3.8.12 / 3.14.3 / development）证伪"SDK 2.32.3+ 内业务有责"假设 v3
  - 反模式 #4 措辞需收紧到 v4：lib 2.32.x ~ 2.33.x dev 冷启动 SDK 内部 race · 业务无责
  - 新增反模式 #5：禁用 `development` 基础库（含 `(TO:基础库开发同学)` 内部 assert · 不可用于业务验证）
  - COSTRA-125 业务侧已通过跨 lib 实测证伪 SDK race · 顺带收官（业务全 async 是充分必要条件 · 无论 SDK 是否修复都该改）

---

## §0 SBAI 路径裁决

**本卡跳过 card-review**（D-014 豁免触发）：

- chore + 1 点（远低于 D-014 强制 card-review 阈值 ≥ 3 点 / P0/P1）
- 已有 dispatch 同卡簇先例（COSTRA-124 / COSTRA-125 dispatch 模板齐全 · 本卡仅在其上做"治理反哺"型措辞收紧 + 配置升级）
- 实装后走 review-tech R1 即可（不开 P0/P1 时不强制 R2）

---

## §1 背景

### §1.1 COSTRA-125 R1 已交付（2026-05-04）

- 业务侧 `wx.*StorageSync` 已全部消灭（`miniprogram/services/storage.ts` 等 0 命中）
- `app.bootstrapPromise` IIFE 串行 `await ensureVersion(); await initAuth()` 落地
- 3 Page（login/home/mine）onLoad gate 落地
- 单测 `services/storage.spec.ts` 8 测全绿
- 等 Human 第 8 次模拟器实测兑现 FU-LAUNCH-B 真闭合

### §1.2 Human 第 8 次跨 lib 实测（2026-05-08 16:33 ~ 17:00）

业务代码侧自证：

- `grep StorageSync` 全仓 0 命中
- `grep traceEvent` 全仓 0 命中
- `grep getSystemInfo` 全仓 0 命中

5 lib 跨版本对照（COSTRA-125 R1 已落 + 业务代码无变）：

**清缓存 + 重新编译** 路径（IDE 进程已预热）：

| lib | too eayly | Expected updated data | Launch Time | 业务流程 |
|---|---|---|---|---|
| 2.33.0 | 0 | 0 | 2156 ms | ✅ |

**重新打开项目**（IDE webview 冷启动）：

| lib | too eayly | Expected updated data | Launch Time | 业务流程 |
|---|---|---|---|---|
| 2.33.0 | 多次（getGlobalStorage / setGlobalStorage / removeGlobalStorage / traceEvent）| 1 次 | 3485 ms | ✅ 但有 SDK 报错 |
| 3.8.12 | **0** | 1 次 | 4216 ms | ✅ |
| 3.14.3 | （未测）| —— | —— | —— |
| development | 0 too eayly · 5 条 framework error `(TO:基础库开发同学)` `__wxConfig.*` | —— | —— | 启动期 framework error |

**关键证据**（4 条独立证据链证伪"业务有责"）：

1. 业务代码 grep `wx.*StorageSync` = 0 命中（COSTRA-125 R1 已彻底改 async）
2. 业务代码 grep `traceEvent` = 0 命中
3. 业务代码 grep `getSystemInfo` = 0 命中
4. lib 2.33.0 场景 B 报错栈 100% 在 `WAWebview.js` `Tt._prepare` / `_setMetadata` 内部，未进业务代码
5. lib 2.33.0 场景 B 报错时刻 100% 在 `[Costra] onLaunch env= dev` 之前
6. lib 升级到 3.8.12 后 `too eayly` 整族消失 → 直接证伪 v3 定性
7. `Expected updated data` 在 lib 3.8.12 仍 1 次 · 仅 dev 工具冷启动 · 与 LazyCodeLoading 启动时序相关 · 真机延后验证

### §1.3 Human 决策（2026-05-08 · 已拍板 · 不再问）

- **开发期 libVersion**：2.32.3 → **3.8.12**
- **上架最低基础库 NFR**：保持 **2.32.3** 不动（PRD / test-strategy / smoke-cases / wechat-review-checklist 不改）
- **COSTRA-125 验收**：本卡顺带 close（业务侧已通过跨 lib 实测证伪 SDK race）

---

## §2 DoD（5 条 · 可度量）

### (a) `project.config.json` libVersion 升级

- `"libVersion": "2.32.3"` → `"libVersion": "3.8.12"`
- 文件其他字段零改动（最小变更纪律）
- 验证：`git diff project.config.json` 仅 1 行

### (b) `miniprogram/services/storage.ts` 顶部注释收紧

- 现有第 14 行：`是基础库 2.21.0+ 的官方 Promise 形态（不传 success/fail/complete 时返回 Promise）· 项目 libVersion 2.32.3 满足`
- 改为：`是基础库 2.21.0+ 的官方 Promise 形态（不传 success/fail/complete 时返回 Promise）· 当前开发期 libVersion 3.8.12 满足 · NFR 最低基础库 2.32.3 亦满足（Epic-G 上架合规）`
- 不变量 #1~#4 其他内容不动

### (c) `miniprogram/README.md` 区分"开发期"vs"NFR 最低"

将现有 `最低基础库：**2.32.3**（对齐 PRD NFR）` 行改为三行：

```
- 开发期基础库：**3.8.12**（开发者工具调试基础库 + project.config.json 默认）
- NFR 最低基础库：**2.32.3**（对齐 PRD §NFR · 上架时微信后台"最低基础库"档位 · 影响真机用户覆盖率）
- 禁用：`development` 基础库（含 `(TO:基础库开发同学)` 内部 assert 断言 · 不应用于业务验证 · libversion-upgrade.md §3.5 反模式 #5）
```

### (d) `docs/devops/libversion-upgrade.md` 文档治理（4 块）

#### (d.1) §3.4 反模式 #4 措辞收紧到 v4

定性 v4：

> "微信开发者工具在**冷启动 webview**（重新打开项目）场景下，**lib 2.32.x ~ 2.33.x** 的渲染层 `Tt._prepare()` 自身 jsbridge 调用存在内部时序循环 · 抛 `too eayly` 系列错误（getGlobalStorage / setGlobalStorage / removeGlobalStorage / traceEvent / Failed get/delete storage group）· **lib 3.8+ 已基本修复**（实测 0 too eayly）· 这是 dev 工具冷启动现象 · 真机不复现 · 业务无责。本反模式由 COSTRA-124 R2 误判 + COSTRA-125 跨 lib 实测纠正。**业务侧治理**：所有 wx.*StorageSync 同步 API 一律改 wx.getStorage Promise 形态（基础库 2.21.0+ 支持 · COSTRA-125 已实装）· 这是充分必要条件——无论 SDK 内部 race 是否被官方修复，业务都要用 Promise 形态。"

#### (d.2) §3.5 新增反模式 #5 · `development` 基础库

- 标题：反模式 #5 · 使用 development 基础库验证业务
- 坏例：开发者工具"调试基础库"选 `development`
- 报错样本：`FrameworkError Error: [Service](TO:基础库开发同学) 在 onLoad 阶段访问 __wxConfig.useWebWorker / isFirstPage / isLazyLoad / plugins / subPackages 可能取不到值`
- 真因：`development` 是微信基础库团队**未发布的开发分支** · 含 `(TO:基础库开发同学)` 内部 assert 断言 · 是给基础库团队自己看的诊断标签
- 治理：业务**永远使用稳定版**（如 2.32.3 / 3.8.12 / 3.14.x）· `project.config.json` libVersion 字段不允许写 `development`
- 检测：CI 可考虑加 `check:libversion` 脚本扫 `libVersion` 不得为 `development`（本卡不实装 · 转 FU-LIBVERSION-DEV-GUARD P3 观察）

#### (d.3) §4 跨 lib 实测对照表（新增章节）

落盘 §1.2 两个表格 · 数据来源 = Human 第 8 次实测 2026-05-08 16:33 ~ 17:00 · lib `2.32.3` / `3.14.3` 待补（Sprint-2 真机预览时补全）

#### (d.4) §3.6 R1 假设证伪定稿 v4

- 把"COSTRA-124 R1 假设证伪 = SDK + 业务共责"修正为"COSTRA-124 R1 假设证伪定稿 v4 = lib 2.32.x ~ 2.33.x dev 冷启动 SDK 内部 bug · 业务无责 · COSTRA-125 全 async 化是预防性最佳实践"
- 显式列出 4 条独立证据链：
  1. 业务 grep（`*StorageSync` / `traceEvent` / `getSystemInfo`）全 0 命中
  2. 报错栈 100% 在 SDK `WAWebview.js` 内部（`Tt._prepare` / `_setMetadata`）
  3. 报错时刻 100% 在业务 `[Costra] onLaunch env= dev` 之前
  4. lib 升级到 3.8.12 后 `too eayly` 整族消失（独立第 4 证据）

### (e) FU + state + history + COSTRA-125 收官

- `.team/follow-ups/README.md`：
  - FU-LAUNCH-FIRST-RENDER-RACE-B：`open` → `closed`（resolved_by COSTRA-125 commits + COSTRA-126 跨 lib 实测）
  - FU-LAUNCH-FIRST-RENDER-RACE-C：`open` → `degraded-to-p3-observe`（仅 dev 工具复现 · 真机验证延后到 Sprint-2 / 提审前）
  - 父 FU-LAUNCH-FIRST-RENDER-RACE：`open` → `closed`（A/B 真 closed · C 转 P3 观察）
  - 新立 FU-LIBVERSION-DEV-GUARD（P3 观察 · `development` lib CI 防护 · 不计点 · Sprint-2 候选）
- `.team/members/miniapp-dev/state.md`：
  - §2 active tasks：COSTRA-125 改 "整卡 CLOSED + 待 review-tech 形式 R1 审" · COSTRA-126 进度
  - §3 加新 history 索引
  - §7 加 2026-05-08 时间戳
- `.team/members/miniapp-dev/history/2026-05-08-costra-126-libversion-upgrade.md`（新建 · 5 段模板）

---

## §3 工作区 + 权限

**可写**：

- `project.config.json`（DoD a）
- `miniprogram/services/storage.ts`（DoD b · 仅顶部注释 · 不动函数实现）
- `miniprogram/README.md`（DoD c）
- `docs/devops/libversion-upgrade.md`（DoD d.1~d.4）
- `.team/follow-ups/README.md`（DoD e · FU 状态流转）
- `.team/members/miniapp-dev/state.md`（DoD e · §2/§3/§7 收尾）
- `.team/members/miniapp-dev/history/2026-05-08-costra-126-libversion-upgrade.md`（新建）
- 本 dispatch（自身）

**禁写**：

- `server/` / `api/` / `design/` / `infra/`
- `docs/PRD.md` / `docs/qa/test-strategy.md` / `docs/qa/smoke-cases.md` / `docs/qa/wechat-review-checklist.md`（NFR 不改 · 产品决策）
- `.team/decisions/*.md` / `.team/agents/*.md`
- `project.private.config.json`（个人配置 · 不入 git）
- `miniprogram/` 业务代码（仅 storage.ts 顶部注释 + README.md 允许）
- `.codebuddy/agents/costra-miniapp-dev.md`（角色装扮档案 · 与运行配置解耦 · 留待下一轮 agent 维护卡处理）

---

## §4 反模式禁令

- ❌ 改 PRD/test-strategy/smoke-cases/wechat-review-checklist 的"2.32.3"（NFR 是产品决策）
- ❌ 改 `project.private.config.json`（不入 git）
- ❌ 改业务代码（除 storage.ts 顶部注释 + README.md）
- ❌ 不跑闸门就 commit
- ❌ 用 `--no-verify` 绕 hooks
- ❌ 自行决定 review-tech 是否拉起（Orchestrator 拍板权）

---

## §5 闸门（必跑）

- `npm run typecheck` → exit 0
- `npm run test` → 全绿
- `npm run lint` → exit 0
- `npm run check:appjson` → exit 0
- `npm run check:tooling` → exit 0
- `npm run check:whitelist` → exit 0

注：本卡不动业务代码，闸门应完全无变化（注释改写不计入 lint/typecheck）。

---

## §6 commit 纪律

按 D-012 单卡即提交 · 分 2 commit：

- commit 1：`chore(miniapp): bump libversion 2.32.3 → 3.8.12 dev (COSTRA-126)` — `project.config.json` + `miniprogram/services/storage.ts` 顶部注释 + `miniprogram/README.md`
- commit 2：`docs(repo): costra-126 libversion-upgrade v4 + anti-pattern #5 + costra-125 close (COSTRA-126)` — `docs/devops/libversion-upgrade.md` + `.team/`
- footer 必含 `Refs: COSTRA-126`（commit 2 可加 `Refs: COSTRA-125, COSTRA-126`）
- 禁止 `--no-verify` · hooks 必 PASS

---

## §7 验收

- 5 条 DoD 全 PASS
- 6 条闸门全 exit 0
- 2 commit 落盘 · footer 合规
- COSTRA-125 整卡 CLOSED（FU-LAUNCH-A/B 真 closed · C 转 P3 观察 · 父 FU close）
- 等 Orchestrator 决策是否 spawn review-tech 形式 R1（chore + 1 点 · 可选）

---

## §8 时间预算

- (a) project.config.json libVersion bump：1 min
- (b) storage.ts 顶部注释：3 min
- (c) miniprogram/README.md：5 min
- (d) docs/devops/libversion-upgrade.md（4 块）：30 min
- (e) FU + state + history：25 min
- 闸门 + commit：10 min
- **合计 AI 侧**：~75 min

---

## §9 Driver 溯源

- COSTRA-125 R1 实装 history：`.team/members/miniapp-dev/history/2026-05-04-costra-125-r1-implement.md`
- Human 第 8 次实测时段：2026-05-08 16:33 ~ 17:00（5 lib 跨版本对照 + 4 条独立证据链）
- Human 拍板 D1/D2/D3：2026-05-08 17:00（开发期升级 / NFR 不动 / COSTRA-125 顺带 close）
- 本卡走 SBAI v1.1 派单 · 装扮 subagent `costra-miniapp-dev` 实装 · D-014 豁免 card-review
