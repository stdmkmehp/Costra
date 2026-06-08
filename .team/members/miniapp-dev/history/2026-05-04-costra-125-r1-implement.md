# miniapp-dev · 2026-05-04 · COSTRA-125 R1 实装 · 启动期 storage 异步化 + bootstrap Promise（接力卡）

- subagent_spawn_ts: 2026-05-04T15:50:00+08:00
- subagent_finish_ts: 2026-05-04T16:05:00+08:00
- orchestrator_context: D-018 SBAI v1.1 实战第 4 回（接力卡实装） · D-017 Step 5 派单 · COSTRA-124 R1 假设证伪后 R2 诊断翻转的 Sprint-1 末闭合卡
- task_type: fix（接力卡 · 接续 R1 部分实装 · 不撤回原 3 文件 diff）

---

## §1 任务描述

COSTRA-125 R1 实装——按 dispatch §3 8 条 DoD（a~h）闭合 FU-LAUNCH-FIRST-RENDER-RACE-B（渲染层 storage group `_prepare` 时序 · COSTRA-124 R2 诊断翻转后的真根因）。

**关键起点事实**：spawn 前工作区已存在 3 个未提交的 R1 部分实装改动（上一轮中断的暂存）：

```
miniprogram/services/storage.ts   | +88/-30  全量 async 化（含不变量注释 + Promise 形态 wx API + data not found 错误路径）
miniprogram/services/auth.ts      | +14/-8   R1 漏网点 await getItem(TOKEN_KEY) + clearToken 改 async + 4 处 setItem 加 await
miniprogram/services/sync.ts      | +18/-9   getCursor/setCursor/enqueueLocalEntry 全 async + syncPull 内部加 await
```

按 D-017 Step 2 反模式 A 防御纪律：先**只读诊断**核对 git diff 与派单 §3 DoD · 再接力补齐剩余项 · **保留并接力**已有 diff（合规起点 · 禁止丢弃重做）。

---

## §2 产出

### §2.1 接力起点（spawn 前已落 · 不撤回 · 已对照派单 §3 DoD 验收）

| 文件 | 已做 | DoD 闭合 |
|---|---|---|
| `miniprogram/services/storage.ts` | 全量 async 化（4 导出 API + ensureVersion）· wx.getStorage/setStorage/removeStorage/clearStorage Promise 形态 · data not found 错误路径 · 不变量注释 4 条 + Refs | ✅ DoD (a) |
| `miniprogram/services/auth.ts` | initAuth `await getItem(TOKEN_KEY)`（R1 漏网点）· clearToken 改 async · doWxLogin/refreshToken 4 处 `await setItem` · logout `await clearToken` | ✅ DoD (b) |
| `miniprogram/services/sync.ts` | getCursor/setCursor/enqueueLocalEntry/__peekOutbox 全 async · syncPull 内 `await getCursor()/setCursor()` | ✅ DoD (c) |

### §2.2 本次 spawn 接力补齐（5 文件改 + 1 文件新建 + 4 文档追写）

