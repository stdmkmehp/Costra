# Card Review · Tech · COSTRA-164 · Round 2

- 卡 Owner：backend-dev
- 卡类型：feature
- 卡 points：3
- 审核时间：2026-05-27T14:50:00+08:00
- 上轮结论：R1 PASS-WITH-FOLLOWUP 25/30（6 项 FU 修订要求）
- 审查者装扮：costra-card-reviewer-tech（D-022 v2.0 + D-025 §2 反模式扫描 · 形式审）

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：**28/30 分**（R1 25 → R2 28 · +3 分）
- **阻塞点**：0 个 P0 / 1 个 P1 残留 / 1 个 P2 新增

> **注**：R2 报告由 Orchestrator 在 spawn `costra-card-reviewer-tech` 后接收 final message · 物理落盘到本路径 · subagent 自身物理无写权（SBAI v1.1 范式 · D-014）

---

## §1 R1 6 项 FU 兑现核验表

### FU-164-001：withTransaction → withTx 复用 · transaction.ts 删除 · import 显式 · §7 风险清理

| 核验项 | 期望 | 实际 | 判定 | 证据行号 |
|---|---|---|---|---|
| §2.1 B withTransaction → `withTx` | `withTx` | L225 `await withTx(async (client) => {` | ✅ | dispatch L225 |
| §2.1 B 显式 import | `import { withTx } from '../db/pool.js'` | L204 完全一致 | ✅ | dispatch L204 |
| §5.1 删除 `server/src/db/transaction.ts` 条目 | 不应出现 | L460 仍写 `server/src/db/transaction.ts（如需新建 withTransaction 工具 · 视现状）` | **✗** | dispatch L460 |
| §7 删除/替换"withTransaction 工具是否已存在"风险条目 | 不应出现旧文 | L504 仍写 `withTransaction 工具是否已存在：本卡需先核查…` | **✗** | dispatch L504 |
| §5.3 FU-164-WITH-TRANSACTION-UTIL 清理 | 应标注"已确认复用 withTx · 不新建" | L482 仍写 `如本卡新建 withTransaction 工具` | **✗** | dispatch L482 |

**兑现度**：2/5 · 核心代码段（§2.1 B）已正确修改 · 但 §5.1 / §7 / §5.3 三处旧文残留未清理

---

### FU-164-002：wxLogin try-catch isUniqueViolation + fallback findPersonalFamily · T6 对齐

| 核验项 | 期望 | 实际 | 判定 | 证据行号 |
|---|---|---|---|---|
| §2.1 B wxLogin 含 try-catch 块 | `try { createPersonalFamily } catch (err) { if isUniqueViolation ... }` | L237-256 完整 try-catch 块 | ✅ | dispatch L237-256 |
| isUniqueViolation 双校验 code + constraint | code='23505' + constraint 名 | L213-218 `err.code === '23505' && err.constraint === constraint` | ✅ | dispatch L213-218 |
| fallback findPersonalFamily | catch 内调 findPersonalFamily | L245 `personalFamily = await familyRepo.findPersonalFamily(user.id, client)` | ✅ | dispatch L245 |
| 极边缘 throw UNAVAILABLE | catch unique violation 但 findPersonal 返 null | L246-251 `if (!personalFamily) { throw new AppError(ErrorCode.UNAVAILABLE, ...) }` | ✅ | dispatch L246-251 |
| T6 期望与代码路径一致 | T6 描述 service 层 catch + fallback | L385 "service 层应捕获并 fallback findPersonalFamily" | ✅ | dispatch L385 |
| isUniqueViolation 工具定义给出 | 说明 pg error code 23505 + constraint 双校验 | L209-218 完整定义 + L301 注释 | ✅ | dispatch L209-218, L301 |

**兑现度**：6/6 ✅

---

### FU-164-003：/families/* x-deferred 虚假声明修正 · AP-003 改为"命中"

