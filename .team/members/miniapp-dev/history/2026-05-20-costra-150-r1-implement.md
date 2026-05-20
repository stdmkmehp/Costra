# COSTRA-150 R1 实装 · client sync 调度器（4 触发源 + mutex + debounce）

> **任务类型**：feature
> **卡号**：COSTRA-150
> **装扮档**：costra-miniapp-dev（一次性 · SBAI v1.1 第 8 次冒烟）
> **时间**：2026-05-20

---

## 1. 任务描述

COSTRA-150 R1 实装 · client sync 调度器。4 触发源（launch / network-recover / page-show / periodic）+ mutex（isRunning flag）+ debounce（5s page-show 防风暴）。复用 sync.ts 已封装的 `pushDelta()` + `syncPull(familyId, opts?)`，调度器只做调度逻辑。R1 卡审 APPROVE 29/30。

## 2. 产出

### A · 新建 `miniprogram/services/syncScheduler.ts`（~135 行）

- 4 个常量：FAMILY_ID_KEY, SHOW_DEBOUNCE_MS=5000, PERIODIC_INTERVAL_MS=60_000
- module-level state：isRunning, lastShowTriggerAt, periodicTimer
- `TriggerSource` 类型 + `SyncResult` interface
- `getActiveFamilyId()`: 读 storage `__costra_family_id_v1`（FU-150-FAMILY-CONTEXT-SERVICE 待抽）
- `syncOnce(trigger)`: mutex + isLoggedIn + getActiveFamilyId + pushDelta + syncPull + SyncResult
- `startScheduler()`: setTimeout 500ms launch + wx.onNetworkStatusChange + setInterval 60s periodic
- `stopScheduler()`: clearInterval periodicTimer
- `triggerOnPageShow(pageName)`: debounce 5s
- `__test__`: reset + getIsRunning（单测专用）

### B · 核验 db.ts watermark 接口（0 行改动）

- ✅ `getWatermark(familyId): Promise<string>` · 默认 epoch
- ✅ `setWatermark(familyId, watermark): Promise<void>`
- ✅ `applyServerChanges(changes): Promise<void>`
- 现状已完整 · 不动

### C · `miniprogram/app.ts` 接入（3 行改动）

- import `{ startScheduler, stopScheduler }` from `./services/syncScheduler`
- onLaunch 末尾 `startScheduler()`（在 bootstrapPromise 之后 · 不破异步等待链）
- 新增 `onHide()` 调 `stopScheduler()`

### D · home + mine 二页 onShow 接入（4 行改动）

- `pages/home/index.ts`: import + onShow 末尾 `triggerOnPageShow('home')`
- `pages/mine/index.ts`: import + onShow 末尾 `triggerOnPageShow('mine')`
- entry 页**不接入**（R1 卡审 P0-3 修订 · 非 tabBar 页）

### E · 新建 `miniprogram/services/syncScheduler.spec.ts`（8 测全绿）

| # | 测 | 结果 |
|---|---|---|
| T1 | syncOnce 未登录跳过 | ✅ 返 null |
| T2 | syncOnce 无 family_id 跳过 | ✅ 返 null |
| T3 | syncOnce 正常路径 pushDelta+syncPull 顺序 | ✅ 返 SyncResult |
| T4 | syncOnce 并发 mutex 跳过 | ✅ 第 2 次返 null |
| T5 | syncOnce 5xx 静默失败 | ✅ 返 null + console.warn |
| T6 | triggerOnPageShow debounce 5s | ✅ 5s 内第 2 次跳过 |
| T7 | startScheduler/stopScheduler 周期 timer | ✅ 启停正常 |
| T8 | syncOnce trigger 字段透传 | ✅ trigger 正确 |

### F · db.spec.ts 已存在 watermark 测（0 补测）

db.spec.ts 已含 `watermark 读写单调` + `getWatermark 不存在 family 返回 EPOCH` 2 测 · 无需补

### G · FU-103 CLOSED + 105 D2 联合 RESOLVED

- `.team/follow-ups/README.md` FU-103-CLIENT-SYNC-SCHEDULER: open → closed @ COSTRA-150
- `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`: §4 更新为 154+150 联合 RESOLVED

## 3. 关键决策

1. **复用 sync.ts 封装**（R1 卡审 P0-1 + P1-1）：调度器不重写 request/db 调用 · 直接 import pushDelta + syncPull · 文件从 ~250 行降到 ~135 行 · 避免与 sync.ts 维护两份逻辑漂移（D-025 AP-003 规避）
2. **family_id storage 兜底**（R1 卡审 P0-1）：family.ts 不存在 · inline 实现 getItem 读 `__costra_family_id_v1` · 留 FU-150-FAMILY-CONTEXT-SERVICE
3. **entry 页不接入**（R1 卡审 P0-3）：entry 是 navigateTo 子页非 tabBar · debounce 防风暴语义不适用 · 留 FU-150-ENTRY-PAGE-ONSHOW-SEMANTICS
4. **401 处理**：request.ts L105-119 已自动续签 retry · syncOnce catch 是最终失败兜底 · 不自行调 auth.refresh
5. **网络监听不清理**（MVP 简化）：stopScheduler 只清 periodic timer · wx.offNetworkStatusChange 留 FU-150-NETWORK-LISTENER-CLEANUP

## 4. 遗留 / follow-up

- **FU-150-FAMILY-CONTEXT-SERVICE**（P2）：`__costra_family_id_v1` storage 兜底 → Sprint-3+ 抽 family.ts service
- **FU-150-NETWORK-LISTENER-CLEANUP**（P3）：wx.offNetworkStatusChange 可行性评估
- **FU-150-ENTRY-PAGE-ONSHOW-SEMANTICS**（P3）：待 entry 页加 onShow 时评估
- **§3.5 runtime 实测**（5 条 A~E）：留 Human 联合 154 staging 实测

## 5. state.md diff

- §2 active tasks: COSTRA-158 R1.x.1 → COSTRA-150 R1 实装
- §3 交付历史索引: +1 条 COSTRA-150 R1
- §7 时间戳: +1 条 2026-05-20T12:00:00+08:00

---

_本档由 costra-miniapp-dev 装扮档在 2026-05-20 产出 · SBAI v1.1 第 8 次冒烟 · D-018 §3.5 同轮兑现_