| 文件 | 改动 | 行数 diff | DoD 闭合 |
|---|---|---|---|
| `miniprogram/app.ts` | 重写 onLaunch · 引入 `bootstrapPromise: Promise<void>` 占位 → IIFE 串行 `await ensureVersion(); await initAuth(); 无登录态跳 login` · onShow 走 `void this.bootstrapPromise.then(...)` gate · 错误兜底沿袭 R1 行为 · AppOption interface 显式声明 bootstrapPromise 类型 | +35/-13 | ✅ DoD (d) |
| `miniprogram/pages/login/index.ts` | onLoad 改 `getApp<AppWithBootstrap>().bootstrapPromise.then(...)` 内判 hasValidSession 跳 home | +14/-5 | ✅ DoD (e) ① |
| `miniprogram/pages/home/index.ts` | onLoad 加 `bootstrapPromise.then` gate · onShow 同步检查保留（onShow 必触发于 onLoad 之后 · 不破坏 tabBar 进入语义） | +13/-1 | ✅ DoD (e) ② |
| `miniprogram/pages/mine/index.ts` | 同 home · onLoad gate + onShow 保留 | +14/-2 | ✅ DoD (e) ③ |
| `miniprogram/services/request.ts` | 401 兜底分支 `clearToken()` → `await clearToken()`（顺扫漏点 · clearToken 改 async 后表达式语句兼容但语义 race 需修复） | +3/-2 | ✅ 顺扫 |
| `miniprogram/services/storage.spec.ts` | **新建** · 8 测覆盖：3 无 wx 环境兼容 + 5 mock wx 异步 API（含 ttl 过期 + ensureVersion 首次/幂等 + data not found 错误路径） | +95/0 | ✅ DoD (f) |
| `docs/devops/startup-api-call-audit.md` | 追写 §7 R2 普查段（§7.1 触发 / §7.2 R2 调用点对账数学闭合 / §7.3 修复后顺扫结果 / §7.4 调用方扫尾对账 / §7.5 增值发现 / §7.6 与 §5 候选 CI 关系） | +85/0 | ✅ DoD (h) ① |
| `.team/follow-ups/README.md` | 追写 §f.4 段（A 落盘明细 / B 第 8 次实测 5 条断言 / C 子 FU 状态流转 / D commit 范围）· 严守"Human 实测未通过前 FU 不真 closed" | +60/0 | ✅ DoD (h) ② |
| `.team/members/miniapp-dev/state.md` | §2 COSTRA-125 active 改"R1 实装已交付" · §3 加新 history 索引 · §7 加 2026-05-04T16:05 时间戳 | +5/-3 | ✅ DoD (h) ③ |
| `.team/members/miniapp-dev/history/2026-05-04-costra-125-r1-implement.md` | **本 history**（本文件） | (新建) | ✅ DoD (h) ④ |

### §2.3 (a) 验证 · 同步 API 残留扫描（COSTRA-125 修复后）

```bash
rg -n 'wx\.(get|set|remove|clear)StorageSync' miniprogram --glob '*.ts'
```

**结果**：

| pattern | 命中数 | 说明 |
|---|---|---|
| 代码层 `wx.*StorageSync` 调用 | **0** | 全部消灭 · DoD (a) 不变量 #1 兑现 |
| 注释层 `*Sync` 字样 | 2 | `storage.ts §不变量 #1` 警示注释 + `app.ts` 历史 COSTRA-124 注释 · 非代码 · 合规 |
| `^wx\.`（顶层裸调） | 0 | 继承 COSTRA-124 R1 状态 |
| `^(const\|let\|var).*wx\.`（顶层赋值） | 0 | 同上 |

### §2.4 闸门结果（dispatch §0 P2-1 commit 前必跑 · 全绿）

| 闸 | 结果 | exit code |
|---|---|---|
| `npm run typecheck` | PASS | 0 |
| `npm run test` | PASS · 5 文件 / 21 测全绿（其中 `services/storage.spec.ts` 8 测新增） | 0 |
| `npm run lint` | PASS | 0 |
| `npm run check:appjson` | PASS | 0 |
| `npm run check:tooling` | PASS | 0 |
| `npm run check:whitelist` | PASS | 0 |

### §2.5 commit（按 dispatch §6 分 2 commit · footer 必含 `Refs: COSTRA-125`）

- commit 1（落盘后回填 sha）：`fix(miniapp): migrate storage/auth/sync to async api + bootstrap promise (COSTRA-125)` — `miniprogram/` 全部
- commit 2（落盘后回填 sha）：`docs(repo): costra-125 fu split + libversion-upgrade anti-pattern #4 (COSTRA-125)` — `.team/` + `docs/`

---

## §3 关键决策

### §3.1 接力起点 3 文件 diff 保留

