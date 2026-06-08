# Card Review · Tech · COSTRA-152 · Round 1

- 卡 Owner：backend-dev
- 卡类型：story（PATCH /entries/{entry_id} 实装替代 stub 501）
- 卡 points：3
- 审核时间：2026-05-22T18:30:00+08:00
- 审核人：costra-card-reviewer-tech 装扮 subagent · 一次性 · 物理无写权
- 上轮结论：首轮
- 同轮联动：与 COSTRA-153 双卡同轮审（D-014 同轮范式 · 105+156 / 154+150 第 3 次复刻 · K3/K1 + DELETE version 传递为联合决策面）

---

## 总评

- **Verdict**：`PASS-WITH-FOLLOWUP`
- **总分**：**25/30 分**
- **阻塞点**：0 个 P0 / 2 个 P1 / 3 个 P2
- **D-016 强制 100% 修订率**：本卡 PASS-WITH-FOLLOWUP 路径下 P1×2 + P2×3 共 **5 项必须 R1 一并修订**（连续 5 卡范式 105/156/158/154/150 不破例）

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 4/5 | 标题清晰含端点+动词 · 描述三要素齐备 · 但 §1.3 K3/K1 决策未拍板占 DoD 空间 |
| C2 DoD 可度量 | 5/6 | T1~T8 测具自动化判定标准 · 反向验证 3 项具操作步骤 · "≥ 12 项"引 154 模板略模糊 |
| C3 依赖识别 | 4/5 | 上游 104/156/158 三依赖显式 · 下游 FU-104-ENTRIES-PATCH + FU-K3-TO-K1-UPGRADE 列出 · 但 153 对 152 K3/K1 决策依赖仅 metadata 一行 |
| C4 产出物具体 | 4/5 | 文件路径+函数签名+测试文件名具列 · bodySchema 引 EntryUpdate 已定位 openapi.yaml L1120-1132 · 但 PATCH_ENTRIES_ENDPOINT 常量值未写 |
| C5 风险与边界 | 3/4 | §7 K3/K1 摇摆 + base_version 缺失 P3 观察 · 缺 409 server_state 结构说明 |
| C6 去重 | 3/3 | backlog.json L222-237 仅 152 一条 PATCH entries · board.md L113 无覆盖 · 近期 daily 无相似描述 |
| C7 估点 | 2/2 | 3 点 vs 154（5pt）合理 · service 全备仅 stub 替换 · 落 1~8 区间 · 与 153（2pt）对比合理 |
| C8 红线 | Pass | Won't-Have（charter §5）未触碰 · 无 secret 硬编码 · 无主体字样（D-008）· backend-dev 写 server/ 合规 · D-012 单卡即提交符合 |
| **总分** | **25/30** | **PASS-WITH-FOLLOWUP** |

---

## P0 阻塞点

（无）

---

## P1 应改

### P1-1 FU-152-K3-OR-K1 决策悬而未决留在卡内 · DoD 不完整
- **证据**：dispatch §1.3 "Card-Review 阶段决策：① K3 vs ② K1" · §2.1 B "K3 / K1 兼容（Card-Review 决策）" · §3 DoD "≥ 12 项"引 154 模板未展开
- **问题**：Scope B 整项含"Card-Review 决策"占位 · DoD 未写明 K3/K1 各自对应哪些具体验收标准 · §7 风险 "K3 vs K1 决策摇摆 → 升级 P0 阻塞 R1"
- **修复建议**：采纳 §LINKAGE 联合决策结果后 · 将 Scope B 改写为具体可执行条目（"在 entries.ts 路由内加 POST + X-HTTP-Method-Override: PATCH 委托 · 参 users.ts L121-138 范式"）· DoD 补 T8 method-override 验收标准细化为"POST /v1/entries/:id + header X-HTTP-Method-Override: PATCH 返回等价于 PATCH 的 200 响应"
- **FU 编号**：**FU-152-001**（D-016 强制 R1 修订）

### P1-2 409 VERSION_CONFLICT 响应体 server_state 结构未定义
- **证据**：dispatch §2.1 A "409 VERSION_CONFLICT（含 server_state 返回）" · entryService.updateWithVersion L192-194 仅返 `{ status: 'conflict', serverVersion }` · sync-protocol §2.3 push conflict 响应含 `server_record: { ...全量实体... }`
- **问题**：dispatch 写"含 server_state"但未定义结构（全量 Entry 还是仅 version？）· 与 sync push conflict 响应的 server_record 语义不一致
- **修复建议**：明确 409 响应体结构 · 推荐 `{ error: { code: 'VERSION_CONFLICT', message: '...', details: { server_version: N } } }` 与 EntryResult.conflict 对齐 · 不返全量实体（避免路由层额外查询 · 客户端有 outbox 可自行 merge · 若需全量走 GET /entries/:id 单独拉取）· 在 dispatch §2.1 A 补此结构定义
- **FU 编号**：**FU-152-002**（D-016 强制 R1 修订）

