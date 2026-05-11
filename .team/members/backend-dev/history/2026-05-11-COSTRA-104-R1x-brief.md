# COSTRA-104 R1.x 极窄修复 · 交付历史

## §1 任务概述

R1.x 极窄修复 · review-tech R1 36/40 APPROVE 后同轮兑现 P1-1 + P2-1。

**涉及卡号**：COSTRA-104
**commit**：363efa1b2dd72b8961f26ab70de934a259482c40
**时间**：2026-05-11 20:57:43+08:00

---

## §2 修复内容

### P1-1 · sync.test.ts 补 T2 update conflict 测

**问题**：dispatch §2.3 验证锚点要求 T2 update conflict 测 · 原只实装 T1/T3/T6/T7/T8 = 5 测。

**修复**：
1. 在 T1 后插入 T2 测（约 line 82-133）：
   - 先用 sync/push create 一个 entry → 拿 server_id + server_version=1
   - 再用 base_version=99（故意错）update 同一 entry → 期望 status=conflict + server_version=1
2. beforeEach 补 family + ledger setup（与 entries.test.ts 对齐 · 补 family_members.role='owner'）
3. 测从 19 → 20 全绿

### P2-1 · 3 处 stub error 字段名 followup → followup_id

**问题**：3 处 stub 路由用 `followup:` · 但 dispatch + curl-verify 期望 `followup_id:` · OpenAPI 风格惯例是 `_id` 后缀。

**修复 6 处**（3 实装 + 3 测 expect）：
1. `server/src/routes/entries.ts:171` PATCH stub `followup:` → `followup_id:`
2. `server/src/routes/entries.ts:187` DELETE stub `followup:` → `followup_id:`
3. `server/src/routes/sync.ts:165` sync/pull stub `followup:` → `followup_id:`
4. `server/test/sync.test.ts:162` T7 expect `followup:` → `followup_id:`
5. `server/test/entries.test.ts:164` T9 expect `followup:` → `followup_id:`
6. `server/test/entries.test.ts:179` T10 expect `followup:` → `followup_id:`

---

## §3 闸门验证

| 检查项 | 结果 |
|--------|------|
| `cd server && npm run typecheck` | ✅ 0 错（tsc -p tsconfig.json --noEmit + tsconfig.test.json） |
| `cd server && npm run test` | ✅ 20/20 全绿（auth 8 + sync 6 + entries 6） |
| `git status -s` | ✅ 空（工作树 clean） |

---

## §4 变更摘要（4 files · +92 -12）

```
server/test/sync.test.ts          | +71 -2   T2 测 + beforeEach family/ledger setup
server/test/entries.test.ts        |  +6 -6    followup → followup_id（2 处 expect）
server/src/routes/entries.ts      |  +3 -3    PATCH/DELETE stub followup → followup_id
server/src/routes/sync.ts         |  +3 -3    sync/pull stub followup → followup_id
```

---

## §5 遗留 / FU

- **P1-1 T2**：beforeEach setup 需补 family_members.role='owner'（pg-mem NOT NULL constraint）· 已修
- **未 push**：push 留 Orchestrator（363efa1 在本地）
- **followup_id 语义**：dispatch §4.2 curl-verify 已用 `followup_id` · 实装和 curl-verify 现已对齐
