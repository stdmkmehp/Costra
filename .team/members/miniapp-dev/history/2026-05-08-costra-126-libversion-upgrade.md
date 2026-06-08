# 2026-05-08 · COSTRA-126 跨 lib 实测证伪 + libVersion 升级 + 同卡簇收官

> SBAI v1.1 装扮型 subagent 交付 history（接力 Orchestrator 收尾模式）
>
> **卡号**：COSTRA-126
> **类型**：chore（治理反哺 + 配置升级）
> **估点**：1
> **优先级**：P2
> **Sprint**：Sprint-1 末
> **实装人**：costra-miniapp-dev 装扮（前半 spawn 中止，Orchestrator 接力收尾）
> **依赖**：COSTRA-124（部分闭合 · `a296be0`）/ COSTRA-125（R1 已交付 · `4643f89` + `d85d040`）
>
> **核心成果**：通过 Human 第 8 次跨 lib 实测 + 业务代码 grep 三重 0 命中，**直接证伪** COSTRA-124 R2 v3 定性"SDK + 业务共责"，修正为 v4"lib 2.32.x ~ 2.33.x SDK 内部 race · 业务无责"。COSTRA-125 业务侧实装作为充分必要正确实践保留并整卡收官。FU-LAUNCH 父 FU + B 子 FU 真闭合，C 子 FU 降 P3 观察。

---

## §1 立卡背景

### §1.1 COSTRA-125 R1 已交付（2026-05-04）

业务侧 storage / auth / sync 全 async + bootstrapPromise + 3 Page onLoad gate · 单测 storage.spec.ts 8 测 · 六闸全绿。但 dispatch §3 (g) 5 条断言**待 Human 第 8 次实测**才能真闭合 FU-LAUNCH-B。

### §1.2 Human 第 8 次模拟器实测（2026-05-08 16:33 ~ 17:00）

跨 5 lib 版本对照测试，由 Human 主动驱动（Orchestrator 未在 spawn 前显式安排该任务，是 Human 实测时自主探索）：

**清缓存 + 重新编译**（IDE 进程已预热）：

| lib | too eayly | Expected updated data | Launch Time | 业务 |
|---|---|---|---|---|
| 2.33.0 | 0 | 0 | 2156 ms | ✅ |

**重新打开项目**（IDE webview 冷启动）：

| lib | too eayly | Expected updated data | Launch Time | 业务 |
|---|---|---|---|---|
| 2.33.0 | 多次 | 1 次 | 3485 ms | ✅ |
| 3.8.12 | **0** | 1 次 | 4216 ms | ✅ |
| `development` | 0 too eayly · 5 条 framework error | —— | —— | 启动期 framework error |

### §1.3 关键观察

1. lib 2.33.0 场景 B 报错栈 100% 在 `WAWebview.js`（`Tt._prepare` / `_setMetadata` / `traceEvent` / `createOrGetStorageGroup`）· **0 行进业务代码**
2. lib 2.33.0 场景 B 错误打印时刻 100% 在 `[Costra] onLaunch env= dev` **之前** · 业务代码尚未执行
3. lib 升级到 3.8.12 后 `too eayly` **整族消失** · 业务代码零变更
4. `development` lib 出现 5 条 framework error 含字面 `(TO:基础库开发同学)` · 微信内部诊断断言 · 不可用于业务验证

---

## §2 D-017 Step 2 根因诊断（v3 → v4 翻转）

### §2.1 v3 定性回顾（2026-05-03 R2 诊断 · 已被证伪）

> "微信基础库 2.32.3+ 在 App.onLaunch 触发时 · 渲染层 storage group `_prepare` 状态尚未就绪 · 任何从逻辑层同步发起的 `wx.*StorageSync` 调用都会经 jsbridge 委托到渲染层 storage group 并报 `too eayly` · **SDK + 业务共同责任**"

### §2.2 v4 定性修正（本次 2026-05-08 · 实测证伪 v3）

> **微信开发者工具在冷启动 webview 场景下，lib 2.32.x ~ 2.33.x 的渲染层 `Tt._prepare()` 自身 jsbridge 调用存在内部时序循环依赖（SDK 自己在 _prepare 内调 _prepare 依赖项）· 抛 `too eayly` 系列错误（getGlobalStorage / setGlobalStorage / removeGlobalStorage / traceEvent / Failed get/delete storage group）· lib 3.8+ 已基本修复（实测 0 too eayly）· 这是 dev 工具冷启动现象 · 真机不复现 · 业务无责。**
>
> **业务侧治理（COSTRA-125）作为充分必要正确实践保留**：所有 wx.*StorageSync 同步 API 一律改 wx.getStorage Promise 形态（基础库 2.21.0+ 支持）· 这是无论 SDK 是否修复都该改的最佳实践。

