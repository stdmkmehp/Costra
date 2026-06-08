# Tech Review · COSTRA-220 · Round 1 · T3 Retrospective

- **触发**：`review-tech:COSTRA-220`
- **审查类型**：D-013 T3 追溯技术审查
- **审查角色**：review-tech（只读审查，Orchestrator 物理落盘）
- **被审卡片**：`COSTRA-220` · C2 明细页真实数据完善
- **Owner**：miniapp-dev
- **主 commit**：`78c1c01 feat(miniapp): integrate real ledger data with family context and categories`
- **后续 polish commit**：`351d1e3 fix(miniapp): polish ledger acceptance issues`
- **历史混入 commit**：`07e0a52 chore(miniapp): commit pending UI refactor & family-first sprint changes`
- **审查时间**：2026-06-02T13:30:00+08:00
- **基线事实**：Human 已确认 `qa/costra-154-150-joint-smoke.md`、`qa/phase-3-prod-realdevice-test.md`、`qa/current-stage-acceptance-family-first-baseline.md` 三份手册全部 PASS。

---

## 1. 总评

| 项 | 结论 |
|---|---|
| **Verdict** | `PASS-WITH-FOLLOWUP` |
| **Score** | `29/35` |
| **P0** | 0 |
| **P1** | 1 |
| **P2** | 5 |
| **INFO** | 3 |
| **是否阻塞 Family First baseline** | 否 |
| **是否要求回滚** | 否 |
| **T3 收口建议** | 登记 `FU-220-SYNC-USER-ID-CREATED-BY` 后可 T3 自动关闭 |

结论：`COSTRA-220` 已被 Family First baseline 的 Human 验收覆盖。本次追溯审查发现 1 个 P1：sync wire `user_id` 与本地 `created_by` 字段名不对齐，会影响 sync pull 条目的“仅看自己”筛选。该问题不推翻已验收事实，不要求回滚，建议作为 Sprint-4 sync 协议适配 follow-up 修复。

---

## 2. 维度评分

| 维度 | 得分 | 说明 |
|---|---:|---|
| 契约一致性 | 4/5 | FamilyContext、active ledger name、category model 与当前 UI 接入基本一致；sync wire `user_id` vs 本地 `created_by` 字段名不对齐，命中 AP-003。 |
| 架构与分层 | 4/5 | `family.ts`、`categoryService`、eventBus、ledger page 职责基本清晰；`ledger/index.ts` 641 行，超过 500 行治理建议阈值。 |
| 数据与持久化 | 4/5 | 本地 Entry `created_by` 可选设计合理；本地创建写入正常；`applyServerChanges` 对 sync raw entry 直接断言导致字段映射缺失。 |
| 离线与同步 | 3/5 | `ENTRY_SAVED` 响应式刷新有效，本地 outbox 不被破坏；sync pull 后 `created_by` 丢失影响成员筛选。 |
| 安全与合规 | 5/5 | 未发现 AppID/secret/session_key 泄漏；家庭上下文缺失时降级安全；未发现跨用户数据访问红线。 |
| 可测与可观测 | 4/5 | 现有 family 与端到端手册覆盖主路径；ledger page 缺独立单测，删除/成员筛选等细节主要靠手册。 |
| 工程纪律 | 5/5 | 当前基线验证已通过；`07e0a52` 多卡多域 commit 已在 218/219 审查中作为工程纪律问题登记，不重复扣分。 |

---

## 3. P0 阻塞点

无。

---

## 4. P1 应改

### P1-1 · sync wire `user_id` 与本地 Entry `created_by` 字段名不对齐

- **ID**：`FU-220-SYNC-USER-ID-CREATED-BY`
- **类型**：契约-实装漂移 / sync 字段映射缺失
- **反模式**：D-025 AP-002 + AP-003
- **证据**：
  - `miniprogram/services/db.ts:23-24`：本地 Entry 接口字段为 `created_by?: string | null`，注释承认从 sync wire `user_id` 写入。
  - `miniprogram/services/db.ts:240`：`const item = raw as Entry`，`applyServerChanges` 对 raw entry 直接强转，无 `user_id → created_by` 字段映射。
  - `server/src/services/syncPullService.ts:126`：sync pull wire 输出 `user_id: e.createdBy`。
  - `server/api/openapi.yaml:1139`：Entry schema 使用 `created_by`，与 sync wire 的 `user_id` 存在契约漂移。
