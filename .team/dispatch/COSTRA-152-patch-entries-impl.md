# COSTRA-152 · PATCH /entries/{entry_id} 实装（替代 R1 stub 501）

> **派单时间**：2026-05-19 20:50（Orchestrator · Sprint-3 follow-up 转正 · 与 154 同轮立档）
> **dispatch 修订**：2026-05-22 18:35（Orchestrator R2 · Card-Review R1 PASS-WITH-FOLLOWUP 25/30 · 5 项 FU 强制修订 · §LINKAGE K3 + query version 联合决策落地）
> **状态**：Card-Review R1 已审 → dispatch 已修订 → 等 Card-Review R2 形式审 → R1 实装
> **依赖**：COSTRA-104（entryService.updateWithVersion + entryRepo.updateEntryByVersion 已全备）· COSTRA-156（v1 prefix · CLOSED）· COSTRA-158（K3 method-override 范式 · CLOSED · 本卡延续）
> **下游解锁**：FU-104-ENTRIES-PATCH 真闭合 · FU-K3-TO-K1-UPGRADE 留 Sprint-4 评估（§LINKAGE 决策 1）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1**（D-014-a）| `costra-card-reviewer-tech`（D-022 v2.0 + D-025 §2 反模式扫描）| 等启动 |
| **R1 实装** | `costra-backend-dev`（一次性装扮 · 单装扮档单 commit）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech`（D-022 v2.0 第 9 次实战）| 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-152`（D-024 §2.2 攒批 · 与 153 联合 approve 优选）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- COSTRA-104 R1 切出去 3 件套铁律（dispatch §2.2 Q1.2）· stub 501 标记 deferred_card=COSTRA-152 / followup_id=FU-104-ENTRIES-PATCH
- OpenAPI L559-579 已有完整 PATCH 定义 + EntryUpdate schema + x-deferred 段
- entryService.updateWithVersion + entryRepo.updateEntryByVersion **三件套已全备**（COSTRA-104 R1 实装时一并落 · 仅缺路由 stub 替换）

### 1.2 PRD / 契约锚点
- **PRD**：用户记一笔后修改场景（高频）
- **OpenAPI**：`server/api/openapi.yaml` L559-579 PATCH /entries/{id} + L1120-1132 EntryUpdate schema（required: [version], properties: amount/category_id/note/occurred_at/version）
- **协议**：`docs/api/sync-protocol.md` §4.x base_version 乐观锁仲裁 · §2.3 conflict 响应 server_record 范式
- **stub 现状**：`server/src/routes/entries.ts:165-180`（含注释 L165 + app.patch L166-180 · 删除目标 · 范式参 154 R1）

### 1.3 K3 → K1 评估（§LINKAGE 决策 1：拍板 K3 · FU-K3-TO-K1-UPGRADE 留 Sprint-4）
- COSTRA-158 R1 用 K3 局部 method-override（POST + X-HTTP-Method-Override: PATCH · users.ts L121-138 范式）· 已 APPROVE 38/40
- **Card-Review R1 §LINKAGE 拍板 K3**（依据 3 条）：
  1. 158 K3 已 APPROVE · 增量成本仅 ~10 行 · 无回归风险
  2. K1 全局 middleware 需新 plugin + 移除 158 旧代码 + 回归 158 测 · scope 膨胀至 5pt+ · 违 INVEST small（本卡 3pt）
  3. Sprint-3 节奏要求快速闭环 · K3 最短路径 · K1 议入 Sprint-4
- **R1 实装期不允许翻案** · 若发现阻塞必须走 D-017 §2.4 验证问题响应 SOP 上报 Orchestrator + Human

---

## §2 Scope（5 项 · 估点 3 · INVEST small）

### 2.1 主交付（5 项 · 必交）

#### A · 替换 routes/entries.ts PATCH stub 为真 handler
- 删除 L165-180 stub 块（含注释 L165 + app.patch L166-180）
- 加 `PATCH_ENTRIES_ENDPOINT = '/entries/:entry_id'` 常量（参 154 范式 PULL_ENDPOINT）
- 加 `patchEntryParamsSchema` + `patchEntryBodySchema`（参 EntryUpdate · required: [version] · properties: amount/category_id/account_id/note/occurred_at/version · **version 随 body 传递 · 同 EntryUpdate schema · 非 query · 与 153 DELETE 走 query 区分清晰**）
- `app.patch<{ Params: { entry_id: string }, Body: EntryUpdatePayload }>(...)` 注册路由
- `parseUserId` 复用（entries.ts L24-34）
- 调 `entryService.updateWithVersion(userId, entryId, payload, baseVersion)`
- **错误处理 + 响应体结构（FU-152-002 落地）**：
  - 200 `{ ...EntryView, version: N+1 }`（参 GET handler L142-161 entityToView 完整字段）
  - 400 INVALID_ARGUMENT（schema 校验失败 / version 类型错）
  - 401 UNAUTHENTICATED（parseUserId 抛错）
  - 404 NOT_FOUND（findById 抛错）
  - **409 VERSION_CONFLICT 标准体**：`{ error: { code: 'VERSION_CONFLICT', message: '...', details: { server_version: N } } }` · 与 entryService EntryResult.conflict.serverVersion 直接对齐 · 不返全量实体（client 走 GET /entries/:id 单独拉取 · 与 sync push conflict 体语义统一）

