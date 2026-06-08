# COSTRA-152 R1 · PATCH /entries/{id} + cross-family guard fix

> **卡号**：COSTRA-152 · **类型**：R1 实装 · **时间**：2026-05-22
> **commit**：待生成 · **状态**：R1 实装完成 · 等 review-tech R1

---

## 1. 背景

COSTRA-104 R1 切出去 3 件套铁律 · PATCH /entries/{entry_id} 从 stub 501 转正实装。
Card-Review R1 PASS-WITH-FOLLOWUP 25/30 → R2 形式审 PASS 28/30 · 5 项 FU-152-001~005 全落地。
§LINKAGE 决策 1 拍板 K3 method-override（FU-K3-TO-K1-UPGRADE 留 Sprint-4）。

R2 暴露真 P0 跨 family 越权守门盲区：entryRepo.findById 仅 JOIN family_members 不按 userId 过滤 ·
entryService.findById(userId, entryId) 接收 userId 但未实际使用 · 影响 GET / PATCH / DELETE 三处。

## 2. 实施

### 2.1 P0 守门补丁

- `entryRepo.findById(entryId, userId?, client?)`：加 userId 参数 · 有 userId 时 JOIN family_members 增加 `fm.user_id = $2 AND fm.left_at IS NULL` 过滤 · 无 userId 时走原始路径（内部 repo 调用兼容）
- `entryService.findById(userId, entryId)`：改调 `entryRepo.findById(entryId, userId)` · 返 null 时抛 NOT_FOUND（跨 family / 不存在统一 404）
- 影响：GET /entries/{id} + PATCH + DELETE 三处共享守门自动获得

### 2.2 PATCH /entries/{entry_id} 实装

- 替换 entries.ts L165-180 stub 为真 handler
- `patchEntryParamsSchema`（entry_id UUID）+ `patchEntryBodySchema`（required: ['version'] · additionalProperties: false）
- `handlePatchEntry(req, reply)` 独立函数 · 调 `entryService.updateWithVersion(userId, entryId, payload, baseVersion)`
- 错误处理：200 EntryView / 400 / 401 / 404 / 409 VERSION_CONFLICT（details: { server_version: N }）

### 2.3 K3 method-override

- POST `/entries/:entry_id` handler · 识别 `X-HTTP-Method-Override: PATCH` 委托 `handlePatchEntry`
- 无 header 时 405 METHOD_NOT_ALLOWED（参 users.ts L121-138 范式）

### 2.4 version+1 显式 SET

- 发现 `entryRepo.updateEntryByVersion` / `softDeleteEntry` 缺少 `version = version + 1`
- 原注释误写"触发器自动 version+1" · 实际只有 updated_at 触发器 · 必须应用层显式 SET
- 一并修复 `softDeleteEntry`（同 commit · 属于同一守门/实装范围）

### 2.5 OpenAPI 修订

- 删 L559-565 x-deferred 段（AP-003 第 4 次正向兑现）
- 补 400 / 401 / 404 / 409 响应定义

### 2.6 单测

- `entries.test.ts`：删 T9/T10 stub 测 · 加 T-CROSS-FAMILY 越权 GET 测（user A 查 user B family entry → 404）
- `entries-patch.test.ts`（新建 ≥ 8 测）：T1 401 / T2 400 UUID / T3 400 缺 version / T4 200 version 递增 / T5 409 conflict / T6 404 / T7 跨 family 404 / T8 method-override 等价

## 3. 闸门

- G1 typecheck ✅ · G2 lint ✅ · G3 OpenAPI lint ✅ · G4 test 70/70 ✅
- G5 schema-check（脚本不存在 · 跳过）· G6 whitelist-check ✅
- G7 OpenAPI 实装齐全 ✅ · G8 x-deferred 清理 ✅ · G15 D-016 反例预防 ✅

## 4. 反向验证

临时回退 `entryService.findById` 不传 userId → `entryRepo.findById(entryId)`（无 userId 过滤）→
3 个跨 family 测（T-CROSS-FAMILY / T7 / T6）均 FAIL（expected 404, received 200）→
恢复守门 → 3 测重新 PASS → 证明守门起作用 ✅

## 5. Retro 议题

- **service 层 user/family 守门作为 review-tech 强制审查维度**：COSTRA-104 R1 实装时漏 · review-tech R1 36/40 漏检 · Sprint-3 末 Retro 议入
- **version+1 显式 SET 规约**：pg-mem 不支持 trigger · 所有 UPDATE 必须应用层显式 SET version = version + 1 · 候选写入 ADR
