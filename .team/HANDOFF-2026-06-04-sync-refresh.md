# Costra · 2026-06-04 sync-refresh 机制改造与下一会话交接

> 生成时间：2026-06-04 17:08
> 交接目标：新对话继续 Costra 项目时，先读本文件，再检查 `git status --short`。
> 当前分支：`dev`
> 上一份 handoff：`.team/HANDOFF-2026-06-02-acceptance-verified.md`

---

## 1. 本次会话背景

Human 在 2026-06-02 验收通过后的二次手测中发现两个数据刷新缺陷：

1. **打开小程序时，明细页不会主动更新**——必须切到其他 tab 再切回明细才会显示新数据。
2. **periodic sync（60s 周期）拉到新数据后，明细页也不会立刻刷新**。

经讨论确认根因为同一缺陷：`syncOnce` 完成后**没有任何事件通知 UI 层**，所有页面只能依赖 `onShow` 生命周期被动重读 storage / API。

本会话即针对该缺陷展开**统一的 sync 完成事件机制**改造，覆盖明细 / 协作 / 统计三个 tab 页。

---

## 2. 本轮已完成内容

### 2.1 核心机制：SYNC_DONE 事件

**`miniprogram/services/eventBus.ts`**
- 新增 `EventNames.SYNC_DONE = 'sync-done'`
- 新增导出接口 `SyncDonePayload { pulled, pushed, trigger }`

**`miniprogram/services/syncScheduler.ts`**
- `syncOnce` 在 `pushResult.pushed > 0 || pulled > 0` 时通过 `eventBus.emit(EventNames.SYNC_DONE, payload)` 广播事件
- 仅在有数据变化时 emit，避免空 sync（最常见的 periodic 心跳）触发无意义 UI 刷新

### 2.2 启动时序优化

**`miniprogram/services/syncScheduler.ts` + `miniprogram/app.ts`**
- `startScheduler` 改为接受可选 `ready: Promise<void>` 参数
- 取消原 `setTimeout(syncOnce, 500)` 固定延迟猜测 bootstrap 完成时间
- 改为 `ready.then(launchSync, launchSync)`：bootstrap resolve 或 reject 都触发 launch sync
- `app.ts.onLaunch` 中 `startScheduler(this.bootstrapPromise)` 衔接

收益：
- 时序竞争完全消除（旧方案在低端设备 bootstrap 慢时可能在未登录状态触发 sync）
- 首屏新数据到达更快（bootstrap 完成即同步，无需额外等待）

### 2.3 三个 tab 页订阅刷新

| 页面 | 订阅后动作 |
|---|---|
| `pages/ledger` | `pulled > 0` 时调 `_refreshIfChanged` · 计算 entries 签名（client_ref_id/version/occurred_at/amount/type/category_id/note/deleted_at/shared_type/created_by），与 `_entriesSignature` 比对，无差异跳过 setData |
| `pages/family` | `pushed/pulled` 任一非零时 `invalidateFamilyCache` + 重拉 `_loadSummary`（绕过 SWR stale 渲染） · 增加 `_loadingPromise` guard 避免与 `_doLoadPage` 并发导致 loading 闪烁 |
| `pages/statistics` | 骨架页面预留订阅桩（仅 `console.log`），待统计图表实装后补 `_loadStatistics` |

三个页面均：
- `onLoad` 订阅 SYNC_DONE
- `onUnload` 取消订阅（防内存泄漏）

**ledger 还修复了**：`onShow` 末尾补 `triggerOnPageShow('ledger')`——之前唯独 ledger 没有调用，与 statistics/family/mine 不一致。

### 2.4 即时刷新 + diff 防跳动

按 Human 确认方案：
- 不引入 dirty 标记延迟，sync 完成立即刷新（数据准确性优先）
- 通过签名 diff 在底层数据没变时跳过 `setData`，避免列表跳动

### 2.5 清理废弃 home 页

