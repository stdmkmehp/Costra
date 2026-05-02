# COSTRA-124 · 启动期 storage 时序修复 + FU-LAUNCH 闭合

- Sprint: Sprint-1（2026-04-23 ~ 2026-05-06 · 收官期）
- Epic: Epic-C 本地存储 + 云同步（补）
- Owner: miniapp-dev
- Type: fix
- Priority: P1
- Points: 1
- 依赖: COSTRA-123（已 CLOSED · Launch Time 865 ms 基线）
- 创建: 2026-05-02 20:58（by Orchestrator · SBAI v1.1 派单）
- Driver:
  - FU-LAUNCH-FIRST-RENDER-RACE（3 次观察 · `.team/follow-ups/README.md` §519-559）
  - D-017 Step 2 根因报告（costra-miniapp-dev @ 2026-05-02 20:25 · SBAI v1.1 P2' 冒烟产物）
  - `.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`（L1-L4 四层根因 + 方案 A/B/C + Q1-Q6 Human 已拍板）

---

## §1 背景（一句话 + 证据链）

微信基础库 2.32.3 启动期存在"storage 调用时机"约束 · 我方 `miniprogram/services/storage.ts:29` 顶层 `ensureVersion()` 副作用在 `App()` 注册**之前**就调 `wx.getStorageSync(VERSION_KEY)` · 触发 SDK 内部 `createOrGetStorageGroup._prepare` 未就绪告警 `getGlobalStorage fail: too eayly`（前 3 次观察错误定性为"SDK 内部 bug · 非业务"已被 subagent 独立核查推翻）。

---

## §2 Human 已拍板（2026-05-02 20:31）

- Q1 ✅ 认可新定性（业务触发 · 非 SDK bug · storage.ts:29 因果链坐实）
- Q2 ✅ Sprint-1 末小卡（本卡 = COSTRA-124）
- Q3 ✅ 方案 A（`ensureVersion()` 迁入 `onLaunch` · 15 分钟 · 零风险）
- Q4 ✅ 顺扫 `miniprogram/` 所有模块顶层 `wx.*` 调用（防同类再犯）
- Q5 ✅ FU-LAUNCH 另一半（"Expected updated data but get first rendering data"）并入修复
- Q6 ✅ 新建 `docs/devops/libversion-upgrade.md`（版本升级影响评估方法论）

---

## §3 DoD（7 条 · 可度量）

### (a) storage.ts 时序修复

- 移除 `miniprogram/services/storage.ts:29` 顶层 `ensureVersion()` 裸调用
- 在 `miniprogram/app.ts` `onLaunch()` **首行**增加 `ensureVersion()` 调用（延后到 App 注册后）
- 保持 `ensureVersion()` 函数体 + 导出不变（只迁调用点）
- 验证：TypeScript typecheck PASS（`npm run typecheck`）+ ESLint PASS（`npm run lint`）

### (b) 顺扫清扫报告

- 执行 `grep -rn "^wx\\." miniprogram/**/*.ts`（扫模块顶层 · 即行首缩进 0）
- 同时扫 `grep -rnE "^(const|let|var).*wx\\." miniprogram/**/*.ts`（顶层赋值触发 wx 调用）
- 验证：0 处模块顶层副作用（允许在函数体 / 生命周期内调 · 不允许 top-level 裸调）
- 若发现其他违规点 → 同卡内修正 · 不另起卡
- 落盘：`docs/devops/startup-api-call-audit.md`（Sprint-1 末的"启动期 API 调用审计"报告）

### (c) FU-LAUNCH 另一半排查

- 验证修复 (a) 后"Expected updated data but get first rendering data"是否自然消失
- 若仍复现 → 从 4 候选源逐一排查：
  1. 登录页 `onLoad` 前同步 `setData`
  2. 分包懒加载竞态
  3. `globalData` 初始化时机
  4. 热重载竞态
- 排查过程落 history · 修复在本卡内完成

### (d) 版本升级方法论文档

- 新建 `docs/devops/libversion-upgrade.md`（200-400 行）
- 必含 4 节：
  1. 本次案例（`storage.ts:29` + 2.32.3 新增 storage group prepare 异步路径 + 方案 A/B/C 对比）
  2. 基础库版本升级前的"影响评估 4 步清单"（扫顶层副作用 / 对比 changelog / 列风险点 / 模拟器冒烟）
  3. 典型"时序陷阱"类反模式清单（模块顶层 `wx.*` / `ensureVersion` 族 / 等）
  4. 与 FU-LAUNCH 族 FU 的关系说明（闭环证据）

### (e) 模拟器第 7 次启动实测（Human 配合 · E1 路径）

subagent 无模拟器访问 · 由 Human 触发微信开发者工具重启小程序。

验证 4 条：
1. `[渲染层错误] getGlobalStorage fail: too eayly` **消失**（0 次上报）
2. `Expected updated data but get first rendering data` **消失**（0 次上报）
3. Launch Time **≤ 900 ms**（对比 COSTRA-123 基线 865 ms · 允许 ±35 ms）
4. `wx.login` 仍成功（`auth.ts:157 [auth] wx.login ok`）

截图存证：`.team/members/miniapp-dev/history/2026-05-02-costra-124-smoke-7.png` 或 `docs/devops/startup-api-call-audit.md` 附录（由 Human 生成 · subagent 只准备坑位）

