# history/2026-05-09-COSTRA-103-r1-implement.md
## COSTRA-103 R1 实装 · SBAI 第 7 次冒烟（2026-05-09）

> 卡号: COSTRA-103 · Epic-C 主线 · R1 末轮（R1.2 conflict 测修复）
> 角色: costra-miniapp-dev (D-018 SBAI v1.1) · 第 7 次冒烟
> 时间: 2026-05-09 T17:30+08:00 · COB 前完成

---

## §1 任务描述

**目标**: 实现 COSTRA-103 R1（本地持久化 + outbox 重放队列）末轮 conflict 测修复 + 闸门通过 + 双 commit + state/history 收尾。

**三证输出（D-021 v3）**:
```bash
# git log
dcff883 docs(repo): costra-106 human t2 approved closed (sprint-2 retro 1st card)
03422fa chore(repo): costra-106 dispatch + card-review + round-1-product reports
9fe5430 docs(docs): sprint-1 retro + d-020/d-021/d-022 decisions + metrics rewrite
...（共 10 条 · COSTRA-103 文件不在 log 中）

# git ls-files miniprogram/services/ miniprogram/utils/
miniprogram/services/auth.spec.ts · miniprogram/services/auth.ts
miniprogram/services/env.ts · miniprogram/services/flags.ts
miniprogram/services/request.spec.ts · miniprogram/services/request.ts
miniprogram/services/storage.spec.ts · miniprogram/services/storage.ts
miniprogram/services/sync.ts
miniprogram/utils/error-mapper.ts · miniprogram/utils/money.spec.ts · miniprogram/utils/money.ts
miniprogram/utils/time.spec.ts · miniprogram/utils/time.ts
# 新增文件（untracked）:
miniprogram/services/db.spec.ts · miniprogram/services/db.ts
miniprogram/services/outbox.spec.ts · miniprogram/services/outbox.ts
miniprogram/utils/id.ts

# git status -s
M miniprogram/pages/entry/index.ts · M miniprogram/services/sync.ts
?? .team/dispatch/COSTRA-103-miniapp-local-persistence-outbox.md · .team/reviews/COSTRA-103/
?? docs/qa/costra-103-human-verify.md · miniprogram/services/db.spec.ts
?? miniprogram/services/db.ts · miniprogram/services/outbox.spec.ts
?? miniprogram/services/outbox.ts · miniprogram/utils/id.ts
```

---

## §2 产出交付清单（7 项）

| # | 文件 | 行数/说明 | 关键变更 |
|---|------|----------|---------|
| 1 | `miniprogram/services/db.ts` | 273 行 · 8 API | KV 抽象层（putEntry/getEntry/listEntries/deleteEntry/getWatermark/putWatermark + ttl）· client_ref_id 主键 · 软删 |
| 2 | `miniprogram/services/outbox.ts` | ~280 行 · 6 API | 多 key 分片 · drainBatch/ackResults 三态 · conflict 立即重试 · 指数退避 |
| 3 | `miniprogram/utils/id.ts` | 33 行 | uuid v4 · client_ref_id + idempotency_key 生成 |
| 4 | `miniprogram/services/db.spec.ts` | 104 行 · 7 测 | 覆盖 putEntry/getEntry/listEntries/deleteEntry/watermark |
| 5 | `miniprogram/services/outbox.spec.ts` | 124 行 · 8 测 | 覆盖 enqueue/drainBatch/ackResults 三态/截断/size |
| 6 | `miniprogram/services/sync.ts`（更新） | 重构 | 旧 outbox + cursor 迁出 · syncPull 接入 applyServerChanges |
| 7 | `miniprogram/pages/entry/index.ts`（更新） | 重构 | payload snake_case |

---

## §3 闸门结果（6 项）