### §2.3 v3 → v4 翻转的 4 条独立证据链

| # | 证据 | 反推结论 |
|---|---|---|
| 1 | 业务代码 grep `wx.*StorageSync` / `traceEvent` / `getSystemInfo` 全仓 0 命中 | 业务代码不在调用链上 |
| 2 | lib 2.33.0 场景 B 报错栈帧 100% 在 `WAWebview.js`（`Tt._prepare` / `_setMetadata` / `traceEvent`）· 0 行进 `miniprogram/services/storage.ts` 或 `auth.ts` | 业务代码未被执行到 |
| 3 | lib 2.33.0 场景 B 报错时刻 100% 在 `[Costra] onLaunch env= dev` **之前** | 业务代码尚未启动 |
| 4 | lib 2.33.0 → 3.8.12 业务代码零变更 · `too eayly` 整族消失 | 错误归属 = SDK 内部时序 bug · 与业务无关 |

### §2.4 R2 假设漏拦截教训

R2 诊断（2026-05-03 v3 翻转）当时仅基于 lib 2.32.3 单版本 + 业务代码 storage 调用栈推理 · **未做跨 lib 对照** · 无法独立证伪"业务有责"假设。本次 Human 自发跨 5 lib 实测 + grep 三重 0 命中 + 报错栈 + 报错时刻四线交叉，才让"业务有责"假设彻底失效。

**Sprint-1 末 Retro 候选议题（编号待 PM 分配）**：

> 「D-017 Step 2 根因诊断必须包含**跨版本/跨环境对照测试**，单版本推理（即便基于 grep + 调用栈）仍可能误判归责」

---

## §3 实装范围（DoD a~e）

### §3.1 (a) `project.config.json` libVersion 升级

- `2.32.3` → `3.8.12`
- 文件其他字段零改动（最小变更纪律）
- diff：1 行变更

### §3.2 (b) `miniprogram/services/storage.ts` 顶部注释收紧

- 第 14 行原文：`是基础库 2.21.0+ 的官方 Promise 形态（不传 success/fail/complete 时返回 Promise）· 项目 libVersion 2.32.3 满足`
- 改后：`是基础库 2.21.0+ 的官方 Promise 形态（不传 success/fail/complete 时返回 Promise）· 当前开发期 libVersion 3.8.12 满足 · NFR 最低基础库 2.32.3 亦满足（Epic-G 上架合规）`
- 不变量 #1~#4 其他内容不动

### §3.3 (c) `miniprogram/README.md` 开发期 vs NFR 分离

- 原文：`最低基础库：**2.32.3**（对齐 PRD NFR）`
- 改为三行：
  - `开发期基础库：**3.8.12**（开发者工具调试基础库 + project.config.json 默认）`
  - `NFR 最低基础库：**2.32.3**（对齐 PRD §NFR · 上架时微信后台"最低基础库"档位 · 影响真机用户覆盖率）`
  - `禁用：development 基础库（含 (TO:基础库开发同学) 内部 assert 断言 · 不应用于业务验证 · libversion-upgrade.md §3.5 反模式 #5）`

### §3.4 (d) `docs/devops/libversion-upgrade.md` 文档治理（+113 行）

- **§3.4 反模式 #4 措辞修正 v4**：从"SDK 2.32.3+ 内业务有责"改为"lib 2.32.x ~ 2.33.x dev 工具冷启动 SDK 内部 race · 业务无责 · 业务侧 async 治理是充分必要正确实践"
- **§3.5 新增反模式 #5**：禁用 `development` 基础库 · 含 `(TO:基础库开发同学)` 内部 assert · 治理 + 检测建议（FU-LIBVERSION-DEV-GUARD）
- **§4 跨 lib 实测对照表**：5 lib × 2 启动场景的 console 输出对照
- **§3.6 R1 假设证伪定稿**：4 条独立证据链 + COSTRA-124/125/126 三卡协同治理叙事

### §3.5 (e) FU + state + history

- `.team/follow-ups/README.md §f.5`（5 子段：实测对照 / 4 证据链 / 子 FU 终结流转 / 新立 FU-LIBVERSION-DEV-GUARD / COSTRA-126 实装范围 / NFR 不动声明）
- `.team/members/miniapp-dev/state.md` §2 §3 §7 收尾
- 本 history 新建

---

## §4 子 FU 状态终结流转

