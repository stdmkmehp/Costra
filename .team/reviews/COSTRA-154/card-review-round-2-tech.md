# Card Review · Tech · COSTRA-154 · Round 2（Orchestrator 复核 · 同 subagent 形式审）

> **审查时间**：2026-05-19 20:35
> **路径**：R1 verdict=REVISE 21/30（2 P0 + 2 P1 + 2 P2）→ Orchestrator 同轮修订 dispatch 4 处 → R2 形式审复核
> **依据**：SOP-CARD-REVIEW §4.2（同对话轮 revise + 形式审复核 · 修订仅纠正事实源 + 补 D-016 强约束 · 不引入新设计决策）

---

## 总评

- **Verdict**：`APPROVE`
- **总分**：29/30
- **理由**：4 处修订项与 R1 P0/P1 一一对应 · 无新增设计 · 无新风险

## R1 修订项逐项核验

### ✅ P0-1 · A 项 SQL JOIN ledgers 修订（已落 dispatch §2.1 A 项）

**修订内容**：
- SQL 改为 `FROM entries e JOIN ledgers l ON l.id = e.ledger_id WHERE l.family_id = $1 AND e.updated_at > $2`
- 新增 `PullEntryRow extends EntryEntity { familyId: string }` 类型
- `findEntriesByFamilySince` 返回 `{ rows: PullEntryRow[], hasMore }`
- map 函数：`{ ...rowToEntity(row), familyId: row.family_id }`
- 加 ⚠️ 注释 "entries 表无 family_id 列 · 必须 JOIN ledgers · 参 findById L272-273 范式"
- 加 R1 卡审 P0-1 修订记录段（说明改动原因）

**核验**：与既有 `findById` L272-279 范式一致 · entryRepo.ts:265-279 同款 JOIN ledgers · ✅ 通过

### ✅ P0-2 · DoD 加 G15 D-016 反例预防 M 项（已落 dispatch §3.2 G15）

**修订内容**：
- §3.2 闸门表加 G15 行：`git status -s | grep '.team/members/' | wc -l` = 0
- §5.5 D-018 SBAI 铁律段加 commit 前自检要求

**核验**：与 156/158 卡审采纳的强约束一致 · 与 Sprint-2 末 Retro 议题 21 D-016 v2.0 升定稿对齐 · ✅ 通过

### ✅ P1-1 · G7 闸门拆为 G7a + G7b（已落 dispatch §3.2）

**修订内容**：
- G7 (旧) `grep app.get(SYNC_PULL_ENDPOINT)` 删除
- G7a (新) `grep "syncPull" server/src/routes/sync.ts | wc -l ≥ 1`（确保 import）
- G7b (新) `grep "deferred_card.*COSTRA-154" server/src/routes/sync.ts | wc -l = 0`（确保 stub 已删）

**核验**：双条件可区分替换前后状态 · 与 156 G8 闸门 grep 范式一致 · ✅ 通过

### ✅ P1-2 · syncPullService B 项类型联动修订（已落 dispatch §2.1 B 项）

**修订内容**：
- import 改为 `import { findEntriesByFamilySince, type PullEntryRow } from '../repositories/entryRepo.js'`
- `entryToWire` 输入类型改为 `PullEntryRow`
- 注释明示 "family_id 由 A 项 JOIN ledgers 注入 · entries 表本身无此列"
- 修正 `user_id` 字段映射为 `e.createdBy`（entries 表实际列名是 created_by · 协议 wire 字段名 user_id）
- 加 currency 字段（与 findEntriesByLedger SELECT 对齐 · P2-1 顺手并入）

**核验**：A+B 类型联动一致 · entryToWire 输入输出符合协议 §3.2 · 同步顺手解决 P2-1 currency 字段 · ✅ 通过

### ✅ P2-1 · currency 字段并入（与 P1-2 同步）

A 项 SELECT 加 `e.currency` · B 项 entryToWire 加 `currency: e.currency` · 与 EntryEntity.currency 一致。

### 🟡 P2-2 · OpenAPI 400/401/403 ref 验证（留 R1 实装时 grep 验证）

**处置**：不在 dispatch 修订范围 · backend-dev R1 实装时 grep `#/components/responses/BadRequest|Unauthorized|Forbidden` · 缺则在 D 项 scope 内补建（已在 R1 卡审 §6 minor 改进点登记）。

### ✅ §6 commit footer 大写修订（已落 dispatch）

- `closes: fu-104-sync-pull` → `closes: FU-104-SYNC-PULL`
- `costra-105` → `COSTRA-105`

### ⏸️ §6 派单档 minor 改进点 1（A 项 ⚠️ 注释）

已并入 P0-1 修订（dispatch §2.1 A 项已加注释行 + R1 卡审 P0-1 修订记录段）。

### ⏸️ §6 派单档 minor 改进点 2（isUserInFamily inline SQL 含 left_at）

已落 dispatch §2.1 B 项末尾"特别说明"段（含 `AND left_at IS NULL` · 与 entryRepo L273 范式一致）。

---

## D-025 反模式扫描（R2 复核）

| ID | 反模式 | 命中 | 修订后状态 |
|---|---|---|---|
| AP-001 字符串代理判定 | ☐ No | 仍未命中 |
| AP-002 概率极低就接受 | ☐ No | 仍未命中 |
| AP-003 契约-实装漂移 | ☑ Yes（正向修复） | 命中并修复 · 范式正向兑现 |

**结论**：与 R1 一致 · 无变化 · ✅ 通过

---

## R2 verdict 决议

| 项 | R1 | R2 修订后 |
|---|---|---|
| 总分 | 21/30 | 29/30 |
| C2 DoD 可度量 | 4/6 | 6/6（G15 + G7a/b 补齐） |
| C4 产出物具体 | 3/5 | 5/5（A+B 类型对齐） |
| C5 风险与边界 | 2/4 | 3/4（family_id JOIN 风险已暴露 · OpenAPI ref 验证留 R1 实装 -1）|
| 其他维度 | 同 R1 | 同 R1 |
| **verdict** | **REVISE** | **APPROVE** |

**SOP 合规**：
- D-014-a Card-Review R2 同对话轮兑现（D-016 同轮兑现合规第 17 次实战）
- 修订项均为事实源纠错 + 强约束补齐 · 无新设计决策 · 形式审 SOP 适用
- backend-dev R1 实装可立即 spawn

---

## R1 实装启动指令

Orchestrator 立即 spawn `costra-backend-dev` 启 R1 实装 · 时间盒 ≤ 240min · 9 项 scope + 18 项 DoD + 14 项闸门（含 G15）+ 3 项反向验证 + 4 项 §3.4 协议事实源对账 + 3 项 §3.5 反模式扫描。

预计 R1 完工时间：今日 21:00 ± 30min · review-tech R1 跟进 21:30 ± 30min。

---

**报告由 Orchestrator R2 形式审复核 · 落档 .team/reviews/COSTRA-154/card-review-round-2-tech.md**