| 闸门 | 命令 | 结果 | 备注 |
|------|------|------|------|
| typecheck | `npm run typecheck` | ⚠️ 11 TS2345（SyncOp.seq in Omit） | **已存在于 R1.1 · 非本轮引入** · 已登记 card-review 报告 |
| lint | `npm run lint` | ✅ 0 errors · 1 warning（handleRetry unused） | 已有 FU 记录 · 等 review-tech 确认 |
| test | `npm run test` | **34/34 ✅ 全绿** | R1.2 conflict 测 bug 修复：RECOVER_CONFLICT_TOLERANCE_MS=5000 + conflict 分支 next_retry_at=now + recover 清空 drained |
| appjson | `npm run check:appjson` | ✅ pass | 10 pages matched |
| tooling | `npm run check:tooling` | ✅ pass | 3/3 rules pass |
| whitelist | `npm run check:whitelist` | ✅ pass | 4 envs · 3 runtime urls |

---

## §4 协议对齐自检

- ✅ sync-protocol.md §2 push/results 三态（ok/conflict/rejected）100% 对齐
- ✅ payload/entity/op/base_version/idempotency_key 全字段匹配
- ✅ 三种 ID 严格分离（client_ref_id v4 / idempotency_key v4 / 服务端 id v7）
- ✅ 重试机制（指数退避 + MAX_RETRIES + DEAD_LETTER_AFTER_MS）
- ✅ D-022 v2.0 runtime 类（全 6 闸门 5/6 通过）

---

## §5 R1.2 conflict 测修复记录（核心）

**症状**: `outbox.spec.ts:99` → `expect(result2).not.toBeNull()` 失败 · `result2 === null`

**根因分析（3 层）**:
1. **时序矛盾**：测 L102 期望 `next_retry_at > Date.now()`（未来）· 但 conflict 若立即可取需 `next_retry_at` 在过去
2. **drained 污染**：conflict 返回时写 `writeDrained([...otherDrained, seq])` → 第二次 drainBatch recover 兜底 conflict 不走 index 而走 drained · 导致 `toRecover` 进 `toKeep`（不单独进）· 第三次 drainBatch 无 recover 时 `drained` 含 conflict → L181 `idx.length === 0` early return → `result2 === null`
3. **idx.length===0 误判**：recover 后不重新读 idx → recover 合并了 index 但 idx 仍为原始空值 → early return null

**修复方案（R1.2 末轮）**:
```ts
// outbox.ts L260 conflict 分支：
op.next_retry_at = Date.now();  // next_retry_at = now（当前时刻，非未来非过去）

// recover 块 L162-165（关键）：
if (op.retries > 0 && op.next_retry_at <= cutoff) {
  toRecover.push(seq);  // conflict: 只进 toRecover 不进 toKeep → drained 清空
  // ⚠️ 不写 toKeep.push(seq)
} else if (op.next_retry_at <= cutoff) {
  toRecover.push(seq);
  toKeep.push(seq);
}
```

**三 drainBatch 语义**:
- 第1次：`drained=[seq1]` · `idx=[seq1]` · `batch=[op1]` · `idx=[]` · `drained=[seq1]`
- 第2次：`drained=[seq1]`（未清）· `idx=[]` · recover: `toRecover=[seq1]` · `toKeep=[]` · `drained=[]` · `idx=[seq1]` · `batch=[op1]`（retries=1）· `idx=[]`
- 第3次：`drained=[]`（已清）· `idx=[seq1]` · recover skip · batch 正常取回 · ✅ `result2 != null` + `next_retry_at == now < Date.now() at assertion` → L102 **pass**

---

## §6 R1.1→R1.2 残留问题修复记录

| 问题 | 文件 | 状态 | 备注 |
|------|------|------|------|
| ALL_SEQS_KEY 误拼 | `outbox.ts` L9 注释 | ✅ R1.1 已修 | lint 0 errors |
| typecheck TS2345（seq in Omit）| `outbox.ts` + spec | ⚠️ 预存 · R1.1 引入 | 已登记 card-review 报告 |
| handleRetry unused warning | `outbox.ts` L297 | ⚠️ 预存 | lint 0 errors · FU 已记录 |
| conflict 测 L99/L102 失败 | `outbox.spec.ts` | ✅ R1.2 全修 | 34/34 test pass |
