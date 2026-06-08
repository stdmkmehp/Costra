# COSTRA-159 · outbox.spec.ts fake timers 重构（FU-156-OUTBOX-FLAKY 转正）

> **派单时间**：2026-05-19 20:50（Sprint-3 头部顺手 · miniapp-dev · ~1 点小卡）
> **状态**：dispatch 已落盘 · 与 COSTRA-150 同链路顺手交付（D-024 §2.2 C2 攒批）
> **依赖**：无（独立 fix）
> **下游解锁**：CI 稳定性提升 · 消除 outbox.spec.ts 时间相关 flaky test（2/5 fail 概率消失）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech`（轻量审 · ≤ 15min）| 等启动 |
| **R1 实装** | `costra-miniapp-dev`（一次性装扮 · 单装扮档单 commit）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech` | 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-159`（攒批 · 与 150 联合）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- 2026-05-13 COSTRA-156 R1 review-tech 独立 5 次跑诊断（2/5 失败 · 非确定性 · pre-existing flaky 由 COSTRA-103 R1 引入）
- 失败行：`miniprogram/services/outbox.spec.ts:102` `expect(result2!.batch[0].next_retry_at > Date.now()).toBe(true)`
- 根因：测试 setup `next_retry_at = Date.now() + 1` · 断言时再取 `Date.now()` · 间隔超 1ms 则 next_retry_at <= Date.now() · 时间相关 race（ms 精度）

### 1.2 修复方案候选（Card-Review 决策）
- **A**. 增大 buffer：`Date.now() + 100`（简单粗暴 · 不彻底）
- **B**. `>=` 替换 `>`（语义不严格 · 能避 race）
- **C**. fake timers（`vi.useFakeTimers()` · 标准做法 · 推荐）✅

---

## §2 Scope（3 项 · 估点 1 · INVEST small）

### 2.1 主交付

#### A · outbox.spec.ts 改用 vi.useFakeTimers()
- `beforeEach` 加 `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-05-19T00:00:00.000Z'))`
- `afterEach` 加 `vi.useRealTimers()`
- 涉及 `Date.now()` 的断言全部改用 `vi.advanceTimersByTime(N)` 推进时间
- L102 断言：`vi.advanceTimersByTime(2); expect(result2!.batch[0].next_retry_at > Date.now()).toBe(true)` · 确定性通过

#### B · 验证（5 次跑全绿）
- `npx vitest run outbox.spec.ts --reporter=verbose --repeat=5` 全绿
- pre-fix 5 次跑应有 2/5 fail（建立基线）

#### C · follow-ups
- FU-156-OUTBOX-FLAKY: open → closed @ COSTRA-159

### 2.2 不在本卡范围
- ❌ 业务代码 outbox.ts 改造（注入时钟 · 留 P3 观察 · 仅测试侧改）
- ❌ 其他文件 fake timers 推广 → 留 FU-VITEST-FAKETIMERS-WIDE

---

## §3 DoD

6 闸门 + G7（outbox.spec.ts 5 次跑全绿）+ G15。反向验证：① 临时去掉 vi.useFakeTimers → 偶发 fail 可复现 · ② revert → 5/5 全绿。

D-025 扫描预测：全不命中。

---

## §4 强制阅读清单

1. 本派单档 + Card-Review 报告
2. **flaky test 现状**：`miniprogram/services/outbox.spec.ts:89-103`
3. **outbox 时间相关代码**：`miniprogram/services/outbox.ts:104-114, 140, 147-150, 231, 257`
4. **vitest fake timers 文档**：https://vitest.dev/guide/mocking.html#timers

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`miniprogram/services/outbox.spec.ts` · `.team/members/miniapp-dev/` · `.team/follow-ups/README.md`
- ❌ 不可写：`miniprogram/services/outbox.ts`（业务代码 · 不动）· server/ · infra/

### §5.2 INVEST small（1 点）
- 时间盒 ≤ 30 分钟

### §5.3 commit footer
- `closes: FU-156-OUTBOX-FLAKY`

---

## §6 估点 / 时间盒
- 估点 1 点 · AI ~30 分钟 · Human 实测：本地 5 次跑全绿截图

---

**派单档结束 · 等 Human `start:COSTRA-159`（建议与 150 同链路顺手交付）。**
