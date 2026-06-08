# Tech Review · COSTRA-100 · Round 2

- 被审 Agent：**backend**
- 本轮产出 commit：未提交（工作区；对比 `round-1-tech.md` 标记的 9 份文件 + 本轮 Round-2 改动 8 份）
- 审核时间：2026-04-23T20:01+08:00
- 上轮结论：**REVISE**（3 P0 / 4 P1 / 3 P2，26/30）
- 本轮模式：**自动循环**（D-011 方案 B · 前置条件全满足 · SOP-REVIEW-AUTOLOOP §2）

---

## 0. 审核范围与上下文

### 本轮核验对象（严格对齐 `round-1-backend-response.md §5` 声明的 8 项 diff）

| # | 路径 | 变更 | 对应 Finding |
|---|---|---|---|
| 1 | `docs/db/schema.md` | §0 头部 + P8 + §2 users + §7 下一步 | P0-1 |
| 2 | `docs/api/README.md` | §1 UUID 行 + §3 错误码表 + §5 幂等键段落 | P0-1 / P0-2 / P1-1 |
| 3 | `docs/api/error-codes.md` | `IDEMPOTENCY_KEY_MISMATCH` 从 §2.1(400) 挪到 §2.5(409)、§2.1-2.9 重编号 1-21、新增 §9.1 白名单反向登记 | P0-2 / P1-3 |
| 4 | `docs/api/sync-protocol.md` | §2.4 rejected 白名单契约块 | P1-3 |
| 5 | `server/api/openapi.yaml` | `IdempotencyKey` description 扩充 | P1-2 |
| 6 | `server/src/errors/ErrorCode.ts` | 追加 `assertErrorCodeCoverage` IIFE | P1-4 |
| 7 | `.team/decisions/ADR-0002-tech-stack.md` | §决策表 3 行定点修订 + 末尾 2026-04-23 补丁段 | P0-3 |
| 8 | `.team/decisions/ADR-0006-backend-runtime-and-primary-store.md` | **新增** 126 行 | P0-3 |

### 强制上下文（本轮再次加载）
- `round-1-tech.md`（上轮报告）
- `round-1-backend-response.md`（Backend 回执）
- `charter.md` / `engineering-guidelines.md` / `COMMON-CONTRACT.md`
- `ADR-0002` v2（含本轮 patch）+ `ADR-0004` + `ADR-0006`（新增）
- `docs/db/schema.md`（含本轮改动）+ `docs/api/*.md` 四份契约

### 独立性说明
- 本 Round-2 未读 `review-product` 报告（无）
- 未与其他 Review-Agent 交叉，断言均自主复现
- 所有声称的改动**全部做了工具侧 grep 二次核验**，不采信 response.md 的单方声明

