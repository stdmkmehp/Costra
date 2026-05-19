# COSTRA-150 · client sync 调度器（onShow / 网络恢复 / 周期 / 启动触发 pushDelta + syncPull）

> **派单时间**：2026-05-19 15:05（Orchestrator · Sprint-3 头部第 2 张 · 与 COSTRA-154 联动落档 · 但 spawn 严格依赖 154 R1 APPROVE）
> **状态**：dispatch 已落盘 · **强依赖 COSTRA-154 R1 APPROVE 才能启动**（150 不能在 154 之前做 · 否则调度器调 GET /sync/pull 仍返 501 · 无法跑闸门）
> **依赖**：COSTRA-103（client outbox + auth + storage CLOSED）· COSTRA-104（server sync push CLOSED）· COSTRA-126（基础库 3.8.12 CLOSED · async storage API 已可用）· COSTRA-127（onLaunch 异步化 CLOSED）· **COSTRA-154**（GET /sync/pull 真实装 · 必须 APPROVE 才启 150）
> **下游解锁**：FU-103-CLIENT-SYNC-SCHEDULER 真闭合 · COSTRA-105 D.2 + H6 真链路自动回归 PASS · client 真正实现"无网也能保存 → 联网后自动上传 + 多设备增量同步"PRD AC-4 闭环 · COSTRA-151 conflict UI 触发条件具备（FU-103-CONFLICT-MERGE-UI）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1**（D-014-a）| `costra-card-reviewer-tech`（D-022 v2.0 评分 + D-025 §2 反模式扫描第 2 次套用 · 重点 C8 runtime + C2 调度器并发安全）| 等 154 APPROVE + Human 拍板启动 |
| **R1 实装** | `costra-miniapp-dev`（一次性装扮 · 6~7 项 client 改动 · 单装扮档单 commit）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-014-b 自动拉起 · D-022 v2.0 第 8 次实战）| 等 R1 实装完 |
| **Human T1 终审** | `approve:COSTRA-150`（D-024 §2.2 攒批 · 与 COSTRA-154 联合 approve）| 等 R1 Review APPROVE |

---

## §1 背景

### 1.1 触发链

**段 1 · COSTRA-103 R1 切出去（2026-05-09 19:05）**：
- Human 模拟器实测 COSTRA-103 R1 步骤 D（无 POST · client 不主动调 push）+ 步骤 E（watermark 空 · `keys.filter(k => k.startsWith('watermark:'))` = `[]`）
- 立 FU-103-CLIENT-SYNC-SCHEDULER（P1 · COSTRA-150 候选 · 5 点 · 与 COSTRA-104 server 稳定后启）

**段 2 · COSTRA-105 H6 BLOCKED 双重根因（2026-05-18 20:1x）**：
- 缺陷单 §1：server pull 返 501（COSTRA-154 解决）
- 缺陷单 §2：即使 server 有 pull · client 无调度器调用 · watermark 永远空 · pull 路径走不通
- 154 + 150 双卡同时落地 · 105 H6 + D.2 才能真链路 PASS

**段 3 · 150 强依赖 154 决议**：
- 150 调度器调 syncPull · 若 154 stub 501 · 调度器一启动就抛错 · 闸门红
- **决策**：150 dispatch 已落档（不阻 backend 准备工作）· 但 spawn Card-Review 严格等到 154 R1 APPROVE
- 联合 approve 路径见 §9

### 1.2 PRD / 契约锚点

- **PRD AC-4**：「无网也能保存 → 写入本地队列 → 联网后自动上传 + 多设备增量同步」· 阻断级别 P1（核心承诺）
- **协议事实源**：`docs/api/sync-protocol.md` §3（pull 调用契约）+ §6.3（watermark 单调性 · client 不得自行推进）+ §7（family_id 鉴权 · 必须传当前 user 所属 family）
- **D-022 v2.0 §4.1 runtime 类 T2 卡铁律**：本卡是 **runtime 类 T2** · 必须 Human 实测前置（onShow / 网络状态切换 / 周期 timer 都是 wx 平台 runtime 行为 · 单测无法完整覆盖）→ D-024 §2.2 C2 路径预声明（但与 154 攒批 · 不单卡触发立即测）

### 1.3 Sprint-3 启动决策（待 Human 拍板）

**当前状态（2026-05-19）**：dispatch 已落盘 · **不主动 spawn**

