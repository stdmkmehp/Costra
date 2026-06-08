# Card Review · Tech · COSTRA-154 · Round 1

> **审查时间**：2026-05-19 20:30
> **审查 subagent**：`card-reviewer-tech-COSTRA-154-r1`（一次性装扮 · D-018 SBAI v1.1）
> **派单档**：`.team/dispatch/COSTRA-154-sync-pull-incremental-fetch.md`
> **依据**：SOP-CARD-REVIEW.md（C1~C8 八维 · 30 分制）+ D-025 反模式扫描清单（首次套用）+ D-022 v2.0 评分参考

---

## 总评

- **Verdict**：`REVISE`
- **总分**：21/30
- **阻塞点**：2 个 P0 + 2 个 P1 + 2 个 P2
- **D-025 反模式扫描**：AP-001 ☐ / AP-002 ☐ / AP-003 ☑（正向修复 · 不升 P1）

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 5/5 | 标题清晰可执行 · 描述含触发链 + PRD/契约锚点 + Sprint-3 启动决策 |
| C2 DoD 可度量 | 4/6 | 18 项 DoD + 14 闸门 + 3 反向验证结构完备 · 但缺 D-016 反例预防 M 项 + G7 闸门 grep 命令有误 |
| C3 依赖识别 | 5/5 | 上游 104/156/158 + 下游 150/152/153/151/155 + 决策类 D-025/022/014/016/018 完整 |
| C4 产出物具体 | 3/5 | 9 项 scope 含示例代码 · 但 A 项 SQL 错误（entries 表无 family_id 列）+ B 项类型错误 |
| C5 风险与边界 | 2/4 | 拆卡损益分析充分 · 但 family_id 越权查询方案未标注 JOIN ledgers · entries 表无 family_id 列导致的实装风险未暴露 |
| C6 去重 | 3/3 | backlog/board 无重复 · 与 104/150/152 职责清晰 · FU-104-SYNC-PULL 唯一来源 |
| C7 估点 | 2/2 | 5 点 INVEST small · 拆卡决策记录充分 |
| C8 红线 | Pass | 无 Won't-Have / 主体 / 目录越权 |

---

## P0 阻塞点（必须修后启 R1）

### P0-1 · A 项 SQL 引用不存在的列 `entries.family_id` · 运行时必 500

**证据**：
- `dispatch §2.1 A 项` L102 `WHERE family_id = $1` + L97 SELECT `family_id` 列
- `server/db/migrations/0001_init.sql` L108-124 `entries` 表 schema 实际**不含** `family_id` 列
- `server/src/repositories/entryRepo.ts:17-34` `EntryEntity` 接口也无 `familyId` 字段
- `entries → ledgers.family_id` 是间接关联（ledger_id 外键）
- 既有正确范式：`entryRepo.ts:265-279 findById` 已用 `JOIN ledgers l ON l.id = e.ledger_id JOIN family_members fm ON fm.family_id = l.family_id AND fm.left_at IS NULL`

**问题**：A 项示例代码运行时会抛 `column "family_id" does not exist` · 与既有 `findById` 范式不一致。

**修复方案**：
1. A 项 SQL 改为 JOIN ledgers 路径：
   ```sql
   SELECT e.id, e.ledger_id, l.family_id, e.user_id, e.client_ref_id,
          e.account_id, e.to_account_id,
          e.type, e.amount, e.currency, e.category_id, e.occurred_at, e.note,
          e.created_at, e.updated_at, e.deleted_at, e.version
     FROM entries e
     JOIN ledgers l ON l.id = e.ledger_id
    WHERE l.family_id = $1
      AND e.updated_at > $2
    ORDER BY e.updated_at ASC, e.id ASC
    LIMIT $3
   ```
2. B 项 `entryToWire` 中 `family_id` 从 JOIN 结果取（行包裹时即附加）。
3. 因为 EntryEntity 接口不变，新增 `PullEntryRow extends EntryEntity { familyId: string }` 中间类型 · 或在 A 项返回 `{ rows: Array<EntryEntity & {familyId: string}>, hasMore }`。

**联动**：B 项 `entryToWire` 函数签名同步调整 · 不再用 EntryEntity 直接 import · 改用 PullEntryRow。

### P0-2 · DoD 缺 D-016 反例预防 M 项（已跨 2 张卡审连续采纳）

**证据**：
- COSTRA-156 卡审 + R1 Review 已立强约束（`commit 前 git status -s | grep .team/members/ | wc -l = 0`）
- COSTRA-158 卡审同款采纳
- Sprint-2 末 Retro 议题 21 "D-016 v2.0 升定稿规约"（board.md L339）
- 但 dispatch §3 DoD 18 项中**无**此条款（dispatch 写于 2026-05-19 15:00 · 在 156/158 之后 · 应已含）

**问题**：违反已成既定惯例 · 第 8 次反例预防机制覆盖中断。

**修复方案**：§3.2 闸门表末尾追加：
```
| G15 | D-016 反例预防 | git status -s | grep '.team/members/' | wc -l | = 0（state.md + history 已 add 与 R1 同 commit）|
```
同时 §5.5 D-018 SBAI 铁律段加一行"commit 前 final message 含 `git status -s | grep .team/members/ | wc -l` = 0 输出"。

---

## P1 应改

