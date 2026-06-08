# COSTRA-103 R1.3 残留 2 问题 · D-017 Step 2 + Step 3 诊断报告

> **报告类型**：D-017 v3 §2 流程 · Step 2 根因分析 + Step 3 多方案对比
> **诊断 subagent**：`costra-miniapp-dev`（D-017 §2 诊断专用轮 · 物理无写权 · 第 6 次实战的诊断模式）
> **本轮 write count**：0（只读 · 仅 Read/Grep/git 只读）

---

## §1 元数据

| 字段 | 内容 |
|---|---|
| **诊断时间** | 2026-05-09 17:47+08:00 |
| **诊断人** | `costra-miniapp-dev` · D-017 v3 §2 诊断轮 |
| **卡号** | COSTRA-103 · R1.3 残留修复 |
| **责任领域** | `miniprogram/services/outbox.ts` · outbox 重放队列 |
| **触发场景** | R1.2 commit `1e723c7` 后 + Human 手动修 typecheck（line 113 Omit 加 'seq'）· lint ⚠️ 1 warning + test ❌ 1 fail |
| **本轮工具消耗** | 13 tool uses · 192s · 2.31 credits |

---

## §2 Step 2 · 根因分析

### 问题 1 · lint warning `handleRetry` is defined but never used

**L1 表征层**

```
miniprogram/services/outbox.ts
  293:16  warning  'handleRetry' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

**L2 直接因层**

- **文件**：`miniprogram/services/outbox.ts:293-306`
- **证据 A**：`grep handleRetry` 全仓库结果：仅出现在 3 处注释（line 7 头部 / line 207 / line 263）+ 自身定义（line 293），**0 处实际调用**
- **证据 B**：`git blame -L 293,306` 整块函数所有 14 行均为 `1e723c76 (steve)` · 同 commit 同批次引入

**L3 设计因层**

- `handleRetry`（line 293-306）是**同 commit `1e723c7` 一并写入的指数退避重试函数**，调用 `nextRetryAt(count)` 按 `RETRY_DELAYS_MS`（2s/8s/32s/2min/15min/1h）计算未来时间点
- 设计注释（line 7）原计划："drainBatch 过滤 → handleRetry 之后才写剩余回 index"
- 但 `ackResults` 三态分支（line 248-286）**最终决定内联处理所有失败路径**（网络失败/conflict/rejected 非白名单），均直接 `next_retry_at = Date.now()` 并写回 index，**跳过了 handleRetry**
- **证据 C**：line 263 显式注释 `// ⚠️ 不走 handleRetry 指数退避（conflict 在 R1 无 mergeIntoConflictQueue UI）` —— 证实这是有意的设计放弃，不是漏接

**L4 根因层**

> **设计文档**与**实际代码实现**之间存在"先写骨架后改实现"的演化断层——`handleRetry` 骨架在 R1 早期设计阶段写入，但在 R1 最终实现（commit `1e723c7`）中已决定改用"立即重试 `next_retry_at = Date.now()`"内联方案，`handleRetry` 成为**死代码**。
>
> 这是架构设计迭代中的典型"遗留死桩"（dead stub）问题：R1 commit 没有对设计阶段遗留的辅助函数做最终清理。

---

### 问题 2 · test fail `next_retry_at > Date.now()`

**L1 表征层**

```
FAIL src/services/outbox.spec.ts > outbox > ackResults conflict → 重新入 index + retries 递增（drainBatch 可再次取出）
AssertionError: expected false to be true // Object.is equality
❯ src/services/outbox.spec.ts:102:55
  expect(result2!.batch[0].next_retry_at > Date.now()).toBe(true);
```

**L2 直接因层**

| 位置 | 代码 |
|---|---|
| `outbox.ts:266` | `op.next_retry_at = Date.now();`（conflict 分支，写入 equality） |
| `outbox.ts:190` | `if (op.next_retry_at > now) continue;`（drainBatch 过滤，**严格大于**） |
| `outbox.spec.ts:102` | `expect(result2!.batch[0].next_retry_at > Date.now()).toBe(true);`（测期望未来时间） |

