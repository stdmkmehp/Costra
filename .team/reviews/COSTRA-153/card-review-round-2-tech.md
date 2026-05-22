# Card Review · Tech · COSTRA-153 · Round 2（形式审）

- 卡 Owner：backend-dev
- 卡类型：feature
- 卡 points：2
- 审核时间：2026-05-22T18:55:00+08:00
- 审核人：costra-card-reviewer-tech 装扮 subagent · 一次性 · 物理无写权
- 上轮结论：R1 REVISE 22/30（P0 + P1×3 + P2×2 = 6 项 FU-153-001~006）
- 同轮联动：与 COSTRA-152 R2 双卡同轮形式审

---

## R1 → R2 FU 落地核验

| FU ID | 要求要点 | v2.0 dispatch 锚点 | ✅/❌ |
|---|---|---|---|
| **FU-153-001** | DoD 19 项展开 | §3 共 G1~G8+G15=9 + T1~T6=6 + 反向验证 3 + AP-003=1 = 19 项 | ✅ |
| **FU-153-002** | 409 体 server_version 标准结构 | §2.1 A 409 标准体 `{ error: { code: 'VERSION_CONFLICT', message: '...', details: { server_version: N } } }` · 与 152 P1-2 修复完全一致 | ✅ |
| **FU-153-003** | version required 强制 · 无降级 | §2.1 A "query schema required: ['version'] + minimum: 1 · 不接受 0 / null / 未传 · 缺失 → 400 · 无降级路径" + §2.2 同述 | ✅ |
| **FU-153-004** | DELETE_ENTRIES_ENDPOINT 常量值 | §2.1 A `DELETE_ENTRIES_ENDPOINT = '/entries/:entry_id'` 显式 | ✅ |
| **FU-153-005** | OpenAPI 补 401/403/409 响应 | §2.1 B "补全响应：401 Unauthorized · 403 Forbidden · 409 Conflict（含 server_version details）" | ✅ |
| **FU-153-006** | §LINKAGE 决策 2 query 拍板入卡 | §1.3 "拍板：方案 A · query string `?version=N`" 依据 3 条 + §2.1 A deleteEntryQuerySchema + §2.1 B version 参数 OpenAPI 定义 | ✅ |

**6/6 FU 全部落地 ✅**

---

## §LINKAGE 决策 2 落地（双卡共享核验）

- **决策 2（DELETE version 传递 = 方案 A query `?version=N`）**：
  - 153 §1.3 ✅（依据 3 条入卡 + R1 实装期不翻案铁律）
  - 153 §2.1 A ✅（deleteEntryQuerySchema + `app.delete<{ Querystring: { version: number } }>(...)` 类型签名）
  - 153 §2.1 B ✅（OpenAPI `parameters: [{ name: version, in: query, required: true, schema: { type: integer, minimum: 1 } }]`）

---

## 维度调整（沿用 R1 评分基线 · 仅列变化项）

| 维度 | R1 得分 | R2 得分 | 变化原因 |
|---|---|---|---|
| C1 标题与描述 | 4/5 | **5/5** | §1.3 决策 2 已拍板 · 不再占空 |
| C2 DoD 可度量 | 4/6 | **5/6** | DoD 19 项展开 · T2 可写"缺 version query → 400"· 但"可自动化判定"条目仅 T1~T6 = 6 项 · 未达满分 6 |
| C3 依赖识别 | 4/5 | 4/5 | 维持（152→153 决策依赖在 §1.3 已显式 · 但 metadata 一行小瑕疵留观察）|
| C4 产出物具体 | 3/5 | **4/5** | 常量值 + query schema + 409 体 + OpenAPI 参数全补 · version 参数名 / schema 已定 |
| C5 风险与边界 | 2/4 | **3/4** | 409 体已定义 · version required 无降级 · 但 §7 跨 family T6 "真 P0 守门点"仍为实装期验证项 · 风险暴露但不扣满 |
| C6 去重 | 3/3 | 3/3 | 维持 |
| C7 估点 | 2/2 | 2/2 | 维持 |
| C8 红线 | Pass | Pass | 维持 |
| **总分** | **22/30** | **26/30** | +4（C1 +1 / C2 +1 / C4 +1 / C5 +1）|

---

## §AP-001/002/003 扫描

| AP | 命中 | 理由 |
|---|---|---|
| AP-001 | 不命中 | 单装扮档单 commit · INVEST small 2pt · 与 R1 一致 |
| AP-002 | 不命中 | handler 复用 entryService.softDelete 已有函数 · 与 R1 一致 |
| AP-003 | **命中·正向兑现** | 第 5 次 · 删 openapi.yaml L580-586 x-deferred + 替换 entries.ts L182-195 stub |

---

## §Verdict

**PASS-WITH-FOLLOWUP** · **26/30** · 落 24-26 区间（D-016 100% 修订率范式） · 6 项 FU 全落地 + §LINKAGE 决策 2 query 显式写明 + 维度 C1/C2/C4/C5 共回升 4 分 → 卡定义已具备 R1 实装条件。

**留观察项**（不阻 R1 启动 · backend-dev R1 实装期重点核验）：
- §7 风险段第 2 条：跨 family 越权（T6）真 P0 守门点 · entryRepo.findById 仅 JOIN family_members 不按 userId 过滤 · entryService.findById(userId, entryId) 接收 userId 但未实际使用 · backend-dev R1 期间必须验证 T6 单测能否真的拦截 · 若不能 → 必须在 service 层加 `isUserInFamily(userId, familyId)` 守门（否则是真 P0 漏洞 · 需补 R1.x.1 紧急修订）

**给 backend-dev 启动指令**：依 v2.0 dispatch 启动 R1 实装 · 单装扮档单 commit · DELETE version 严格走 query `?version=N` · R1 实装期不允许翻案改 header / 加降级 · 跨 family T6 单测必须真能拦截 · 若发现 service 层无守门 → 必须同 R1 一并修补。

---

## 强制阅读清单（R1 实装前必读）

1. v2.0 派单档全文（已修订 · §10 修订记录）
2. 本 R2 报告 + R1 报告（`.team/reviews/COSTRA-153/card-review-round-1-tech.md`）
3. `server/src/routes/entries.ts:182-195` DELETE stub
4. `server/src/services/entryService.ts:199-207` softDelete + L227-233 findById（重点核验 userId 是否实际过滤）
5. `server/src/repositories/entryRepo.ts:211-224` softDeleteEntry + L359-373 findById（v1.2 升级后 change_seq nextval 已含）
6. `server/api/openapi.yaml:580-591` DELETE 定义 + L580-586 x-deferred
7. `docs/api/sync-protocol.md` §3.5 软删行 since 窗口保留

---

**报告由 costra-card-reviewer-tech 装扮 subagent R2 形式审产出 · Orchestrator 原样落盘 · 无写权约束遵守。**