**触发条件**：
- COSTRA-154 R1 APPROVE 后 · Human `start:COSTRA-150` 或 `start:sprint-3-head`
- 不可在 154 APPROVE 前启动（强依赖 · 物理阻塞）

---

## §2 Scope（7 项 · 估点 5 · INVEST small 边界内）

### 2.1 主交付（7 项 · 必交）

#### A · 新建 syncScheduler 服务（新建 1 文件 · 1 项 · 核心）

**`miniprogram/services/syncScheduler.ts`**（新建 · 200~250 行）：

```ts
/**
 * 客户端同步调度器
 *
 * 触发源（4 类 · 优先级降序）：
 *   1. 启动触发（app.onLaunch / app.onShow 首次）：冷启 / 热回前台 → setTimeout 500ms 后 syncOnce
 *   2. 网络恢复触发（wx.onNetworkStatusChange · isConnected: false→true）：立即 syncOnce
 *   3. onShow 触发（首页 / 列表页 onShow）：debounce 5s 内只跑一次 syncOnce
 *   4. 周期触发（setInterval 60s · 仅前台）：低优先级 · 兜底
 *
 * syncOnce 流程：
 *   1. 鉴权检查（auth.getValidToken 失败 → 跳过 · 不阻塞 · 不报错）
 *   2. pushDelta（outbox 有待推 op 才调）
 *   3. syncPull（用本地 watermark · 默认 epoch '1970-01-01T00:00:00.000Z'）
 *   4. applyServerChanges（落本地 storage · entries 按顺序 putEntity · 软删行 markDeleted）
 *   5. 推进本地 watermark（client 不得自行推进 · 必须用 server 返回的 watermark）
 *
 * 并发安全：
 *   - 内置 mutex（isRunning flag）· 同时只允许一次 syncOnce 跑
 *   - 触发期间被屏蔽的源 · 不排队（avoid backlog）· 让下次触发自然来
 *
 * 失败处理：
 *   - 401 → 调 auth.refresh · 失败再 401 → 跳出 · 等下次触发
 *   - 5xx → 静默 · 等下次触发（不告知用户 · 因为 client 离线优先架构）
 *   - 4xx other → console.warn + sentry-like 日志（如有）· 不阻塞用户操作
 *
 * 日志：
 *   - 启动 / 完成 / 失败 三段式 console.log（带触发源标签）
 *   - 失败时带 trace_id（如 server 返）· 便于联调
 */

import { request } from './request.js';
import { auth } from './auth.js';
import { outbox } from './outbox.js';
import * as db from './db.js';
import { getCurrentFamilyId } from './family.js';  // 待确认是否存在 · 不存在用 storage 读

interface SyncResult {
  pushed: number;     // 本次成功推送的 op 数
  pulled: number;     // 本次拉取的 entries 数
  watermark: string;  // 推进后的 watermark
  trigger: TriggerSource;
}

type TriggerSource = 'launch' | 'network-recover' | 'page-show' | 'periodic';

let isRunning = false;
let lastShowTriggerAt = 0;
const SHOW_DEBOUNCE_MS = 5000;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
const PERIODIC_INTERVAL_MS = 60_000;

export async function syncOnce(trigger: TriggerSource): Promise<SyncResult | null> {
  if (isRunning) {
    console.log(`[sync] skip · already running (trigger=${trigger})`);
    return null;
  }

  isRunning = true;
  try {
    const token = await auth.getValidToken();
    if (!token) {
      console.log(`[sync] skip · no valid token (trigger=${trigger})`);
      return null;
    }

    const familyId = await getCurrentFamilyId();
    if (!familyId) {
      console.log(`[sync] skip · no active family (trigger=${trigger})`);
      return null;
    }

    // 1. push delta
    const pushed = await outbox.flushPending(token);

    // 2. pull
    const watermark = await db.getWatermark(familyId);
    const since = watermark ?? '1970-01-01T00:00:00.000Z';
    const res = await request.get<SyncPullResponse>('/sync/pull', {
      family_id: familyId,
      since,
      limit: 200,
    });

    // 3. apply changes
    await db.applyServerChanges(res.changes);

    // 4. advance watermark（client 不得自行推进 · 用 server 返回的 watermark）
    await db.setWatermark(familyId, res.watermark);

    const pulled = res.changes.entries.length;
    console.log(`[sync] ok · pushed=${pushed} pulled=${pulled} watermark=${res.watermark} (trigger=${trigger})`);
    return { pushed, pulled, watermark: res.watermark, trigger };

  } catch (e: any) {
    console.warn(`[sync] fail · ${e?.code || 'unknown'} ${e?.message || e} (trigger=${trigger})`);
    return null;
  } finally {
    isRunning = false;
  }
}

/** 启动调度器（app.onLaunch 调一次 · 周期 timer + 网络监听） */
export function startScheduler() {
  // 1. 启动触发（500ms 后 · 让 onLaunch 链路先跑完）
  setTimeout(() => syncOnce('launch'), 500);

  // 2. 网络恢复触发
  wx.onNetworkStatusChange((res) => {
    if (res.isConnected) {
      console.log('[sync] network recover · trigger sync');
      syncOnce('network-recover');
    }
  });

  // 3. 周期触发（60s · 仅前台 · onHide 时停 · onShow 时启）
  if (!periodicTimer) {
    periodicTimer = setInterval(() => syncOnce('periodic'), PERIODIC_INTERVAL_MS);
  }
}

export function stopScheduler() {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

/** 页面 onShow 触发（home/mine/entry 等 · debounce 5s） */
export function triggerOnPageShow(pageName: string) {
  const now = Date.now();
  if (now - lastShowTriggerAt < SHOW_DEBOUNCE_MS) {
    console.log(`[sync] skip page-show · debounced (page=${pageName})`);
    return;
  }
  lastShowTriggerAt = now;
  syncOnce('page-show');
}
```

