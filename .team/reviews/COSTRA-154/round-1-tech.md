# Round 1 · Tech Review · COSTRA-154

> **审查时间**：2026-05-19 20:35
> **审查 subagent**：`review-tech-COSTRA-154-r1`（一次性装扮 · D-018 SBAI v1.1）
> **R1 commit**：`7e87bad` · **R1.x.1 修订 commit**：待 commit（P1-1+P1-2 顺手并入 · D-017 v3 §2.4 E1 第 8 次实战）
> **依据**：D-022 v2.0 评分表第 7 次实战（40 分制）+ D-025 反模式扫描清单 §5

---

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP` → R1.x.1 修订后 `APPROVE`
- **总分**：36/40 → R1.x.1 修订后 38/40
- **阻塞点**：0 P0 / ~~2 P1~~（已修） / 3 P2

## 维度得分

| 维度 | R1 得分 | R1.x.1 修订后 | 一句话 |
|---|---|---|---|
| C1 契约对齐 | 5/5 | 5/5 | OpenAPI x-deferred 删 + 缩进修 + tags/summary/security 加 + SyncPullResponse required has_more 补齐 |
| C2 代码质量 | 5/5 | 5/5 | findEntriesByFamilySince LIMIT+1 has_more · entryToWire 输入 PullEntryRow · since ISO 二次容错 |
| C3 架构合理 | 5/5 | 5/5 | repo/service/route 三层职责 · isUserInFamily 在 service 层 · inline SQL 含 left_at IS NULL |
| C4 数据完整 | 5/5 | 5/5 | watermark 单调性 · 软删保留（T11）· server_version 字段映射（T13）· snake_case 100%（T12） |
| C5 安全 | 5/5 | 5/5 | JWT + family_id 越权 + query schema + since 二次容错 |
| C6 可测性 | 5/5 | 5/5 | 14 测全绿（49 测全绿）+ 反向验证 G9/G10/G11 |
| C7 纪律 | 4/5 | 5/5 | R1.x.1 修复 commit hash 引用一致性（5 处文档 00d604c → 7e87bad） |
| C8 runtime 加载性 | 4/5 | 5/5 | R1.x.1 修复 SyncPullResult.changes.ledgers `never[]` → `unknown[]` 与 OpenAPI 契约对齐（不破坏 MVP 行为） |
| C9 性能 | 4/5 | 4/5 | LIMIT+1 + 纯映射 · 但 (l.family_id, e.updated_at) 复合索引留 P2-1 FU-154-COMPOSITE-INDEX |
| C10 SBAI 流程合规 | 4/5 | 5/5 | R1.x.1 修复 commit hash 引用 + state/history 同 commit |

---

## P0 阻塞点

无。

## P1 应改 → 已修订

### ✅ P1-1 · SyncPullResult.changes.ledgers `never[]` 与 OpenAPI ledgers schema 不对齐（已修）

**修订**：`server/src/services/syncPullService.ts:32-46` `categories/budgets/ledgers` 类型从 `never[]` 改为 `unknown[]` · 加注释说明 R1 Review P1-1 修订记录 + OpenAPI 契约对齐目的（MVP 实际返 [] 与契约兼容 · FU-154-CATEGORIES-PULL 实装时不破坏类型）。

**核验**：
- `npx tsc --noEmit` exit 0
- `npm run test` 49/49 全绿（无回归）

### ✅ P1-2 · follow-ups / defects / history commit hash 引用一致性（已修）

**修订**：5 处 `00d604c` 统一为 `7e87bad`（amend 后实际 HEAD）：
- `.team/follow-ups/README.md:30` + `:85` + `:86`（族 A 第一行 + FU-104-SYNC-PULL closed 段 × 2）
- `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md:139` resolved_by
- `.team/members/backend-dev/history/2026-05-19-costra-154-r1-implement.md:3` 头部 commit 引用

## P2 建议

### P2-1 · (l.family_id, e.updated_at) 无复合索引 · 留 FU-154-COMPOSITE-INDEX（DAU > 100 触发）

### P2-2 · isUserInFamily 返回 boolean 丢失角色信息 · 留 FU-154-FAMILY-MEMBER-REPO（COSTRA-200 系列卡触发）

### P2-3 · T10 二次拉取测试用 id 二级排序保证稳定 · 无需修改（仅记录）

---

## §5 D-025 反模式扫描清单

| ID | 反模式 | 命中 | 证据 |
|---|---|---|---|
| AP-001 字符串代理判定 | ☐ No | entry.deleted_at 是 ISO timestamp / null 事实字段 · isUserInFamily 用 DB 查询 · entryToWire 字段映射不涉及代理判定 |
| AP-002 概率极低就接受 | ☐ No | watermark 单调性是协议保证（NOW() 不回退）· 软删保留是确定性设计 |
| AP-003 契约-实装漂移 | ☑ Yes（正向修复）| COSTRA-104 R1 用 x-deferred 标记 + stub 501 → 154 R1 实装即修复 · D-025 §1 AP-003 好例 3 范式正向兑现 · **R1.x.1 修订进一步消除 ledgers 类型层面契约漂移** |

**结论**：命中 1 条（AP-003 · 正向修复 · R1.x.1 进一步加固）。

---

## §6 反向验证 G9/G10/G11 核验

| 项 | 期望 | 实际 | 结果 |
|---|---|---|---|
| G9 · `>=` 边界 → T10 FAIL | `WHERE e.updated_at > $2` | entryRepo.ts:303 严格大于 | ✅ |
| G10 · server_version 映射 → T13 FAIL | `server_version: e.version` | syncPullService.ts:96 字段名正确 | ✅ |
| G11 · 注释 isUserInFamily → T6 FAIL | 先校验后查 entries | syncPullService.ts:54-58 顺序正确 | ✅ |

## §7 协议事实源对账 G12/G13/G14

| 项 | 期望 | 结果 |
|---|---|---|
| G12 · whitelist-check 规则 D | exit 0 | ✅ 3 envs / 3 runtime urls matched |
| G13 · OpenAPI vs fastify 对齐 | 路径方法参数 schema 一致 | ✅ |
| G14 · 105 D.2 + H6 等效回归 | defect RESOLVED | ✅ |

---

## §8 follow-up 项

| FU-ID | 优先级 | 触发条件 |
|---|---|---|
| FU-154-CATEGORIES-PULL | P2 | Sprint-4+ 家庭模式 |
| FU-154-FAMILY-MEMBER-REPO | P2 | COSTRA-200 系列卡 |
| FU-154-X-DEFERRED-CI-CHECK | P2 → 已转 COSTRA-161 | Sprint-3 中段 |
| FU-154-COMPOSITE-INDEX | P3 | DAU > 100 |

---

## §9 红线 / Won't-Have / 宪章合规

全 ✅（详见 R1 报告 §9）。

---

## §10 自我反思

- 审核耗时 ~35 分钟
- 置信度 高（10 维度全证据链 + 反向验证 + 协议对账 + 反模式扫描全核验）
- R1.x.1 修订已落 P1-1 + P1-2 · D-017 v3 §2.4 E1 第 8 次实战 · ≤ 5 分钟单 commit
- R1.x.1 修订后 verdict APPROVE 38/40 · 等 Human 联合 150 实测 + approve

---

## §11 R1.x.1 修订记录（D-017 v3 §2.4 E1 第 8 次实战）

**触发**：R1 Review 后 P1-1（never[] → unknown[]）+ P1-2（commit hash 5 处统一）顺手并入修订路径

**修订内容**：
1. `server/src/services/syncPullService.ts` SyncPullResult.changes 类型放宽 + 注释说明
2. `.team/follow-ups/README.md` 3 处 hash 引用
3. `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md` 1 处
4. `.team/members/backend-dev/history/2026-05-19-costra-154-r1-implement.md` 1 处
5. `.team/reviews/COSTRA-154/round-1-tech.md` R1.x.1 落档（本文件）

**闸门复跑**：typecheck 0 错 / test 49/49 全绿 / lint 0 warn / check:appjson + check:tooling + check:whitelist 全 exit 0

**commit message 模板**：
```
fix(server): syncpull changes ledgers types unknown[] + hash refs sync (costra-154 r1.x.1)

p1-1: changes.{categories,budgets,ledgers} from never[] to unknown[]
  - openapi defines them as ledger[]/category[]/budget[]
  - mvp returns [] is contract-compatible
  - never[] blocks future fu-154-categories-pull type extension

p1-2: 5 docs hash refs 00d604c -> 7e87bad sync (amend produced new sha)
  - .team/follow-ups/README.md (3 places)
  - qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md (1)
  - .team/members/backend-dev/history/2026-05-19-costra-154-r1-implement.md (1)

gates: typecheck 0 / test 49/49 / lint 0 / checks all green
no behavior change. type widening only. doc cosmetic.

refs: .team/reviews/COSTRA-154/round-1-tech.md sec-11
```

**verdict 升级**：PASS-WITH-FOLLOWUP 36/40 → APPROVE 38/40
