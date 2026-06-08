# Card Review · Tech · COSTRA-150 · Round 1

> **审查时间**：2026-05-20 11:25
> **审查 subagent**：`card-reviewer-tech-COSTRA-150-r1`（一次性装扮 · D-018 SBAI v1.1）
> **派单档**：`.team/dispatch/COSTRA-150-client-sync-scheduler.md`
> **依据**：SOP-CARD-REVIEW C1~C8 30 分制 + D-025 反模式扫描清单（第 2 次套用）+ D-022 v2.0 runtime 类 T2 卡铁律

---

## 总评

- **Verdict**：`REVISE`
- **总分**：21/30
- **阻塞点**：3 P0 + 2 P1 + 2 P2
- **D-025 反模式扫描**：AP-001 ☐ / AP-002 ☐ / AP-003 ☑ 隐性漂移（P1 级 · 与 P0-1 联动 · 不额外升分）

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 5/5 | 4 触发源具名清晰 · 3 段触发链 + PRD/契约锚点 + D-022 runtime T2 预声明完整 |
| C2 DoD 可度量 | 4/6 | 17 项 DoD + 6 闸门 + 3 反向验证结构完备 · 但缺 G15 D-016 反例预防（与 154 R1 P0-2 同款） |
| C3 依赖识别 | 5/5 | 上游 103/104/126/127/154 + 下游 FU-103/105-H6/151 + 决策类 D-022/024 完整 |
| C4 产出物具体 | 2/5 | A 项示例代码 5 处与现状 API 签名不一致 · §2.1 末尾"特别说明"段仅笼统免责 |
| C5 风险与边界 | 2/4 | 失败处理三档完整 · 但 family_id 来源未拍板（`family.ts` 不存在）· `getValidToken` 不存在 · runtime 实测断言清单缺 |
| C6 去重 | 3/3 | 与 103/154/151 职责清晰 · FU-103-CLIENT-SYNC-SCHEDULER 唯一来源 |
| C7 估点 | 2/2 | 5 点 INVEST small · 时间盒 240min 合理 |
| C8 红线 | Pass | 无 Won't-Have / 主体 / secret / 目录越权违反 |

---

## P0 阻塞点（必修）

### P0-1 · A 项示例代码引用 5 处不存在/签名错误的 API

**5 处不一致**（基于现状文件 grep 验证）：

| # | dispatch 用法 | 现状事实 | 修复方向 |
|---|---|---|---|
| 1 | `outbox.flushPending(token)` | outbox.ts 无 flushPending · 实际是 drainBatch + ackResults · 已封装为 sync.ts L74 `pushDelta()` | 改 `await pushDelta()`（from sync.ts）|
| 2 | `auth.getValidToken()` async | auth.ts 无 getValidToken · 实际 `getToken(): Token \| null` 同步 + `isLoggedIn()` 同步 | 改同步 `getToken()` + `isLoggedIn()` |
| 3 | `import { getCurrentFamilyId } from './family.js'` | `family.ts` **不存在** · miniprogram 全局无 active_family_id 概念 | inline 实现 storage 读取 `__costra_family_id_v1` · 留 FU-150-FAMILY-CONTEXT-SERVICE |
| 4 | `request.get<T>(path, query)` 链式 | request.ts 是 RPC 风格 `request<T>({method, path, query})` | 改 RPC 风格 · 参 sync.ts L48-56 |
| 5 | `db.getWatermark` 假设返 `string \| null` + `?? '1970-...'` | 现状 db.ts L267-268 返 `Promise<string>` 默认 epoch（已兜底） | 删冗余 `??` 或改用 sync.ts.syncPull 内部封装 |

**关键洞察（与 P1-1 联动）**：sync.ts 已封装 `pushDelta()` + `syncPull(familyId)` 全链路 · syncScheduler 应只做调度（mutex/debounce/触发源）+ 调用这两个函数 · 不重写 request 调用。这一改可一次性消除 5 处不一致中的 4 处。

**修复方案**：A 项示例代码改为基于 sync.ts 封装：
```ts
import { syncPull, pushDelta } from './sync.js';
import { getToken, isLoggedIn } from './auth.js';
import { getItem } from './storage.js';

async function getActiveFamilyId(): Promise<string | null> {
  const env = await getItem<string>('__costra_family_id_v1');
  return env || null;  // FU-150-FAMILY-CONTEXT-SERVICE 待 Sprint-3+ 完善
}

export async function syncOnce(trigger: TriggerSource): Promise<SyncResult | null> {
  if (isRunning) return null;
  isRunning = true;
  try {
    if (!isLoggedIn()) return null;          // 同步检查
    const familyId = await getActiveFamilyId();
    if (!familyId) return null;
    const pushResult = await pushDelta();    // 已封装 drainBatch+POST/sync/push+ackResults
    const pullResult = await syncPull(familyId);  // 已封装 watermark+request+applyChanges+setWatermark
    return { pushed: pushResult.pushed, pulled: pullResult.changes.entries?.length || 0,
             watermark: pullResult.watermark, trigger };
  } catch (e: any) {
    console.warn(`[sync] fail · ${e?.code || 'unknown'} (trigger=${trigger})`);
    return null;
  } finally {
    isRunning = false;
  }
}
```