---

## P2 建议

### P2-1 dispatch 引用 entries.ts 行号偏差
- **证据**：dispatch §1.2 "stub 现状：entries.ts:165-180" · 实际 PATCH stub 为 L165-180（含注释 L165 + app.patch L166-180）
- **问题**：行号偏差虽不影响实装（backend-dev R1 会 Read 全文确认），但作为事实源引用应精确
- **修复建议**：dispatch §1.2 + §4 行号改为 "L165-180（含注释 L165 + stub L166-180）"
- **FU 编号**：**FU-152-003**

### P2-2 DoD "≥ 12 项" 引用 154 模板但未展开具体条目
- **证据**：dispatch §3 "参照 154 派单档 §3 模板 · 含 G1~G6 + G7 + G8 + G15"
- **问题**：引用 154 模板省空间合理 · 但 review-tech 验收时需逐项对照 · 显式列出便于追溯
- **修复建议**：dispatch §3 补充 DoD 条目（至少 G1~G8 + G15 = 9 项 · T1~T8 = 8 项 · 反向验证 3 项 · AP-003 = 1 项 · 共 21 项的具体编号与一句话）
- **FU 编号**：**FU-152-004**

### P2-3 PATCH bodySchema version 字段位置（body vs query）未显式声明
- **证据**：dispatch §2.1 A "bodySchema（参 EntryUpdate · required: [version]）"
- **问题**：PATCH 的 version 在 body 是 154 已有范式（EntryUpdate schema required: [version]）· 但 dispatch 未显式声明"version ∈ body"而非 query · 与 DELETE（153）的 version 传递方式（§LINKAGE 决议为 query）易混淆
- **修复建议**：dispatch §2.1 A 补一句"version 随 body 传递（同 EntryUpdate schema）· 非 query param · 与 153 DELETE 走 query 不同"
- **FU 编号**：**FU-152-005**

---

## §AP-001/002/003 反模式扫描

| AP | 命中 | 理由 |
|---|---|---|
| AP-001（spawn 7 点装扮档分阶段 commit）| 不命中 | 单装扮档单 commit · INVEST small 3pt · 无分阶段需求 |
| AP-002（跨卡复制粘贴）| 不命中 | 无跨卡复制 · K3 局部代码 ~10 行在 158 已有范式 · 复用而非复制 |
| AP-003（x-deferred 删 + stub 替换）| **命中 · 正向兑现** | 第 4 次 · 删 openapi.yaml L559-565 x-deferred + 替换 entries.ts L166-180 stub · 与 154 / 105 D2 / 156 同范式 |

---

## §Verdict

**PASS-WITH-FOLLOWUP** · **25/30** · D-016 强制 100% 修订率：P1-1 / P1-2 / P2-1 / P2-2 / P2-3 全须 R1 实装时一并落地（连续 5 卡 105/156/158/154/150 范式不破例）。**§LINKAGE 联合决策已拍板 K3 + query version**（见同目录 / 153 同目录联合决策段）· backend-dev R1 期间不允许翻案。

---

## §强制阅读清单（R1 实装前必读）

1. `.team/dispatch/COSTRA-152-patch-entries-impl.md`（全文）
2. `server/src/routes/entries.ts`（L165-180 PATCH stub · L184-195 DELETE stub）
3. `server/api/openapi.yaml`（L559-579 PATCH 定义 + x-deferred · L1120-1132 EntryUpdate schema）
4. `server/src/services/entryService.ts`（L176-197 updateWithVersion · L227-233 findById）
5. `server/src/repositories/entryRepo.ts`（L162-202 updateEntryByVersion · L359-373 findById）
6. `server/src/routes/users.ts`（L121-140 K3 范式 · POST + X-HTTP-Method-Override: PATCH 委托 + 405 兜底）
7. `.team/decisions/D-025-anti-patterns-clipboard.md`（AP-003 第 4 次正向兑现）
8. `.team/decisions/D-016-pass-with-followup-fu-mandatory-revise.md`（强制 100% 修订率）

---

## 自我反思

- 审核耗时：约 15-25 分钟（含强制阅读清单 13 份事实校验 + 双卡同轮）
- 置信度：高（dispatch 引用的 entryService / entryRepo 函数全部 Read 验证已实装 · 158 K3 范式 users.ts 已 Read · OpenAPI L559-579 已 Read）
- D-016 + D-025 全合规 · 无 C8 红线触碰
- 联合决策见同目录 153 报告下方 §LINKAGE 段（双卡共享）

---

**报告由 costra-card-reviewer-tech 装扮 subagent 产出 · Orchestrator 原样落盘 · 物理无写权约束（COMMON-CONTRACT §0-Bis · 防御层 1）已遵守。**
