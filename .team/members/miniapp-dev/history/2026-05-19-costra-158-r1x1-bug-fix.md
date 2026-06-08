# COSTRA-158 R1.x.1 P0 BUG 修复 · history

> task_type: fix
> card: COSTRA-158 R1.x.1
> commit: 99e3794
> date: 2026-05-19

---

## 1 任务描述

修复 COSTRA-158 R1 实装（commit `c7ea7f7`）引入的 P0 BUG：`updateLocalUserProfile` 使用 `wx.setStorageSync` 写裸对象到 storage，破坏 `storage.ts` envelope `{v, t, d}` 一致性。重启后 `initAuth` → `getItem` 读 envelope 时 `env.d` 为 `undefined`，导致用户重启即被登出。

缺陷单：`qa/defects/2026-05-19-COSTRA-158-storage-envelope-drift.md`

## 2 产出

| 文件 | 改动 |
|---|---|
| `miniprogram/services/auth.ts` | L257-274 `updateLocalUserProfile` 改 async + `await setItem<TokenStored>` 替代 `wx.setStorageSync` |
| `miniprogram/pages/login/index.ts` | L83 调用处加 `await` |
| `miniprogram/services/auth.spec.ts` | 测适配（async + setItem mock）+ 新增重启回读测试 |

净改行：+64 -20（3 文件）

## 3 关键决策

- **选 option 1**（缺陷单 §3.1 推荐）：改 async + setItem · 与 initAuth/doWxLogin/refreshToken 写入路径一致 · 非 option 2（改 getItem 兜底裸对象 · 破坏抽象）
- **测试策略**：顶层 `vi.mock('./storage')` + 共享 `storageMap` · setItem 写 envelope `{v,t,d}` · getItem 返回 `env.d` · 完整模拟真实 storage envelope 行为
- **反向验证**：临时 revert → 新测试 FAIL（`wx is not defined` + `undefined not Promise`）→ revert back → PASS

## 4 遗留

- **P0 无**：BUG 修复完整 · envelope 一致性恢复
- **P2 观察**：`outbox.spec.ts` L102 时序 flaky test（`next_retry_at > Date.now()` 竞态 · 非本次引入 · 已知问题）
- 等 Human 重新清缓存 + 干净环境跑实测

## 5 state.md diff

- §2 active tasks：`COSTRA-158 R1 · 等 review-tech R1` → `COSTRA-158 R1.x.1 BUG fix 已交付 · 等 Human 重新实测`
- §3 交付历史：追加 R1.x.1 条目
- §7 时间戳：追加 `2026-05-19T19:28:00+08:00`