- 删除 `miniprogram/pages/home/` 目录全部 5 个文件（含 spec）
- `miniprogram/app.json` 移除 `pages/home/index` 注册（`pages` 数从 14 → 13）
- `miniprogram/README.md` 标记 home 行废弃
- `npm run check:appjson` 通过：13 pages matched，tabBar main-package 5/5 pass

### 2.6 单元测试

**`miniprogram/services/syncScheduler.spec.ts`** 新增 7 个用例（T9~T15）：

| 用例 | 覆盖 |
|---|---|
| T9 | `pulled > 0` → emit SYNC_DONE 且 payload 字段正确 |
| T10 | `pushed > 0` → emit SYNC_DONE 且 payload 字段正确 |
| T11 | `pushed=0 && pulled=0` → 不 emit |
| T12 | 5xx 失败路径 → 不 emit |
| T13 | `startScheduler(ready)` 在 ready resolve 后才触发 launch sync |
| T14 | `startScheduler(ready)` 在 ready reject 时仍兜底触发 launch sync |
| T15 | `pushed > 0 && pulled > 0` 同时非零时 payload 正确携带两个值（reviewer Nit-2） |

T7 同步更新：从「launch 触发等 500ms」改为「flush microtasks 即可」。

### 2.7 Follow-up 登记

新增 `.team/follow-ups/FU-SUMMARY-PERF.md`：

后端 `getFamilySummary` 直接做 PG 实时聚合，无后端缓存。本次 sync-refresh 上线后 family 页重拉频次会上升（粗略 ×2~3），登记触发条件 + 候选方案（Redis / 物化视图 / 预聚合表）+ 优先级 P3，待用户量级达到阈值后启动评估。

### 2.8 技术审查

调用 `costra-card-reviewer-tech` subagent 完成 G3 风格审查，纪要落盘 `.team/reviews/REVIEW-2026-06-04-sync-refresh.md`：

- **总体判定**：✅ PASS-WITH-NIT · 无 Blocker / Major
- **Issue**：3 Minor + 2 Nit
  - **已处理**（合并前修复）：M-2 加注释说明账本切换路径 / M-3 family 加 `_loadingPromise` guard / N-2 补 T15 测试
  - **保留**：M-1（conflicts/rejected 未触发 SYNC_DONE，依赖未来 conflict UI 实装）/ N-1（防御性 null 初始化）

---

## 3. 涉及文件清单

### Modify

```text
miniprogram/services/eventBus.ts                  # +SYNC_DONE / +SyncDonePayload
miniprogram/services/syncScheduler.ts             # emit SYNC_DONE / startScheduler(ready?)
miniprogram/services/syncScheduler.spec.ts        # +T9~T15 / 修 T7
miniprogram/pages/ledger/index.ts                 # 订阅 + diff + onShow triggerOnPageShow
miniprogram/pages/family/index.ts                 # 订阅 + invalidateCache + 重拉 summary
miniprogram/pages/statistics/index.ts             # 订阅桩
miniprogram/app.ts                                # startScheduler(this.bootstrapPromise)
miniprogram/app.json                              # 移除 pages/home/index
miniprogram/README.md                             # 标记 home 行废弃
```

### Delete

```text
miniprogram/pages/home/index.ts
miniprogram/pages/home/index.wxml
miniprogram/pages/home/index.wxss
miniprogram/pages/home/index.json
miniprogram/pages/home/index.spec.ts
miniprogram/pages/home/                           # 空目录一并 rmdir
```

### Add

```text
.team/follow-ups/FU-SUMMARY-PERF.md
.team/reviews/REVIEW-2026-06-04-sync-refresh.md
.team/HANDOFF-2026-06-04-sync-refresh.md          # 本文件
```

---

## 4. 验证结果

```text
npm run typecheck      → 0 error
npm run lint           → 0 error · 3 warning（全部为本次改动之前已存在的 unused-import）
npm test -- --run      → 11 files / 105 tests 全 pass（之前 104，+T15）
npm run check:appjson  → 13 pages matched · tabBar main-package 5/5 pass
```

---

## 5. 待 Human 验证（建议复测项）

按 Human 提出的两个原始问题进行回归：