- **影响**：服务端 pull 回来的 entry 只有 `user_id` 而没有本地 `created_by`，导致 `entries.filter(e => e.created_by === this._currentUserId)` 对同步拉取条目无效，“仅看自己”成员筛选会漏掉远端同步条目。
- **阻塞评估**：不阻塞 Family First baseline。Human 已验收通过；本地创建条目正常；问题限定在 sync pull 条目的成员筛选一致性。
- **建议修复**：
  1. 推荐：在 sync 协议层统一字段名，服务端 `syncPullService` 输出 `created_by`，与 OpenAPI Entry schema 对齐。
  2. 或客户端 `applyServerChanges` entries 分支中显式映射：`created_by = raw.created_by ?? raw.user_id ?? null`。
  3. 修复时补充 sync pull 后“仅看自己”筛选的回归用例。

---

## 5. P2 建议

### P2-1 · 多账本切换仍为 stub

- **ID**：`FU-220-MULTI-LEDGER-SWITCH`
- **证据**：`miniprogram/pages/ledger/index.ts:421-429`，`items.length <= 1` 时直接 Toast 返回，ActionSheet 不会展示。
- **问题**：dispatch 曾要求“切换后刷数据”，但 MVP 当前只有个人账本，多账本切换尚未真实闭环。
- **建议**：依赖 `COSTRA-221` family list / ledger list API 后，在 Sprint-5 家庭页/明细页联动中补齐。

### P2-2 · expense overlay 账本名仍硬编码“我的账本”

- **ID**：`FU-220-OVERLAY-ACTIVE-LEDGER-NAME`
- **证据**：`miniprogram/components/expense-overlay/index.ts:127`、`187`、`225`。
- **问题**：明细页已使用 `getActiveLedgerName()`，但记账 overlay 仍硬编码“我的账本”，切换 shared family 后两处显示可能不一致。
- **建议**：overlay `_show()` 或初始化路径调用 `getActiveLedgerName()`，保持与 ledger 页一致。

### P2-3 · `auth.ts` 中 `family_kind` 仍硬编码 `personal`

- **ID**：`FU-220-AUTH-FAMILY-KIND-SOURCE`
- **证据**：`miniprogram/services/auth.ts:218`、`246`、`282`、`308`。
- **问题**：登录/refresh 路径中 `family_kind` 当前写死为 `personal`。MVP 个人账本可接受，但 D2/shared family 接入后会误导前端 family context。
- **建议**：`COSTRA-221`/`COSTRA-222` 后由服务端 auth/family bootstrap response 返回真实 `family_kind`，前端只消费服务端事实。

### P2-4 · 删除条目退出动画未实现

- **ID**：`FU-220-DELETE-ANIMATION`
- **证据**：`miniprogram/pages/ledger/index.ts:612-625`，删除成功后即时 `_buildDisplay()` 重建。
- **问题**：dispatch §C5 要求 `translateX → 全宽滑出 + opacity → 0, 300ms`，当前未实现动画，仅完成左滑删除交互闭环。
- **建议**：作为 polish 小卡补齐，不阻塞数据链路。

### P2-5 · 缺 `ENTRY_DELETED` eventBus 事件

- **ID**：`FU-220-ENTRY-DELETED-EVENT`
- **证据**：`miniprogram/services/eventBus.ts:8-15` 仅定义 `ENTRY_SAVED`；dispatch §C4 提到 `ENTRY_DELETED`（如有）。
- **问题**：删除后明细页主要靠当前页本地刷新与 `onShow` 被动刷新，未完全形成“删除事件响应式刷新”范式。
- **建议**：新增 `EventNames.ENTRY_DELETED`，删除成功后 emit；ledger 页订阅并刷新。

---

## 6. INFO

### INFO-1 · `07e0a52` 多卡多域 chore commit

- **证据**：`.team/reviews/audit-217-220.md`、历史提交语境。
- **说明**：已成事实，不对当前卡重复扣分；后续继续执行“单卡即提交”。

