# miniapp-dev · 2026-05-02 · COSTRA-124 R1 实装 · 启动期 storage 时序修复 + FU-LAUNCH 预闭合

- subagent_spawn_ts: 2026-05-02T21:10:00+08:00
- subagent_finish_ts: 2026-05-02T21:30:00+08:00
- orchestrator_context: D-017 Step 5 派单实装 · SBAI v1.1 P2' 实战第 2 回 · card-review Round-1 PASS-WITH-FOLLOWUP 26/30（2 P1 就地采纳 · 3 P2 自主决定是否合并）
- task_type: fix

## §1 任务描述

COSTRA-124 R1 实装——按修订后 dispatch §3 7 条 DoD（a~g）闭合 FU-LAUNCH-FIRST-RENDER-RACE。

核心上下文：

- 前 3 次观察（2026-04-29 / 2026-05-01 / 2026-05-02 19:32）定性为"100% SDK 内部 Bug · 非业务"
- 第 4 次观察（2026-05-02 20:15-20:25）由 Human 新线索 + 装扮 subagent D-017 Step 2 独立核查翻转为"业务触发 · storage.ts:29 顶层 ensureVersion() 在 App() 注册前调 wx.getStorageSync · 命中基础库 2.32.3+ 的 storage group prepare 时序约束"
- Human 2026-05-02 20:31 Q1-Q6 拍板全"按推荐"（方案 A · Sprint-1 末小卡 · 顺扫 · 并入 FU 另一半 · 新建 libversion-upgrade.md）
- card-review Round-1（2026-05-02 21:05）PASS-WITH-FOLLOWUP 26/30 · P1-1 补"判定标准 3 选 1" · P1-2 把"200-400 行"改为 4 节内容硬性条目 · P2-3 把 DoD (f) 扩为 f.1 + f.2

本次 R1 实装严格按修订后 DoD 7 条执行 · 代码走方案 A · 顺扫路径 ① 声明 · 文档走内容度量 · FU 预闭合不真 close。

## §2 产出

### §2.1 修改文件（2 份）

| 文件 | 改动 | 行数 diff |
|---|---|---|
| `miniprogram/services/storage.ts` | 删除 line 29 顶层 `ensureVersion()` 裸调 · 函数改 `export` · 新增 JSDoc 警示 · 文件头补 COSTRA-124 Refs 注释 | +18 / -1（净 +17） |
| `miniprogram/app.ts` | `onLaunch()` 首行加 `ensureVersion()` 调用 + 对应 import · 文件头补 COSTRA-124 Refs 注释 | +7 / 0 |

双文件 `npm run typecheck` + `npm run lint` PASS（exitCode 0）。

### §2.2 新建文件（3 份）

| 文件 | 用途 | 行数 |
|---|---|---|
| `docs/devops/startup-api-call-audit.md` | DoD (b) · 启动期 API 调用审计报告 · 扫描命令 + 结果 + 历史对照 + Sprint-2 CI 升级候选 | ~120 |
| `docs/devops/libversion-upgrade.md` | DoD (d) · 基础库升级影响评估方法论 v1.0 · §1 本次案例 / §2 四步清单 / §3 三反模式 / §4 族关系表 | ~320 |
| `.team/members/miniapp-dev/history/2026-05-02-costra-124-r1-implement.md` | 本 history · §3.3 收尾必做 | ~120 |

### §2.3 追加文件（2 份）

| 文件 | 改动 |
|---|---|
| `.team/follow-ups/README.md` | FU-LAUNCH-FIRST-RENDER-RACE 段追加 f.1（第 4 次翻转事件 + 第 5 次修复验证待触发）+ f.2（定性翻转追写段 + 下游 Retro 议题 15/16）· 修改同族观察次数行 · FU 状态仍 `open`（待 Human 实测） | +75 / -1 |
| `.team/members/miniapp-dev/state.md` | §2 active tasks 加 COSTRA-124 · §3 交付历史索引加 1 条 · §7 时间戳加 1 行 | +4 / 0 |

### §2.4 commit

- **本轮不 commit**（Bash 权限需 Human 批 · commit 策略由 Orchestrator 决定）
- 预留 commit sha 占位：`docs/devops/libversion-upgrade.md §1.4` 的 "`<待 commit 后回填>`"（Orchestrator commit 后补或下次 spawn 补）
- 建议 commit 策略（dispatch §5）：2 commit
  - `fix(miniapp): move ensureVersion from storage top-level to app onLaunch (COSTRA-124)` — 仅 `miniprogram/`
  - `docs(repo): startup api call audit + libversion upgrade methodology (COSTRA-124)` — 仅 `docs/devops/` + `.team/follow-ups/README.md` + `.team/members/miniapp-dev/`

## §3 关键决策

### §3.1 走路径 ①（DoD (c) 首选）

R1 实装**不做** 4 候选源细查（登录页 setData / 分包懒加载 / globalData / 热重载）。理由：