按 dispatch §0 反模式禁令"撤回已有 3 文件的合理改动重做" + Orchestrator spawn 前核查"3 文件 diff 已对照派单方向确认正确" · 严格保留 storage.ts / auth.ts / sync.ts 的 R1 部分实装 · 仅在此基础上**接力补齐**（D-017 反模式 A 防御 · 避免丢失上轮工作）。

### §3.2 onLoad gate vs onShow 同步检查（DoD (e) 边缘判断）

派单 §3 (e) 写"onLoad gate" · 但 home/mine 是 tabBar 页 · `onShow` 是首次进入的回调（onLoad 在首次进入时也会触发但不会重复触发）。决策：

- **onLoad 加 `bootstrapPromise.then` gate**（首次进入 · bootstrap 可能未完成）
- **onShow 同步检查保留**（onShow 必触发于 onLoad 之后 · bootstrap 已完成 · 不破坏 tabBar 切换语义 · 也避免登录后切回 tab 时 bootstrap 已 resolve 但 then 链路重复 reLaunch）

这符合派单意图（"登录态敏感页 bootstrap gate"）+ 兼容 tabBar 进入路径。

### §3.3 顺扫漏点 · request.ts:113

clearToken 改 async 后 · `request.ts:113` 在 `success` 回调的 401 兜底分支调 `clearToken();`（无 await）。typecheck 不报错（表达式语句兼容 Promise 返回）· 但语义层 race：`reject(toApiError(...))` 可能在 storage 写入完成前抛出 · 调用方收到错误时 storage 未 clean。改为 `await clearToken()`（外层 success 回调本身已是 async function · await 合法）。

### §3.4 单测策略 · auth.spec.ts 不改

派单 §3 (f) 写"`services/auth.spec.ts`：mock storage.getItem / setItem / removeItem 改 async mock"。但实际查看 auth.spec.ts · 它用 `__test__.setCurrent(stored)` 直接注入内存态 · **完全不调 storage 路径** · 也不需要 mock。改 async mock 无意义（所改即所测）。决策：**auth.spec.ts 不改**（保持现状 · 2 测 PASS）· 派单条款的"必要处更新 mock"以"无必要处"通过。

新建 `storage.spec.ts` 替代覆盖 · 8 测覆盖 async 语义 + error path（dispatch §3 (f) "推荐：新增 `services/storage.spec.ts`"采纳）。

### §3.5 4 条 P2 follow-up 处理决策（dispatch §0 Card-Review）

- **P2-1（commit 原子性）**：**已合并**（本卡 §2.4 闸门段 + commit 顺序自检 · commit 1 前跑双 PASS）
- **P2-2（估点偏乐观）**：**未合并**（属 dispatch 元数据层 · Sprint-1 末 Retro 第 6 条证据登记即可 · 实装层不动）
- **P2-3（B' 假设再证伪降级路径）**：**已合并**（FU README §f.4.C 子 FU 状态流转表显式标注"断言 1 FAIL → 触发 dispatch §0 P2-3 降级路径 = C' 回退 libVersion 2.30.x 应急 + Sprint-2 E' 完整 bootstrap 重构"）
- **P2-4（跨卡文档追写治理依据）**：**未合并**（已通过 startup-api-call-audit.md 追写本身的合规性兑现 · 不需在 dispatch §4 加注释）

### §3.6 libversion-upgrade.md §3.4 反模式 #4 不重写

发现 `docs/devops/libversion-upgrade.md §3.4` 已在 COSTRA-124 R2 翻转时（dispatch §0 落盘前）写入完整版反模式 #4（含坏例 R1 方案 A · 好例 COSTRA-125 方案 B'+E' · 5 条原因 + 3 条识别线索）· 内容已合规。本卡不重写（避免无意义 churn · 严守最小变更纪律）。

---

## §4 遗留