- `ackResults` 中 `Date.now()` 调用时刻 = T2
- `drainBatch` 中 `Date.now()` 调用时刻 = T3（T2 后 microseconds）
- 两处 `Date.now()` 在同一 JS event loop tick 内调用 → T3 ≈ T2 → `next_retry_at = T2 = T3 (mod 1ms)` → `next_retry_at > now` → `false` → **被 drainBatch 的 line 190 过滤掉** → 测期望落空

- **证据 D**：`outbox.spec.ts:14-40` · 测使用 `vi.stubGlobal('wx', ...)` mock 存储，但**未 mock `Date.now()`**，依赖真实 wall-clock，证实了同一 tick 内 T2 ≈ T3 的时序
- **证据 E**：`outbox.ts:262` 代码注释声称 `// 测试 L102: batch[0].next_retry_at = T2；assertion Date.now() = T3+ms >> T2 → L102 pass` —— **注释对时序的假设是错的**（同 tick 内 T2 ≈ T3，注释误以为 T3 >> T2）

**L3 设计因层**

- R1 实现选择"conflict → `next_retry_at = Date.now()`"（立即重试）来规避 handleRetry 的指数退避（因为 R1 无 mergeIntoConflictQueue UI）
- 但 `drainBatch` 的过滤条件（line 190）是 `> now`（**严格大于**），与 `= Date.now()` 不兼容——这两个设计决策之间存在**隐式矛盾**，未在设计文档中显式约定过滤边界

**L4 根因层**

> **协议层面**（`sync-protocol.md` §5.1 + §2.4）：协议只规定了**网络失败**的指数退避重试（`RETRY_DELAYS_MS`），并未规定 `conflict` 的重试时间语义。`conflict` 在 §2.4 中定义为"保留 dirty，等待合并"，但在 R1 无合并 UI 场景下，客户端选择"尽快再次尝试 push"，这与协议对 `conflict` 的定义有**语义空白**。
>
> 代码实现时把"尽快"字面理解为 `Date.now()`（当前时刻），但 `drainBatch` 的 `> now` 过滤条件要求"严格未来"，两者之间差了一个最小正时间单位（≥ 1ms），这是**实现细节层面的 off-by-1 时序 bug**。

---

### 是否同根因 · 一并处置可行性

| | 问题 1 | 问题 2 |
|---|---|---|
| **引入 commit** | 同 `1e723c7` | 同 `1e723c7` |
| **根因类型** | 死代码遗留（设计演化断层） | off-by-1 时序 bug（实现与过滤条件矛盾） |
| **直接修复** | 删除 `handleRetry` | 改 `Date.now()` 为 `Date.now() + 1` |
| **是否必须同时处理** | **否**（独立的两处修改） | **否** |
| **一起处置的好处** | 同一文件 / 同一 commit fix · 同一 PR · 逻辑一致 | |
| **一起处置的风险** | 无互相依赖 · 可以独立验证 | |

**结论**：两个问题来自**同一 commit 的两个独立实现错误**，可以放在同一个 fix commit 里修复（scope = `miniapp`），但不存在互相依赖，无需在同一次 replace_in_file 中一起改——它们是两条独立的 fix。

---

## §3 Step 3 · 多方案对比

### 方案 A【推荐】· 修复 conflict 分支 + 删除 handleRetry 死代码

| 字段 | 内容 |
|---|---|
| **改动范围** | `miniprogram/services/outbox.ts` · 3 处：line 266 / line 293-306（整块）/ 3 处注释 |
| **是否改测** | ❌ 不改（测期望不可改） |
| **是否改协议** | ❌ |
| **是否需 Human 确认** | ✅ 需拍板 Q1 / Q2 |

**关键 diff**：