- 方案 A (a) 修复消除了"App() 注册前触发 wx.* 的唯一已知触发路径"
- "Expected updated data but get first rendering data" 另一半现象**理论上也应同步消失**（同属启动期 · 同为 storage.ts 顶层副作用引发的 data pipeline 错位可能）
- dispatch §3 DoD (c) P1-1 修订版明确：路径 ① = Human 第 7 次实测不复现 → 自然消失 → 4 候选源不必细查
- 若 Human 实测仍复现（走路径 ②）· 由 Orchestrator 另起 D-017 Step 2-4 派单 · 不在本卡内硬修

### §3.2 顺扫 0 命中 · 无同族违规

`miniprogram/**/*.ts` 顺扫结果：

| grep pattern | 命中数 |
|---|---|
| `^wx\.`（顶层裸调） | 0 |
| `^(const\|let\|var).*wx\.`（顶层赋值触发 wx） | 0 |
| `^setTimeout\|^setInterval`（顶层定时器反模式 · 增值项） | 0 |

`storage.ts:29` 是**唯一**顶层副作用源 · 修复后 `miniprogram/` 完全零模块顶层副作用。

### §3.3 §3 第 3 条反模式自识别（dispatch §3 (d) §3 要求）

自识别方向：**"分包懒加载模块的顶层副作用"**（`docs/devops/libversion-upgrade.md §3.3`）。依据：

- `project.config.json` 开启 `LazyCodeLoading: true`（COSTRA-123 前默认）· 分包脚本首次加载时机由用户页面跳转触发 · 不走 App 生命周期
- 若分包模块顶层有 `wx.*` 副作用 · 会再现 `too eayly` 的**子分包变种**
- 从 COSTRA-124 追查过程中识别出：当前 Sprint-2 候选脚本 `startup-top-level-call-check.mjs` 必须显式覆盖 `miniprogram/pages-*/` 分包目录 · 不能只扫主包

### §3.4 FU 预闭合不真 closed

严格遵守"Human 实测未通过前 FU 不真 closed"硬约束：

- FU-LAUNCH-FIRST-RENDER-RACE 顶部 status 仍 `open`
- f.1.A 已记第 4 次翻转事件（已发生 · 有证据）
- f.1.B 记第 5 次实测计划（待触发 · 5 条断言清单占位）· `pending` 标识
- f.2 记定性翻转范式沉淀（治理价值）
- 真正 closed 的动作留给 Orchestrator 收到 Human 实测 OK 后执行

### §3.5 3 P2 follow-up 处理决策

P2-1（估点实事求是）+ P2-2（实测断言 AND 语义）：**不合并**——这两条属 dispatch 元数据层面 · 已在 dispatch §0 和 §8/§9 落位 · R1 实装层不需再动

P2-3（DoD (f) 扩 f.1 + f.2）：**合并** · 按 FU 追写范式落地（本 R1 已完成 · 见 §2.3 `.team/follow-ups/README.md` 改动）

## §4 遗留

- **DoD (e) Human 模拟器实测**：subagent 无模拟器访问 · 必须由 Human 触发微信开发者工具重启 · 按 dispatch §9 附录 5 条检查清单验证
- **DoD (f) FU 真闭合**：等 Human 实测通过后 · 由 Orchestrator（或下一次 spawn）改 FU status 从 `open` → `closed` + 补闭合依据 commit sha
- **DoD (g) review-tech Round-1**：R1 交付完成 · 等 Orchestrator spawn `costra-review-tech` 审查（5 轮 · 35 分制）· 是否等 Human 实测通过后再派由 Orchestrator 决策
- **commit sha 占位**：`docs/devops/libversion-upgrade.md §1.4` 的 `<待 commit 后回填>` · Orchestrator commit 后需回填
- **Sprint-2 议题候选**：
  - `scripts/devops/startup-top-level-call-check.mjs`（`docs/devops/startup-api-call-audit.md §5`）· CI 硬拦截脚本 · 0.5 点
  - Retro 议题 15 "独立复核可翻转历史定性"范式明文化
  - Retro 议题 16 "SBAI v1.1 两档 tools 白名单差异化"沉淀为 D-018 §3.5 附录
- **Card-review Round-1 3 P2 中 P2-1 + P2-2**：本 R1 未合并 · Sprint-1 末 Retro 时可作为"紧急卡估点偏乐观"议题第 5 条证据

## §5 state.md diff

- §2 active tasks：增加 COSTRA-124 条目（"R1 已交付 · 等 Human 实测 + review-tech Round-1"）
- §3 交付历史索引：新增 1 条指向本 history `2026-05-02-costra-124-r1-implement.md`
- §7 最近更新时间戳：追加 1 行 `2026-05-02T21:30:00+08:00 · COSTRA-124 R1 实装交付（by costra-miniapp-dev · SBAI v1.1 P2' 实战第 2 回）`

---

**history 结束 · COSTRA-124 R1 实装全程 1 次 spawn 完成 · 等 Orchestrator 后续调度（commit + review-tech Round-1 派单 + Human 实测 + FU 真 closed 的串联）。**