| 核验项 | 期望 | 实际 | 判定 | 证据行号 |
|---|---|---|---|---|
| §1.1 隐性触发段改为"无 x-deferred 标记"事实陈述 | 不再写"仍是 deferred" | L30 `当前无 x-deferred 标记（grep 0 命中 · v2.0 修正 · 是已知隐性漂移）` | ✅ | dispatch L30 |
| §2.1 C 禁项段修正 | "不动 L161-319 任何一行 + 标记补齐推 COSTRA-161/201" | L361 `本卡边界：不引入新 deferred · 不清旧 deferred · 不动 L161-319 任何一行` + L360 推 COSTRA-161/201 | ✅ | dispatch L357-361 |
| §3 G8 修正 | "x-deferred 不新增 · /families/* 当前无 x-deferred 标记（AP-003 已知漂移）" | L416 完整修正 | ✅ | dispatch L416 |
| §3 D-025 AP-003 扫描改为"命中（已知隐性漂移）" | AP-003 命中 | L432 `AP-003 命中（已知隐性漂移）（v2.0 修正）` | ✅ | dispatch L432 |
| openapi.yaml 实际验证 | grep deferred 返 0 | 实测 `grep -nic "deferred" openapi.yaml` 返回 0 匹配 | ✅ | 物理验证 |

**兑现度**：5/5 ✅

---

### FU-164-004：familyRepo.softDelete kind 守门 + ErrorCode.ts + T10 测试

| 核验项 | 期望 | 实际 | 判定 | 证据行号 |
|---|---|---|---|---|
| §2.1 A familyRepo 接口加 `softDelete(input,client)` | 签名含 kind 守门逻辑 | L166-170 完整接口 + L167 kind 守门注释 | ✅ | dispatch L166-170 |
| §5.1 工作区加 ErrorCode.ts 写权限 + FAMILY_PERSONAL_NOT_DELETABLE 提及 | 显式列出 | L459 完整声明 | ✅ | dispatch L459 |
| §2.1 E 加 T10 softDelete kind 守门测试 | 3 子项：personal 拒绝 / shared 成功 / NOT_FOUND | L389 三子项完整 | ✅ | dispatch L389 |
| ADR-0007 §5.7.3 锚定 | softDelete 引用 ADR | L166 `ADR-0007 §5.7.3 早期防御` | ✅ | dispatch L166 |

**兑现度**：4/4 ✅

---

### FU-164-005：migration ROW_NUMBER 排序键选择理由注释

| 核验项 | 期望 | 实际 | 判定 | 证据行号 |
|---|---|---|---|---|
| §2.1 A0 排序键选择理由注释 | created_at vs updated_at 选择理由 | L100-103 三条注释：① personal 按创建时间判定 ② 双键防歧义 ③ 边缘场景 0 风险 | ✅ | dispatch L100-103 |

**兑现度**：1/1 ✅

---

### FU-164-006：bootstrap 时延 < 30ms 加 [未经验测] + 实测节点

| 核验项 | 期望 | 实际 | 判定 | 证据行号 |
|---|---|---|---|---|
| §7 时延预期加 `[未经验测]` 标注 | D-022 §2.2 C8-3 范式 | L507 `[未经验测] 单事务 < 30ms 为纸面预期` | ✅ | dispatch L506-507 |
| 补实测节点 | 显式写何时实测 | L508 `实测节点：与 165 联合 staging 实测时观察 server 日志 · 记录 P50/P95 时延` | ✅ | dispatch L508 |

**兑现度**：2/2 ✅

---

## §2 是否引入新问题

### 新 P1-1：§5.1 L460 + §7 L504 + §5.3 L482 transaction.ts / withTransaction 三处旧文残留（FU-164-001 部分未兑现）