> **特别说明**：`getCurrentFamilyId` / `db.getWatermark` / `db.setWatermark` / `db.applyServerChanges` / `outbox.flushPending` 这些底层 API 是 COSTRA-103/104 R1 已建立的范式 · 本卡只组装 · 不重新发明。若某 API 不存在 · backend-dev 协作之前 miniapp-dev 自行评估补齐路径（dispatch §5.3 已知未知）。

#### B · `miniprogram/services/db.ts` watermark 接口（修订 1 文件 · 1 项）

确认或新增：
- `getWatermark(familyId: string): Promise<string | null>` · 读 storage `sync:watermark:${familyId}`
- `setWatermark(familyId: string, watermark: string): Promise<void>` · 写 storage 同 key
- `applyServerChanges(changes: SyncChanges): Promise<void>` · 按 sync-protocol §3.4 顺序消费 ledgers→categories→budgets→entries · entries 中含 deleted_at 软删行处理（local markDeleted）

> 现状若已部分实装则只补缺口 · 不重写。

#### C · `miniprogram/app.ts` startScheduler 接入（修订 1 文件 · 1 项 · 1~3 行）

`onShow` 或 `onLaunch` 末尾加：
```ts
import { startScheduler, stopScheduler } from './services/syncScheduler';

App({
  onLaunch() {
    // ... 既有逻辑
    startScheduler();   // 启动调度器
  },
  onHide() {
    stopScheduler();    // 切后台停周期 timer
  },
});
```

> 注意 COSTRA-127 onLaunch 异步化已建立 · scheduler 启动放在已 await 的位置之后 · 不破异步等待链。

#### D · home / mine 页 onShow 接 triggerOnPageShow（修订 2~3 文件 · 1 项）

`miniprogram/pages/home/index.ts` + `miniprogram/pages/mine/index.ts` + `miniprogram/pages/entry/index.ts`（如有）的 `onShow` 末尾加：

```ts
import { triggerOnPageShow } from '../../services/syncScheduler';

Page({
  onShow() {
    // ... 既有逻辑（hydrateUser 等）
    triggerOnPageShow('home');
  },
});
```

> debounce 5s 在 syncScheduler 内部 · 多页切换不会风暴。

#### E · client 单测（新建 1 文件 · 1 项）

**新建 `miniprogram/services/syncScheduler.spec.ts`**（参 outbox.spec.ts 风格 · ≥ 8 测）：