### P1-1 · G7 闸门 grep 命令无法区分 stub vs 真实装

**证据**：当前 G7 = `grep -E "app\.(get|post|delete)\(SYNC_PULL_ENDPOINT" server/src/routes/sync.ts | wc -l ≥ 1` · stub 替换前后均为 1 · 无法验证替换成功。

**修复方案**：拆为 G7a + G7b：
- G7a · `grep "syncPull" server/src/routes/sync.ts | wc -l ≥ 1`（确保 import）
- G7b · `grep "deferred_card.*COSTRA-154" server/src/routes/sync.ts | wc -l = 0`（确保 stub 已删）

### P1-2 · syncPullService B 项类型与 A 项联动错误（与 P0-1 联动）

**证据**：B 项 L150 `entries: ReturnType<typeof entryToWire>[]` + L194 `function entryToWire(e: EntryEntity)` · 但 EntryEntity 无 familyId · 修复 P0-1 后 entryToWire 输入类型需扩展。

**修复方案**：与 P0-1 修复方案 3 同步 · entryToWire 输入改为 `EntryEntity & { familyId: string }` 或 `PullEntryRow`。

---

## P2 建议

### P2-1 · A 项 SELECT 列与协议字段对齐

**证据**：A 项 SELECT 不含 `currency` 列 · 但既有 `findEntriesByLedger`（entryRepo.ts L243）含 `currency` · 协议 `sync-protocol.md §3.2` 响应 Entry 对象未明确列字段清单。

**修复方案**：R1 实装前确认协议 §3.2 Entry 字段清单 · 与 A 项 SELECT + B 项 entryToWire 对齐。倾向加 currency（与 findEntriesByLedger 一致）· 同时 entryToWire 加 `currency` 字段输出。

### P2-2 · OpenAPI 修订后 400/401/403 ref 验证

**证据**：D 项 L303-305 引用 `#/components/responses/BadRequest|Unauthorized|Forbidden` · 需验证已存在。

**修复方案**：R1 实装时 grep 验证 · 缺则在 D 项 scope 内补建。

---

## §4 D-025 反模式扫描清单

| ID | 反模式 | 命中 | 证据 |
|---|---|---|---|
| AP-001 字符串代理判定 | ☐ No | entry.deleted_at 是事实字段（ISO timestamp / null）· 非字符串推断 · isUserInFamily 用 DB 查询 |
| AP-002 概率极低就接受 | ☐ No | watermark 单调性是协议保证（NOW() 不回退 · sync-protocol §6.3）· 非概率推断 |
| AP-003 契约-实装漂移 | ☑ Yes（正向修复）| COSTRA-104 R1 用 x-deferred 标记（openapi.yaml L631-634）+ stub 501 · 154 R1 实装即修复 · D 项删 x-deferred + C 项替换 stub · **AP-003 好例 1 范式正向兑现** |

**结论**：命中 1 条（AP-003 · 正向修复）· AP-001/002 未命中 · 无升 P1。

---

## §5 红线 / Won't-Have / 宪章合规

| 检查项 | 结果 |
|---|---|
| Won't-Have（charter §5）| ✅ 不涉及 AI 语音/OCR/独立 App/E2E 加密/支付/理财 |
| 硬编码 secret | ✅ 全部参数化 |
| D-008 主体字样硬编码 | ✅ dispatch §1.2 明确"与主体无关" |
| 目录越权 | ✅ §5.1 工作区铁律明确 |
| engineering-guidelines | ✅ 单卡单 commit + commitlint + 参数化查询 |

---

## §6 派单档可改进点（minor · 不阻 R1 启动 · 与 P0/P1 修订并入 R1.x dispatch revise）

1. §2.1 A 项加注释行："⚠️ entries 表无 family_id 列 · 必须 JOIN ledgers · 参 findById L272-273 范式"
2. §2.1 B 项 import 段补："若 familyMemberRepo.ts 不存在则 inline SQL：`SELECT 1 FROM family_members WHERE family_id=$1 AND user_id=$2 AND left_at IS NULL LIMIT 1`"（加 left_at IS NULL · 与 entryRepo L273 范式一致）
3. §6 commit message 模板 footer `closes: fu-104-sync-pull` 改 `closes: FU-104-SYNC-PULL`（大写 · 与 follow-ups README 命名空间一致）

---

## §7 R1 启动指令

请 Orchestrator 按 P0/P1 清单修订 dispatch（dispatch revise · 4 处改动 · ≤ 5 分钟）→ 同轮发起 Card-Review R2（同 subagent 复审）→ R2 PASS 后 spawn `costra-backend-dev` 启 R1 实装。

预计 R2 verdict = APPROVE 28~30/30（修订后无遗留 P0/P1 · P2 顺手并入 R1 实装）。

---

## §8 自我反思

- 审核耗时：~25 分钟
- 置信度：**高**
  - P0-1 基于 0001_init.sql + entryRepo.ts EntryEntity 接口双重事实源验证
  - P0-2 基于 156/158 卡审 + R1 Review + Sprint-2 末 Retro 议题 21 多重交叉验证
  - AP-003 命中判定与 dispatch §3.5 / §5.7 预测一致 · 属正向兑现
- 无需转 Human 二裁

---

**报告由 Orchestrator 接收 final message 后落档。**