- **证据**：见 §1 FU-164-001 表
- **问题**：§2.1 B 核心代码已正确修改（withTx + import），但 §5.1 工作区铁律 + §7 风险条目 + §5.3 follow-up 三处文档残留矛盾，造成实装歧义
- **修复建议**：
  1. L460 删除 `server/src/db/transaction.ts（如需新建 withTransaction 工具 · 视现状）` 条目
  2. L504 替换为 `withTx 工具已确认复用：server/src/db/pool.ts:L45-62 已实装 · 无需新建 transaction.ts`
  3. L482 替换为 `FU-164-WITH-TX-UTIL（已复用 pool.ts:withTx）：评估未来是否抽出独立 plugin / utility 供其他 service 复用 · 留 Sprint-4 评估`

### 新 P2-1：DoD 计数 "22 项" 与实际 23 项不一致

- **证据**：
  - L405：`## §3 DoD（22 项 · v2.0 +T10 softDelete kind 守门）`
  - 实际计数：G1~G8 + G15 + G16 = 10 项 · T1~T10 = 10 项 · 反向验证 = 3 项 · 合计 = 23
  - v2.0 修订历史 L533 写"DoD 21 项 → 22 项（+T10）"——漏算了 G 列从 v1.0 8 项变成 v1.1 10 项的差异
- **修复建议**：L405 改为 `DoD（23 项 · v2.0 +T10 softDelete kind 守门）`

---

## §3 总评结论

### R1 → R2 维度变化

| 维度 | R1 | R2 | 说明 |
|---|---|---|---|
| C1 | 5/5 | 5/5 | FU-164-003 修正后描述更准确 |
| C2 | 4/6 | 5/6 | FU-164-002 兑现 · 扣 1 因 DoD 计数不一致 |
| C3 | 4/5 | 4/5 | FU-164-001 核心段已修但 §5.1/§7/§5.3 残留矛盾 · 扣 1 |
| C4 | 4/5 | 5/5 | FU-164-002 + 004 兑现 |
| C5 | 3/4 | 4/4 | FU-164-006 兑现 |
| C6 | 3/3 | 3/3 | 无变化 |
| C7 | 2/2 | 2/2 | 无变化 |
| C8 | Pass | Pass | 无红线触碰 |

**总分**：5 + 5 + 4 + 5 + 4 + 3 + 2 = **28/30** · **PASS-WITH-FOLLOWUP**

FU-164-001 核心修复（§2.1 B withTx + import）已做 · 实装正确性不受影响 · 但 §5.1/§7/§5.3 三处旧文残留属文档一致性缺陷 · 建议在 R1 实装 commit 前一并清理（v2.1 修订）。

---

## §4 D-025 反模式重扫

| AP | 命中 | 证据 |
|---|---|---|
| AP-001 | 不命中 | 无变化 |
| AP-002 | 不命中 | 无变化 |
| AP-003 | **命中（已知隐性漂移）** | v2.0 修正后四处（§1.1 L30 / §2.1 C L357-361 / §3 G8 L416 / §3 D-025 L432）描述一致 · AP-003 正确标为"命中" · 物理验证 grep 0 匹配 · 与 R1 一致 ✅ |

---

## 给卡作者的回执指令

请 Orchestrator 在 R1 实装 spawn 前完成 v2.1 文档清理：

1. **P1-1（FU-164-001 残留）**：3 处旧文清理
2. **P2-1**：§3 DoD 标题计数 22 → 23

清理后可直接进入 R1 实装（无需 R3 再审 · v2.1 仅为文档清理 · 不改变 scope/估点/实装范围）。

---

## 自我反思

- 审核耗时：约 20 分钟（6 项 FU 逐条核验 + 3 处事实源物理验证 + D-025 重扫）
- 置信度：高
  - withTx 签名：物理 Read pool.ts L45-62 确认 ✓
  - deferred 缺失：grep 验证 0 匹配 ✓
  - ErrorCode.ts 无 FAMILY_PERSONAL_NOT_DELETABLE：物理 grep 确认（为预期——dispatch 声明将加）✓
  - ADR-0007 §5.7.3 softDelete 要求：Read ADR 确认 ✓
  - 三处残留：物理 grep withTransaction/transaction.ts 确认 ✓
- 若低：建议 Orchestrator 转 Human 二裁（不需要 · 置信度高）
