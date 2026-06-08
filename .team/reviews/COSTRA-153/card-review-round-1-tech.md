# Card Review · Tech · COSTRA-153 · Round 1

- 卡 Owner：backend-dev
- 卡类型：feature（DELETE /entries/{entry_id} 软删实装替代 stub 501）
- 卡 points：2
- 审核时间：2026-05-22T18:30:00+08:00
- 审核人：costra-card-reviewer-tech 装扮 subagent · 一次性 · 物理无写权
- 上轮结论：首轮
- 同轮联动：与 COSTRA-152 双卡同轮审（D-014 同轮范式 · 105+156 / 154+150 第 3 次复刻 · K3/K1 + DELETE version 传递为联合决策面）

---

## 总评

- **Verdict**：`REVISE`
- **总分**：**22/30 分**
- **阻塞点**：1 个 P0（A/B version 传递方式未决）+ 3 个 P1 + 2 个 P2
- **下一步**：dispatch 按 P0+P1+P2 修订 + 采纳 §LINKAGE 联合决策结果（A 方案 query `?version=N`）→ 触发 Round 2 卡审

---

## 维度得分

| 维度 | 得分 | 一句话 |
|---|---|---|
| C1 标题与描述 | 4/5 | 背景三要素齐 · §1.3 version 传递决策未拍板占 DoD 空间 |
| C2 DoD 可度量 | 4/6 | T1~T6 + 反向验证 3 项可验 · 但"≥ 10 项"引 154 模板未展开具体条目 · A/B 未决导致 T2 schema 验证逻辑无法写 |
| C3 依赖识别 | 4/5 | 上游 104 + 152(K3/K1) 显式 · 下游 FU-104-ENTRIES-DELETE + 150 列出 · 但 152 对 153 的 version 传递决策依赖仅 metadata 一行 |
| C4 产出物具体 | 3/5 | 文件 + 测试名具列 · 但 DELETE_ENTRIES_ENDPOINT 常量值未写 · 409 响应体结构未定义 · version 参数名/schema 未定（A/B 待决） |
| C5 风险与边界 | 2/4 | §1.3 A/B 摇摆 · 缺 409 响应体 · 缺 client 未升级无 version 降级策略 · 无硬删误操作防护说明 |
| C6 去重 | 3/3 | backlog.json L239-251 唯一 · board.md L114 无覆盖 |
| C7 估点 | 2/2 | 2 点合理 · 比 152(3pt) 轻 · service 已全备 |
| C8 红线 | Pass | Won't-Have / secret / D-008 / 越权 全过 |
| **总分** | **22/30** | **REVISE** |

---

## P0 阻塞点

### P0-1 DELETE version 传递方式 A/B 未决阻塞 DoD 完整性
- **证据**：dispatch §1.3 "方案 A query `?version=N` vs 方案 B header `If-Match: \"N\"` · Card-Review 阶段拍板 · 不留 R1 实装期摇摆"
- **问题**：A/B 未选导致：① DoD T2 "缺 version 400"无法写 schema 验证逻辑（query schema vs header schema） · ② OpenAPI §2.1 B "加 version 参数"无法落笔（query param vs header param） · ③ 单测 T2~T4 无法写 mock 请求构造
- **依据**：SOP-CARD-REVIEW §3 C2 + C4 · §7 已知风险同述
- **修复建议**：Card-Review 联合决策（§LINKAGE）已拍板 **方案 A：query `?version=N`** · backend-dev 收到 §LINKAGE 后 dispatch §1.3 / §2.1 A / §2.1 B / §3 DoD 同步更新

---

## P1 应改

### P1-1 DoD "≥ 10 项" 未展开具体条目（同 152 P2-2）
- **证据**：dispatch §3 "参照 154 模板 · 6 闸门 + G7/G8 + G15"
- **问题**：未列出 G1~G8 + G15 + T1~T6 + 反向验证 3 + AP-003 的具体条目清单 · review-tech 验收时需逐项追溯
- **修复建议**：展开为 G1~G8 + G15 = 9 项 · T1~T6 = 6 项 · 反向验证 3 项 · AP-003 = 1 项 · 共 19 项的具体编号
- **FU 编号**：**FU-153-001**

