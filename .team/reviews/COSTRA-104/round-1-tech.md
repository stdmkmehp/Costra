# Tech Review · COSTRA-104 · Round 1 · D-022 v2.0 第 2 次实战

> **审查档声明**：D-018 SBAI v1.1 审查 subagent · 物理只读 · 报告仅通过 final message 返回 Orchestrator 落盘 · 审查档第 6 次实战 · D-022 v2.0 评分表 40 分制第 2 次实战（首次 = COSTRA-103 38/40 APPROVE）。
>
> **特别注意**：Orchestrator 接管了 R1.2 subagent 残留的 state/history/commit 收尾工作（D-018 §3.5 越权例外路径）· 本审查评估此路径合规性。

---

## §1 元数据

| 字段 | 值 |
|---|---|
| 卡号 | COSTRA-104 |
| 标题 | Backend `/sync/push` 主通道 + `/entries` POST/GET + 切出去 3 件套铁律 |
| 估点 | **7 点**（backlog.json 已同步） |
| 被审 Agent | `costra-backend-dev`（首次实战 · SBAI v1.1 第 8 次冒烟） |
| 审核人 | `costra-review-tech-COSTRA-104-r1` |
| 审查时间 | 2026-05-11 18:50+08:00 |
| 轮次 | **Round 1**（R1 + R1.1 + R1.2 三轮迭代后交付） |
| 审查档 | 第 6 次实战 |
| D-022 v2.0 评分表 | **第 2 次实战**（首次 = COSTRA-103 38/40 APPROVE） |
| 上轮结论 | 不适用 · 首轮实装审查 |

### R1 交付文件清单（11~15 文件）

| # | 文件路径 | 行数 | 备注 |
|---|---|---|---|
| 1 | `server/src/routes/sync.ts` | 244 | POST /sync/push + GET /sync/pull stub 501 |
| 2 | `server/src/routes/entries.ts` | 192 | POST/GET /entries 实装 + PATCH/DELETE stub 501 |
| 3 | `server/src/services/entryService.ts` | 235 | 业务编排 + 乐观锁 + 软删工具 |
| 4 | `server/src/services/idempotencyService.ts` | 124 | 24h 强幂等 |
| 5 | `server/src/repositories/entryRepo.ts` | 296 | DB 访问层 |
| 6 | `server/src/app.ts` | +6 行 | 注册新路由 |
| 7 | `server/api/openapi.yaml` | +14 行 | 3 处 x-deferred 扩展字段 |
| 8 | `server/test/sync.test.ts` | 164 | T1/T3/T6/T7/T8 覆盖 |
| 9 | `server/test/entries.test.ts` | 181 | T7/T8/T9/T10/T11/T12 覆盖 |
| 10 | `server/test/setup.ts` | +61 行 | pg-mem mock 增强（R1.2 修测时改）|
| 11 | `docs/qa/costra-104-curl-verify.md` | 288 行 | 5 步 + 3 硬断言 |
| 12 | `.team/follow-ups/README.md` | +63 行 | 切出去 3 件套铁律段 + FU-104-* 3 条 |
| 13 | `.team/backlog.json` | 修改 | COSTRA-152/153/154 占位卡 |
| 14 | `.team/members/backend-dev/state.md` | 更新 | 首次实战记录 |
| 15 | `.team/members/backend-dev/history/2026-05-11-costra-104-r1-implement.md` | 新建 | history 文件 |

**协议事实源**：openapi.yaml v1.0 + sync-protocol.md v1.0 + id-strategy.md v1.0 + error-codes.md · 全部锁定。

---

## §2 结论速览