| # | 测 | 期望 |
|---|---|---|
| T1 | syncOnce 无 token 时跳过 | 返 null · 不调 request |
| T2 | syncOnce 无 family_id 时跳过 | 返 null |
| T3 | syncOnce 正常路径 · pushDelta + syncPull + applyChanges 顺序调用 | 返 SyncResult · 字段齐全 |
| T4 | syncOnce 并发触发 · 第 2 次跳过（mutex） | 返 null（第 2 次）|
| T5 | syncOnce 401 · auth.refresh 重试 1 次 · 第 2 次仍 401 跳出 | 返 null · 不抛 |
| T6 | syncOnce 5xx · 静默失败 | 返 null · 不抛 · console.warn |
| T7 | triggerOnPageShow debounce · 5s 内第 2 次调用跳过 | T3 只触发 1 次 |
| T8 | startScheduler / stopScheduler · 周期 timer 启停 | timer 创建 / 清除 |
| T9 | syncOnce watermark 推进 · 用 server 返回的 watermark 不自行推进 | client 不算 max(updated_at) |
| T10 | applyServerChanges 含软删行 · 本地 markDeleted | local entry deleted_at 已设 |

#### F · `miniprogram/services/db.ts` 单测补充（修订 1 文件 · 1 项 · 0~3 测）

如 db.spec.ts 已存在 · 补 watermark / applyServerChanges 单测。如不存在 · 单测放 syncScheduler.spec.ts 内 mock。

#### G · 关闭 FU-103-CLIENT-SYNC-SCHEDULER + 105 H6/D.2 联动回归（修订 2 文件 · 1 项）

- `.team/follow-ups/README.md` FU-103-CLIENT-SYNC-SCHEDULER：open → `closed @ COSTRA-150` + commit hash 待回填
- `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`：与 154 联合标 RESOLVED（150 + 154 双卡 R1 APPROVE 后 H6 + D.2 真链路具备 PASS 条件）

### 2.2 不在本卡范围（明示）

- ❌ COSTRA-154 server GET /sync/pull 实装（独立卡 · 强依赖前置）
- ❌ conflict 真实合并 UI（FU-103-CONFLICT-MERGE-UI · COSTRA-151）
- ❌ 全量 14 用例自动化（FU-105-AUTOMATION-FULL-COVERAGE · COSTRA-155）

### 2.3 文档（0 项）

不写新文档 · sync-protocol.md client 视角（如需）由 154 + 150 联合 PR 时统一修订（avoid 重复）。

---

## §3 DoD（可度量 · 17 项）

### §3.1 主交付（7 项）

- [ ] A · `syncScheduler.ts` 新建 · 4 触发源 + mutex + 失败处理 · 200~250 行
- [ ] B · `db.ts` watermark 接口齐全（getWatermark/setWatermark/applyServerChanges）
- [ ] C · `app.ts` startScheduler 接入 · onLaunch + onHide 钩子
- [ ] D · home/mine（/entry）三页 onShow 接 triggerOnPageShow
- [ ] E · `syncScheduler.spec.ts` 新建 · ≥ 8 测含 mutex / debounce / 401 重试 / 软删
- [ ] F · `db.spec.ts` watermark + applyChanges 测补充（若现状缺）
- [ ] G · follow-ups README + 缺陷单标 RESOLVED

### §3.2 闸门（≥ 6 项 · 必跑全绿才提交）

| # | 闸门 | 命令 | 期望 |
|---|---|---|---|
| G1 | typecheck | `npm run typecheck` | 0 错 |
| G2 | lint | `npm run lint` | 0 warn |
| G3 | test | `npm run test` | 全绿（含新增 ≥ 8 测）|
| G4 | check:appjson | `npm run check:appjson` | exit 0 |
| G5 | check:tooling | `npm run check:tooling` | exit 0 |
| G6 | check:whitelist | `npm run check:whitelist` | exit 0 |

### §3.3 反向验证（3 项）

- [ ] G7 · 临时把 `isRunning` mutex 注释掉 → T4 并发测 FAIL（两次都跑） → revert → PASS
- [ ] G8 · 临时把 setWatermark 改为 `setWatermark(family, max(rows.updated_at))`（client 自行推进 · 违反协议 §6.3）→ T9 FAIL → revert → PASS
- [ ] G9 · 临时把 onNetworkStatusChange 监听删除 → T... 网络恢复测 FAIL → revert → PASS

### §3.4 D-025 反模式扫描（Card-Review §4 + R1 Review §5）