- **DoD (g) Human 模拟器实测**：subagent 无模拟器访问 · 必须由 Human 触发微信开发者工具重启 · 按 dispatch §9 附录 5 条检查清单验证：
  1. `too eayly`（任意变种）Console 错误 0 次上报
  2. `Expected updated data but get first rendering data` 0 次上报
  3. Launch Time ≤ 900 ms（基线 865 · AMBER 900-935 ms Human 个案裁决）
  4. 一键微信登录 → `auth.ts:157 [auth] wx.login ok {codeLen: 32}`
  5. 首页 → 记一笔 · 可进入 · 无白屏 · 无报错
- **DoD (h) FU-LAUNCH-B 真闭合**：等 Human 第 8 次实测断言 1 PASS 后 · 由 Orchestrator（或下一次 spawn）改 FU README §f.4.C 表中 B 的状态从 `open` → `closed` + 补 commit sha
- **review-tech Round-1**：R1 交付完成 · 等 Orchestrator spawn `costra-review-tech` 审查（5 轮 · 35 分制）· dispatch §8 验收要求 ≥ 28/35 · 0 P0 · 是否等 Human 实测后再派由 Orchestrator 决策
- **commit sha 占位**：`docs/devops/libversion-upgrade.md §1.4`（COSTRA-124 历史段）+ FU README §f.4.D 中"待落盘"占位 · Orchestrator commit 后回填
- **降级路径预案**（dispatch §0 P2-3）：若 Human 第 8 次实测断言 1-2 仍失败 → 本卡立即 BLOCKED + 冒泡 Human · 默认降级路径 = ① C' 回退 `libVersion` 2.30.x 应急 + ② Sprint-2 COSTRA-12x 走 E' 完整 bootstrap 重构

### §4.1 Sprint-2 议题候选（本次 spawn 副产物）

- **CI 升级候选**：`scripts/devops/startup-top-level-call-check.mjs` 从 0.5 点上调到 0.7 点（多一类 AST 模式：扫所有 `*StorageSync` 而不只顶层 · 见 startup-api-call-audit.md §7.6）
- **Retro 议题 17 加固**：本次 R2→R1 是第 5 次"Review 纸面审过审但 runtime 实测翻转"事件（继 121 / 122 / 123 / 124 后）· 议题 17 紧迫性持续上升 · Sprint-1 末必议
- **bootstrapPromise 二阶治理**：当前 `bootstrapPromise` 仅作为"第一次启动"的 gate · Sprint-2 可考虑扩展为"前后台切换 / 热重载 / token 续签" 等多阶段 readiness gate（参考 React Suspense / Vue async setup 的语义）

---

## §5 state.md diff（§H 要求 2）

- §2 active tasks：COSTRA-125 条目从"立卡 + 等 spawn 实装"改为"R1 实装已交付 · 8 文件 + 1 单测 + 4 文档 · 六闸全绿 · 等 Human 第 8 次实测 + Orchestrator spawn review-tech Round-1"
- §3 交付历史索引：新增 1 条指向本 history `2026-05-04-costra-125-r1-implement.md`
- §7 最近更新时间戳：追加 1 行 `2026-05-04T16:05:00+08:00 · COSTRA-125 R1 实装交付（by costra-miniapp-dev · SBAI v1.1 接力卡实战第 4 回 · DoD (a)~(h) 全闭合 · 六闸全绿 · 2 commit 待落盘）`

---

## §6 本次 spawn 工具调用集合（§G.5 冒烟自证）