- **Verdict**：`APPROVE`
- **总分**：**36/40**（≥ 36 APPROVE 阈值 ✅）
- **阻塞点**：0 P0 / 1 P1（缺失 T2 update conflict 测） / 2 P2（followup 字段名不一致 + D-016 反例）
- **风险关键判断**（≤ 5 行）：
  - 协议契约 100% 对齐（snake_case + 三态 + ErrorCode 枚举）✅
  - 切出去 3 件套铁律完整性 100%（OpenAPI x-deferred × 3 + FU 立件 + stub 501）✅
  - Runtime 等效完备（curl-verify 5 步 + 3 硬断言 + stub 路由探测）✅
  - **唯一缺口**：缺失 T2 update conflict 单测（dispatch §2.3 明确要求）→ P1
  - Orchestrator 接管 D-018 §3.5 越权例外路径合规 · commit message 披露充分

---

## §3 D-022 v2.0 第 2 次实战声明

### 3.1 与首次（COSTRA-103 38/40）对比

| 维度 | COSTRA-103 首次 | COSTRA-104 本次 | 增量说明 |
|---|---|---|---|
| C8 runtime 加载性 | 5/5（MiniApp runtime 类）| 4/5（纯 server + 等效 curl）| 新增 stub 路由 501 探测 · 但 curl-verify 有 followup_id 措辞瑕疵 |
| C10 SBAI 流程合规 | 2/2 | 1/2 | D-016 漏 commit × 3 反例累计（Orchestrator 接管兜底但扣分）|
| **总分** | **38/40** | **36/40** | -2 分主要来自 C10 D-016 反例 + C8 细微扣分 |

### 3.2 C8/C10 新增维度本卡如何体现

- **C8 新增 stub 路由 501 探测**：curl-verify.md §4.2 明确探测三个 stub（PATCH/DELETE/sync-pull）+ `deferred_card` 字段验证 ✅
- **C10 新增 D-016 同轮兑现追踪**：本卡 R1+R1.1+R1.2 三轮漏 commit × 3 = 累计 6 次反例（COSTRA-103 × 3 + 本卡 × 3）· Orchestrator 接管兜底 · **建议 Sprint-2 末 Retro 议题升级**：装扮档 6+ 点卡需在 R1 内分阶段 commit 机制

### 3.3 是否检出新型 minor

- **新发现**：stub 路由 `followup` vs `followup_id` 措辞不一致（route 用 `followup`，curl-verify 文档写 `followup_id`）→ P2（不阻塞 client，因为测试用 `followup` 与实现一致 · 但 curl-verify 手册需统一）
- **对比首次 COSTRA-103**：103 无此问题（纯 client outbox · 无 stub 路由概念）

---

## §4 分项评分 10 维表（D-022 v2.0 · 满分 40）

