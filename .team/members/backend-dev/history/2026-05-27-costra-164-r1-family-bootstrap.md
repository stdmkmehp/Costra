# 2026-05-27 · COSTRA-164 R1 实装（server family bootstrap MVP）

> **装扮档**：costra-backend-dev
> **dispatch**：v2.1 · `.team/dispatch/COSTRA-164-server-family-bootstrap-mvp.md`
> **决策锚定**：ADR-0007 v1.1 family-ledger 关系模型（方案 R）
> **Card-Review**：R1 25/30 PASS-WITH-FOLLOWUP（6 项 FU 全落地修订到 v2.0）→ R2 28/30 PASS-WITH-FOLLOWUP（v2.1 残留清理）
> **commit**：`<待 Orchestrator 收尾时填入>`
> **耗时**：~158min（subagent 81 工具调用 · ≤ 180min 时间盒）
> **D-016 反例**：第 N 次（subagent 完成代码但未做 commit + state/history 归档 · Orchestrator 接管收尾 · Sprint-2 末 retro 议题"SBAI 装扮档 7 点卡需在 R1 内分阶段 commit"实战预警）

---

## §1 交付 6 项 scope

| # | 交付 | 文件 | 行数 |
|---|---|---|---|
| A0 | migration 0007 family_kind ENUM + kind 列 + partial unique index + 历史回填 | `server/db/migrations/0007_families_kind.sql`（新建） | 52 |
| A | familyRepo（含 createPersonalFamily / listActiveFamiliesByUser / findPersonalFamily / softDelete kind 守门）| `server/src/repositories/familyRepo.ts`（新建） | 204 |
| A | ledgerRepo（含 createDefaultLedger / findFirstByFamilyId）| `server/src/repositories/ledgerRepo.ts`（新建） | 103 |
| B | authService.wxLogin atomic bootstrap + isUniqueViolation + try-catch fallback findPersonalFamily | `server/src/services/authService.ts`（修改） | +95 行 |
| C | AuthTokenPair 接口加 default_family_id/ledger_id + OpenAPI schema 同步 | `server/src/services/authService.ts` + `server/api/openapi.yaml` | +6 |
| D | env.ts MAX_FAMILIES_PER_USER=20 + USER_VISIBLE_FAMILY_LIMIT=3 占位 | `server/src/config/env.ts`（修改）| +2 |
| E | 单测 T1~T10 + 反向验证 ①②③ | `server/test/auth-family-bootstrap.test.ts`（新建）| 400（10 测） |
| 联动 | ErrorCode 加 FAMILY_PERSONAL_NOT_DELETABLE = 403 + retry 'none' | `server/src/errors/ErrorCode.ts`（修改）| +3 行 |
| 联动 | pg-mem schema 同步加 family_kind ENUM + partial unique index | `server/test/setup.ts`（修改 · 范围外但合理 · FU-PG-MEM-SHARED-HELPER 已立案 P2）| +5 行 |

---

## §2 DoD 23 项核验结果