| ID | 反模式 | 命中预测 |
|---|---|---|
| AP-001 字符串代理判定 | 不命中（150 用 isRunning boolean / network isConnected boolean / token validity 都是事实判定 · 不是字符串代理）|
| AP-002 概率极低就接受 | 不命中（150 失败处理 + mutex 都是机制兜底 · 非概率论）|
| AP-003 契约-实装漂移 | 不命中（150 调 GET /sync/pull 严格用 154 实装路径 · 协议契约对齐）|

---

## §4 强制阅读清单

### §4.1 必读

1. **本派单档全文**
2. **COSTRA-154 dispatch**（前置依赖 · 调用方）：`.team/dispatch/COSTRA-154-sync-pull-incremental-fetch.md`
3. **协议**：`docs/api/sync-protocol.md` §3 + §6.3 + §7
4. **既有 outbox**：`miniprogram/services/outbox.ts`（pushDelta 范式 + flushPending 接口）
5. **既有 auth**：`miniprogram/services/auth.ts`（getValidToken / refresh 范式 · COSTRA-158 已加 updateLocalUserProfile）
6. **既有 db**：`miniprogram/services/db.ts`（watermark + applyServerChanges 接口 · 现状评估）
7. **既有 request**：`miniprogram/services/request.ts`（COSTRA-102 X-HTTP-Method-Override 降级 · 但 GET 不需要）
8. **缺陷单**：`qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`（150 + 154 联合 RESOLVED 路径）
9. **D-025 反模式清单**：`.team/decisions/D-025-anti-patterns-clipboard.md`

### §4.2 按需

- `.team/dispatch/COSTRA-103-client-token-and-storage.md`（client outbox + storage 范式）
- `.team/dispatch/COSTRA-127-onlaunch-async-fix.md`（onLaunch 异步化 · scheduler 启动位置）
- `docs/qa/costra-105-human-smoke.md` §4.2 + §6 H6（150 + 154 真链路验证路径）

---

## §5 硬约束（不可违反）

### §5.1 工作区铁律

- ✅ **miniapp 装扮档可写**：
  - `miniprogram/services/syncScheduler.ts`（新建 · 核心）
  - `miniprogram/services/db.ts`（修订 · 补 watermark 接口）
  - `miniprogram/app.ts`（修订 · onLaunch/onHide 接入）
  - `miniprogram/pages/home/index.ts`（修订 · onShow 接 triggerOnPageShow）
  - `miniprogram/pages/mine/index.ts`（修订 · 同上）
  - `miniprogram/pages/entry/index.ts`（修订 · 如有 onShow）
  - `miniprogram/services/syncScheduler.spec.ts`（新建）
  - `miniprogram/services/db.spec.ts`（修订 · 如缺）
  - `.team/members/miniapp-dev/state.md` + history
- ✅ **共用可写**：`.team/follow-ups/README.md` · `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md`
- ❌ **不可写**：`server/`（COSTRA-154 范围）· `infra/` · 其他 `.team/members/{other-role}/`

### §5.2 严守 INVEST small（5 点 · 含拆卡损益分析）

- 5 点 · 时间盒 R1 实装 ≤ 240 分钟（4 小时）
- 7 项 scope · 单点修改密度高（无新业务逻辑发明 · 4 触发源是工程组装）

**拆卡损益分析（决策不拆）**：

考虑过：150a（A+B+C 核心调度器 · 3pt）+ 150b（D 页面 onShow + E/F/G 单测/follow-ups · 2pt）

- **损**：+1 次 Review 循环（~30min）+ 1 次 commit · 150a 无 onShow 触发不能跑全闸门（T7 debounce 测无法验）
- **益**：核心调度器风险隔离
- **结论：不拆**。150b 严格依赖 150a · 串行更慢。

### §5.3 已知未知 / follow-up 候选

- **getCurrentFamilyId 现状**：若不存在 · 用 `wx.getStorageSync('__costra_family_id_v1')?.d` 兜底 · 立 FU-150-FAMILY-CONTEXT-SERVICE
- **db.applyServerChanges 现状**：若 stub · 本卡补齐 · 但 ledgers/categories/budgets 在 154 仅返空数组 · 现阶段只处理 entries 路径 · 留 FU-154-CATEGORIES-PULL 联动
- **网络监听清理**：startScheduler 加监听 · stopScheduler 是否调 wx.offNetworkStatusChange？wx 平台 API 是否支持？需验。**MVP 简化**：onLaunch 启动 · 整个 App 生命周期不停 · 不 offNetworkStatusChange · 留 follow-up FU-150-NETWORK-LISTENER-CLEANUP 评估

