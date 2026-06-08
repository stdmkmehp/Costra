# Review-Tech · COSTRA-153 · Round 1

- 卡 Owner：backend-dev
- 卡类型：story · 卡 points：2
- 实装 commit：`ccd80b9 feat(backend): delete /entries/{id} soft delete with query version`
- 审核时间：2026-05-22T20:30:00+08:00
- 审核人：costra-review-tech 装扮 subagent · 一次性 · 物理无写权
- 上轮结论：首轮（D-014 同轮范式 · D-022 v2.0 评分表第 10 次实战）

---

## 8 维评分表（D-022 v2.0 · 40 分制）

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 契约一致性 | 4/5 | DELETE query version + 204 / 409 与 OpenAPI 对齐；缺 403 响应定义 |
| C2 架构与分层 | 5/5 | route → service → repo 三层；DELETE handler 简洁 25 行 |
| C3 数据与持久化 | 5/5 | 软删 deleted_at + version+1 + change_seq nextval 三字段正确 |
| C4 离线与同步 | 5/5 | Backend N/A；软删行 sync/pull 路径已由 154 v1.2 闭环 |
| C5 安全与合规 | 5/5 | 跨 family 守门复用 152 补丁；T6 越权 → 404 测通过 |
| C6 可测与可观测 | 5/5 | 6 测覆盖 401 / 400 / 204+DB 验证 / 409 / 404 / 跨 family；T3 验 DB 三字段 |
| C7 工程纪律 | 5/5 | Conventional Commits + Refs；6 files ≤ 212 行；T10 stub 删除干净 |
| C8 反模式与治理 | 5/5 | AP-001 / 002 不命中；AP-003 第 5 次正向兑现 |
| **总分** | **39/40** | **PASS-WITH-FOLLOWUP** |

---

## 问题清单

### P1 应改

#### P1-1 OpenAPI DELETE 缺 403 Forbidden 响应定义
- **证据**：`server/api/openapi.yaml:579-595`（DELETE responses 无 403）· dispatch §2.1 A+B 要求 403
- **问题**：同 152 P1-1 双胞胎 · 跨 family 越权当前走 404 而非 403 · OpenAPI 未声明
- **修复建议**：OpenAPI DELETE 加 `'403': { $ref: '#/components/responses/Forbidden' }`；或统一 404 语义后修正 dispatch（与 152 P1-1 同决策）
- **FU 编号**：**FU-153-R001**（D-016 强制 R1.x.1 修订 · 与 152 R001 双胞胎可同 commit）

### P2 建议

#### P2-1 entries-delete.test.ts T4 依赖 PATCH 先行
- **证据**：`server/test/entries-delete.test.ts:134-140` T4 先 PATCH 再 DELETE 测 409
- **问题**：DELETE 单测依赖 PATCH 端点先行修改 version；若 PATCH 拆分独立跑会 T4 FAIL
- **修复建议**：当前双卡同 commit 无实际风险 · 记录为 P3 观察即可
- **FU 编号**：**FU-153-R002**（degraded-to-p3-observe）

---

## §AP-001/002/003 反模式扫描

| AP | 结论 | 证据 |
|---|---|---|
| AP-001（spawn 7 点装扮档分阶段 commit）| 不命中 | INVEST small 2pt 单装扮档单 commit |
| AP-002（跨卡复制粘贴）| 不命中 | 复用 entryService.softDelete 已有函数 · 与 152 PATCH 是不同语义路由 |
| AP-003（x-deferred 删 + stub 替换）| **命中 · 正向兑现第 5 次** | x-deferred 全清零；stub → 真 handler |

---

## §Verdict

**PASS-WITH-FOLLOWUP** · **39/40** · 0 P0 · 1 P1（OpenAPI 403 缺定义） · D-016 强制 FU-153-R001 R1.x.1 修订（与 152 R001 双胞胎可同 commit）。

---

## §强制阅读清单（R1.x.1 修订前必读）

1. `server/src/routes/entries.ts:265-290`（DELETE handler）
2. `server/api/openapi.yaml:579-595`（DELETE OpenAPI 缺 403）
3. `server/test/entries-delete.test.ts:113-131`（T3 DB 三字段验证）
4. `server/test/entries-delete.test.ts:163-175`（T6 跨 family 越权）
5. `server/src/repositories/entryRepo.ts:213-227`（softDeleteEntry）

---

# §联合总评（双卡共享 · 落 152 + 153 两份报告同时段 · 此处仅一份方便交叉对照）

| 卡 | Verdict | 分数 | 关键 FU |
|---|---|---|---|
| **COSTRA-152** | PASS-WITH-FOLLOWUP | **37/40** | FU-152-R001（OpenAPI 403）+ FU-152-R002/003 P2 |
| **COSTRA-153** | PASS-WITH-FOLLOWUP | **39/40** | FU-153-R001（OpenAPI 403）+ FU-153-R002 P3 观察 |

## §LINKAGE 决策落地核验

| 决策 | 结论 | 证据 |
|---|---|---|
| 决策 1 K3 method-override | ✅ 落地 | `entries.ts:247-263` POST + X-HTTP-Method-Override: PATCH 委托 handlePatchEntry + 405 兜底 |
| 决策 2 query `?version=N` | ✅ 落地 | `entries.ts:93-100` deleteEntryQuerySchema required:['version'] + `entries.ts:268-270` Querystring 类型 |

## D-016 / D-022 v2.0 / D-025 范式累计

- **D-016 PASS-WITH-FOLLOWUP 100% 修订率**：连续第 7~8 张（105+156+158+154+150+152+153）
- **D-022 v2.0 评分**：第 9~10 次实战 · 评分趋势 38/40+38/40 → **37+39** · 双卡同 spawn 评分稳定
- **D-025 AP-003 正向兑现**：第 4~5 次（152 第 4 次 + 153 第 5 次）

## 给 backend-dev R1.x.1 修订指令

1. **P1 必修**（D-016 铁律 · 100% 修订率）：
   - **FU-152-R001 + FU-153-R001 双胞胎 P1**：OpenAPI 双端点加 403 响应（或显式声明 404 语义替代并修正 dispatch）· **同 commit 修 2 处** · `1 行 × 2`
2. **P2 可选延后**：
   - FU-152-R002：entries.test.ts L36 console.error 清理
   - FU-152-R003：patchEntryBodySchema account_id / to_account_id 评估
   - FU-153-R002：T4 依赖 PATCH 观察（degraded-to-p3-observe）
3. 每条 P1 产出"修复说明 + diff 指针"在 R1.x.1 commit message 或 history 中
4. P2 全部记入 Sprint-3 backlog

---

## 守门补丁特别评论

- **P0 修复完整度**：✅ 完整 · 153 复用 152 补丁 · entryRepo.findById 重载 + entryService 调用方更新 · GET / PATCH / DELETE 三处共享守门
- **反向验证认可**：✅ 铁证（详见 152 报告同段）· T6 跨 family → 404 在守门下生效

---

## 自我反思

- 审核耗时：约 25 分钟（双卡同 spawn）
- 置信度：高（commit diff + 代码 + 测试 + history + dispatch 五重事实交叉校验）
- 153 评分高 152 2 分原因：C6 / C7 满分（覆盖更全 + 文件更少更整洁）
- 联合范式效率高：双卡同 spawn ≈ 单卡 1.5x 时间 · 评分独立 + 联合总评共享 + R1.x.1 双胞胎修订可同 commit

---

**报告由 costra-review-tech 装扮 subagent 产出 · Orchestrator 原样落盘 · 物理无写权约束（COMMON-CONTRACT §0-Bis · 防御层 1）已遵守。**
