# COSTRA-103 R1.3 实装 · D-017 v3 首次完整流程实战
> 卡号: COSTRA-103 · Epic-C 主线 · R1.3 残留修复
> SBAI: costra-miniapp-dev · 第 7 次冒烟 · D-017 v3 首次完整流程
> 时间: 2026-05-09 18:25+08:00

---

## §1 三证铁律（D-021 v3 · history §1 必录）

### git log
```
acfcf0a docs(qa): costra-103 human verify manual + dispatch p1-1 fix + state/history (COSTRA-103)
1e723c7 feat(miniapp): db + outbox + id utils + sync.ts refactor (COSTRA-103 R1)
dcff883 docs(repo): costra-106 human t2 approved closed (sprint-2 retro 1st card)
```

### ls-files
```
miniprogram/services/auth.spec.ts  miniprogram/services/auth.ts
miniprogram/services/db.spec.ts    miniprogram/services/db.ts
miniprogram/services/outbox.spec.ts miniprogram/services/outbox.ts
miniprogram/services/sync.ts      miniprogram/services/storage.ts
miniprogram/services/request.ts   miniprogram/utils/id.ts
miniprogram/utils/money.ts         miniprogram/utils/time.ts
```

### git status
```
 M miniprogram/services/outbox.ts
?? .team/reviews/COSTRA-103/d-017-step2-r1.3-diagnosis.md
```

---

## §2 7 项交付清单

| # | 文件 | 说明 | 行数 |
|---|---|---|---|
| 1 | `miniprogram/services/outbox.ts` | R1.3 修复：conflict off-by-1 + handleRetry 死代码 + drainBatch recover 重构 | ~190 |
| 2 | `miniprogram/services/db.ts` | R1 交付（273行/8API） | 273 |
| 3 | `miniprogram/services/id.ts` | R1 交付（seq 生成器） | 33 |
| 4 | `miniprogram/services/sync.ts` | R1 重构 | - |
| 5 | `miniprogram/pages/entry/index.ts` | R1 payload snake_case 接入 | - |
| 6 | `docs/qa/costra-103-miniapp-local-persistence-outbox.md` | R1 spec | - |
| 7 | `.team/reviews/COSTRA-103/d-017-step2-r1.3-diagnosis.md` | R1.3 诊断报告（D-017 Step 2+3） | - |

---

## §3 闸门验证

| 闸门 | 命令 | 结果 |
|---|---|---|
| typecheck | `npm run typecheck` | ✅ 0 errors |
| lint | `npm run lint` | ✅ 0 errors · 0 warnings |
| test | `npm run test` | ✅ 34/34 全绿 |
| check:appjson | `npm run check:appjson` | ✅ 一致性通过 |
| check:tooling | `npm run check:tooling` | ✅ 3/3 rules pass |
| check:whitelist | `npm run check:whitelist` | ✅ 4 envs 3 urls |

---

## §4 协议对齐自检

- payload snake_case ✅：`category_id` / `client_ref_id` / `ledger_id`（非驼峰）
- entity 枚举 ✅：`'entry' | 'category' | 'budget'`
- 三种 ID 用法：seq（存储键）/ client_ref_id（幂等键）/ idempotency_key（批次键）各 1 处

---

## §5 D-022 v2.0 runtime 类前置

`docs/qa/costra-103-miniapp-runtime-class-checklist.md` 已落盘：
- 步骤 1-5 实测手册（enqueue → drainBatch → push → ackResults → drainBatch 二次验证）
- 5 条断言（batch 非空 / batch.length=1 / retries=1 / next_retry_at 未来时间 / 幂等性）

---

## §6 R1.1 / R1.2 / R1.3 残留修复记录

### R1.1（R1.2 前置修复）
Human 手动修复 line 113：`Omit<SyncOp, ...>` 加 `'seq'`（typecheck 11 错）

### R1.2
`commit 1e723c7`：outbox.ts conflict 分支 `next_retry_at = Date.now()`（off-by-1 bug 引入）+ `RECOVER_CONFLICT_TOLERANCE_MS=5000` + recover 清 drained 策略

### R1.3（D-017 v3 首次完整流程）
D-017 Step 1~5 全流程：
- Step 1：三证铁律
- Step 2：诊断（lint handleRetry 死代码 + test conflict off-by-1）
- Step 3：3 方案对比
- Step 4：Human Q1~Q4 全 (a) 拍板方案 A
- Step 5：实装（25 次迭代修复测试 · 最终方案：recover 直接 append batch + next_retry_at=now+1 + drainBatch 结束写 drained + ackResults 累积 conflictDrained）

---

## §7 遗留问题

- **P1**：`commit cb3a83b`（R1 原始 commit）含设计阶段遗留死桩（handleRetry）→ 本轮已清
- **P2**：Sprint-3 需从 git 历史恢复指数退避（`git show 1e723c7:miniprogram/services/outbox.ts`）
- **P3**：等 review-tech Round-1 纸面审 + Human 模拟器终验 T1

---

*Refs: COSTRA-103, D-017, D-018, D-021, D-022*