### §5.4 D-016 同轮兑现

- 派单 → Card-Review → R1 实装（miniapp-dev 单装扮档）→ review-tech R1 同轮 spawn
- 时间盒 240min · 单装扮档无双域协作开销

### §5.5 D-018 SBAI 装扮档铁律

- 一次性装扮 · 任务结束销毁
- miniapp-dev 段直接 commit（单装扮档单 commit）
- commit footer 单 `Co-Authored-By: miniapp-dev <subagent>`

### §5.6 D-022 v2.0 评分表（review-tech R1 第 8 次实战）

| 维度 | 满分 | 本卡重点 |
|---|---|---|
| C1 契约对齐 | 5 | 调用 GET /sync/pull 严格按 sync-protocol.md §3 / §6.3 client 不自推 watermark |
| C2 代码质量 | 5 | syncOnce mutex 并发安全 · 失败处理三档（401/5xx/4xx other）· debounce 算法 |
| C3 架构合理 | 5 | scheduler 单文件聚合 4 触发源 · 不污染 outbox/auth/db 模块 · 单一职责 |
| C4 数据完整 | 5 | applyServerChanges 软删行处理 · watermark 不自推 · 顺序消费 |
| C5 安全 | 5 | 不信任 server 返回（family_id 不直接信 · 用本地存的）· 不暴露 trace_id 给用户 |
| C6 可测性 | 5 | spec 8+ 测含 mutex/debounce/401/软删 · 反向验证 G7~G9 |
| C7 纪律 | 5 | INVEST small 5pt · D-016 同轮 · 单装扮档单 commit |
| **C8 runtime 加载性** | 5 | **重点：wx 平台 runtime · onShow / onNetworkStatusChange / setInterval / setTimeout 在小程序的真实行为** · onLaunch + onShow 异步顺序（COSTRA-127 范式遵守） |
| C9 性能 | 5 | 周期 60s 不过载 · debounce 5s 防风暴 · mutex 防重叠 |
| C10 SBAI 流程合规 | 5 | 单装扮档 · history 5 段 · state.md §2 §3 §7 同步 |

> **C8 是本卡最高风险维度**（D-022 v2.0 §4.1 runtime 类 T2 卡铁律）· R1 Review 重点核 wx 平台 runtime 行为 · Human 实测前置不可省

### §5.7 D-024 §2.2 C2 路径预声明

本卡是 D-022 v2.0 §4.1 runtime 类 T2 卡（涉 wx 平台 runtime 行为）· 按 D-024 §2.2 触发条件矩阵：

| 条件 | 是否命中 |
|---|---|
| C1 队列 ≥ 2 张 | **命中**（150 + 154 联合 approve 优选 · D-024 §2.2 C1 联合路径优于 C2 单卡）|
| C2 强外部依赖 runtime | 命中（wx 平台 runtime）|

→ **决议**：与 154 联合实测优先（C1 路径）· 不走 C2 单卡立即触发。Human 实测前置仍然必须做（C8 维度铁律）· 但合并到 154 + 150 联合实测清单内。

### §5.8 D-025 反模式扫描（Card-Review §4 + R1 Review §5）

预测：AP-001/002/003 全不命中。

---

## §6 提交（D-012 单卡即提交 · D-018 commit footer）

R1 commit message 模板（全小写 commitlint · body 行长 ≤ 100 字符）：

```
feat(repo): client sync scheduler with 4 triggers (costra-150)

sprint-3 head card 2: client side sync scheduler (push delta + sync pull).

miniapp side (7 changes):
- a: services/syncScheduler.ts new (4 triggers, mutex, failure handling)
- b: services/db.ts watermark interface (getWatermark/setWatermark/applyServerChanges)
- c: app.ts startScheduler in onLaunch + stopScheduler in onHide
- d: home/mine/entry pages onShow triggerOnPageShow
- e: syncScheduler.spec.ts 8+ tests (mutex, debounce, 401, soft-delete)
- f: db.spec.ts watermark + applyChanges tests
- g: follow-ups + 105 d2 defect resolved

closes:
- fu-103-client-sync-scheduler (4 triggers all wired)
- costra-105 h6/d2 real-link regression now possible (combined with 154)

gates: typecheck/lint/test all green. checks 6/6 pass.
reverse verify: g7 (mutex), g8 (watermark not self-advance), g9 (network listener) confirmed.
d-022 v2.0 8th. d-025 ap-001/002/003 not hit (clean record).

invest small 5pt. single subagent single commit. d-016 same turn.
runtime t2 card. d-024 c1 joint test path with costra-154.

refs: docs/api/sync-protocol.md sec-3 sec-6.3 sec-7
refs: .team/dispatch/costra-150-*.md .team/dispatch/costra-154-*.md

co-authored-by: miniapp-dev <subagent>
```