### P0-2 · DoD 缺 G15 D-016 反例预防（154 R1 P0-2 同款 · 第 4 次卡审强约束）

**证据**：156/158/154 卡审均含 G15 · 150 dispatch §3.2 闸门表无。Sprint-2 末 Retro 议题 21 已立 D-016 v2.0 升定稿规约。

**修复**：§3.2 闸门表追加 `| G15 | D-016 反例预防 | git status -s | grep '.team/members/' | wc -l | = 0 |` · §5.5 加 commit 前自检要求。

### P0-3 · D 项 entry 页不存在 onShow · 无法直接接入

**证据**：grep `miniprogram/pages/entry/index.ts` 无 onShow/onLoad 调用 · entry 是 navigateTo 子页（home L118 跳入）· 非 tabBar 页。

**修复**：D 项明确 home/mine 二页（删 entry）· DoD D 项同步改为"home/mine 二页"。

---

## P1 应改

### P1-1 · 调度器应直接复用 sync.ts 已封装（与 P0-1 联动）

A 项示例代码当前重写 200 行 sync 逻辑 · 与 sync.ts L43-67/L74-103 已封装重复 · 维护两处易漂移。改为复用后调度器降到 ~120 行 · 一次解决 P0-1 中 4/5 项 + P2-2 冗余。

### P1-2 · D-022 §4.1 runtime T2 卡缺 Human 实测断言清单

dispatch §1.2 明确"runtime 类 T2 卡" · 但 §3 DoD 无 D-022 §3.2 格式的 ≥ 5 条断言（A~E）。

**修复**：§3 加 §3.5 runtime 实测断言清单：
- A：Console 无 `[sync] fail` 以外 error/warn
- B：冷启 Console `[sync] ok ... trigger=launch`
- C：home/mine 切换 Console `trigger=page-show`（5s 内仅 1 次）
- D：Offline → 写一笔 → Online → `trigger=network-recover`
- E：水印持久化（杀进程重启 → pull 增量而非全量）

---

## P2 建议

### P2-1 · B 项 watermark 接口描述应明确"确认现有"

dispatch B 项写"确认或新增"· 现状 db.ts L267-273 已全有 · 改"确认现有满足"。

### P2-2 · request 自动 401 续签已内置（request.ts L105-119）· 调度器不需自行 catch 401

dispatch §1 失败处理"401 → 调 auth.refresh" · 实际 request.ts 已自动 refresh+retry · syncOnce 只 catch 最终 401 即可（已 fall through 到通用 catch）。

---

## §4 D-025 反模式扫描

| ID | 命中 | 证据 |
|---|---|---|
| AP-001 字符串代理判定 | ☐ No | mutex/network/token 都用 boolean/事实字段 · 无字符串代理 |
| AP-002 概率极低就接受 | ☐ No | 5xx 静默是离线优先架构明确策略 · 非"概率极低就接受" |
| AP-003 契约-实装漂移 | ☑ Yes（隐性） | A 项示例代码 5 处 API 签名与现状不一致 · 属 dispatch 阶段变体 · P0-1 已覆盖修复 · 不额外升分 |

---

## §5 红线 / Won't-Have / 宪章合规

全 Pass（charter §5 不涉及 / 无 secret / D-008 主体不涉 / 工作区铁律明确）。

---

## §6 follow-up 项（R2 后参考）

1. **FU-150-FAMILY-CONTEXT-SERVICE** P2 · `__costra_family_id_v1` storage 兜底 · Sprint-3+ 抽 family.ts service
2. **FU-150-NETWORK-LISTENER-CLEANUP** P3 · wx.offNetworkStatusChange 可行性
3. **FU-150-ENTRY-PAGE-ONSHOW-SEMANTICS** P3 · 待 entry 页加 onShow 时评估

---

## §7 派单档可改进点（minor · 不阻 R1）

1. A 项注释加 ⚠️ "以下为伪代码 · R1 实装时按现状 API 调整（详见特别说明段差异表）"
2. §5.6 D-022 评分表 C2 加"401 路径由 request.ts 自动续签兜底 · syncScheduler 仅 catch 最终 401"
3. commit footer `closes: fu-103-client-sync-scheduler` → `closes: FU-103-CLIENT-SYNC-SCHEDULER`（大写 · 与 154 R2 同款）

---

## R1 启动指令

请 Orchestrator 按 P0 修订 dispatch（5 处改动 · ≤ 10 分钟）→ 同轮发起 R2 形式审 → R2 PASS 后 spawn `costra-miniapp-dev` 启 R1 实装。

预计 R2 = APPROVE 28~30/30。

---

## 自我反思

- 审核耗时 ~25 分钟
- 置信度 高（P0-1 基于 5 个文件 grep 验证 · P0-2 基于 156/158/154 三卡交叉 · P0-3 基于 entry/index.ts 全文阅读）
- 与 154 R1 同分（21/30）· 性质相同（dispatch 示例代码 vs 现状不一致）
- 无需 Human 二裁

---

**报告由 Orchestrator 接收 final message 后落档。**