### (f) FU-LAUNCH 闭合

- 在 `.team/follow-ups/README.md` FU-LAUNCH-FIRST-RENDER-RACE 段补"第 4 次观察（修复确认无复现）"
- 状态从 `open` 改为 `closed`
- 补时间戳 + 闭合依据（本卡 commit sha）
- 同族观察次数行追加"第 4 次 2026-05-02 · COSTRA-124 修复验证闭合"

### (g) Review 流程

- R1 交付后 · Orchestrator spawn `costra-review-tech` Round-1 审查
- PASS → Human 终审（T2 Gate） → CLOSED
- REVISE → 走 D-015 revise · Round-2 修复 + response.md

---

## §4 工作区 + 权限

可写：
- `miniprogram/services/storage.ts`（修改 · 移除顶层调用）
- `miniprogram/app.ts`（修改 · `onLaunch` 首行加 `ensureVersion()`）
- `miniprogram/` 其他顺扫发现的违规文件（修改 · 若有）
- `docs/devops/libversion-upgrade.md`（**新建**）
- `docs/devops/startup-api-call-audit.md`（**新建**）
- `.team/follow-ups/README.md`（闭合 FU 段 · DoD f）
- `.team/members/miniapp-dev/state.md`（§2/§3/§7 · 收尾必做）
- `.team/members/miniapp-dev/history/2026-05-02-costra-124-*.md`（新建 · 收尾必做）

禁写：
- `server/` / `api/` / `design/` / `infra/` / 其他 `.team/members/{other-role}/`
- `.team/decisions/*.md`（规约不在本卡范围）
- `miniprogram/` 与 storage 顺扫无关的文件（范围边界）

---

## §5 commit 纪律

- scope 白名单：`miniapp` / `docs` · 本卡按 D-012 单卡即提交 · 允许分 2 commit：
  - commit 1: `fix(miniapp): move ensureVersion from storage top-level to app onLaunch (COSTRA-124)`
  - commit 2: `docs(repo): startup api call audit + libversion upgrade methodology (COSTRA-124)`
- Footer 必含: `Refs: COSTRA-124`
- 禁止 `--no-verify` 绕 hooks（I-011 已明令）
- 禁止 `git push --force`
- hooks 必须 PASS（lint + typecheck + commitlint · 允许 husky v10 deprecated warning 非阻塞）

---

## §6 E1 路径 · Human 实测由 Human 完成

subagent 无模拟器访问 · DoD (e) 模拟器实测必须由 Human 触发。

subagent 在 final message 明确列：
- "(a)(b)(c)(d)(f)(g) 已完成 · 代码 + 文档 + FU 闭合段已落盘"
- "(e) 待 Human 模拟器实测 · 提供实测清单 4 条 + 截图位"
- "(g) R1 交付完成 · 等 Orchestrator spawn review-tech Round-1"

---

## §7 验收

- **R1 审查 PASS**（`costra-review-tech` Verdict ≥ 28/35 · 0 P0 · 或 PASS-WITH-FOLLOWUP）
- **Human 模拟器实测 4 条 PASS**（DoD (e)）
- **FU-LAUNCH 闭合**（DoD (f)）
- 三条齐全 → COSTRA-124 CLOSED · Sprint-1 基建线 **8 卡全数收官**（100 + 101 + 119 + 120 + 121 + 122 + 123 + 124）

---

## §8 时间预算

- (a)(b)(c) 代码修复 + 顺扫：15~25 min
- (d) libversion-upgrade.md + startup-api-call-audit.md 两份文档：30 min
- (f) FU 闭合 + state.md + history：5 min
- R1 Review + Response：15~30 min
- Human 实测 + 终审：10~15 min
- **合计**：~1.5 h（AI 侧 45-60 min · Human 侧 15 min）

---

## §9 附录 · Human 实测检查清单（subagent 在 final message 复述此表）

| # | 验证项 | 通过标准 | 实测结果 |
|---|---|---|---|
| 1 | getGlobalStorage fail: too eayly | 0 次上报 | ☐ |
| 2 | Expected updated data but get first rendering data | 0 次上报 | ☐ |
| 3 | Launch Time | ≤ 900 ms（基线 865）| ☐ ms |
| 4 | wx.login 成功 | `auth.ts:157 [auth] wx.login ok` | ☐ |
| 5 | 后续业务链路 | 首页 → 记一笔可进入 | ☐ |

---

## §10 Driver 溯源（SBAI v1.1 P2' 冒烟产物全集）

- 装扮 subagent：`costra-miniapp-dev`（SBAI v1.1 · `.codebuddy/agents/costra-miniapp-dev.md`）
- spawn 时间：2026-05-02 20:20（经 Q12 踩坑后重跑）
- 工具调用数：18 次（11 Read / 3 WebFetch / 3 Edit / 1 Write）
- 自主落盘：
  - `.team/members/miniapp-dev/state.md`（3 次 Edit · §2/§6/§7）
  - `.team/members/miniapp-dev/history/2026-05-02-getglobalstorage-v2-diagnose.md`（5933 bytes · 5 段模板）
- Human 拍板：2026-05-02 20:31（Q1-Q6 全"按推荐"）
- 卡立：2026-05-02 20:58（本卡）