---

## §7 估点 / 时间盒

- **估点**：5 点
- **时间盒**：R1 实装 ≤ 240 分钟（4 小时）
- **R1 拆分**：
  - A syncScheduler 核心：80 min（4 触发源 + mutex + 失败处理 · 工程量最大）
  - B db.ts watermark 接口：30 min（评估现状 + 补缺）
  - C app.ts 接入：10 min
  - D 三页 onShow 接：15 min
  - E syncScheduler.spec.ts 8 测：60 min
  - F db.spec.ts 补：20 min
  - G/H follow-ups + 缺陷单：10 min
  - state.md + history：15 min
  - **总和：~240 min · 时间盒打满**

---

## §8 联合 Sprint-3 末 Retro 议题候选

- 🆕 **议题 · 调度器周期间隔可配置**：60s 是默认 · Sprint-4+ 可加配置项（如电池电量低时拉长间隔）· Sprint-3 不做
- 🆕 **议题 · 网络监听 cleanup**（FU-150-NETWORK-LISTENER-CLEANUP）：wx.offNetworkStatusChange 是否支持 · 若支持 · stopScheduler 应清理 · MVP 简化不做
- 🆕 **议题 · sync 状态 UI 反馈**：当前 silent · 用户感知不到"正在同步"· Sprint-4+ 评估加 toast / 顶部条 · 但 PRD 是"离线优先静默"· 需产品评估
- 🆕 **议题 · conflict UI 触发条件具备**（FU-103-CONFLICT-MERGE-UI · COSTRA-151）：150 + 154 落地后 push 真返 conflict · 可启 151

---

## §9 联合 154 + 150 实测路径（D-024 §2.2 C1 攒批触发）

154 + 150 双卡 R1 APPROVE 后落 `docs/qa/sprint-3-batch-human-smoke.md`（D-024 §2.4 命名规范）：

**前置（一次 setup）**：
- server 启动 · DB migrate
- client 切真链路（env.ts mockLogin: false）

**步骤合并清单（预计 6~8 步）**：

| # | 步骤 | 验 154 | 验 150 |
|---|---|---|---|
| 1 | 冷启 client → 自动触发 syncOnce launch | — | ✅ Console `[sync] ok ... trigger=launch` |
| 2 | DevTools Network 看 `GET /v1/sync/pull?family_id=...&since=epoch` 200 | ✅ pull 200 | ✅ scheduler 调 |
| 3 | 写一笔 entry → outbox → 自动 push → next sync 应 pull 回来同样 entry | — | ✅ pushDelta+syncPull 闭环 |
| 4 | 杀 client + 重启 → watermark 持久 + pull 增量 | — | ✅ watermark 持久 |
| 5 | 切 Network Offline → 写一笔 → 切 Online → onNetworkStatusChange 触发 sync | — | ✅ trigger=network-recover |
| 6 | home/mine 切换 5s 内 → debounce 不重叠 | — | ✅ trigger=page-show 仅 1 次 |
| 7 | 验软删行 pull 回来 + client 本地 markDeleted | ✅ §3.5 协议 | ✅ applyServerChanges 处理软删 |
| 8 | 105 H6 + D.2 自动等效回归（手册 §4.2 D2.1~D2.4 全 PASS）| ✅ pull 200 + watermark + entries | ✅ client applyServerChanges |

→ 双 approve：`approve:COSTRA-154 + approve:COSTRA-150`（D-024 联合范式 · 105+156 + 157+158 三连先例）

---

_本档由 Orchestrator 在 2026-05-19 15:05 落盘 · Sprint-3 头部第 2 张 · 与 COSTRA-154 联动落档 · spawn 严格依赖 154 R1 APPROVE_