### INFO-2 · `auth.ts` 中 `console.info` 包含 `userId` / `familyId`

- **证据**：`miniprogram/services/auth.ts:226`、`255`。
- **说明**：非 `session_key` / `openid` / secret，当前不构成安全红线；生产环境建议降级为 `console.debug` 或移除。

### INFO-3 · `ledger/index.ts` 641 行

- **证据**：`miniprogram/pages/ledger/index.ts` 行数统计。
- **说明**：低于 D-018 Reject 阈值 1000 行，但超过 SBAI 建议 500 行治理线；后续可抽 `helpers.ts` 降低维护成本。

---

## 7. D-025 反模式扫描

| ID | 反模式 | 结论 | 证据 / 说明 |
|---|---|---|---|
| AP-001 | 字符串代理判定 | 未命中 | `familyKind === 'shared'` 为显式枚举判断；成员筛选使用 user id 等值比较，不属于字符串语义代理。 |
| AP-002 | 概率极低就接受 | 命中，合并为 P1-1 | `created_by` 对 sync pull 条目无效，被以 MVP 边界接受，但缺自动检测/监控/数学证明。 |
| AP-003 | 契约-实装漂移 | 命中，合并为 P1-1 | sync wire `user_id` 与本地/OpenAPI `created_by` 漂移，客户端未映射。 |
| AP-004-X | 红字反模式 | 未命中 | 未发现主体硬编码、session_key/openid/secret 泄漏、AppID 在打包源码中出现。 |

---

## 8. T3 追溯收口建议

| 条件 | 状态 | 说明 |
|---|---|---|
| Human baseline PASS | ✅ | 三份手册全部 PASS。 |
| 无 P0 | ✅ | 本轮未发现 P0。 |
| P1 已登记 follow-up | ✅ | `FU-220-SYNC-USER-ID-CREATED-BY` 已登记为 Sprint-4 sync 协议适配候选。 |
| 无红线 | ✅ | 无 AP-004-X。 |
| 是否要求回滚 | 否 | 不推翻 Family First baseline。 |

建议：`COSTRA-220` 按 T3 追溯档 **AUTO-CLOSED-WITH-FOLLOWUP**。`FU-220-SYNC-USER-ID-CREATED-BY` 应在 Sprint-4 或 sync 协议适配批次中优先修复；其他 P2 可进入 polish / Family UI 前置债务池。

---

## 9. 证据路径

| 项 | 路径 |
|---|---|
| Dispatch | `.team/dispatch/COSTRA-220-miniapp-ledger-data-integration.md` |
| 交付 history | `.team/members/miniapp-dev/history/2026-06-17-costra-220-ledger-data-integration.md` |
| 验收手册 | `qa/current-stage-acceptance-family-first-baseline.md` |
| 明细页逻辑 | `miniprogram/pages/ledger/index.ts` |
| 明细页视图 | `miniprogram/pages/ledger/index.wxml` |
| 明细页样式 | `miniprogram/pages/ledger/index.wxss` |
| 本地 DB / sync apply | `miniprogram/services/db.ts` |
| sync pull 服务端 wire | `server/src/services/syncPullService.ts` |
| OpenAPI Entry schema | `server/api/openapi.yaml` |
| family context | `miniprogram/services/family.ts` |
| category service | `miniprogram/services/categoryService.ts` |
| eventBus | `miniprogram/services/eventBus.ts` |
| expense overlay | `miniprogram/components/expense-overlay/index.ts` |
| auth bootstrap | `miniprogram/services/auth.ts` |
| audit 总表 | `.team/reviews/audit-217-220.md` |

---

## 10. 下一步建议

1. `triage:sprint3-leftovers`：把 `FU-220-SYNC-USER-ID-CREATED-BY` 纳入 Sprint-4 guardrail / sync 协议适配候选。
2. `plan-dispatch:COSTRA-221`：家庭管理 API dispatch 中明确 `family_kind`、成员权限、账本切换与前端上下文字段来源。
3. 后续 polish：`FU-220-OVERLAY-ACTIVE-LEDGER-NAME`、`FU-220-DELETE-ANIMATION`、`FU-220-ENTRY-DELETED-EVENT` 可作为低风险前端小卡。