### P1-2 409 响应体结构未定义（同 152 P1-2 双胞胎）
- **证据**：dispatch §2.1 A "401 / 403 / 404 / 409 VERSION_CONFLICT"列出但无 body · entryService.softDelete L201-205 返 `{ status: 'conflict', serverVersion: N }` · 路由层如何映射未说明
- **问题**：与 152 P1-2 同款问题 · 409 响应体结构需统一定义保 client 一致解析
- **修复建议**：显式定义 409 body `{ error: { code: 'VERSION_CONFLICT', message: '...', details: { server_version: N } } }` 与 EntryResult.conflict 对齐 · 与 152 P1-2 修复完全一致
- **FU 编号**：**FU-153-002**

### P1-3 client 无 version 降级策略缺失
- **证据**：dispatch §5.3 无相关说明 · 152 §7 仅"base_version 缺失场景 · 留 P3 观察"
- **问题**：DELETE 若 client 不传 version → 应 400 拒绝还是 200 放行？未声明 · 软删无 version 等同放任硬删风险（虽然 service 层 softDeleteEntry WHERE version = $2 不匹配会 0 row）
- **修复建议**：DoD 加 T2 "缺 version → 400"已隐含 · 但需显式写"version 强制 required · 无降级路径 · 不接受 0 / null / 未传"· OpenAPI parameters required: true
- **FU 编号**：**FU-153-003**

---

## P2 建议

### P2-1 DELETE_ENTRIES_ENDPOINT 常量值未写
- **证据**：dispatch §2.1 A "加 DELETE_ENTRIES_ENDPOINT 常量"
- **问题**：未写常量值字符串 · 154 范式（PULL_ENDPOINT = '/sync/pull'）/ 152 同款 P2 可参照
- **修复建议**：补 `DELETE_ENTRIES_ENDPOINT = '/entries/:entry_id'`
- **FU 编号**：**FU-153-004**

### P2-2 OpenAPI 409 响应未列
- **证据**：openapi.yaml L589-591 仅列 204 / 404 · dispatch §2.1 B 未提补 409
- **问题**：实装后 OpenAPI 缺 409 定义将致 AP-003 部分命中（x-deferred 删但 spec 不全）
- **修复建议**：§2.1 B 补 "加 409 VERSION_CONFLICT 响应定义 + 401 / 403 完整列出"
- **FU 编号**：**FU-153-005**

---

## §AP-001/002/003 反模式扫描

| AP | 命中 | 理由 |
|---|---|---|
| AP-001（spawn 7 点装扮档分阶段 commit）| 不命中 | 单装扮档单 commit · INVEST small 2pt · 无分阶段需求 |
| AP-002（跨卡复制粘贴）| 不命中 | 无跨卡复制 · handler 复用 entryService.softDelete 已有函数 · 与 152 PATCH 是不同语义路由 |
| AP-003（x-deferred 删 + stub 替换）| **命中 · 正向兑现** | 第 5 次 · 删 openapi.yaml L580-586 x-deferred + 替换 entries.ts L184-195 stub · 与 152 / 154 / 105 D2 / 156 同范式 |

---

## §Verdict

**REVISE** · **22/30** · P0-1（A/B 决策）阻塞 R1 启动 · 需采纳 §LINKAGE 拍板（**方案 A query `?version=N`**）· P1×3 + P2×2 同步修订 · 修订后触发 Round 2 卡审。

---

## 给卡作者回执指令

请 backend-dev：
1. 按 §LINKAGE 决策 1（K3）+ 决策 2（A query `?version=N`）更新 152 + 153 dispatch
2. 152 dispatch 修 P1-1 / P1-2 / P2-1 / P2-2 / P2-3 共 5 处（D-016 100% 修订率）
3. 153 dispatch 修 P0-1 / P1-1 / P1-2 / P1-3 / P2-1 / P2-2 共 6 处
4. 通过 Orchestrator 触发 Round 2 卡审（card-reviewer-tech 双卡同轮第 2 次 spawn · 153 期望升 PASS-WITH-FOLLOWUP 或 PASS）

---

## §强制阅读清单（R1 实装前必读）

1. `.team/dispatch/COSTRA-153-delete-entries-soft-delete.md`（全文）
2. `server/src/routes/entries.ts`（L184-195 DELETE stub）
3. `server/api/openapi.yaml`（L580-591 DELETE 定义 + x-deferred）
4. `server/src/services/entryService.ts`（L199-207 softDelete · L227-233 findById）
5. `server/src/repositories/entryRepo.ts`（L211-224 softDeleteEntry · L359-373 findById）
6. `docs/api/sync-protocol.md` §3.5（软删行协议 · since 窗口保留）
7. `.team/decisions/D-025-anti-patterns-clipboard.md`（AP-003 第 5 次正向兑现）
8. `.team/decisions/D-016-pass-with-followup-fu-mandatory-revise.md`

