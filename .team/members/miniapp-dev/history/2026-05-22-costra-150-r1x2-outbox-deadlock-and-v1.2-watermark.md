# COSTRA-150 R1.x.2 · outbox 死锁修复（150-D）+ v1.2 watermark 适配

> **日期**：2026-05-22 17:30
> **装扮**：miniapp-dev（Orchestrator 直接执行 · 非 spawn · 性质属修复型 + 协议适配）
> **commit**：`2b28210`（client 端单 commit · 含双修复 · 8 文件 +310/-54）
> **触发**：Human 联合 154+150 staging 实测 · 5 条断言期间发现 **P0 outbox 死锁 BUG（150-D）** + 协议 v1.2 升级要求 client 适配 BIGINT watermark
> **决策**：Human 选项 B · 同轮彻底修复 outbox 死锁 + 适配协议 v1.2 BIGINT change_seq

---

## §1 背景：联合实测捕获的 P0 BUG（COSTRA-150-D · outbox 死锁）

### 实测现象

切 offline → 写 entry → 切 online → 触发 sync · entry 卡在 outbox `drained` 状态永不重发 · DB 端无对应记录 · 4 条 Console 诊断输出：
1. `outbox.pending` 空数组
2. `outbox.drained` 非空（残留 entry）
3. drained item retries=0
4. `wx.onNetworkStatusChange` 切换无反应

### 三重根因

| 层 | 文件 | 问题 |
|---|---|---|
| L1 | `miniprogram/services/sync.ts:95-97` | `try { ... } catch (err) { /* 静默 */ }` 吞掉 push 失败错误 · drained 永久残留 |
| L2 | `miniprogram/services/outbox.ts` drainBatch recover | recover 逻辑仅捞 `retries > 0` 的 drained · push 首次失败 retries=0 永远不进入 recover 循环 |
| L3 | `miniprogram/services/outbox.ts` ackResults | 用 `idempotency_key` 字段对比 server 返回的 ack 列表 · server 实际返回 `ack_batch_key` · 字段错配 → 所有 push 都判定为 ack 失败 |

**触发条件**：网络抖动或 server 5xx 返回时 100% 复现 · 单测 + curl 都漏不出（单测 mock 永远成功 · curl 是单条不走 batch ack 路径）

---

## §2 修复 scope（commit `2b28210` · 8 文件 +310/-54）

### Part A · outbox 死锁修复（COSTRA-150-D · P0）

| # | 文件 | 改动 |
|---|---|---|
| A1 | `miniprogram/services/sync.ts` | catch 段不再静默吞错 · throw 上抛给 syncScheduler · 让重试机制接管 |
| A2 | `miniprogram/services/outbox.ts` | 新增 ackBatchFailure(envelope) · push 失败时显式回退 drained → pending（retries+1） |
| A3 | `miniprogram/services/outbox.ts` drainBatch | recover 段移除 `retries > 0` 过滤条件 · 首次失败 drained 也能 recover |
| A4 | `miniprogram/services/outbox.ts` ackResults | 修复字段错配 · 改读 server 返回的 `ack_batch_key`（与 protocol 对齐） |
| A5 | `miniprogram/services/outbox.spec.ts` | 新增回归测：drained orphan recovery（覆盖 retries=0 路径）+ ackBatchFailure 单元测 |

### Part B · v1.2 watermark BIGINT 适配（COSTRA-154 协议升级 client 段）

| # | 文件 | 改动 |
|---|---|---|
| B1 | `miniprogram/services/db.ts` getWatermark | 返回类型 `string \| null` → `number`（默认 0）· legacy ISO 字符串自动检测并重置为 0（防御性兼容历史 wx.storage） |
| B2 | `miniprogram/services/db.ts` setWatermark | 防御性参数校验 · 拒绝负数 / 浮点 / 非 number |
| B3 | `miniprogram/services/db.spec.ts` | 新增 4 条 v1.2 watermark 回归测（数字写入读取 · legacy ISO 重置 · 负数拒绝 · 浮点拒绝） |
| B4 | `miniprogram/services/sync.ts` | SyncPullResponse.watermark 类型 string → number |
| B5 | `miniprogram/services/syncScheduler.ts` | SyncResult.watermark 类型 string → number |
| B6 | `miniprogram/services/syncScheduler.spec.ts` | 5 处 mock watermark 字面量 ISO → 数字 · 1 处断言升级 |
| B7 | `miniprogram/services/env.ts` | 微调 1 处 watermark 类型 |

