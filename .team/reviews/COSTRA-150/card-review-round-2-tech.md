# Card Review · Tech · COSTRA-150 · Round 2（Orchestrator 复核 · 形式审）

> **审查时间**：2026-05-20 11:35
> **路径**：R1 verdict=REVISE 21/30 → Orchestrator 同轮修订 dispatch 5 处 → R2 形式审复核
> **依据**：SOP-CARD-REVIEW §4.2（同对话轮 revise + 形式审复核 · 修订仅纠正事实源 + 强约束补齐 · 不引入新设计决策）

---

## 总评

- **Verdict**：`APPROVE`
- **总分**：29/30（与 154 R2 同款 · -1 因 P2-2 留 R1 实装时验证 request.ts 401 路径）
- **理由**：5 处修订项与 R1 P0/P1 一一对应 · 无新增设计 · 无新风险

## R1 修订项逐项核验

### ✅ P0-1 · A 项示例代码 5 处 API 签名修订（已落 dispatch §2.1 A 项 + 现状 API 范式速查表）

**修订内容**：
- `outbox.flushPending(token)` → `pushDelta()` from sync.ts（已封装 drainBatch+POST/sync/push+ackResults）
- `auth.getValidToken()` async → `isLoggedIn()` 同步 + request.ts 自动 401 续签兜底
- `getCurrentFamilyId()` from `family.ts` → inline `getActiveFamilyId()` 读 storage `__costra_family_id_v1` · 留 FU-150-FAMILY-CONTEXT-SERVICE
- `request.get<T>()` 链式 → `syncPull(familyId, opts?)` from sync.ts（封装 RPC 风格）
- `db.getWatermark` 假设返 string|null → 改用 sync.ts.syncPull 内部封装 · 不直接调 db
- 新增 5 行对照表（A 项末尾"现状 API 范式速查"段）+ R1 卡审 P0-1 修订记录段

**架构选择**：syncScheduler 复用 sync.ts 封装（D-025 AP-003 隐性漂移预防）· 文件从 200~250 行降到 ~120 行

**核验**：
- 现状 sync.ts L43-67 syncPull + L74-103 pushDelta 全可用
- 现状 db.ts L267-273 getWatermark/setWatermark 全可用
- 现状 auth.ts L84/L93 isLoggedIn/getToken 全可用
- 现状 request.ts L105-119 已自动 401 续签 retry · syncOnce 不需自行处理
- ✅ 通过

### ✅ P0-2 · DoD 加 G15 D-016 反例预防（154 R2 同款 · 第 4 次卡审强约束）

**修订**：§3.2 闸门表加 G15 行 · `git status -s | grep '.team/members/' | wc -l` = 0
**核验**：与 156/158/154 G15 范式一致 · ✅ 通过

### ✅ P0-3 · D 项排除 entry 页（仅 home/mine 二 tabBar 页）

**修订**：§2.1 D 项明确"仅 home + mine（tabBar 页）" · 加 P0-3 修订记录 · 留 FU-150-ENTRY-PAGE-ONSHOW-SEMANTICS（P3 · 待 entry 加 onShow 时再评估）
**核验**：现状 entry/index.ts 95 行确实无 onShow · ✅ 通过

### ✅ P1-1 · 调度器复用 sync.ts 已封装（与 P0-1 联动）

**修订**：A 项示例代码改为 import { syncPull, pushDelta } from './sync.js' · 调度器只做触发源/mutex/debounce
**核验**：与 sync.ts L43-103 范式一致 · 文件预计 ~120 行（vs 原 200~250 行） · ✅ 通过

### ✅ P1-2 · §3.5 runtime 实测断言（≥ 5 条 A~E）

**修订**：§3 加 §3.5 D-022 §4.1 runtime 实测断言 · A~E 5 条 · 联合 154 staging 实测兑现
**核验**：与 D-022 §3.2 格式对齐 · 含 launch / page-show / network-recover / watermark 持久化 / Console 无 error · ✅ 通过

### ✅ P2-1 · B 项措辞改"确认现有"

**修订**：§2.1 B 项标题"修订" → "确认现有 · 0 行改动 · 1 项核验" · 列现状 db.ts L267-273 三函数已实装 · 含 ✅ 标识
**核验**：与现状一致 · ✅ 通过

### ⏸️ P2-2 · request.ts 401 自动续签（留 R1 实装时验证）

不在 dispatch 修订范围 · miniapp-dev R1 实装时按现状 request.ts 行为（自动续签）· 已在 §2.1 A 项 syncOnce catch 注释中说明（"401 已由 request.ts L105-119 自动续签 retry · 此处 catch 是最终失败兜底"）· -1 分留观察。

### ✅ §6 commit footer 大写修订（已落 dispatch）

`closes: fu-103-client-sync-scheduler` → `closes: FU-103-CLIENT-SYNC-SCHEDULER`
`refs: .team/dispatch/costra-*.md` → `.team/dispatch/COSTRA-*.md`

---

## D-025 反模式扫描（R2 复核）

| ID | 反模式 | 命中 | 修订后状态 |
|---|---|---|---|
| AP-001 字符串代理判定 | ☐ No | 仍未命中 |
| AP-002 概率极低就接受 | ☐ No | 仍未命中 |
| AP-003 契约-实装漂移 | ☐ No（修订后）| **R1 时隐性命中**（dispatch 示例代码 5 处 API 签名漂移）→ R2 修订后**消除**（直接复用 sync.ts 封装 + 现状 API 对照表）· 第 7 次正向兑现（154 R1 第 6 次 · 150 R2 第 7 次）|

---

## R2 verdict 决议

| 项 | R1 | R2 修订后 |
|---|---|---|
| 总分 | 21/30 | 29/30 |
| C2 DoD 可度量 | 4/6 | 6/6（G15 + §3.5 runtime 断言补齐） |
| C4 产出物具体 | 2/5 | 5/5（5 处 API 对齐 + sync.ts 复用 + entry 排除） |
| C5 风险与边界 | 2/4 | 3/4（family_id 兜底方案明确 · runtime 断言清单 · -1 留 P2-2 R1 实装时验证 401 路径） |
| 其他维度 | 同 R1 | 同 R1 |
| **verdict** | **REVISE** | **APPROVE** |

**SOP 合规**：
- D-014-a Card-Review R2 同对话轮兑现（D-016 同轮兑现合规第 18 次实战）
- 修订项均为事实源纠错 + 强约束补齐 + 现状 API 对照 · 无新设计决策 · 形式审 SOP 适用
- miniapp-dev R1 实装可立即 spawn

---

## R1 实装启动指令

Orchestrator 立即 spawn `costra-miniapp-dev` 启 R1 实装 · 时间盒 ≤ 240min · 7 项 scope（A 调度器新建 + B 核验 + C app.ts 接入 + D 二页 onShow + E 单测 + F db 单测 + G FU/缺陷单关闭）+ 17 项 DoD + 7 项闸门（含 G15）+ 3 项反向验证 + 5 项 §3.5 runtime 实测断言。

预计 R1 完工：今日 13:00 ± 30min · review-tech R1 跟进 13:30 ± 30min。

---

**报告由 Orchestrator R2 形式审复核 · 落档 .team/reviews/COSTRA-150/card-review-round-2-tech.md**
