# COSTRA-154 R1 实装 · GET /sync/pull 增量拉取

> 日期：2026-05-19 · backend-dev 一次性装扮档 · commit `7e87bad`

---

## 1. 背景

COSTRA-104 R1 切出去铁律留了 3 个 stub 501（PATCH /entries / DELETE /entries / GET /sync/pull）。其中 GET /sync/pull 的 stub 阻塞 COSTRA-105 H6 + D.2 硬断言（Human 实测时 501），同时 COSTRA-150 client 调度器强依赖 pull 端点。COSTRA-154 R1 实装替代 stub 为真实 handler。

## 2. 方案

9 项 scope 按 dispatch §2.1 执行：

- **A** · `entryRepo.ts` 加 `findEntriesByFamilySince`（JOIN ledgers · 不直查 entries.family_id · 卡审 P0-1 修正）+ `PullCursor` interface + `PullEntryRow` type
- **B** · `syncPullService.ts` 新建（80~120 行）· `isUserInFamily` inline SQL 兜底（familyMemberRepo 不存在）+ watermark 推进（max updated_at · 无数据不变）+ `entryToWire` snake_case 映射
- **C** · `routes/sync.ts` 删 stub 501 → 真实 handler + `pullQuerySchema` + `parseUserIdFromRequest` 复用 + since ISO 解析容错
- **D** · `openapi.yaml` 删 x-deferred + 修缩进异常 + 加 tags/summary/security + 400/401/403 response ref
- **E** · `SyncPullResponse` schema 验证（已存在 · 补 `has_more` 到 required）
- **F** · `sync-pull.test.ts` 新建 14 测（T1~T14 · 含软删/分页/越权/字段映射/snake_case/server_version）+ `sync.test.ts` T7 从 stub 501 改为 401
- **F'** · `setup.ts` pg-mem DDL 确认（entries + ledgers + family_members 全齐 + deleted_at + version）
- **G** · `follow-ups/README.md` FU-104-SYNC-PULL open → closed
- **H** · `105 D2 blocker defect` BLOCKED → RESOLVED

关键设计决策：
1. `findEntriesByFamilySince` JOIN ledgers（entries 无 family_id 列 · R1 卡审 P0-1）
2. 不过滤 deleted_at（协议 §3.5 软删保留）
3. LIMIT+1 has_more 范式
4. `entryToWire` 中 `server_version = e.version`（协议字段名 vs DB 列名）
5. `isUserInFamily` inline SQL（含 left_at IS NULL · 立 FU-154-FAMILY-MEMBER-REPO）

## 3. 产出

| 文件 | 类型 | 行数 |
|---|---|---|
| `server/src/repositories/entryRepo.ts` | 修订 | +48 |
| `server/src/services/syncPullService.ts` | 新建 | 108 |
| `server/src/routes/sync.ts` | 修订 | -8/+23 |
| `server/api/openapi.yaml` | 修订 | -10/+17 |
| `server/test/sync-pull.test.ts` | 新建 | 270 |
| `server/test/sync.test.ts` | 修订 | -4/+4 |
| `.team/follow-ups/README.md` | 修订 | 2 行 |
| `qa/defects/2026-05-18-COSTRA-105-D2-pull-501-blocker.md` | 修订 | +12 |

闸门 G1~G8 + G15 全绿 · 49 测全绿（含新增 14 测）。

## 4. 反思

- 卡审 P0-1（entries 无 family_id 列）在实装前已由 R2 修正 · 实装时未踩坑 · JOIN ledgers 范式与 findById 一致
- `isUserInFamily` inline SQL 是技术债 · 已立 FU-154-FAMILY-MEMBER-REPO · 后续 COSTRA-200 系列卡抽 repo 时统一收
- T11 软删测试初版用 `payload: { entry_id }` 但 sync/push delete 用 `client_ref_id` 作 entry id · 修后通过
- D-025 AP-003 命中并修复（x-deferred 删除 · 契约-实装漂移正向兑现）

## 5. 交接

- **等 review-tech R1**（D-022 v2.0 第 8 次实战）
- **下游解锁**：COSTRA-150（client 调度器 · 严格依赖 154 R1 APPROVE）· COSTRA-105 H6/D.2 等效回归
- **follow-up 候选**：
  - FU-154-CATEGORIES-PULL（MVP 仅返 entries · ledgers/categories/budgets 留 Sprint-4+）
  - FU-154-FAMILY-MEMBER-REPO（isUserInFamily inline SQL 抽 repo）
  - FU-154-X-DEFERRED-CI-CHECK（whitelist-check.mjs 规则 E · Sprint-3 末 Retro 议题）
