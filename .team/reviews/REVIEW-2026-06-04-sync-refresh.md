# Review · sync-refresh-mechanism · 2026-06-04

**Reviewer**: card-reviewer-tech (SBAI v1.1 · D-018)
**Date**: 2026-06-04
**Scope**: 11 个文件 · sync-refresh 机制改造（无独立卡号 · 验收回归修复）
**Verdict**: ✅ **PASS-WITH-NIT** · 无 Blocker / Major

---

## 改动总览

目的：解决「打开小程序明细页不主动刷新」+「periodic sync 后明细页不刷新」两个验收问题，建立统一的 sync 完成事件机制。

### 文件清单

- `miniprogram/services/eventBus.ts` — 新增 `EventNames.SYNC_DONE` + `SyncDonePayload`
- `miniprogram/services/syncScheduler.ts` — `syncOnce` 在 `pushed>0||pulled>0` 时 emit；`startScheduler(ready?: Promise<void>)` 取代 `setTimeout(500ms)`
- `miniprogram/services/syncScheduler.spec.ts` — 新增 T9~T15 共 7 个测试
- `miniprogram/pages/ledger/index.ts` — 订阅 SYNC_DONE + `_refreshIfChanged` 签名 diff；`onShow` 补 `triggerOnPageShow('ledger')`
- `miniprogram/pages/family/index.ts` — 订阅 SYNC_DONE + invalidateCache + 重拉 summary
- `miniprogram/pages/statistics/index.ts` — 订阅 SYNC_DONE 预留桩
- `miniprogram/app.ts` — `startScheduler(this.bootstrapPromise)`
- `miniprogram/app.json` + `miniprogram/pages/home/` — 删除废弃 home 页
- `miniprogram/README.md` — 标记 home 行废弃
- `.team/follow-ups/FU-SUMMARY-PERF.md` — 后端聚合性能 follow-up

---

## 7 维度审查结论

| 维度 | 结论 |
|---|---|
| 1. 事件机制设计合理性 | ✅ PASS |
| 2. 订阅生命周期完整性 | ✅ PASS |
| 3. ledger 签名 diff 正确性 | ✅ PASS |
| 4. family 缓存失效顺序 | ✅ PASS |
| 5. launch sync 时序 | ✅ PASS |
| 6. 测试覆盖度 | ✅ PASS |
| 7. 其他风险（内存泄漏 / 死循环 / 兼容性） | ✅ PASS |

---

## Issue 汇总与跟进

| 级别 | ID | 描述 | 处理 |
|---|---|---|---|
| Minor | M-1 | `conflicts>0/rejected>0` 未触发 SYNC_DONE | **未处理** · 当前无 conflict UI 路径，conflict 告警 UI 实装时再补；登记到本 review 后续追踪 |
| Minor | M-2 | `_refreshIfChanged` 账本切换路径未显式说明 | ✅ **已修复**：在 `_refreshIfChanged` 上方补充注释，明确切账本路径无残留旧数据风险 |
| Minor | M-3 | family `_onSyncDone` 与 `_loadingPromise` 并发可能 loading 闪烁 | ✅ **已修复**：在 `_onSyncDone` 开头增加 `if (this._loadingPromise) return` guard |
| Nit | N-1 | statistics `_syncDoneHandler` null 初始化略冗余 | **保留**：与 ledger/family 三页面统一签名（防御性编程一致），不改 |
| Nit | N-2 | 缺 `pushed>0 && pulled>0` 同时非零的测试 | ✅ **已修复**：新增 T15 测试用例 |

---

## 架构合规性

- ✅ 无主体字样硬编码（D-008）
- ✅ 无 secret / 密钥
- ✅ miniapp 改动未越权到 `server/`
- ✅ 事件名常量化
- ✅ `void` 修饰异步调用
- ✅ FU 登记规范

---

## 验证基线

- ✅ `npm run typecheck` 0 error
- ✅ `npm run lint` 0 error，3 warning（全部为本次改动之前已存在的 unused-import）
- ✅ `npm test -- --run` 11 files / 105 tests 全 pass（含本次新增 T9-T15）
- ✅ `npm run check:appjson` 13 pages matched，tabBar main-package 5/5 pass

---

## 最终结论

> 这是一次**设计清晰、执行严谨**的改动。事件机制引入统一 SYNC_DONE 替代分散的手动刷新，消除了两个已知验收问题；bootstrap Promise 门控取代 setTimeout 的改进消除了首屏时序竞争。
>
> Reviewer 提出的 3 项可立即落地的改进（M-2 / M-3 / N-2）已在本次合并前一并处理；M-1 因依赖未来 conflict UI 实装暂保留观察。
>
> **可直接进入 Human Review。**