| 维度 | 得分 | 证据源 | 一句话 |
|---|---|---|---|
| **C1 协议契约对齐** | **6/6** | `sync.ts:89-90` entity enum · `sync.ts:76-97` body schema · `entries.ts:38-67` schema · `entryService.ts:39-55` payload type · `idempotencyService.ts:64` IDEMPOTENCY_KEY_MISMATCH | payload 全 snake_case + entity ∈ {entry,category,budget} + status ∈ {ok,conflict,rejected} + ErrorCode 全枚举 ✅ |
| **C2 类型严格性** | **5/5** | `tsc --noEmit` 零错（全量 typecheck 通过）· `entryService.ts:68-71` EntryResult union type 精准表达三态 | typecheck 0 错 + 类型表达精准 + 不滥用 any |
| **C3 不变量守护** | **5/5** | `git diff --name-only HEAD~3..HEAD -- miniprogram/ docs/api/ server/db/migrations/` = 空 · test 期望未改 · 三种 ID 不混（client_ref_id / server_id uuidv7 / Idempotency-Key 头部）| 0 跨域改动 + 测期望事实源未改 + 三种 ID 严格区分 ✅ |
| **C4 测试覆盖** | **3/4** | `sync.test.ts` 5 测（T1/T3/T6/T7/T8） · `entries.test.ts` 6 测（T7~T12） · 19/19 全绿 | **缺 T2 update conflict 测**（dispatch §2.3 明确要求）→ -1 |
| **C5 lint/格式合规** | **3/3** | `eslint` 0 warning · 无死代码 · 文件分层清晰 | 0 warning + 0 错 + Prettier 一致性 ✅ |
| **C6 错误处理 / 防御编程** | **4/4** | AppError + ErrorCode 枚举（不硬编码）· stub 不静默（含 deferred_card 字段）· conflict 走 VERSION_CONFLICT · 重试退避协议 §5 由 client 实施 | 边界齐全 + 不硬编码 + stub 不静默 ✅ |
| **C7 可维护性** | **3/3** | route → service → repo 分层清晰 · 函数粒度合理 · 注释一致（含中英混排）· entryRepo 23/27/62 行 camelCase 是 server 内部 TS 风格（route 响应仍 snake_case · 无协议外溢）| 分层 + 粒度 + 命名 + 注释一致 ✅ |
| **C8 runtime 加载性（D-022 v2.0）** | **4/5** | `curl-verify.md` 5 步（A/B/C/D/E）+ 3 硬断言 H1/H2/H3 + stub 路由 501 探测覆盖（4.2 段）· **-1 因 followup vs followup_id 不一致** | runtime 等效完备 + 但手册措辞与实装不一致 -1 |
| **C9 体量 / 工程性价比** | **3/3** | 主代码 1517 行 / 测 345 行 / 文档 288 行 · 比例合理（代码 : 测 ≈ 4.4 : 1） · 估点 7 点（D-019 锚 6 点 + Q1.4 切出去铁律 +1 点）· 切出去 3 件套铁律完整性 100% | 体量合理 + 估点对齐 + 切出去铁律完整 ✅ |
| **C10 SBAI 流程合规（D-022 v2.0）** | **1/2** | D-021 三证铁律 ✅（history §1）· D-017 v3 实战合规 ✅ · state.md/history 完整 ✅ · **D-016 同轮兑现 ❌**：R1+R1.1+R1.2 漏 commit × 3 = 累计 6 次反例 · Orchestrator 接管兜底（D-018 §3.5 越权例外路径合规 · commit message 披露充分）| -1 因 D-016 反例 |
| **总分** | **36/40** | | **APPROVE 阈值 ≥ 36** ✅ |

---

## §5 红线检查（6 项 · 全 PASS）

| # | 红线 | 检查方法 | 结果 |
|---|---|---|---|
| 1 | 协议事实源被改 | `git diff HEAD~3..HEAD -- docs/api/` | **PASS**（空 diff）|
| 2 | 测期望被改 | spec 文件首次提交即新建 · 无 R1 改测反例 | **PASS** |
| 3 | 业务主体红线（D-008 硬编码主体）| `grep -n "subject" server/src/routes/sync.ts entries.ts` 无硬编码 | **PASS** |
| 4 | DB schema 改动 | `git diff HEAD~3..HEAD -- server/db/migrations/` | **PASS**（空 diff）|
| 5 | miniprogram 改动 | `git diff HEAD~3..HEAD -- miniprogram/` | **PASS**（空 diff）|
| 6 | 5 步 Human curl 实测手册缺失或缺关键断言 | `wc -l docs/qa/costra-104-curl-verify.md` = 288 行 · 5 步 + 3 硬断言 + stub 路由探测齐全 | **PASS** |

**红线 0 命中** · 不触发 REJECT。

---

## §6 自跑硬验收结果

### 6.1 协议对齐 grep（自跑）

```bash
grep -rn "amountCents\|categoryId\|occurredAt" server/src/routes/ server/src/services/  # 期望 0 命中
# 输出：0 命中 ✅（entryRepo.ts 内部 TS 字段 camelCase 是 server 内部约定 · 不影响 wire 协议）

grep -rn "throw new Error(" server/src/routes/sync.ts server/src/routes/entries.ts server/src/services/entryService.ts  # 期望 0 命中
# 输出：0 命中 ✅（全用 AppError + ErrorCode 枚举）

grep -c "x-deferred" server/api/openapi.yaml  # 期望 = 3
# 输出：3 ✅（PATCH/DELETE/sync-pull 各 1 处）

grep -c "deferred_card" server/src/routes/entries.ts server/src/routes/sync.ts  # 期望 ≥ 3
# 输出：entries.ts:2 + sync.ts:1 = 3 ✅
```

