# COSTRA-153 · DELETE /entries/{entry_id} 软删实装（替代 R1 stub 501）

> **派单时间**：2026-05-19 20:50（Orchestrator · Sprint-3 follow-up 转正 · 与 152 联动）
> **状态**：dispatch 已落盘 · 不主动 spawn · 等 Human 拍板启动（D-024 §2.3）
> **依赖**：COSTRA-104（entryService.softDelete + entryRepo.softDeleteEntry 已全备）· COSTRA-152（K3/K1 决策结果延续）
> **下游解锁**：FU-104-ENTRIES-DELETE 真闭合 · COSTRA-150 调度器软删行处理路径完整

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | 等启动 |
| **R1 实装** | `costra-backend-dev` | 等卡审 PASS |
| **R1 Review** | `costra-review-tech` | 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-153`（与 152 联合 approve 优选）| 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- 同 COSTRA-152（COSTRA-104 R1 切出去 3 件套铁律）· stub 501 标记 deferred_card=COSTRA-153 / followup_id=FU-104-ENTRIES-DELETE
- OpenAPI L580-591 已有 DELETE 定义 + x-deferred 段
- entries.deleted_at 列 + entryService.softDelete + entryRepo.softDeleteEntry 已全备
- 软删行已在 COSTRA-154 sync/pull 路径返回（协议 §3.5）· 闭环

### 1.2 PRD / 契约锚点
- **PRD**：用户删除一笔（高频）· 软删保留审计 · client 据 deleted_at 本地软删（COSTRA-150 调度器接收）
- **OpenAPI**：`server/api/openapi.yaml:580-591` DELETE /entries/{id} · 响应 204 / 404
- **协议**：`docs/api/sync-protocol.md` §3.5 软删行 since 窗口保留

### 1.3 ⚠️ OpenAPI version 传递方式未明（Card-Review 决策）
- 当前 spec 在 DELETE 段无 query/header 参数
- 软删需 baseVersion（乐观锁）· 必须决定传递方式：
  - **方案 A**：query string `?version=N`（REST 风格）
  - **方案 B**：header `If-Match: "N"`（HTTP 标准乐观锁 ETag 范式）
- **Card-Review 阶段拍板** · 不留 R1 实装期摇摆

---

## §2 Scope（4 项 · 估点 2 · INVEST small）

### 2.1 主交付

#### A · 替换 routes/entries.ts DELETE stub 为真 handler
- 删除 L182-195 stub
- 加 DELETE_ENTRIES_ENDPOINT 常量 + 参数解析（A 或 B 方案）
- 调 entryService.softDelete(userId, entryId, baseVersion)
- 响应：204 No Content（成功）/ 404 NOT_FOUND / 409 VERSION_CONFLICT / 401 / 403

#### B · OpenAPI 修订
- 删除 L580-586 x-deferred 段
- 加 version 参数（query 或 header · Card-Review 决策结果）
- tags / summary / security 已在（核验）

#### C · server 单测
- 新建 `server/test/entries-delete.test.ts` ≥ 6 测
- T1 未登录 401 · T2 缺 version 400 · T3 删除成功 204 + deleted_at != null
- T4 base_version 不匹配 409 · T5 entry 不存在 404 · T6 跨 family 越权 403

#### D · follow-ups
- FU-104-ENTRIES-DELETE: open → closed @ COSTRA-153

### 2.2 不在本卡范围
- ❌ 硬删 / 数据清理 job → 留 FU-DB-OPS-AUDIT
- ❌ undelete / 恢复 → MVP 不做 · 留 Sprint-4+

---

## §3 DoD（≥ 10 项）

参照 154 模板 · 6 闸门 + G7/G8 + G15。反向验证 3 项：① 改 DELETE 为硬删（DELETE FROM）→ T3 FAIL · ② 不校验 base_version → T4 FAIL · ③ 跨 family 不 throw → T6 FAIL。

D-025 扫描预测：AP-003 命中并修复（第 5 次正向兑现）· AP-001/002 不命中。

---

## §4 强制阅读清单

1. 本派单档 + Card-Review 报告
2. **stub 现状**：`server/src/routes/entries.ts:182-195`
3. **OpenAPI**：`server/api/openapi.yaml:580-591`
4. **复用**：
   - `server/src/services/entryService.ts:26,199-207` softDelete
   - `server/src/repositories/entryRepo.ts:189-201` softDeleteEntry
5. **协议软删**：`docs/api/sync-protocol.md §3.5`
6. **152 范式**（如已先做）：`.team/dispatch/COSTRA-152-*.md`

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`server/src/routes/entries.ts` · `server/api/openapi.yaml` · `server/test/entries-delete.test.ts`（新建）· `.team/members/backend-dev/` · `.team/follow-ups/README.md`
- ❌ 不可写：miniprogram/ · infra/ · 其他 .team/members/{other-role}/

### §5.2 INVEST small（2 点）
- 时间盒 ≤ 90 分钟（service 全备 · 5 项 scope 比 152 更轻）

### §5.3 D-016 同轮兑现 · D-018 单装扮档单 commit
- commit footer `closes: FU-104-ENTRIES-DELETE`

---

## §6 估点 / 时间盒
- 估点 2 点 · AI ~1.5 小时 · Human 联合 152/154/150 staging 实测

---

**派单档结束 · 等 Human `start:COSTRA-153`。**
