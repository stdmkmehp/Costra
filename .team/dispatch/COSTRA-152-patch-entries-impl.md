# COSTRA-152 · PATCH /entries/{entry_id} 实装（替代 R1 stub 501）

> **派单时间**：2026-05-19 20:50（Orchestrator · Sprint-3 follow-up 转正 · 与 154 同轮立档）
> **状态**：dispatch 已落盘 · 不主动 spawn · 等 Human 拍板启动（D-024 §2.3 攒批）
> **依赖**：COSTRA-104（entryService.updateWithVersion + entryRepo.updateEntryByVersion 已全备）· COSTRA-156（v1 prefix · CLOSED）· COSTRA-158（K3 method-override 范式 · CLOSED）
> **下游解锁**：FU-104-ENTRIES-PATCH 真闭合 · K3→K1 升级评估触发（FU-K3-TO-K1-UPGRADE · dispatch 阶段决策）

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
- **协议**：`docs/api/sync-protocol.md` §4.x base_version 乐观锁仲裁
- **stub 现状**：`server/src/routes/entries.ts:165-180`（删除目标）

### 1.3 K3 → K1 评估（FU-K3-TO-K1-UPGRADE 触发点）
- COSTRA-158 R1 用 K3 局部 method-override（POST + X-HTTP-Method-Override: PATCH）
- 152 PATCH /entries 同样需要 method-override（wx.request 不支持 PATCH 是平台限制）
- **Card-Review 阶段决策**：① 继续 K3（在 entries 路由内重复 ~10 行）vs ② K1 全局 middleware 升级（fastify-method-override 库 / 自实现）
- D-017 §2.4 验证问题响应 SOP 上报决策点

---

## §2 Scope（5 项 · 估点 3 · INVEST small）

### 2.1 主交付（5 项 · 必交）

#### A · 替换 routes/entries.ts PATCH stub 为真 handler
- 删除 L165-180 stub 块
- 加 PATCH_ENTRIES_ENDPOINT 常量 + bodySchema（参 EntryUpdate · required: [version]）
- app.patch<{ Params: { entry_id: string }, Body: EntryUpdatePayload }>(...)
- parseUserIdFromRequest 复用
- 调 entryService.updateWithVersion(userId, entryId, payload, baseVersion)
- 错误处理：404 NOT_FOUND / 409 VERSION_CONFLICT（含 server_state 返回）/ 400 INVALID_ARGUMENT

#### B · K3 / K1 兼容（与 COSTRA-158 K3 范式延续 · 或 K1 全局升级 · Card-Review 决策）
- 若选 K3：在 entries.ts 路由内识别 X-HTTP-Method-Override: PATCH
- 若选 K1：抽 server/src/plugins/methodOverride.ts 全局 middleware · 同步移除 158 R1 的 K3 局部代码

#### C · OpenAPI 修订
- 删除 L559-565 x-deferred 段
- 验证 EntryUpdate schema 已完整（已确认）
- tags / summary / security 已在（核验）

#### D · server 单测
- 新建 `server/test/entries-patch.test.ts` ≥ 8 测
- T1 未登录 401 · T2 entry_id 非 UUID 400 · T3 缺 version 400
- T4 update 成功 200 + version 递增 · T5 base_version 不匹配 409 + server_state
- T6 entry 不存在 404 · T7 跨 family 越权 403
- T8 method-override（POST + X-HTTP-Method-Override: PATCH）等价行为

#### E · follow-ups + 缺陷单同步
- FU-104-ENTRIES-PATCH: open → closed @ COSTRA-152
- FU-COMMON-MINIAPP-PATCH-LIMIT 状态延续（已 closed @ 158 · 仅注释延续 K3 范式）
- FU-K3-TO-K1-UPGRADE: open → closed/scoped 取决于本卡 Card-Review 决策

### 2.2 不在本卡范围
- ❌ DELETE /entries/{id} → COSTRA-153
- ❌ 客户端 patch UI → 已在 COSTRA-103 outbox 内
- ❌ 字段级合并 / conflict UI → COSTRA-151

---

## §3 DoD（≥ 12 项）

参照 COSTRA-154 派单档 §3 模板 · 含 G1~G6 标准闸门 + G7 OpenAPI 实装齐全 + G8 x-deferred 清理（剩 DELETE entries · sync/pull 已删）+ G15 D-016 反例预防（M 项强约束）。

反向验证 3 项：① 临时把 base_version 不传 → T3 FAIL → revert · ② 临时返 200 而非 409 → T5 FAIL → revert · ③ 跨 family 不 throw → T7 FAIL → revert。

D-025 反模式扫描预测：AP-001 不命中 / AP-002 不命中 / AP-003 命中并修复（x-deferred 删 + stub 替换 · 第 4 次正向兑现）。

---

## §4 强制阅读清单

1. 本派单档全文
2. Card-Review 报告（待生成）：`.team/reviews/COSTRA-152/card-review-round-1-tech.md`
3. **OpenAPI 现状**：`server/api/openapi.yaml:559-579` PATCH 定义 + L1120-1132 EntryUpdate schema
4. **stub 现状**：`server/src/routes/entries.ts:165-180`
5. **复用范式**：
   - `server/src/services/entryService.ts:25,176-197` updateWithVersion（已实装）
   - `server/src/repositories/entryRepo.ts:138-183` updateEntryByVersion + L265-279 findById
6. **K3 范式参考**：`.team/dispatch/COSTRA-158-users-me-and-has-completed-profile.md` §2.1（POST + X-HTTP-Method-Override 范式）
7. **D-025 反模式清单**：`.team/decisions/D-025-anti-patterns-clipboard.md`
8. **D-022 v2.0**：`.team/decisions/D-022-review-tech-runtime-dimension.md`

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

**派单档结束 · Orchestrator 等 Human 触发 `start:COSTRA-152` 后 spawn Card-Review R1。**