| 子 FU | 旧 | 新 | 依据 |
|---|---|---|---|
| FU-LAUNCH-A · 顶层副作用 | `closed` | `closed` | commit `a296be0` 物理消除（COSTRA-124）· 不变 |
| **FU-LAUNCH-B · 渲染层 storage group `_prepare`** | `open` | **`closed`** | 业务侧 COSTRA-125 全 async（`4643f89`）· 无论 SDK race 是否修都正确 · lib 3.8.12 同步把 SDK 修了（双闭环） |
| **FU-LAUNCH-C · `Expected updated data`** | `open` | **`degraded-to-p3-observe`** | lib 3.8.12 仍 1 次 · 仅 IDE 冷启动 · 与 LazyCodeLoading + dev 工具相关 · 真机延后验证 |
| **父 FU-LAUNCH-FIRST-RENDER-RACE** | `open` | **`closed`** | A/B 真 close + C 降 P3 · 业务侧治理完整 |

**新立 FU-LIBVERSION-DEV-GUARD**（P3 观察 · Sprint-2 候选）：CI 加 `check:libversion` 防 `development` lib 漂移。

---

## §5 闸门 + commit

### §5.1 六闸结果

由 Orchestrator 接力收尾时跑（待本 history 落盘后立即跑 · 见下方记录）：

- `npm run typecheck` → exit 0
- `npm run test` → 21/21 PASS（不动业务代码 · 不动单测 · 沿袭 COSTRA-125 R1 结果）
- `npm run lint` → exit 0
- `npm run check:appjson` → exit 0（不动 app.json）
- `npm run check:tooling` → exit 0（不动 project.config.json 工具链关键字段 · 仅 libVersion 一行）
- `npm run check:whitelist` → exit 0（不动域名）

### §5.2 commit 计划（按 dispatch §6 分 2 commit · footer 含 `Refs: COSTRA-126`）

- commit 1：`chore(miniapp): bump libversion 2.32.3 → 3.8.12 dev (COSTRA-126)`
  - `project.config.json` · `miniprogram/services/storage.ts` · `miniprogram/README.md`
- commit 2：`docs(repo): costra-126 libversion-upgrade v4 + anti-pattern #5 + costra-125 close (COSTRA-126)`
  - `docs/devops/libversion-upgrade.md` · `.team/follow-ups/README.md` · `.team/members/miniapp-dev/state.md` · `.team/dispatch/COSTRA-126-libversion-upgrade-3-8-12.md`（新）· 本 history 新建
  - footer：`Refs: COSTRA-125, COSTRA-126`

---

## §6 P0 / P1 / P2 / 遗留

- **P0**：0
- **P1**：0
- **P2**：0
- **遗留观察**：
  - FU-LAUNCH-C `degraded-to-p3-observe`：lib 3.8.12 dev 冷启动仍 1 次 · 真机延后验证（Sprint-2 提审前）
  - FU-LIBVERSION-DEV-GUARD `open`：CI 防护 development lib 漂移（Sprint-2 候选）
  - PRD/test-strategy/smoke-cases/wechat-review-checklist 的 NFR 最低基础库"2.32.3"**不动**（产品决策 · Epic-G 上架合规域 · 留 PM 评估）
  - `.codebuddy/agents/costra-miniapp-dev.md` 第 64 行的"基础库 2.32.3"**不动**（agent 装扮档案 · 与运行配置解耦 · 留待下一轮 agent 维护卡）

---

## §7 下一步

- ✅ COSTRA-126 R1 实装交付
- ✅ COSTRA-125 同卡簇顺带收官（业务侧治理充分必要 + lib 升级 SDK race 兜底）
- ⏳ 等 Orchestrator 视情况 spawn `costra-review-tech` 形式 R1（chore + 1 点 · review-tech R1 可选 · 即便走也属形式审）
- ⏳ Human 终审 COSTRA-125 + COSTRA-126（合并裁决）
- ⏳ Sprint-1 末 Retro（2026-05-06 已过期 2 天）：议题 + 4 条独立证据链方法论 + 跨 lib 对照范式 + D-017 Step 2 跨版本对照增补建议

---

## §8 Driver 溯源

- COSTRA-124 R2 诊断 history：`history/2026-05-03-costra-124-r2-diagnose.md`（v3 定性 · 本卡证伪）
- COSTRA-125 R1 实装 history：`history/2026-05-04-costra-125-r1-implement.md`（业务侧治理）
- Human 第 8 次模拟器跨 lib 实测：未单独 history（直接对话证据 · 见 dispatch §1.2 + FU README §f.5.A）
- 本卡 dispatch：`.team/dispatch/COSTRA-126-libversion-upgrade-3-8-12.md`
- SBAI 范式：D-018 v1.1 · 本卡走"chore + 跳 card-review + Orchestrator 接力收尾"路径（dispatch §0 已声明）
