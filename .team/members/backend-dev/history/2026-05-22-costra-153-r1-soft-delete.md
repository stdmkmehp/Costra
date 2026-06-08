# COSTRA-153 R1 · DELETE /entries/{id} soft delete with query version

> **卡号**：COSTRA-153 · **类型**：R1 实装 · **时间**：2026-05-22
> **commit**：待生成 · **状态**：R1 实装完成 · 等 review-tech R1

---

## 1. 背景

COSTRA-104 R1 切出去 3 件套铁律 · DELETE /entries/{entry_id} 从 stub 501 转正实装。
Card-Review R1 REVISE 22/30 → R2 形式审 PASS-WITH-FOLLOWUP 26/30 · 6 项 FU-153-001~006 全落地。
§LINKAGE 决策 2 拍板方案 A query `?version=N`（DELETE 无 body · wx.request 自定义 header 限制 · 与 PATCH body version 区分清晰）。

## 2. 实施

### 2.1 DELETE /entries/{entry_id} 实装

- 替换 entries.ts L182-195 stub 为真 handler
- `deleteEntryParamsSchema`（entry_id UUID）+ `deleteEntryQuerySchema`（required: ['version'] · minimum: 1）
- `app.delete<{ Params: { entry_id: string }; Querystring: { version: number } }>(...)` 注册
- `parseUserId` + 调 `entryService.softDelete(userId, entryId, version)`
- 响应：204 No Content（成功）/ 400 / 401 / 404 / 409 VERSION_CONFLICT（details: { server_version: N }）
- 跨 family 守门已由 152 commit 的 entryRepo.findById userId 过滤覆盖（service.findById → repo.findById(entryId, userId)）

### 2.2 OpenAPI 修订

- 删 L580-586 x-deferred 段（AP-003 第 5 次正向兑现）
- 加 `parameters: [{ name: version, in: query, required: true, schema: { type: integer, minimum: 1 } }]`
- 补 400 / 401 / 404 / 409 响应定义

### 2.3 单测

- `entries-delete.test.ts`（新建 ≥ 6 测）：T1 401 / T2 缺 version query 400 / T3 删除成功 204 + DB deleted_at != null + version+1 + change_seq 推进 / T4 409 conflict + details.server_version / T5 entry 不存在 404 / T6 跨 family 越权 → 404
- `entries.test.ts`：移除 T10 DELETE stub 测（已有 entries-delete.test.ts 覆盖）

## 3. 闸门

- G1 typecheck ✅ · G2 lint ✅ · G3 OpenAPI lint ✅ · G4 test 70/70 ✅
- G5 schema-check（脚本不存在 · 跳过）· G6 whitelist-check ✅
- G7 OpenAPI 实装齐全 ✅ · G8 x-deferred 清理 ✅（COSTRA-152 + 153 全清）
- G15 D-016 反例预防 ✅

## 4. 反向验证

跨 family 守门已在 152 commit 反向验证（T6 DELETE 跨 family → 404 同走 service.findById 守门路径）。

## 5. Retro 议题

- 同 152 commit 议题 #5（service 层 userId 守门强制审查维度）+ #6（version+1 显式 SET 规约）
