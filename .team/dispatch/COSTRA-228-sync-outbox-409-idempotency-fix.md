# COSTRA-228 · Sync/Outbox 409 幂等键冲突导致条目永久积压

> **触发**：COSTRA-227 验收期间发现  
> **记录时间**：2026-06-03 19:23  
> **状态**：`backlog` · 待排期  
> **Owner**：`costra-backend-dev` + `costra-miniapp-dev`  
> **优先级**：P0（阻塞正常同步）  
> **类型**：bug fix（前后端联合）

---

## 问题描述

outbox 中 `op: "create"` 条目在首次 sync push 失败后，**无限重试永远 409**，导致所有后续 push 也被阻塞。

### 复现路径

1. 用户正常记账（`op: "create"` 入 outbox）
2. `POST /v1/sync/push` 首次发送成功，服务端处理了 ops 并写入 `idempotency_keys` 表
3. 客户端因网络超时/异常**未收到 200 响应** → catch 分支调用 `ackBatchFailure` → 条目放回 outbox
4. 重试时客户端携带**相同 `idempotency_key`**，但 body_hash 可能因序列化差异而改变
5. 服务端 `idempotencyService.checkAndGet()` 检测到：key 命中 + hash 不一致 → 抛 `IDEMPOTENCY_KEY_MISMATCH`（HTTP 409）
6. 客户端 `pushDelta()` catch 分支再次 `ackBatchFailure` → 放回 outbox → **死循环**

### 日志证据

```
[sync] ok · pushed=0 conflicts=0 rejected=0 failed=24 pulled=0 watermark=0
POST /v1/sync/push 409 (Conflict)
```

outbox 条目详情：
```json
{
  "op": "create",
  "entity": "entry",
  "client_ref_id": "0d00040f-0c09-4c00-8606-0e0005030b0b",
  "base_version": null,
  "retries": 321,
  "idempotency_key": "idem-1780480321094-hvpf04"
}
```

---

## 根因分析

### 直接原因

`sync.ts` 第 120 行 catch 分支**不区分 HTTP 状态码**，将 409（可恢复的幂等冲突）与 5xx（服务端故障）一视同仁地 retry。

### 深层原因

1. **幂等键 body_hash 不稳定**：重试时 body 可能因 `retries`/`next_retry_at` 字段变化或 JSON key 序列化顺序不同导致 hash 变化。
2. **服务端已成功但客户端不知道**：第一次 push 实际已创建 entry，但客户端未能消费 response → 本地 entry 缺少 `id` 和 `version` → 永远留在 outbox。
3. **无最大重试上限**：outbox 没有 `max_retries` 机制，失败条目永远积压。

---

## 修复方案

### 方案 A：客户端识别 409 并特殊处理（推荐）

**miniapp-dev 改动**（`services/sync.ts`）：

```typescript
// pushDelta() catch 分支改为：
} catch (err: unknown) {
  const status = (err as { statusCode?: number }).statusCode;
  
  if (status === 409) {
    // 幂等键冲突：说明服务端已处理过该批次
    // 视为成功 → 清空该批 outbox 条目（服务端已有数据）
    await ackBatchAsAlreadyProcessed(batchKey);
    return { pushed: 0, conflicts: 0, rejected: 0, failed: 0 };
  }
  
  // 其他错误：放回 outbox 重试
  const failed = await ackBatchFailure(batchKey);
  return { pushed: 0, conflicts: 0, rejected: 0, failed };
}
```

### 方案 B：服务端对相同 idempotency_key 返回缓存响应（而非 409）

**backend-dev 改动**（`services/idempotencyService.ts`）：

当 key 命中但 hash 不同时，**不抛 409**，而是返回之前缓存的响应。理由：对于 sync/push 场景，重试时 body 变化是合理的（客户端加了 retry 元数据），服务端应宽容处理。

### 方案 C：前端稳定化 body_hash

确保重试时 body 与首次完全一致（不含 retries/next_retry_at 等元数据字段，JSON key 排序稳定）。

### 推荐组合

- **短期修复**：方案 A（客户端 2 行改动，风险低）
- **中期加固**：方案 B（服务端宽容处理）+ 方案 C（前端 hash 稳定化）
- **长期**：增加 `max_retries` 机制（超过 N 次 → 移入 dead-letter 不再重试）

---

## 额外问题

### outbox 中 `op: "create"` 的 base_version: null

服务端 sync push 路由对 `op: "create"` 不需要 `base_version`（create 走 `entryService.createWithIdempotency`，不检查 version）。这不是 409 的原因，但应确认 base_version: null 不会在其他路径触发异常。

### 已创建但本地不知道的条目

第一次 push 成功后服务端已有 entry（有 server_id 和 version），但本地 entry 缺少这些字段。修复后需要通过 `sync/pull` 回填 → 本地 entry 获得 `id`/`version` → 标记 `dirty: false`。

---

## DoD

- [ ] 409 不再导致 outbox 条目无限重试
- [ ] 已积压条目能通过修复后的逻辑自动消解（或提供一次性清理脚本）
- [ ] 现有 99 测试不回退
- [ ] 新增单测：模拟 409 响应 → 验证 batch 被清除而非重试
- [ ] 增加 `max_retries`（建议 50 次）→ 超限移入 dead-letter

---

## 临时缓解

开发环境下清空积压 outbox：

```javascript
const allKeys = wx.getStorageInfoSync().keys.filter(k => k.startsWith('outbox:'));
allKeys.forEach(k => wx.removeStorageSync(k));
console.log('cleared', allKeys.length, 'outbox entries');
```

---

## 关联

| 卡号 | 关系 |
|---|---|
| COSTRA-150 | outbox 机制实现 · BUG-COSTRA-150-D 死锁已修 |
| COSTRA-154 | sync push/pull 联调 |
| COSTRA-227 | 验收期间暴露此问题 |
| COSTRA-104 | idempotencyService 实现 |