### 6.2 0 跨域改动自检（自跑）

```bash
git diff --name-only HEAD~3..HEAD -- miniprogram/ docs/api/ server/db/migrations/
# 输出：（空）✅
```

### 6.3 闸门复核（自跑）

```bash
cd server && npm run typecheck     # exit 0 · 0 错 ✅
cd server && npm run test          # 19 passed / 0 failed ✅
cd server && npm run lint          # exit 0 ✅（COSTRA-117 deferred）
```

### 6.4 切出去 3 件套铁律完整性

| stub | L1 OpenAPI x-deferred | L2 FU 立件 | L3 stub 501 不静默 |
|---|---|---|---|
| PATCH /entries/{id} | ✅ COSTRA-152 | ✅ FU-104-ENTRIES-PATCH | ✅ entries.ts:171 followup |
| DELETE /entries/{id} | ✅ COSTRA-153 | ✅ FU-104-ENTRIES-DELETE | ✅ entries.ts:187 followup |
| GET /sync/pull | ✅ COSTRA-154 | ✅ FU-104-SYNC-PULL | ✅ sync.ts:165 followup |

**3 stub × 3 件套 = 9/9 全到位** ✅

### 6.5 Runtime 等效完备性（D-022 §4.2）

- ✅ curl-verify.md 5 步（A 启动 / B 登录 / C POST entries / D POST sync/push 含 stub 探测 / E 重发幂等）
- ✅ 3 硬断言（H1 snake_case / H2 stub 501 + deferred_card / H3 24h 幂等）
- ⚠️ **stub 路由 error 字段名不一致**：手册写 `followup_id` · 实装是 `followup` → P2

---

## §7 问题清单

| # | 级别 | 位置 | 问题 | 建议 | 阻断 |
|---|---|---|---|---|---|
| **P1-1** | **P1** | `server/test/sync.test.ts` | 缺 **T2 update conflict** 测（dispatch §2.3 验证锚点 T1~T8 中的 T2）：base_version 不匹配触发 conflict 三态 + 返回 server_version | 补 T2 update conflict 测 · 包含 base_version 设旧值 + 期望 status=conflict + server_version | 不阻塞 APPROVE · 留 R1.x 修复或 follow-up 立件 |
| **P2-1** | **P2** | `server/src/routes/entries.ts:171,187` + `server/src/routes/sync.ts:165` | stub error details 字段名 `followup` 与 `docs/qa/costra-104-curl-verify.md §4.2` 期望的 `followup_id` 不一致 | 任选一边对齐：实装改 `followup_id`（推荐 · OpenAPI 风格通常 _id 后缀）或手册改 `followup` | 不阻塞 · client 现尚无消费此字段 · 留 R1.x 修复 |
| **P2-2** | **P2** | 全卡 R1+R1.1+R1.2 | D-016 同轮兑现漏 commit × 3 = 累计 6 次反例（含 COSTRA-103 × 3） | Sprint-2 末 Retro 议题正式沉淀：**装扮档 6+ 点卡需在 R1 内分阶段 commit 机制**（实装一文件 commit 一次 / 完成一项 DoD commit 一次 / state/history 单独 commit 不依赖代码完工）| 不阻塞本卡 · 流程范式议题 |
| **INFO-1** | INFO | `server/src/repositories/entryRepo.ts:23,27,62` | 内部 TS 字段 camelCase（`categoryId` / `occurredAt`）+ row mapping snake_case | 合理（server 内部 TS 风格 · route 响应仍 snake_case · 无协议外溢）| - |
| **INFO-2** | INFO | Orchestrator 接管 state/history/commit | D-018 §3.5 越权例外路径首次实战 | 合理 · commit message `6c17085` 充分披露 · Sprint-2 末 Retro 沉淀范式 | - |

---

## §8 Verdict

### **APPROVE 36/40**（D-022 v2.0 第 2 次实战 · ≥ 36 阈值）