**测试基线**：client 58/58 PASS（vs R1.x.1 52/52 · 新增 6 条：4 条 v1.2 watermark + 2 条 outbox 死锁回归）

---

## §3 闸门 + 反向验证

| 闸门 | 结果 | 备注 |
|---|---|---|
| G1 typecheck | ✅ | tsc --noEmit 干净 |
| G2 eslint | ✅ | 0 warnings |
| G3 协议事实源对齐 | ✅ | client SyncPullResponse 与 server entryToWire 一致（watermark:number + change_seq）|
| G4 单测全绿 | ✅ | 58/58 |
| G5 commit subject 小写 | ✅ | `fix(miniapp): sync watermark v1.2 bigint + outbox deadlock (costra-154 costra-150)` |
| G6 commit footer | ✅ | `Refs: COSTRA-154 COSTRA-150` |
| G15 D-016 反例预防 | ✅ | commit 前 .team/members/miniapp-dev/ wc -l = 0（本档案 + state.md 同 commit 落盘） |

**反向验证**：
- grep `watermark.*string` 0 命中（除 legacy 检测代码注释）
- outbox.spec.ts 新增 retries=0 drained orphan 路径测覆盖
- 双修复在 1 笔 commit 因为 sync.ts 是两个 BUG 的共同入口（强行拆分破坏可编译性）

---

## §4 防御性兼容历史 wx.storage 数据

```ts
// db.ts getWatermark · v1.2 升级后的兼容逻辑
const stored = wx.getStorageSync('watermark:' + familyId);
if (typeof stored === 'string') {
  // legacy v1.0/v1.1 ISO 字符串 watermark · 强制重置
  console.warn('[db] legacy ISO watermark detected · reset to 0', { familyId });
  wx.setStorageSync('watermark:' + familyId, 0);
  return 0;
}
return typeof stored === 'number' ? stored : 0;
```

**首次升级影响**：客户端会全量回灌一次（watermark=0 触发 server pull 全部历史）· 之后增量正常 · 用户感知 = 一次稍长的 sync · 可接受

---

## §5 等再次 staging 实测

下一步 Human 操作：
1. （server 段）staging 重启 + 跑 migration 0006
2. （client 段）小程序模拟器/真机重新拉起 · 旧 wx.storage 中的 ISO watermark 自动重置
3. 重跑联合 smoke 5 条断言 A~E：
   - 断言 A · launch 时序
   - 断言 B · page-show 触发
   - 断言 C · network-recover 触发
   - **断言 D · watermark 持久化（重点验证 BIGINT 数字 + legacy 重置）**
   - **断言 E · Console 无 error（重点验证 outbox 不再死锁）**
4. `approve:COSTRA-154 + COSTRA-150` 联合双卡同轮 approve

**风险评估**：低 · client 58/58 测全绿 · 双 BUG 都有针对性回归测兜底 · legacy 自动重置防御性强

---

## §6 议入 Sprint-3 末 Retro 议题（候选）

1. **联合实测 = 真闭环最后一道闸新范式**：本卡 outbox 死锁单测 + curl 都漏不出 · 必须真链路 client+server staging 实测才能捕获（D-024 §2.2 C1 立意首次得到协议升级级别证据）
2. **R1.x.2 协议破坏性升级范式**（新建）：vs 以往 R1.x.1 review-tech 修订型 · 联合实测发现 P0+P1 双 BUG → Human 决策"选项 B 不背历史包袱" → 同轮 server+client+protocol+qa 四层升级 → 全测试绿 → 3 笔原子 commit
3. **catch 静默吞错反模式**：sync.ts:95-97 是 D-025 反模式扫描清单候选追加项 · CI hook 是否能扫"空 catch 块" · 配合 eslint no-empty 规则
4. **field name 字段错配的契约对账**：ack_batch_key vs idempotency_key 这种字段错配应该在 OpenAPI schema gen → client type 自动绑定时被消除 · CI 对账族第 6 张候选

---

**装扮 subagent SBAI 实战记录**：本卡为 Orchestrator 直接执行（非 spawn 装扮档）· 双修复（150-D outbox 死锁 + v1.2 watermark 适配）· 时长 ~2.5h（含 syncScheduler.spec 5 处 ts 类型修复 + commitlint body 行长拦截）
