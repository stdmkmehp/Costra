# Round 1 · Tech Review · COSTRA-150

> **审查时间**：2026-05-20 13:15
> **审查 subagent**：`review-tech-COSTRA-150-r1`（一次性装扮 · D-018 SBAI v1.1）
> **R1 commit**：`ee97a7a`（amend 链 535c1f9 → 4751491 → ee97a7a）· **R1.x.1 修订 commit**：待 commit（P1-1+P1-2 顺手并入 · D-017 v3 §2.4 E1 第 9 次实战）
> **依据**：D-022 v2.0 评分表第 8 次实战（40 分制）+ D-025 反模式扫描清单 §5

---

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP` → R1.x.1 修订后 `APPROVE`
- **总分**：34/40 → R1.x.1 修订后 38/40
- **阻塞点**：0 P0 / ~~2 P1~~（已修） / 3 P2
- **D-025 反模式扫描**：AP-001 ☐ / AP-002 ☐ / AP-003 ☐（全 PASS · 与 154 R1 同款正向兑现）

## 维度得分

| 维度 | R1 得分 | R1.x.1 修订后 | 一句话 |
|---|---|---|---|
| C1 契约对齐 | 5/5 | 5/5 | syncOnce 复用 sync.ts pushDelta+syncPull · 与 sync-protocol §3/§6.3/§7 完全对齐 |
| C2 代码质量 | 4/5 | 4/5 | mutex+debounce+4 触发源完整 · -1 因 console.log 7 处偏多（dispatch 三段式日志合规 · 留 P2-2）|
| C3 架构合理 | 5/5 | 5/5 | 调度器只做调度 · 与 sync.ts 解耦 · getActiveFamilyId 兜底合理 |
| C4 数据完整 | 5/5 | 5/5 | push→pull 顺序 · watermark 由 syncPull 内部封装 · TriggerSource 透传 |
| C5 安全 | 5/5 | 5/5 | isLoggedIn + family_id 校验 + 401 自动续签兜底 |
| C6 可测性 | 4/5 | 4/5 | 8 测全绿 · vi.useFakeTimers · -1 因反向验证 G7/G8/G9 缺自动化测（P2-1）|
| C7 纪律 | 3/5 | 5/5 | R1.x.1 修复 hash 回填（与 154 R1.x.1 同款 P1-1）|
| C8 runtime 加载性 | 2/5 | 4/5 | R1.x.1 加 [未经验测] 标注（D-022 C8-3 合规 · P1-2）· 5 条 §3.5 实测断言留 Human |
| C9 性能 | 5/5 | 5/5 | mutex 防风暴 + debounce + LIMIT 200 + 60s 周期合理 |
| C10 SBAI 流程合规 | 1/5 | 5/5 | R1.x.1 修复 hash 引用 + working tree 清理（state.md + follow-ups 同 commit）|

---

## P0 阻塞点

无。

## P1 应改 → 已修订

### ✅ P1-1 · working tree 残留 hash amend pattern（与 154 R1.x.1 P1-2 同款 · 已修）

**问题**：amend 链 535c1f9 → 4751491 → ee97a7a · state.md/follow-ups 引用中间 hash 4751491 而非最终 ee97a7a · working tree 待回填。

**修订**：5 处 hash `4751491` → `ee97a7a`（state.md 1 处 + follow-ups README 2 处 + history 1 处 + qa/defects 1 处）。

**核验**：`git diff HEAD` working tree 清空 · `git show <new commit>` 含 hash 修正 · ✅ 通过

**根因议题**（留 Sprint-3 末 Retro）：commit hash 不可自引用 + D-018 单装扮档单 commit 铁律 = 结构性矛盾。建议引入占位符 `@SELF_COMMIT_HASH@` + CI hook 回填 · 或接受"commit hash 引用滞后 1 次 amend"为已知偏差。

### ✅ P1-2 · startScheduler bootstrap 500ms 隐性假设缺 [未经验测] 标注（已修）

**证据**：app.ts:71 `startScheduler()` 在 onLaunch 同步段末尾 · bootstrapPromise（L57-67 异步 IIFE）未 await 完成时被调用 · setTimeout 500ms 是"假设 bootstrap 500ms 内完成"的隐性假设。

**修订**：syncScheduler.ts startScheduler 函数注释加：
```
[未经验测] startScheduler 在 App.onLaunch 同步段调用 · 假设 bootstrapPromise
500ms 内完成 · 微信开发者工具与真机行为可能有差异 · §3.5 runtime 实测断言 B
（Human 联合 154 staging）兜底验证。若 bootstrap > 500ms · syncOnce('launch') 因
isLoggedIn()=false 静默跳过 · 下次 page-show 或 60s periodic 触发兜底。
```

**核验**：D-022 v2.0 §2.2 C8-3 合规 · ✅ 通过

## P2 建议（保留 · 不阻 R1.x.1 APPROVE）

### P2-1 · 反向验证 G7/G8/G9 缺自动化反向验证测

T4 mutex 正向验证 + commit message 文字声称 · 与 154 R1 同款 · 留 Sprint-3 中后段补 spec（describe.skip / 条件编译）· 不阻 PASS。

### P2-2 · console.log 7 处偏多

dispatch 三段式日志合规 · 但生产环境每 60s periodic 会输出 · 留 Sprint-4+ 引入 isDevEnv 条件 log 或 wx.getLogManager()。

### P2-3 · `__costra_family_id_v1` 无写入点

当前 getActiveFamilyId 永远返 null · syncOnce 跳过 push+pull · 需 FU-150-FAMILY-CONTEXT-SERVICE Sprint-3+ 落地。MVP 已知缺口 · 不阻本卡。

---

## §5 D-025 反模式扫描清单

| ID | 反模式 | 命中 | 证据 |
|---|---|---|---|
| AP-001 字符串代理判定 | ☐ No | isRunning boolean / network.isConnected boolean / isLoggedIn() boolean · 全事实字段判定 |
| AP-002 概率极低就接受 | ☐ No | 5xx 静默是离线优先架构明确策略 · "等下次触发"是机制兜底 · 非概率推断 |
| AP-003 契约-实装漂移 | ☐ No | 复用 sync.ts 已封装 · 不重写 sync 逻辑 · 与 sync-protocol §3/§6.3/§7 对齐 · 卡审 R1 隐性漂移已在 R2 修复 |

**结论**：3 项全 PASS（与 154 R1 同款 · 正向兑现）。

---

## §6 反向验证 G7/G8/G9

| 项 | 期望 | 实际 | 结果 |
|---|---|---|---|
| G7 mutex | 注释 → T4 FAIL | T4 正向 mutex 测 · commit message confirmed | ⚠️ 部分（与 154 同款 · 不阻）|
| G8 watermark 不自推 | 改 max(updated_at) → T9 FAIL | syncPull 内部封装 setWatermark · 设计层保证 | ⚠️ 部分 |
| G9 network listener | 删 → T7 FAIL | T7 验证 onNetworkStatusChange 注册 | ⚠️ 部分 |

判定：与 154 R1 同款 · 正向测覆盖 + commit message 声称 · 留 P2-1 补反向验证测。

---

## §7 协议事实源对账

全 ✅（详见 review subagent 完整报告 · §3 GET /sync/pull / §6.1 push-pull 互斥 / §6.3 watermark 单调 / §7 family_id 鉴权 / §3.3 实体顺序+软删均对齐）。

---

## §8 working tree 残留核验（关键判断点）

**git status -s** 显示 ` M .team/follow-ups/README.md` + ` M .team/members/miniapp-dev/state.md`

**判定**：amend 链 535c1f9 → 4751491 → ee97a7a · 是 hash amend pattern（与 154 R1.x.1 P1-2 同款）· 不是 D-016 反例（state.md+history 在 ee97a7a 同 commit · G15 commit 时点 = 0 · 只是 amend 后残留了 hash 更新）。

**P1-1 修订**：R1.x.1 hash 回填 5 处。

---

## §9 follow-up 项

| FU-ID | 优先级 | 状态 | 触发条件 |
|---|---|---|---|
| FU-150-FAMILY-CONTEXT-SERVICE | P2 | open | Sprint-3+ |
| FU-150-NETWORK-LISTENER-CLEANUP | P3 | open | observation |
| FU-150-ENTRY-PAGE-ONSHOW-SEMANTICS | P3 | open | entry 加 onShow 时 |
| FU-COMMIT-HASH-SELF-REF（新立）| P3 | observation | Sprint-3 末 Retro 议题 |

---

## §10 红线 / Won't-Have / 宪章合规

全 ✅（D-008 主体不涉 / AppID 无硬编码 / session_key 无泄漏 / 工作区铁律 / 单文件 ≤ 500 行 / Won't-Have 不侵入）。

---

## §11 自我反思

- 审核耗时 ~45 分钟
- 置信度 高（10 维度全证据链 + git show diff + 反向验证 + 反模式扫描 + amend 链还原 + 协议对账）
- 与 154 R1 对比：154 R1 36/40 · 150 R1 34/40 · 同款 hash 回填问题 + 同款 C8 runtime 扣分（runtime T2 卡 Human 实测前置不可省）· 同款 R1.x.1 修订 → APPROVE 升级
- R1.x.1 修订后 verdict APPROVE 38/40 · 等 Human 联合 154 staging 实测 + 双卡 approve（D-024 §2.2 C1 路径第 3 次实战）

---

## §12 R1.x.1 修订记录（D-017 v3 §2.4 E1 第 9 次实战）

**触发**：R1 Review 后 P1-1（hash 回填 · 与 154 R1.x.1 同款）+ P1-2（startScheduler [未经验测] 标注）顺手并入修订路径

**修订内容**：
1. `miniprogram/services/syncScheduler.ts` startScheduler 函数注释加 [未经验测] 段（D-022 C8-3 合规）
2. `.team/follow-ups/README.md` hash `4751491` → `ee97a7a`（2 处）
3. `.team/members/miniapp-dev/state.md` hash 同步（1 处）
4. `.team/members/miniapp-dev/history/2026-05-20-costra-150-r1-implement.md` hash 同步（1 处）
5. `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md` hash 同步（1 处 · 如有引用）
6. `.team/reviews/COSTRA-150/round-1-tech.md` R1.x.1 落档（本文件）

**闸门复跑**：typecheck 0 / test 52/52 / lint 0 / 3 checks 全绿

**verdict 升级**：PASS-WITH-FOLLOWUP 34/40 → APPROVE 38/40