#### B · K3 method-override 兼容（§LINKAGE 决策 1 已拍板 K3）
- 在 entries.ts 路由内加 POST `/entries/:entry_id` handler · 识别 `req.headers['x-http-method-override']` toUpperCase === 'PATCH' 时委托 PATCH handler
- 不命中 header 时返 405 METHOD_NOT_ALLOWED（参 users.ts L131-137 范式）
- **不抽全局 middleware**（K1 路径议入 Sprint-4 · FU-K3-TO-K1-UPGRADE 保持 open）
- 与 158 K3 范式语义完全一致 · 复用而非复制（AP-002 不命中）

#### C · OpenAPI 修订
- 删除 L559-565 x-deferred 段（AP-003 第 4 次正向兑现）
- 验证 EntryUpdate schema 已完整（已确认 L1120-1132 · 含 version required）
- tags / summary / security / responses 401 / 403 / 409 完整列出（核验）

#### D · server 单测 ≥ 8 测
- 新建 `server/test/entries-patch.test.ts`
- T1 未登录 401（无 Authorization）
- T2 entry_id 非 UUID 400
- T3 缺 version 400（body 无 version 字段）
- T4 update 成功 200 + version 递增（response.version === baseVersion + 1 + entityToView 完整字段）
- T5 base_version 不匹配 409 + body `{ error: { code: 'VERSION_CONFLICT', details: { server_version: N } } }`
- T6 entry 不存在 404
- T7 跨 family 越权 403（user A 改 user B family 的 entry · entryService.findById 应抛 NOT_FOUND 或 service 层加 user 过滤）
- T8 method-override（POST + X-HTTP-Method-Override: PATCH）等价于 PATCH 行为（200 + version 递增）

#### E · follow-ups + 缺陷单同步
- FU-104-ENTRIES-PATCH: open → closed @ COSTRA-152
- FU-COMMON-MINIAPP-PATCH-LIMIT 状态延续（已 closed @ 158 · 仅注释延续 K3 范式）
- FU-K3-TO-K1-UPGRADE: 保持 open · 留 Sprint-4 评估（§LINKAGE 决策 1）

### 2.2 不在本卡范围
- ❌ DELETE /entries/{id} → COSTRA-153
- ❌ 客户端 patch UI → 已在 COSTRA-103 outbox 内
- ❌ 字段级合并 / conflict UI → COSTRA-151
- ❌ K1 全局 method-override middleware → Sprint-4 FU-K3-TO-K1-UPGRADE

---

## §3 DoD（21 项 · FU-152-004 R2 展开 · 参 154 模板对照）

### G1~G8 + G15 标准闸门（9 项）
- **G1** TypeScript typecheck 全绿（`cd server && npm run typecheck`）
- **G2** ESLint 全绿（`cd server && npm run lint`）
- **G3** OpenAPI lint 全绿（`cd server && npm run openapi:lint`）+ x-deferred 段已删（L559-565）
- **G4** server 单测全绿（`cd server && npm test` · 含本卡新增 T1~T8）
- **G5** schema-check 全绿（`node scripts/schema-check.mjs` · entries 表无破坏性改动）
- **G6** whitelist-check 全绿（`node scripts/whitelist-check.mjs` · 路径白名单 + 规则 D OpenAPI vs fastify prefix · 156 范式）
- **G7** OpenAPI 实装齐全（PATCH /entries/{id} 路由可达 + EntryUpdate schema 引用正确 + 401/403/409 响应定义完整）
- **G8** x-deferred 清理（剩 DELETE entries · 待 153 同样清理 · sync/pull 已 154 清理）
- **G15** D-016 反例预防（M 项强约束 · commit 前 `git status -s | grep '.team/members/' | wc -l` = 0）

### T1~T8 单测（8 项 · 见 §2.1 D）

### 反向验证（3 项）
- ① 临时把 base_version 不传 → T3 FAIL → revert
- ② 临时返 200 而非 409 → T5 FAIL → revert
- ③ 跨 family 不 throw → T7 FAIL → revert