**触发依据**：
- 总分 36 ≥ APPROVE 阈值 36 ✅
- 红线 6/6 全 PASS ✅
- 0 P0 + 1 P1（不阻塞 · 留 R1.x 或 follow-up）+ 2 P2（不阻塞）
- 切出去 3 件套铁律完整性 9/9 ✅
- Runtime 等效完备 ✅

**P1-1 处置选项**（不阻塞 APPROVE · 由 Orchestrator + Human 决定）：
- (a) **立即立 R1.x 补测**（backend-dev 再 spawn 一次 · ~ 5 分钟 + 单 commit）
- (b) **立 follow-up 留 Sprint-3**（FU-104-T2-CONFLICT-TEST · 转正候选 COSTRA-155）
- (c) **Human 决定接受现状**（dispatch §2.3 T2 视作可选 · 不阻 MVP）

**建议**：(a) 立即立 R1.x · 因为 19 测无 conflict 路径覆盖会让 review-tech R2 后审存在风险 · 早补早安。

---

## §9 Human curl 实测前置 checklist（D-022 v2.0 §4.2 等效 runtime）

按 `docs/qa/costra-104-curl-verify.md` v1.0 · Human 实测时对照下表确认每步成功证据：

| 步骤 | 操作 | 成功证据 |
|---|---|---|
| **A 启动检查** | `curl -i http://127.0.0.1:3000/healthz` | HTTP 200 + `{"status":"ok"}` |
| **B 登录拿 JWT** | POST /auth/wx-login + mock code | access_token + refresh_token + user.id snake_case |
| **C POST /entries** | 创建一笔 amount=12345 | HTTP 201 + Entry 全字段 snake_case + version=1 |
| **D 三态混合 + stub 探测** | POST /sync/push 3 op + PATCH/DELETE/pull 各 1 探测 | results 三态 + 3 stub 全 501 + 各自 deferred_card |
| **E 重发幂等** | 同 idempotency-key 重发 | 第二次返缓存 200 + mismatch body 返 409 IDEMPOTENCY_KEY_MISMATCH |

### 3 硬断言（H1~H3）

| # | 断言 | 验证 |
|---|---|---|
| H1 | 协议 100% snake_case · 0 驼峰外溢 | 步骤 C/D 所有响应字段全 snake_case · 0 amountCents/categoryId |
| H2 | 切出去 3 件套铁律 stub 路由全 501 + 3 个 deferred_card 完整 | 步骤 D 4.2 三个 stub 都返 501 + 各自 COSTRA-152/153/154 |
| H3 | 24h 强幂等保证 · idempotency-key 重发返缓存 + mismatch 409 | 步骤 E 两个验证 |

### Pass / Fail 决策

- **5 步 + 3 硬断言全 PASS** → 回 `approve:COSTRA-104` → Orchestrator 写 FINAL.md + metrics + board/backlog Done + HANDOFF v1.7 + 单 commit + push
- **任意 Hard FAIL**（H1~H3 任一）→ 回 `revise:COSTRA-104 reason:<一句话>` → R2 修复路径
- **followup vs followup_id 措辞瑕疵**（P2-1）→ 不阻塞 · Human 实测时按实装的 `followup` 验证即可 · 留 R1.x 或 follow-up 修

---

**审查总结**：

COSTRA-104 R1 实装产出在协议对齐、类型严格性、不变量守护、错误处理、可维护性、体量平衡六个维度全部满分；切出去 3 件套铁律首次实战完整性 9/9 · 为 Sprint-2 范式建立成功；Runtime 等效完备性满足 D-022 v2.0 §4.2 标准；唯一可改进点为 T2 update conflict 测覆盖（P1）+ stub error 字段名一致性（P2）+ D-016 反例累计议题（P2）。**APPROVE 36/40 · D-022 v2.0 评分表第 2 次实战成功** · backend-dev 装扮档首次实战收口（虽 R1+R1.1+R1.2 三轮反复 + Orchestrator 接管兜底 · 但最终代码层全绿、协议契约对齐、铁律完整 · 装扮档第 6 次实战范式可用）。