---

## 自我反思

- 审核耗时：约 15 分钟（含 152 范式复用减半 · 7 份补读文件全部 Read 验证）
- 置信度：高（softDelete / softDeleteEntry / findById / openapi.yaml DELETE 段全部 Read · 与 152 对称比对充分）
- 153 与 152 高度对称 · 153 更轻（2pt vs 3pt · service 全备 4 项 scope vs 5 项）· P0-1 需 §LINKAGE 解锁 → REVISE 而非 PASS-WITH-FOLLOWUP
- 联合决策见下方 §LINKAGE 段（双卡共享）

---

# §LINKAGE · 152+153 联合决策（双卡共享 · backend-dev R1 期间不允许翻案）

## 决策 1：K3 vs K1（152 §1.3 / FU-K3-TO-K1-UPGRADE）

**拍板：K3（延续局部 method-override · 158 范式复刻）**

| # | 依据 |
|---|---|
| 1 | 158 R1 已用 K3 并 APPROVE 38/40 · 增量成本仅 ~10 行 · 无回归风险 |
| 2 | K1 全局 middleware 需新 plugin（server/src/plugins/methodOverride.ts）+ 移除 158 旧代码 + 回归 158 测 · scope 膨胀至 5pt+ · 违 INVEST small（152 估点仅 3pt） |
| 3 | board L113-114 152+153 联合估点仅 5 · Sprint-3 节奏要求快速闭环 · K3 最短路径 · K1 全局升级议入 Sprint-4 评估 |

**实施**：152 dispatch §2.1 B 改写为"在 entries.ts 路由内加 POST + X-HTTP-Method-Override: PATCH 委托 · 参 server/src/routes/users.ts L121-138 范式 · 不命中 header 时 405 兜底"· 153 DELETE 无需 method-override（DELETE 是标准 HTTP method）· FU-K3-TO-K1-UPGRADE 保持 open · Sprint-4 评估窗口

## 决策 2：DELETE version 传递（153 §1.3 · 方案 A query vs 方案 B header）

**拍板：方案 A（query string `?version=N`）**

| # | 依据 |
|---|---|
| 1 | DELETE 无 body · 若用 header（If-Match）需 miniapp wx.request 额外配置 header · 小程序 wx.request 对自定义 header 支持有限制（白名单 + 大小写敏感） |
| 2 | 152 PATCH version 在 body（EntryUpdate schema required: [version]）· DELETE 与 PATCH 语义不同（DELETE 无 body）· query 是 REST 对 resource+version 标识的自然表达 · 与 152 区分清晰 |
| 3 | sync-protocol §2 push ops 的 base_version 已在 payload · /sync/pull 用 query since（v1.2 BIGINT change_seq）· DELETE 用 query version 与项目已有 query 参数风格一致 · OpenAPI 协议层规范统一 |

**实施**：153 dispatch §1.3 选 A · §2.1 A 补 "query param `version: integer (>0) required`" · OpenAPI L580-591 补 `parameters: [{ name: version, in: query, required: true, schema: { type: integer, minimum: 1 } }]` + 加 401/403/409 响应定义 · T2 改为"缺 version query → 400"

## 后续指令给 backend-dev

1. R1 实装期间**不允许翻案**：K3 + query `?version=N` 为 Card-Review 阶段终局决策
2. 若 R1 实装期发现阻塞 → 必须提 D-017 §2.4 验证问题响应 SOP 升级 → 经 Orchestrator 同步 Human → 不可自行改选 K1 或 header
3. FU-K3-TO-K1-UPGRADE 留 Sprint-4 评估窗口 · 不在本卡范围
4. 152 + 153 dispatch 修订完成后 · 通过 Orchestrator 同轮触发 Round 2 卡审（双卡同轮第 2 次 spawn · 期望 152 ≥ 27 PASS · 153 ≥ 24 PASS-WITH-FOLLOWUP）

---

**报告由 costra-card-reviewer-tech 装扮 subagent 产出 · Orchestrator 原样落盘 · 物理无写权约束（COMMON-CONTRACT §0-Bis · 防御层 1）已遵守。**