```diff
// ── line 266（原 conflict 分支）──────────────
-       op.next_retry_at = Date.now();
+       // conflict 立即重试（下次 drainBatch 必须取出 → next_retry_at 须严格 < drainBatch 的 now）
+       // 使用 Date.now() + 1 确保 > drainBatch 中的 now（同 tick 内 = 会导致 line 190 过滤掉）
+       op.next_retry_at = Date.now() + 1;

// ── line 293-306（原 handleRetry 函数 · 整块删除）─────────
- async function handleRetry(op: SyncOp, seq: number): Promise<void> {
-   const count = await incrementRetry(op.client_ref_id);
-   if (count >= MAX_RETRIES || (op.enqueued_at + DEAD_LETTER_AFTER_MS) < Date.now()) {
-     console.error('[outbox] dead-letter', { client_ref_id: op.client_ref_id });
-     await removeItem(opKey(seq));
-   } else {
-     op.retries = count;
-     op.next_retry_at = nextRetryAt(count);
-     await setItem(opKey(op.seq), op);
-     const newIdx = await readIndex();
-     if (!newIdx.includes(seq)) newIdx.push(seq);
-     await writeIndex(newIdx);
-   }
- }

// ── 注释清理（line 7 / line 207 / line 263）────
// 删除涉及 handleRetry 的注释 · 避免后人误读
```

| 维度 | 内容 |
|---|---|
| **成本** | 改 3 处（1 行修 + 14 行删 + 3 处注释清理）· 1 个文件 · ≤ 10 min |
| **价值** | ✅ 同时解决 lint warning + test fail · ✅ 消除死代码 · ✅ 注释清理防误读 |
| **风险** | ⚠️ Sprint-3 真合并 UI 需要指数退避时需从 git 历史恢复（`git show 1e723c7:miniprogram/services/outbox.ts` 可找回） |
| **既有产物影响** | `1e723c7`：✅ 无害（不 amend）· 测 34/34：✅ 修后全绿 · 协议：✅ 无冲突 |
| **协议对齐** | ✅ sync-protocol.md §2.4 conflict + §5.1 网络失败重试均无冲突 |
| **是否 amend** | ❌ 干净 fix commit · 独立于 `1e723c7` |

---

### 方案 B【备选】· 仅修复 conflict 分支 + 保留 handleRetry 待命

| 字段 | 内容 |
|---|---|
| **改动范围** | `miniprogram/services/outbox.ts` · 1 处：line 266 |
| **是否改测** | ❌ |
| **是否改协议** | ❌ |

**关键 diff**：

```diff
// line 266
-       op.next_retry_at = Date.now();
+       op.next_retry_at = Date.now() + 1;
```

| 维度 | 内容 |
|---|---|
| **成本** | 改 1 行 · 1 个文件 · ≤ 2 min |
| **价值** | ✅ 解决 test fail · ❌ lint warning 残留 |
| **风险** | ⚠️ lint warning 残留 → CI lint gate 永久 ⚠️ · 后续开发者可能误读注释 line 263 并误用 |
| **既有产物影响** | ✅ 无害 |
| **协议对齐** | ✅ |
| **是否 amend** | ❌ |

---

### 方案 C【激进/不推荐】· 改 drainBatch 过滤条件 ≥ 替代 >

| 字段 | 内容 |
|---|---|
| **改动范围** | `miniprogram/services/outbox.ts` · 1 处：line 190 |

**关键 diff**：

```diff
// line 190
-     if (op.next_retry_at > now) continue;
+     if (op.next_retry_at >= now) continue;
```

| 维度 | 内容 |
|---|---|
| **成本** | 改 1 行 |
| **价值** | ✅ 解决 test fail |
| **风险** | ❌ **协议语义破坏**：改为 `>= now` 后 · `enqueue` 刚入队的 op（`next_retry_at = now`）会在**同一次 `drainBatch` 调用中**被 drain 出去 · 违反 outbox 批次原子性 |
| **既有产物影响** | ⚠️ 破坏核心语义 · 潜在 regression |
| **协议对齐** | ❌ 违反 sync-protocol.md §2.4 批次原子性假设 |

---

### 方案对比总结表