1. **冷启动场景**：杀死小程序进程 → 重新打开，明细页是否在 1~2 秒内自动显示最新数据？
   - 预期：是。bootstrap 完成立即触发 launch sync，pulled > 0 时即时刷新。

2. **periodic sync 场景**：保持明细页停留 60s+，配偶在另一台设备记一笔账，等下一次 periodic sync（最长 60s 内），明细页是否自动出现新记录？
   - 预期：是。periodic 触发 sync，pulled > 0 时 emit SYNC_DONE，签名变化触发 setData。

3. **协作页同步**：在协作页停留 → 自己记一笔账 → 等 mutation sync 完成（2s debounce 后），协作页 summary 是否自动更新？
   - 预期：是。push 成功后 emit SYNC_DONE，invalidateCache + 重拉 summary。

4. **跳动控制**：明细页停留 → 触发空 sync（无新数据）→ 列表是否保持稳定不刷新？
   - 预期：是。`pulled === 0` 不 emit；即使 emit 后签名相同也跳过 setData。

5. **首屏数据到达速度**：与之前对比，是否能感觉到首屏新数据出现更快？
   - 预期：是。原本固定等 500ms，现在 bootstrap 完成（实测通常 < 200ms）即同步。

---

## 6. 已识别但未在本次处理的事项

- **M-1（Minor）**：`syncOnce` 在 `conflicts > 0 || rejected > 0` 但 `pushed=0 && pulled=0` 时不会 emit SYNC_DONE。当前没有 conflict UI 路径（dead-letter 仅 console.error 告警），不构成功能回归。后续如果要做 conflict 告警 UI，需要在 `syncScheduler.ts` 中扩展 emit 条件或新增独立事件（如 `SYNC_CONFLICT`）。
- **FU-SUMMARY-PERF**：后端 family summary 聚合性能优化，触发条件 + 候选方案见 `.team/follow-ups/FU-SUMMARY-PERF.md`，优先级 P3。

---

## 7. 下一会话建议起步

1. 读本 handoff + `git status --short`
2. 若 Human 复测发现新问题：进入对话讨论 → plan_create → 单独修复
3. 若 Human 复测通过：可继续推进现有 backlog（参见 `.team/board.md` / `.team/sprints/`）

---

## 8. 关键设计决策（供后续维护参考）

### 决策 1：单一 SYNC_DONE 事件 vs. 拆分 PULL/PUSH

选择**单一事件 + payload 区分**。理由：
- 订阅方按需过滤即可（ledger 看 pulled，family 看 pushed||pulled）
- 扩展性好：未来若有 conflicts/rejected 等新维度，扩展 payload 字段即可，订阅方 API 不变
- 避免事件爆炸

### 决策 2：即时刷新 vs. dirty 标记延迟

选择**即时刷新**。理由：
- 记账 App 数据准确性是核心体验，不接受用户看到残留旧数据
- 单月几十~几百条 entry 的 `_loadEntries` 不是性能瓶颈（< 1ms 实测）
- "跳动"问题通过签名 diff 解决，不需要引入 dirty 标记的额外复杂度

### 决策 3：签名 diff 选取字段

选择拼接字符串 `client_ref_id|version|occurred_at|amount|type|category_id|note|deleted_at|shared_type|created_by`。
- 覆盖所有影响视觉的字段
- O(n) 复杂度，单月几十~几百条 < 1ms
- 不做深 JSON 比对（开销大、误差小）；不做局部 diff（复杂度收益不匹配，签名一致直接跳过、不一致全量 setData）

### 决策 4：launch sync 取消固定 500ms

选择 **bootstrap Promise 门控**，`ready.then(launchSync, launchSync)`。
- 既能等 bootstrap 完成（消除时序竞争）
- 又不被固定延迟拖慢首屏（bootstrap 通常 < 200ms）
- bootstrap reject 也兜底触发，由 `syncOnce` 内部 `isLoggedIn()` guard 优雅跳过

---

> 本文件即为下一会话起点。Human 复测通过后即可关闭本轮验收回归。
