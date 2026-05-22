# COSTRA-153 · DELETE /entries/{entry_id} 软删实装（替代 R1 stub 501）

> **派单时间**：2026-05-19 20:50（Orchestrator · Sprint-3 follow-up 转正 · 与 152 联动）
> **dispatch 修订**：2026-05-22 18:35（Orchestrator R2 · Card-Review R1 REVISE 22/30 · P0+P1×3+P2×2 共 6 项 FU 强制修订 · §LINKAGE 决策 2 拍板方案 A query `?version=N`）
> **状态**：Card-Review R1 已审 → dispatch 已修订 → 等 Card-Review R2 形式审 → R1 实装
> **依赖**：COSTRA-104（entryService.softDelete + entryRepo.softDeleteEntry 已全备）· COSTRA-152（K3 决策延续 · §LINKAGE 决策 1）
> **下游解锁**：FU-104-ENTRIES-DELETE 真闭合 · COSTRA-150 调度器软删行处理路径完整

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | ✅ 已审 REVISE 22/30 @ 2026-05-22 18:30 |
| **Card-Review R2**（形式审）| `costra-card-reviewer-tech` | 等启动（dispatch R2 修订完毕 · 期望 ≥ 24 PASS-WITH-FOLLOWUP）|
| **R1 实装** | `costra-backend-dev` | 等卡审 R2 PASS |
| **R1 Review** | `costra-review-tech`（D-022 v2.0 第 10 次实战）| 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-153`（与 152 联合 approve · D-024 §2.2 C1 第 4 次实战候选）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- 同 COSTRA-152（COSTRA-104 R1 切出去 3 件套铁律）· stub 501 标记 deferred_card=COSTRA-153 / followup_id=FU-104-ENTRIES-DELETE
- OpenAPI L580-591 已有 DELETE 定义 + x-deferred 段（待删）
- entries.deleted_at 列 + entryService.softDelete + entryRepo.softDeleteEntry 已全备（COSTRA-104 R1 一并落 · 仅缺路由 stub 替换）
- 软删行已在 COSTRA-154 sync/pull 路径返回（协议 §3.5）· 闭环（v1.2 BIGINT change_seq 推进）

### 1.2 PRD / 契约锚点
- **PRD**：用户删除一笔（高频）· 软删保留审计 · client 据 deleted_at 本地软删（COSTRA-150 调度器接收）
- **OpenAPI**：`server/api/openapi.yaml:580-591` DELETE /entries/{id} · 现仅响应 204 / 404 · 待补 401/403/409 + version query 参数
- **协议**：`docs/api/sync-protocol.md` §3.5 软删行 since 窗口保留 · §4.x base_version 乐观锁仲裁
- **stub 现状**：`server/src/routes/entries.ts:182-195`（含注释 L182-183 + app.delete L184-195 · 删除目标）

### 1.3 §LINKAGE 决策 2：DELETE version 传递方式（已拍板方案 A · FU-153-006 落地）
- **拍板：方案 A · query string `?version=N`** · 依据 3 条：
  1. DELETE 无 body · 若用 header(If-Match) 需 miniapp wx.request 额外配置 header · 小程序 wx.request 对自定义 header 支持有限制（白名单 + 大小写敏感）
  2. 152 PATCH version 在 body（EntryUpdate schema required: [version]）· DELETE 与 PATCH 语义不同（DELETE 无 body）· query 是 REST 对 resource+version 标识的自然表达 · 与 152 区分清晰
  3. /sync/pull 已用 query since（v1.2 BIGINT change_seq）· DELETE 用 query version 与项目已有 query 参数风格一致 · OpenAPI 协议层规范统一
- **R1 实装期不允许翻案**（§LINKAGE 铁律）· 若发现阻塞必须走 D-017 §2.4 验证问题响应 SOP 上报 Orchestrator + Human

---

## §2 Scope（4 项 · 估点 2 · INVEST small）

### 2.1 主交付（4 项 · 必交）

#### A · 替换 routes/entries.ts DELETE stub 为真 handler
- 删除 L182-195 stub 块（含注释 L182-183 + app.delete L184-195）
- 加 `DELETE_ENTRIES_ENDPOINT = '/entries/:entry_id'` 常量（参 154 / 152 范式）
- 加 `deleteEntryParamsSchema`（entry_id 必 UUID）+ `deleteEntryQuerySchema`（**version: integer minimum 1 required** · §LINKAGE 决策 2 落地）
- `app.delete<{ Params: { entry_id: string }, Querystring: { version: number } }>(...)` 注册路由
- `parseUserId` 复用（entries.ts L24-34）
- 调 `entryService.softDelete(userId, entryId, version)`
- **响应（FU-153-002 + FU-153-005 落地）**：
  - 204 No Content（成功 · entryService.softDelete 返 status: 'ok'）
  - 400 INVALID_ARGUMENT（schema 校验失败 / version 缺失 / version <= 0 / entry_id 非 UUID）
  - 401 UNAUTHENTICATED（parseUserId 抛错）
  - 403 FORBIDDEN（跨 family 越权 · 见 T6）
  - 404 NOT_FOUND（findById 抛错）
  - **409 VERSION_CONFLICT 标准体**：`{ error: { code: 'VERSION_CONFLICT', message: '...', details: { server_version: N } } }` · 与 entryService EntryResult.conflict.serverVersion 直接对齐 · 不返全量实体（client 走 GET /entries/:id 单独拉取 · 与 152 P1-2 修复完全一致）
- **强制 version required（FU-153-003 落地）**：query schema required: ['version'] + minimum: 1 · 不接受 0 / null / 未传 · 缺失 → 400 · 无降级路径

#### B · OpenAPI 修订
- 删除 L580-586 x-deferred 段（AP-003 第 5 次正向兑现）
- **加 version 参数**：`parameters: [{ name: version, in: query, required: true, schema: { type: integer, minimum: 1 } }]`（§LINKAGE 决策 2 落地）
- **补全响应**：401 Unauthorized · 403 Forbidden · 409 Conflict（含 server_version details · FU-153-005 落地）
- tags / summary / security 已在（核验）

#### C · server 单测 ≥ 6 测
- 新建 `server/test/entries-delete.test.ts`
- T1 未登录 401（无 Authorization）
- T2 缺 version query 400（DELETE /entries/{id} 不带 ?version → query schema 校验失败）
- T3 删除成功 204 + deleted_at != null（DB 行 deleted_at IS NOT NULL · version+1 · change_seq 推进）
- T4 base_version 不匹配 409 + body `{ error: { code: 'VERSION_CONFLICT', details: { server_version: N } } }`
- T5 entry 不存在 404
- T6 跨 family 越权 403（user A 删 user B family 的 entry · entryService.findById 应抛 NOT_FOUND 或 service 层加 user 过滤）

#### D · follow-ups + 缺陷单同步
- FU-104-ENTRIES-DELETE: open → closed @ COSTRA-153
- FU-150-SOFT-DELETE-CLIENT: 不在本卡 · 留 COSTRA-150 自身 R1 涵盖（client 接收软删行处理）

### 2.2 不在本卡范围
- ❌ 硬删 / 数据清理 job → 留 FU-DB-OPS-AUDIT
- ❌ undelete / 恢复 → MVP 不做 · 留 Sprint-4+
- ❌ DELETE 不带 version 的降级路径 → §1.3 已拍板强制 required · 无降级
- ❌ method-override（DELETE 是标准 HTTP method · 不需 K3）→ 152 K3 已覆盖 PATCH

---

## §3 DoD（19 项 · FU-153-001 R2 展开 · 参 154/152 模板对照）

### G1~G8 + G15 标准闸门（9 项）
- **G1** TypeScript typecheck 全绿
- **G2** ESLint 全绿
- **G3** OpenAPI lint 全绿 + L580-586 x-deferred 段已删
- **G4** server 单测全绿（含本卡新增 T1~T6）
- **G5** schema-check 全绿（entries.deleted_at 列已存在 · 无破坏性改动）
- **G6** whitelist-check 全绿（路径白名单 + 规则 D OpenAPI vs fastify prefix）
- **G7** OpenAPI 实装齐全（DELETE /entries/{id} 路由可达 + version query param 已加 + 401/403/409 响应定义完整）
- **G8** x-deferred 清理（剩 0 个 · 152 同时清理 · sync/pull 已 154 清理 · 全 spec 干净）
- **G15** D-016 反例预防（commit 前 `git status -s | grep '.team/members/' | wc -l` = 0）

### T1~T6 单测（6 项 · 见 §2.1 C）

### 反向验证（3 项）
- ① 改 DELETE 为硬删（DELETE FROM entries）→ T3 应 FAIL（deleted_at 不可能 != null · 行已不存在）→ revert
- ② 不校验 base_version（softDelete 不传 version）→ T4 FAIL → revert
- ③ 跨 family 不 throw → T6 FAIL → revert

### D-025 AP-003（1 项 · 第 5 次正向兑现）
- AP-001 不命中（INVEST small 2pt 单装扮档单 commit）
- AP-002 不命中（无跨卡复制 · handler 复用 entryService.softDelete 已有函数）
- **AP-003 命中并修复**：删 openapi.yaml L580-586 x-deferred + 替换 entries.ts L182-195 stub · grep `x-deferred.*COSTRA-153` openapi.yaml 应返 0 行

---

## §4 强制阅读清单

1. 本派单档全文（已修订 R2 版 · 2026-05-22 18:35）
2. Card-Review 报告：`.team/reviews/COSTRA-153/card-review-round-1-tech.md`（REVISE 22/30 · 6 项 FU-153-001~006 已落地本档）
3. **OpenAPI 现状**：`server/api/openapi.yaml:580-591` DELETE 定义 + L580-586 x-deferred
4. **stub 现状**：`server/src/routes/entries.ts:182-195`（含注释 L182-183 + app.delete L184-195）
5. **复用范式**：
   - `server/src/services/entryService.ts:26,199-207` softDelete（已实装 · 不需改）
   - `server/src/repositories/entryRepo.ts:211-224` softDeleteEntry（已含 change_seq nextval · v1.2 升级后）
6. **协议软删**：`docs/api/sync-protocol.md` §3.5（软删行 since 窗口保留 · 154 sync/pull 已含 deleted_at 行）
7. **152 范式参考**（一并并行做 / 152 先做）：`.team/dispatch/COSTRA-152-patch-entries-impl.md` v2.0
8. **D-025 反模式清单**：`.team/decisions/D-025-anti-patterns-clipboard.md`（AP-003 第 5 次正向兑现）
9. **D-016 100% 修订率**：`.team/decisions/D-016-pass-with-followup-fu-mandatory-revise.md`

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`server/src/routes/entries.ts` · `server/api/openapi.yaml` · `server/test/entries-delete.test.ts`（新建）· `.team/members/backend-dev/` · `.team/follow-ups/README.md`
- ❌ 不可写：miniprogram/ · infra/ · 其他 .team/members/{other-role}/

### §5.2 INVEST small（2 点）
- 时间盒 R1 实装 ≤ 90 分钟（service 全备 · 4 项 scope 比 152 更轻）
- 与 152 联合启动可共用上下文（同文件 routes/entries.ts · 同 entryService · §LINKAGE 决策面已定）

### §5.3 已知未知 / follow-up 候选
- FU-153-CLIENT-SOFT-DELETE-RECEIVE：不在本卡 · COSTRA-150 调度器自身 R1 涵盖
- FU-DB-OPS-AUDIT：硬删 / 数据清理 job · 留独立卡 Sprint-4+

### §5.4 D-016 同轮兑现 · D-018 单装扮档单 commit
- commit footer：`Co-Authored-By: backend-dev <subagent>` · `closes: FU-104-ENTRIES-DELETE`
- commit subject 全小写（commitlint）· `Refs: COSTRA-153` 大写在 footer
- commit 前 final message 含 `git status -s | grep '.team/members/' | wc -l` = 0

---

## §6 估点 / 时间盒

- **估点**：2 点（vs 152 3 点 · 简单 33%）
- **AI 时间盒**：~~1.5 小时~~（含 Card-Review R2 + R1 实装 + R1 Review）
- **Human 实测**：与 152 + 154 + 150 联合 staging 实测（D-024 §2.2 C1 第 4 次实战候选）

---

## §7 已知风险

- **client 未升级到带 version 的 DELETE 请求**：本卡强制 required · 不接受降级 · client（COSTRA-150 调度器）必须传 version · 若实测期 client 未传 → 客户端缺陷不是本卡责任
- **跨 family 越权（T6）**：当前 entryService.findById(userId, entryId) 接收 userId 但未做 family_members 过滤 · 实际过滤在 entryRepo.findById JOIN family_members（但仍未按 userId 过滤）· R1 实装期 backend-dev 需重点验证 T6 是否真的能拦截跨 family · 若不能 → 必须在 service 层加 isUserInFamily 守门（否则是真 P0 漏洞）

---

**派单档结束 · Orchestrator 等 Card-Review R2 形式审 PASS 后 spawn backend-dev R1 实装。**

---

## §10 修订记录

| 版本 | 时间 | 变更 |
|---|---|---|
| v1.0 | 2026-05-19 20:50 | 初版立档（Sprint-3 follow-up 转正 · 8 张联立批落档之一）|
| **v2.0** | **2026-05-22 18:35** | **Card-Review R1 REVISE 22/30 修订** · 6 项 FU 全落地：FU-153-001（§3 DoD 展开 19 项条目）· FU-153-002（§2.1 A 加 409 标准响应体结构）· FU-153-003（§2.1 A version required 强制 · 无降级路径）· FU-153-004（§2.1 A DELETE_ENTRIES_ENDPOINT 常量值显式）· FU-153-005（§2.1 B OpenAPI 补 401/403/409 响应定义）· FU-153-006（§1.3 §LINKAGE 决策 2 拍板方案 A query `?version=N` · 依据 3 条入卡）· §7 风险新增跨 family 越权（T6）真 P0 守门点提醒 |