| 维度 | 方案 A【推荐】 | 方案 B【备选】 | 方案 C【激进】 |
|---|---|---|---|
| 解决 lint | ✅ | ❌ | ❌ |
| 解决 test | ✅ | ✅ | ✅ |
| 破坏核心语义 | ❌ | ❌ | ⚠️ `>= now` 破坏批次原子性 |
| 协议对齐 | ✅ | ✅ | ❌ |
| 死代码清理 | ✅ | ❌ | ❌ |
| 改动行数 | ~18 行 | 1 行 | 1 行 |
| 风险等级 | 低 | 中（lint 残留） | 高（核心语义） |
| Sprint-3 影响 | 需 git 恢复 handleRetry | handleRetry 可直接启用 | 同方案 B |

---

## §4 Q1~Qn Human 决策点

| Q | 选项 | 推荐 | 推荐理由 |
|---|---|---|---|
| **Q1 · 选哪个方案** | (a) **A【推荐】** / (b) B / (c) C | **(a)** | 同时解决 lint + test · 清理死代码 · 一次 commit 完整修复 |
| **Q2 · handleRetry 删除后 Sprint-3 指数退避策略** | (a) **接受删除 + Sprint-3 从 git 历史恢复** / (b) 保留 + lint disable comment | **(a)** | handleRetry 是纯函数无外部依赖；`git show 1e723c7:miniprogram/services/outbox.ts` 可随时恢复；留着反而误导 |
| **Q3 · 修复 commit scope** | (a) **fix(miniapp)** / (b) refactor / (c) chore | **(a)** | bug fix（off-by-1 + dead code）· 不是 refactor |
| **Q4 · Human 手动 seq Omit 改动（line 113）合并方式** | (a) **保留 · 同 fix commit 一并 add** / (b) 单独 commit | **(a)** | 同一文件同一卡 · 一次 fix commit 即可 |

---

## §5 不变量验证清单（修复后用什么命令验证）

修复后 Human 需依次执行：

```bash
cd /Users/weizhao/Desktop/Costra

# 1. typecheck（验证 0 错）
npm run typecheck
# 期望：✅ 0 errors

# 2. lint（验证 lint ⚠️ 消除）
npm run lint
# 期望：✅ 0 errors, 0 warnings

# 3. test（验证 test ❌ 消除）
npm run test
# 期望：✅ 34 passing（含 outbox.spec.ts:89-103 conflict 重入测 pass）

# 4. CI tooling 闸门
npm run check:appjson && npm run check:whitelist && npm run check:tooling
# 期望：全部 ✅

# 5. git 验证
git status
# 期望：仅 miniprogram/services/outbox.ts Modified
git diff miniprogram/services/outbox.ts | grep "next_retry_at = Date"
# 期望：op.next_retry_at = Date.now() + 1
git diff miniprogram/services/outbox.ts | grep "handleRetry"
# 期望：无匹配（函数已删除）

# 6. 反向 grep 三段（保 0 命中 · dispatch 闸门）
grep -rn "amountCents\|categoryId\|occurredAt" miniprogram/services/outbox.ts miniprogram/pages/entry/index.ts | grep -v "^\s*//"
# 期望：0
grep -rn "OUTBOX_KEY\|enqueueLocalEntry\|__peekOutbox" miniprogram/ | grep -v "^\s*//"
# 期望：0
grep -rn "wx\.setStorageSync\|wx\.getStorageSync" miniprogram/services/db.ts miniprogram/services/outbox.ts
# 期望：0

# 7. commit footer 验证
git log -1 --format='%B'
# 期望：Refs: COSTRA-103 出现在 footer
```

---

## §6 Orchestrator 后续路径（D-017 §2 Step 4~5）

- **Step 4**：本报告呈给 Human 拍板 Q1~Q4
- **Step 5**：Human 拍板后 spawn 第 2 轮 miniapp-dev 装扮 subagent · 走实装 + 闸门 + 双 commit + state.md/history 收尾（实装轮 · 不再是诊断轮）

**state.md / history**：本轮为只读诊断轮 · 不修改 · 留 Step 5 实装轮一次性收尾。

---

**报告结束。**
