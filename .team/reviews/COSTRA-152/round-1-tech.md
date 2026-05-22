# Review-Tech · COSTRA-152 · Round 1

- 卡 Owner：backend-dev
- 卡类型：story · 卡 points：3
- 实装 commit：`513dd5a feat(backend): patch /entries/{id} + cross-family guard fix`（含附加 P0 跨 family 守门补丁）
- 审核时间：2026-05-22T20:30:00+08:00
- 审核人：costra-review-tech 装扮 subagent · 一次性 · 物理无写权
- 上轮结论：首轮（D-014 同轮范式 · D-022 v2.0 评分表第 9 次实战）

---

## 8 维评分表（D-022 v2.0 · 40 分制）

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 契约一致性 | 4/5 | PATCH body / version / 409 与 OpenAPI 对齐；缺 403 响应定义 |
| C2 架构与分层 | 5/5 | route → service → repo 三层清晰；handlePatchEntry 抽函数复用 K3 |
| C3 数据与持久化 | 5/5 | findById userId 重载设计合理；version+1 显式 SET 修到位 |
| C4 离线与同步 | 5/5 | Backend N/A；change_seq nextval 同步推进正确 |
| C5 安全与合规 | 5/5 | 跨 family 守门补丁铁证（反向验证 3 测全 FAIL → revert → 全绿）；无 AppID / 主体泄漏 |
| C6 可测与可观测 | 4/5 | 9 测覆盖 401 / 400 / 404 / 409 / 跨 family / K3；entries.test.ts L36 console.error 残留 |
| C7 工程纪律 | 4/5 | Conventional Commits + Refs；单文件 ≤ 291 行；dispatch 5/5 scope 全落地；缺 403 |
| C8 反模式与治理 | 5/5 | AP-001 / 002 不命中；AP-003 第 4 次正向兑现（x-deferred 清零） |
| **总分** | **37/40** | **PASS-WITH-FOLLOWUP** |

---

## 问题清单

### P1 应改

#### P1-1 OpenAPI PATCH 缺 403 Forbidden 响应定义
- **证据**：`server/api/openapi.yaml:559-578`（PATCH responses 无 403）· dispatch §2.1 A+C 要求 403
- **问题**：OpenAPI 契约未声明 403 · 但代码跨 family 越权走 findById → NOT_FOUND → 404；若未来改 403 则契约缺定义
- **修复建议**：OpenAPI PATCH 加 `'403': { $ref: '#/components/responses/Forbidden' }`；或显式判定 404 语义合理（不泄露 entry 存在性给非 family 成员）后修正 dispatch
- **FU 编号**：**FU-152-R001**（D-016 强制 R1.x.1 修订）

### P2 建议

#### P2-1 entries.test.ts L36 console.error 残留
- **证据**：`server/test/entries.test.ts:36` `console.error('[DEBUG entries login fail]'...)`
- **问题**：调试用 console 残留；虽仅测试文件不泄漏生产信息 · 但违反 engineering-guidelines
- **修复建议**：移除或改条件 `if (process.env.DEBUG) console.error(...)`
- **FU 编号**：**FU-152-R002**

#### P2-2 patchEntryBodySchema 缺 account_id / to_account_id
- **证据**：`server/src/routes/entries.ts:80-91` bodySchema 无此二字段；EntryUpdate OpenAPI schema L1137-1148 也无（当前一致）；但 UpdateEntryPayload (entryService.ts:51-57) + UpdateEntryInput (entryRepo.ts:153-160) 均含此二字段 → 路由层 schema 过严无法传值
- **问题**：MVP 是否支持改 account_id 未声明 · service / repo 已 wired 但 route 收口
- **修复建议**：若确认 MVP 不支持改则记 INFO；否则 bodySchema 补齐
- **FU 编号**：**FU-152-R003**

---

## §AP-001/002/003 反模式扫描

| AP | 结论 | 证据 |
|---|---|---|
| AP-001（spawn 7 点装扮档分阶段 commit）| 不命中 | INVEST small 单装扮档单 commit · 3pt |
| AP-002（跨卡复制粘贴）| 不命中 | K3 复用 158 users.ts L121-138 范式（非复制） |
| AP-003（x-deferred 删 + stub 替换）| **命中 · 正向兑现第 4 次** | `grep x-deferred openapi.yaml` 返 0 行；stub 替换为真 handler |

---

## §Verdict

**PASS-WITH-FOLLOWUP** · **37/40** · 0 P0 · 1 P1（OpenAPI 403 缺定义） · D-016 强制 FU-152-R001 R1.x.1 修订（与 153 R001 双胞胎可同 commit）。

---

## §强制阅读清单（R1.x.1 修订前必读）

1. `server/src/routes/entries.ts:197-263`（PATCH + K3 handler）
2. `server/src/repositories/entryRepo.ts:359-409`（findById userId 重载守门）
3. `server/api/openapi.yaml:559-578`（PATCH OpenAPI 缺 403）
4. `server/test/entries-patch.test.ts:169-199`（T7 跨 family + T8 K3）
5. `.team/members/backend-dev/history/2026-05-22-costra-152-r1-patch-and-cross-family-guard.md` §4（反向验证铁证）

---

## 守门补丁特别评论（R2 卡审 carryover_observation 真兑现）

- **P0 修复完整度**：✅ 完整。`entryRepo.findById(entryId, userId?, client?)` 重载（L359-409）有 userId 时 JOIN family_members 加 `fm.user_id = $2 AND fm.left_at IS NULL`；无 userId 时走原始路径供 service 内部冲突回查（`entryService.ts:193,203`）
- **反向验证认可**：✅ 铁证。history §4 明记：临时移除 userId 过滤 → 3 测全 FAIL（T-CROSS-FAMILY / T7 / T6）→ 恢复 → 70/70 全绿。守门生效的确定性证明
- **三处共享守门**：GET / PATCH / DELETE 均经 `entryService.findById(userId, entryId)` → `entryRepo.findById(entryId, userId)` 统一守门 · 无旁路

---

## 自我反思

- 审核耗时：约 25 分钟（双卡同 spawn · 14 份文件全 Read · 行号精确）
- 置信度：高（commit diff + 代码 + 测试 + history + dispatch 五重事实交叉校验）
- 403 vs 404 判定：当前代码走 404（跨 family = 不存在）语义合理（不泄露 entry 存在性），但 dispatch 明确要求 403 → 判 P1 令被审方显式决策后修正 OpenAPI 或修正 dispatch
- 联合总评见 153 报告同时段 §联合总评

---

**报告由 costra-review-tech 装扮 subagent 产出 · Orchestrator 原样落盘 · 物理无写权约束（COMMON-CONTRACT §0-Bis · 防御层 1）已遵守。**