| 闸门 | 结果 | 证据 |
|---|---|---|
| G1 typecheck | ✅ | `cd server && npm run typecheck` 通过（tsc + tsc test config）|
| G2 ESLint | ✅ | `npm run lint` 通过（COSTRA-117 deferred 范式）|
| G3 OpenAPI lint | ✅ | typecheck 含 yaml 校验 · AuthTokenPair 新字段合法 |
| G4 server 单测 | ✅ | **80 / 80 测全绿**（含 auth-family-bootstrap.test.ts 10 测）|
| G5 schema-check | ✅ | pg-mem setup.ts 已同步 0007 schema |
| G6 whitelist-check | ✅ | `npm run check:whitelist` 通过（3 envs · 3 runtime urls 匹配）|
| G7 OpenAPI 实装齐全 | ✅ | AuthTokenPair 新字段 server 端实装一致（authService L56/L58）|
| G8 x-deferred 不新增 | ✅ | `grep -c deferred openapi.yaml` = 0（未引入 · /families/* 段不动）|
| G15 D-016 反例预防 | ⚠️ | **subagent 未做 history/state/commit · Orchestrator 接管收尾** |
| G16 migration 0007 幂等性 | ✅ | DO/EXCEPTION 包裹 ENUM + IF NOT EXISTS 包裹列和索引（0007_families_kind.sql L20-23, L27-28, L48-50）|
| T1~T10 | ✅ | 10/10 测全绿 |
| 反向验证 ①②③ | ✅ | 由测试自身覆盖（事务回滚 / fallback / partial unique index 拦截）|

**实际 DoD 22/23 通过 · G15 反例命中**（subagent 漏 commit + 漏归档 · 同 Sprint-2 末 retro 议题）

---

## §3 D-025 反模式扫描

| AP | 命中 | 证据 |
|---|---|---|
| AP-001 字符串代理判定 | ❌ 不命中 | kind ENUM 是显式状态枚举非字符串代理 |
| AP-002 概率极低就接受 | ❌ 不命中 | partial unique index 物理消除多 personal · race condition 走 catch+fallback 自愈 |
| AP-003 契约-实装漂移 | ⚠️ 已知命中（不阻塞）| /families/* L161-319 共 6 端点无实装无 x-deferred · 与 dispatch v2.0 §3 AP-003 声明一致 · 推 COSTRA-161 / COSTRA-201 处理 |

---

## §4 实装中的关键决策（与 dispatch 一致）

1. **withTx 复用 pool.ts:L45-62**（FU-164-001 已落地 v2.1 · 不新建 transaction.ts）
2. **isUniqueViolation 工具就地内联**（FU-164-002 · authService L130-138 · 双校验 code='23505' + constraint 名）
3. **race condition fallback**（FU-164-002 · authService L160-167 · catch unique violation → findPersonalFamily → 极边缘 throw UNAVAILABLE）
4. **softDelete kind 守门**（FU-164-004 · familyRepo · ADR-0007 §5.7.3 早期防御）
5. **pg-mem schema 同步**（被动落地 · 不在 dispatch §5.1 工作区铁律 · 但 0006 v1.2 升级已立先例 · FU-PG-MEM-SHARED-HELPER P2 已立案）

---

## §5 实测发现（无与 dispatch 偏差）

- 无新发现 P0/P1/P2 问题
- pg-mem 兼容 ENUM type + partial unique index（与 dispatch §2.1 A0 兼容性提醒一致）
- bootstrap 事务时延暂未实测（**[未经验测]** · D-022 §2.2 C8-3 · 留与 165 联合 staging 实测时观察 · FU-164-006 锚定）

---

## §6 已知 follow-up 候选

- **FU-PG-MEM-SHARED-HELPER**（P2 · 已立案 · Sprint-3 末 Retro）：本卡 setup.ts 同步 0007 schema · 进一步证明需要公共 helper
- **FU-164-FAMILY-KIND-CHECK-MIDDLEWARE**（P2 · 已立案 · Sprint-4）：DELETE /families REST 落地时评估抽出 requireKind 中间件
- **FU-164-WITH-TX-UTIL**（已确认复用 · Sprint-4 评估）

---

## §7 联动事项（Orchestrator 收尾）

- **更新 follow-ups README**：FU-150-FAMILY-CONTEXT-SERVICE → `partial-closed @ COSTRA-164 (server)` · 等 165 完整闭合
- **不更新 Phase-3 实测手册**：等 165 联合 approve 后 spawn qa-planner 出新版手册（D-025 §议题 25 反模式：Orchestrator 不直写 Human 操作类文档）
- **下一步**：spawn review-tech R1 Review（D-022 v2.0 第 N 次实战）· 或 D-024 §2.2 C1 与 165 攒批联合 approve（推荐 · 165 也需 backend 提供的 default_family/ledger_id 协议）