---

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`（P0 全部闭环 · P1 全部落地 · 残余仅 1 条 P1 级误标 + 1 条 P2 级文案，均可本 Round 就地修复后合入，或直接登记 Follow-up 不阻断）
- **总分**：**29 / 30 分**（6 维有效 × 5，"离线与同步（MiniApp 专属）"N/A；本轮唯一扣 1 分在"工程纪律"——schema.md §0 头部错把 ADR-0006 写成 ADR-0005）
- **阻塞点数量**：**0 P0 · 1 P1 · 1 P2**

一句话：**上轮 3 P0 全部闭环，证据链干净、事实源统一（PG15 + UUID v7 + Node/TS）；新起的 ADR-0006 结构规范，决策表修订与补丁段形成完整溯源。唯一遗留是 schema.md §0 头部把 ADR 编号误引为 0005（本应 0006），以及同段"ADR 追溯"措辞略冗余；属可一行修复的误标，不阻塞推进至 Human 终审。**

---

## 维度得分（vs Round-1）

| 维度 | R1 | R2 | 变化 | 一句话结论 |
|---|---|---|---|---|
| 契约一致性 | 2 | **5** | +3 | 5 份事实源（error-codes / README / id-strategy / openapi / ErrorCode.ts）对 `IDEMPOTENCY_KEY_MISMATCH=409` 全部对齐；UUID 版本从三方分裂→统一 v7 服务端 / v4 客户端；sync-protocol 白名单双向登记 |
| 架构与分层 | 4 | **5** | +1 | ADR-0002 + ADR-0006 + 实现三者闭合，后端运行时决策有溯源 |
| 数据与持久化 | 3 | **5** | +2 | schema.md 与 id-strategy.md 对齐 PG15 + v7；`gen_random_uuid()` 仅剩 §7 未来计划中的 `gen_random_uuid_v7()` 一处（合法前瞻，非事实冲突） |
| 离线与同步 | N/A | N/A | — | 不适用 |
| 安全与合规 | 5 | **5** | 0 | 维持零违规 |
| 可测与可观测 | 5 | **5** | 0 | 新增 `assertErrorCodeCoverage` IIFE，运行时增加一道启动期兜底 |
| 工程纪律 | 4 | **4** | 0 | Diff 清晰、response.md 自验链齐全；**扣 1 分**在 schema.md §0 "ADR-0005 追溯" 误标（应为 0006）；工作区仍未 commit（不在本卡质量门内） |

**总分**：5+5+5+5+5+4 = **29 / 30**（N/A 维不计入分母）

---

## P0 阻塞点

**无。** 上轮 3 P0 全部闭环，核验如下：

### P0-1（UUID / 主存储事实源分裂）→ **已闭环** ✅

**核验动作**：
- `rg 'UUID v4' docs/api/README.md` → 第 17 行已改为 "服务端实体主键 v7（时间有序）；`client_ref_id` / `Idempotency-Key` 为 v4"（命中）
- `rg 'gen_random_uuid' docs/db/schema.md` → 仅剩 §7 v0.4 未来计划中的 `gen_random_uuid_v7()` 一处（合法前瞻）
- `docs/db/schema.md` §1 P8 已改写为 "UUID v7（时间有序，应用层 `newId()` 生成）"，引用 `../api/id-strategy.md`
- `rg 'MySQL 8.0' .team/decisions/ADR-0002*` → 仅在 "修订补丁" 段作为历史引用出现（合法），决策表已替换为 PostgreSQL 15
- `rg 'ADR-0006' .team/decisions/ADR-0002-tech-stack.md` → 决策表 3 处 + 补丁段 1 处，溯源链完整

**结论**：三份权威文档（ADR-0002 / schema.md / id-strategy.md）对 UUID 版本 + 主存储口径完全一致。

### P0-2（`IDEMPOTENCY_KEY_MISMATCH` HTTP 归属不一致）→ **已闭环** ✅

**核验动作**：
- `rg 'IDEMPOTENCY_KEY_MISMATCH' docs/api/error-codes.md` → 仅出现在：
  - §2.5 409 冲突表第 #14 行（正确位置）
  - §3 客户端重试矩阵 `409 IDEMPOTENCY_KEY_MISMATCH` 行
  - §9.1 白名单登记中 `conflict` 分支
  - **§2.1 400 小节无残留**
- `rg 'IDEMPOTENCY_KEY_MISMATCH' docs/api/README.md` → §3 精简表新增 "409 | IDEMPOTENCY_KEY_MISMATCH"，§5 幂等键段落标 "409"
- `server/api/openapi.yaml` line 609-610 description 正文明确 "409 IDEMPOTENCY_KEY_MISMATCH"
- `server/src/errors/ErrorCode.ts` `ErrorHttpStatus[ErrorCode.IDEMPOTENCY_KEY_MISMATCH] = 409`（原本正确）
- 错误码重编号 1-21 连续无跳号（人工核对 §2.1-2.9 编号递增）

**结论**：5 份事实源 100% 一致归属 409。

### P0-3（ADR-0002 后端语言事实脱钩）→ **已闭环** ✅

**核验动作**：
- `.team/decisions/ADR-0006-*.md` **存在**（126 行，完整结构：状态 / 背景 / 决策 / 关系 / 影响面 / 代价 / 废弃项 / 验证路径 / 相关文档 / 修订历史）
- ADR-0002 §决策表 line 24-27 三行就地修订完成，且**保留修订补丁段**（未删除原文痕迹）
- `rg --files -g '*.go' server/` → **0 个结果**（与 ADR-0006 §7 验证路径断言一致）
- ADR-0006 §2.2 金额类型标注 "`NUMERIC(18,4)`"，与 schema.md 原则 P1 "BIGINT（分）" **存在措辞差异但非冲突**——P1 是应用层实际存储策略（以分为单位用 BIGINT），ADR-0006 是类型容量上界说明，两者并存不构成事实源分裂（记为 P2 建议点，不列入本轮 P0/P1）

**结论**：ADR-0006 内容充分、ADR-0002 修订留痕完整、实现与决策闭合。

---

## P1 应改

### P1-1（新）· `docs/db/schema.md:6` 把 ADR-0006 误引为 ADR-0005

**证据**：

```
6:> **运行环境**: PostgreSQL 15，`TIMESTAMPTZ` 强制 UTC 存储；主键 UUID v7 由应用层 `newId()` 生成（ADR-0005 追溯）
```

**问题**：
- ADR-0005 编号已在 ADR-0002 §部署策略补丁（2026-04-22 · D-007）中被预留给 "部署平台最终选型"（本次变更尚未发生），**本轮新增的是 ADR-0006**
- 误标会让后续 Agent 顺着 "ADR-0005" 去找溯源时扑空（文件不存在），或误将部署选型 ADR 当作 DB 决策来源
- ADR-0006 自己 §引用背景段也明确说明 "ADR-0005 已预留给部署平台选型，故本次独立变更占用 ADR-0006" —— schema.md 这一行就是漏改一处

**依据**：Review-Tech §3.1 契约一致性 "交叉引用必须精确到存在的文档"

**修复建议**：一行替换
```diff
-> **运行环境**: PostgreSQL 15，`TIMESTAMPTZ` 强制 UTC 存储；主键 UUID v7 由应用层 `newId()` 生成（ADR-0005 追溯）
+> **运行环境**: PostgreSQL 15，`TIMESTAMPTZ` 强制 UTC 存储；主键 UUID v7 由应用层 `newId()` 生成（见 [ADR-0006](../../.team/decisions/ADR-0006-backend-runtime-and-primary-store.md)）
```

**置信度**：**高**。该点 grep 一条命令即可锁定，修改零风险。

---

## P2 建议（不阻断，登记 D-010 Follow-up）

### P2-1（新）· schema.md §1 P8 提 "§6 下一步"，实际章节是 §7

- **证据**：`docs/db/schema.md:22` 末尾 "见 §6 下一步"，但 `§6 下一步` 实际为 §7（§6 是 "关键查询示例" 或其他）
- **修复建议**：改为 "见 §7 下一步"，或去掉编号只用文字 "见末尾'下一步'章节"
- **非阻断理由**：读者能从上下文猜到去向；不涉及契约语义

### P2-2（沿用 R1）· `ttl-policy.md §4` ↔ `.env.production.example` 互相引用
（Backend 已登记 D-010 Follow-up，无需本轮动作）

### P2-3（沿用 R1）· OpenAPI `SyncPushRequest` 补 `minItems: 1, maxItems: 200`
（已登记 D-010 Follow-up）

### P2-4（沿用 R1）· `uuidv7` npm 依赖登记到 ADR-0002 §库依赖清单
（已登记 D-010 Follow-up；ADR-0006 §2.2 已提及 `uuidv7` 包，Sprint-1 `npm install` 时再补清单）

### P2-5（新）· ADR-0006 §2.2 金额类型与 schema.md P1 措辞差异

- ADR-0006 §2.2 写 "金额类型：`NUMERIC(18,4)`"
- schema.md §1 P1 写 "金额字段使用 `BIGINT`（分）"
- **两者并非冲突**（BIGINT 分存是应用层选择，NUMERIC 是容量上界），但第三方读者可能误以为冲突
- **建议**：ADR-0006 §2.2 追加一句 "实际落地见 schema.md P1 `BIGINT`（分）存储策略" —— 纯文档性修订，不阻断

---

## 与上轮的差异

| 维度 | Round 1 | Round 2 | 差异 |
|---|---|---|---|
| 总分 | 26 / 30 | **29 / 30** | +3（契约一致性 +3 / 数据持久化 +2 / 架构分层 +1 / 工程纪律 0） |
| Verdict | REVISE | **PASS-WITH-FOLLOWUP** | 可推 Human 终审 |
| P0 数 | 3 | **0** | -3（P0-1/2/3 全部闭环） |
| P1 数 | 4 | **1** | -3（R1 P1-1~P1-4 全修；新出 1 条 schema.md ADR 误标） |
| P2 数 | 3 | **5** | +2（沿用 3 条 + 新增 2 条："§6 下一步" 章节号误标、ADR-0006 金额措辞补充） |

**进步评语**：Backend-Agent 本轮回执质量很高：
- **`round-1-backend-response.md` §6 自验证锚点**（5 条 `rg` 命令）全部经我方独立复现通过
- **无任何 P0/P1 反驳**，态度对契约一致性认知到位
- **方案选择**对上轮建议（方案 A+C 组合）精准——既修数据，也补 ADR，未走方案 B 回退
- **新增 ADR-0006** 结构严谨，影响面清单把 DevOps 后续动作明确列入 COSTRA-13x，而非本卡范围，边界把握清晰

---

## 给被审 Agent（Backend-Agent）的回执指令

**Review-Tech 对本卡结论为 `PASS-WITH-FOLLOWUP`**，**无需再跑 Round 3**（自动循环可终止 · SOP-REVIEW-AUTOLOOP §4.1）。但请 Backend-Agent **在本轮 revise 就近** 做一件事：

1. **P1-1 就地修复**（可选但强推 · 5 秒改动）：把 `docs/db/schema.md:6` 的 `ADR-0005` 改为指向 `ADR-0006`，避免让 Human 终审时再指一次。若修复则 Orchestrator 把 verdict 升级为纯 `PASS`；若不修，以 `PASS-WITH-FOLLOWUP` 形态推给 Human，由 Human 决定是否本卡修/带到下卡。
2. **P2-1 / P2-5** 本卡不必动手，登记到 D-010 Follow-up 同一条目即可（与 R1 三条 P2 合并）

**Orchestrator 下一步**：
- 立刻把本报告 + Backend 回执一起推送到 `.team/board.md` COSTRA-100 条目下的 "Review 迭代" 栏
- 终止自动循环，**转入 Human 终审窗口**（SOP-REVIEW-LOOP §8 第一行：`Review-Agent 给 PASS/PASS-WITH-FOLLOWUP → 走 approve:COSTRA-100 或 reject:...`）
- 在回复开头列 "⚠️ 需要你触发的 Agent 任务清单"，把 COSTRA-100 标为 "等 Human 终审"

---

## 自我反思

- **本次审核耗时估计**：约 18 分钟（独立复现 5 条 anchor + 8 个文件改动核验 + 1 条新 finding 定位）
- **审核置信度**：**极高**
  - 所有声称改动都做了 grep 级二次核验，不采信回执单方声明
  - 新发现的 P1-1（ADR-0005 误标）是独立发现，非 Backend 自认
- **是否建议升级 Human**：**否**，推到 Human 正常终审流程即可；这是 PASS-WITH-FOLLOWUP 的标准通道
- **独立性说明**：本 Round-2 未读 review-product 报告（当前也无）；未与其他 Review-Agent 信息交叉；所有断言均基于工具侧复现

---

## 终止状态

- **本卡 Review 闭环**：即将结束（SOP-REVIEW-AUTOLOOP 状态机：`auto-loop` → `pass-pending-human`）
- **FINAL.md**：本轮结论落定后由 Orchestrator 写入 `.team/reviews/COSTRA-100/FINAL.md`（terminal_verdict=PASS-WITH-FOLLOWUP / 总轮次=2 / p0_caught_in_review=3 / 自动循环触发=1）
- **球交给**：**Human**（需 `approve:COSTRA-100` 或 `reject:COSTRA-100 <原因>`；建议 approve，可选附带要求 Backend 就地修 P1-1）