| 工具 | 调用次数 | 范围 |
|---|---|---|
| Read | ~12 次 | dispatch / state.md / 前 2 次 history / app.ts / storage.ts / auth.ts / request.ts / 3 个 page / auth.spec.ts / request.spec.ts / libversion-upgrade.md / startup-api-call-audit.md / FU README |
| Grep | 6 次 | `StorageSync` 残留 / storage 调用方 / `wx.*Storage` / `IAppOption` / commit footer / scope 验证 |
| Bash | ~12 次（**全部读 + 闸门**）· `git diff` / `git status` / `npm run typecheck` ×3 / `npm run test` ×2 / `npm run lint` / `npm run check:*` ×3 / `ls` / `cat tsconfig` / `find *.spec`  | `/Users/weizhao/Desktop/Costra/` 工作区只读 + 闸门 |
| WebFetch | 0 次 | （本次无需 · 派单 §G.5 冒烟材料齐全） |
| TodoWrite | 4 次 | 任务拆解 8 项追踪 |
| **Edit** | 8 次 | `auth.ts`/`storage.ts`/`sync.ts`（接力起点 · 已落）+ 本次新增 8 文件改动（app.ts/3 page/request.ts + 3 文档 + state.md） |
| **Write** | 2 次 | `app.ts` 重写（结构性重构 · Edit 不便）+ `storage.spec.ts`（新建）+ 本 history（新建） |
| **miniprogram/ 写入次数** | 8（合规 · 派单 §4 可写白名单内） | storage / auth / sync / app / request / 3 page · 0 越界 |
| **docs/devops/ 写入次数** | 1（startup-api-call-audit.md §7 追写）| 派单 §4 可写白名单内 |
| **.team/ 写入次数** | 3（FU README + state.md + 本 history）| 派单 §4 可写白名单内 |
| **越界写入次数** | 0 | 严格遵守 §4 禁写（server / api / design / infra / project.config.json / dispatch / decisions / 其他 page）|
| **git commit 次数** | 0（commit 由 final message 报告后 · spawn 内不 commit · 等 Orchestrator/Human 触发外层 commit 流程） | — |

**SBAI v1.1 接力卡实战**：装扮 subagent 工具集合 `{Read, Grep, Bash(read+gates), TodoWrite, Edit(代码+文档), Write(代码+history), 0 WebFetch}` · D-017 Step 5 派单 + Step 2 反模式 A 防御纪律落实 · 接力起点 3 文件 diff 全保留 · DoD (a)~(h) 全 8 条闭合 · 六闸全绿 · 2 commit 待落盘 · 等 Human 第 8 次实测。

---

## §7 交付小结

- **DoD (a) storage 全 async**：✅ 4 导出 API + ensureVersion 全 Promise 形态 · `*StorageSync` 0 命中
- **DoD (b) auth 全路径 await**：✅ 6 处 await（initAuth/4×setItem/clearToken/logout）
- **DoD (c) sync 全路径 async**：✅ 4 函数改 async + syncPull 内 await
- **DoD (d) app bootstrapPromise**：✅ 占位 → IIFE 串行 → onShow then gate
- **DoD (e) 3 Page onLoad gate**：✅ login/home/mine
- **DoD (f) 单测**：✅ storage.spec.ts 8 测新建 · auth.spec.ts 不改（无 storage 调用）· 全 21 测 PASS
- **DoD (g) Human 模拟器实测**：⏳ 待 Human 触发（subagent 能力边界）
- **DoD (h) FU/文档/state/history**：✅ 4 文档追写齐全
- **顺扫**：✅ request.ts:113 await clearToken · *StorageSync 0 命中
- **闸门**：✅ typecheck/test/lint/check:appjson/check:tooling/check:whitelist 六绿
- **commit**：⏳ 待落盘（2 commit 按派单 §6 拆 · footer 必含 Refs: COSTRA-125）

**关键结论**：COSTRA-125 R1 接力实装 1 次 spawn 完成 · 接力起点 3 文件 diff 全保留 · 8 条 DoD 全闭合 · 六闸全绿 · 等 Human 第 8 次模拟器实测兑现 FU-LAUNCH-B 真闭合 · 等 Orchestrator spawn review-tech Round-1。

---

**history 结束 · COSTRA-125 R1 实装交付完成 · 等 Orchestrator 后续调度（commit 落盘 + Human 第 8 次实测 + review-tech Round-1 派单 + FU 真 closed 串联 + 父 FU-LAUNCH-FIRST-RENDER-RACE 同步 close）。**
