# backend-dev · 2026-05-11 · COSTRA-104 R1 实装（含 R1.1 + R1.2 残留修复）

## §1 三证（D-021 v3）

```
git log --oneline -5
e00afbb docs(repo): costra-103 human t1 approved closed (sprint-2 主线主头收官)
f125f05 docs(qa): costra-103 human-verify v1.1 + 2 follow-ups (scope gap)
3a8623b chore(repo): costra-103 round-1-tech review report (approve 38/40)
561e884 chore(repo): costra-103 backlog title sync (p1-1) + d-017 step2 diagnosis
c8b6c06 chore(repo): miniapp-dev state/history closure for costra-103 r1 (COSTRA-103)

git ls-files server/src/routes/ server/src/services/ server/src/repositories/
server/src/repositories/sessionRepo.ts
server/src/repositories/userRepo.ts
server/src/routes/auth.ts
server/src/routes/healthz.ts
server/src/services/authService.ts

git status -s（R1 起点）
（clean · 工作树空）
```

## §2 7 项交付（实测行数 · ~ 1498 行）

| 文件 | 类型 | 行数 |
|---|---|---|
| `server/src/routes/sync.ts` | new | 244 |
| `server/src/routes/entries.ts` | new | 192 |
| `server/src/services/entryService.ts` | new | 235 |
| `server/src/services/idempotencyService.ts` | new | 124 |
| `server/src/repositories/entryRepo.ts` | new | 296 |
| `server/test/sync.test.ts` | new | 164 |
| `server/test/entries.test.ts` | new | 181 |
| `server/api/openapi.yaml` | edit | +14（3 处 x-deferred）|
| `server/src/app.ts` | edit | +6（注册新路由）|
| `server/test/setup.ts` | edit | +61（pg-mem mock 增强 · R1.2 修测时增加）|

合计：1436 行新代码 + 81 行编辑 = 1517 行净增。

## §3 6 闸门

- typecheck ✅ 0 错（R1.2 修了 entries.ts:134 await parseUserId 漏 await）
- test ✅ **19/19 全绿**（R1 5 fail · R1.1 反向退化 6 fail · R1.2 全修复）
- lint ✅ exit 0（COSTRA-117 deferred）
- `grep -c x-deferred server/api/openapi.yaml` = **3** ✅
- `grep -c deferred_card server/src/routes/{entries,sync}.ts` ≥ **3** ✅
- 跨域 diff `git diff --name-only HEAD -- miniprogram/ docs/api/ server/db/migrations/` = **空** ✅

## §4 协议对齐自检

- payload 100% snake_case：`grep amountCents/categoryId/occurredAt server/src/` = 0 命中 ✅
- entity 枚举 ∈ {entry, category, budget}：sync.ts:91 严格匹配 ✅
- 三种 ID 不混：`client_ref_id`（client）/ `server_id` uuidv7（server）/ `idempotency-key` 头（24h 缓存）✅
- ErrorCode 全用枚举：`grep "throw new Error\(" server/src/routes/sync.ts entries.ts entryService.ts` = 0 命中 ✅
- stub 路由不静默：error 含 `deferred_card + followup_id` 字段 ✅

## §5 D-022 v2.0 第 2 次实战准备 + Human curl 实测前置

- runtime 类判定：**非微信 SDK runtime**（Card-Review 已确认）· 但 client/server 协议联调 = **D-022 §4.2 等效 runtime** · 必须 Human curl 实测前置
- Human curl 手册：`docs/qa/costra-104-curl-verify.md`（v1.0 · 5 步 + 3 硬断言）
- review-tech R1 拉起后 → Human 跑 curl 5 步 → T1 终审

## §6 R1 / R1.1 / R1.2 残留修复记录（D-016 反例第 5 次教训）

- **R1（53 tool uses · 305s）**：落盘 7 主文件 · typecheck **3 错** / test **5 fail** / **0 commit**
  - typecheck 错：sync.ts:102 类型断言 / entryService.ts:27,208 ListEntryResult 找不到
  - test fail：entries.test PATCH/DELETE stub 401/400 · sync.test 4 个 401（jwt preHandler 顺序）
- **R1.1（53 tool uses · 463s）**：修了 typecheck 2 错 + 改坏 1（async parseUserId 忘 await） · test **反向退化 6 fail** / **0 commit**（D-016 反例第 4 次）
- **R1.2（180 tool uses · 2767s · 71 credits）**：修最后 typecheck + 6 test fail · 19/19 全绿 · 但 state/history/commit 仍未做（D-016 反例第 5 次） · **Orchestrator 接管收尾**
- **教训**：装扮 subagent 7 点卡 · context 窗口压力大 · 单次实装+commit+state/history 任务过大 · 多次失败模式：闸门做完但 commit/state 漏 · Sprint-2 末 Retro 议题：**装扮档 6+ 点卡需在 R1 内分阶段 commit · 不能等到全部完工才 commit**
- **范式延续**：同 COSTRA-103 R1.3 由 Orchestrator 协助元数据落盘（FU/backlog/curl-verify/state/history）但守住"业务代码必须 subagent 写"边界 · D-018 §3.5 越权例外路径首次合规

---

**SBAI v1.1 第 8 次冒烟成功**（代码层 · D-022 v2.0 第 2 次实战准备完成）· **backend-dev 首次实战收口**（Sprint-2 第 3 张主线 · 总耗时 ~ 60 min · 远超 dispatch §8 时间预算 ≤ 150 min · 因 R1.1 反向退化 + R1.2 修复体量超预期）。