### D-025 AP-003（1 项 · 第 4 次正向兑现）
- AP-001 不命中（INVEST small 单装扮档单 commit）
- AP-002 不命中（K3 复用 158 范式 · 非复制）
- **AP-003 命中并修复**：删 openapi.yaml L559-565 x-deferred + 替换 entries.ts L165-180 stub · grep `x-deferred.*COSTRA-152` openapi.yaml 应返 0 行

---

## §4 强制阅读清单

1. 本派单档全文（已修订 R2 版 · 2026-05-22 18:35）
2. Card-Review 报告：`.team/reviews/COSTRA-152/card-review-round-1-tech.md`（PASS-WITH-FOLLOWUP 25/30 · 5 项 FU-152-001~005 已落地本档）
3. **OpenAPI 现状**：`server/api/openapi.yaml:559-579` PATCH 定义 + L1120-1132 EntryUpdate schema
4. **stub 现状**：`server/src/routes/entries.ts:165-180`（含注释 L165 + app.patch L166-180）
5. **复用范式**：
   - `server/src/services/entryService.ts:25,176-197` updateWithVersion（已实装 · 不需改）
   - `server/src/repositories/entryRepo.ts:138-183` updateEntryByVersion + L265-279 findById
6. **K3 范式参考**：`server/src/routes/users.ts:121-138`（POST + X-HTTP-Method-Override 委托 + 405 兜底 · 158 已 APPROVE 范式）
7. **D-025 反模式清单**：`.team/decisions/D-025-anti-patterns-clipboard.md`（AP-003 第 4 次正向兑现）
8. **D-022 v2.0**：`.team/decisions/D-022-review-tech-runtime-dimension.md`
9. **D-016 100% 修订率**：`.team/decisions/D-016-pass-with-followup-fu-mandatory-revise.md`

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`server/src/routes/entries.ts` · `server/api/openapi.yaml` · `server/test/entries-patch.test.ts`（新建）· `server/src/plugins/methodOverride.ts`（如选 K1）· `.team/members/backend-dev/state.md` + history · `.team/follow-ups/README.md`
- ❌ 不可写：miniprogram/ · infra/ · 其他 .team/members/{other-role}/

### §5.2 INVEST small（3 点）
- 时间盒 R1 实装 ≤ 120 分钟（2 小时 · 比 154 简单 · service 已全备）
- 5 项 scope 单点修改密度高 · 现有范式齐全（entryService 复用 + K3 158 范式）

### §5.3 已知未知 / follow-up 候选
- FU-152-K3-OR-K1：本卡 Card-Review 阶段决策 K3 vs K1 · 决策结果直接落本卡 R1 实装

### §5.4 D-016 同轮兑现 · D-018 单装扮档单 commit
- commit footer：`Co-Authored-By: backend-dev <subagent>` · `closes: FU-104-ENTRIES-PATCH`
- commit 前 final message 含 `git status -s | grep '.team/members/' | wc -l` = 0

---

## §6 估点 / 时间盒

- **估点**：3 点（vs 154 5 点 · 简单 40%）
- **AI 时间盒**：~~2~3 小时~~（含 Card-Review + R1 实装 + R1 Review）
- **Human 实测**：与 153 + 154 + 150 联合 staging 实测（D-024 §2.2 C1 攒批）

---

## §7 已知风险

- **K3 vs K1 决策摇摆**：Card-Review 阶段必须明示 · 不留 R1 实装期摇摆空间 · 若摇摆 → 升级 P0 阻塞 R1
- **base_version 缺失场景**：client 未升级到 outbox 携带 version 时如何降级 · 留 P3 观察

---

**派单档结束 · Orchestrator 等 Card-Review R2 形式审 PASS 后 spawn backend-dev R1 实装。**

---

## §10 修订记录

| 版本 | 时间 | 变更 |
|---|---|---|
| v1.0 | 2026-05-19 20:50 | 初版立档（Sprint-3 follow-up 转正 · 8 张联立批落档之一）|
| **v2.0** | **2026-05-22 18:35** | **Card-Review R1 PASS-WITH-FOLLOWUP 25/30 修订** · 5 项 FU 全落地：FU-152-001（§1.3 K3 拍板 + §2.1 B 改写为 K3 具体条目）· FU-152-002（§2.1 A 加 409 标准响应体结构）· FU-152-003（§1.2 + §4 行号 165-180 注释精确化）· FU-152-004（§3 DoD 展开 21 项条目）· FU-152-005（§2.1 A bodySchema 显式声明 version ∈ body 与 153 query 区分）· §LINKAGE 决策 1 拍板 K3（依据 3 条入卡）· FU-K3-TO-K1-UPGRADE 留 Sprint-4 |
