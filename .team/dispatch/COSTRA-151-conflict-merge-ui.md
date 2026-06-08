# COSTRA-151 · conflict 合并 UI（FU-103-CONFLICT-MERGE-UI 转正）

> **派单时间**：2026-05-19 20:50（Sprint-3 中后段候选 · 不在 Sprint-3 头部启动序列）
> **状态**：dispatch 已落盘 · 等 154+150+152+153 全 CLOSED 后启动（D-024 §2.3）
> **依赖**：COSTRA-104（server /sync/push 返 conflict + server_state · CLOSED）· COSTRA-150（client 调度器 · 让 conflict 真实在 prod 出现）· `docs/api/conflict-strategy.md` 已存在（5.1KB · 7 节 · 字段级合并规则定）

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` | 等启动（建议 154+150 CLOSED 后）|
| **R1 实装** | `costra-miniapp-dev` + `costra-design-maker`（双装扮档单 commit · UI + 合并策略实装）| 等卡审 PASS |
| **R1 Review** | `costra-review-tech` + `costra-review-product`（UI 双签）| 等 R1 完成 |
| **Human T1 终审** | `approve:COSTRA-151` | 等 R1 APPROVE |

---

## §1 背景

### 1.1 触发链
- COSTRA-103 R1 outbox `mergeIntoConflictQueue` 是 R1 桩（立即重试 next_retry_at = now+1 消极策略 · `miniprogram/services/outbox.ts:239-249`）
- 当前 conflict 状态降级为"指数退避重试"· 不暴露给用户 · 用户感知差
- PRD AC-3 转账冲突场景（家庭模式下父母同时改一笔）需真合并 UI

### 1.2 PRD / 契约锚点
- **PRD AC-3**：转账冲突场景
- **协议**：`docs/api/sync-protocol.md §2.4` conflict → 保留 dirty + 等待合并
- **conflict-strategy.md**：§4 字段级合并规则（amount/note/category_id/occurred_at/deleted_at 策略已定）· §2 弹合并面板 UI 流程已定（行 31~37）

---

## §2 Scope（6 项 · 估点 5 · INVEST small）

### 2.1 主交付

#### A · 新建 miniprogram/pages/conflict-merge/ 页面（design-maker 协助 UI 设计）
- 页面布局：server 版本 vs client 版本字段对照表 + 三按钮（保留服务端 / 保留客户端 / 手动合并）
- 设计 tokens 复用（COSTRA-160 落地后联动）

#### B · outbox.ts mergeIntoConflictQueue 真实装
- 替换 R1 桩"立即重试"策略
- 落 storage `conflict:__queue` + `conflict:<client_ref_id>`（已预留命名空间 outbox.ts:295）
- 调度上层弹合并 UI

#### C · 合并策略实装（按 conflict-strategy.md §4）
- amount: 默认保留较大值（用户选择）
- note: 字符串拼接 + 用户编辑
- category_id: 用户选择
- occurred_at: 服务端为准
- deleted_at: 用户选择

#### D · client 单测 ≥ 8 测
- 三态 button 选择 → outbox 出队 + 同步触发
- conflict queue storage 持久化
- 多 conflict 并发场景

#### E · 文档同步
- `miniprogram/services/outbox.spec.ts` 加 conflict 真实路径测
- `docs/api/conflict-strategy.md` v0.2 实装回填

#### F · follow-ups
- FU-103-CONFLICT-MERGE-UI: open → closed @ COSTRA-151

### 2.2 不在本卡范围
- ❌ 多人协作合并（≥ 3 设备同时编辑）→ Sprint-4+
- ❌ 字段级 diff 高亮 → 留 FU-151-DIFF-HIGHLIGHT

---

## §3 DoD

6 闸门 + G7（conflict UI 单测全绿 · ≥ 8 测）+ G15。反向验证：① 强制构造 conflict 场景 → UI 必弹 · ② 用户选保留服务端 → outbox 出队 + entry 更新到 server 版本 · ③ 用户选保留客户端 → outbox 重推 + version+1。

D-025 扫描预测：AP-001 不命中（用户主动选择 · 非代理判定）· AP-002 不命中（明确策略 · 非概率接受）· AP-003 不命中。

---

## §4 强制阅读清单

1. 本派单档 + Card-Review 报告
2. **outbox 桩**：`miniprogram/services/outbox.ts:239-249, 295`
3. **协议**：`docs/api/sync-protocol.md §2.4`
4. **合并策略**：`docs/api/conflict-strategy.md`（已存在 7 节）
5. **conflict 测试范式**：`miniprogram/services/outbox.spec.ts`

---

## §5 硬约束

### §5.1 工作区铁律
- ✅ 可写：`miniprogram/pages/conflict-merge/` · `miniprogram/services/outbox.ts` · `miniprogram/services/outbox.spec.ts` · `docs/api/conflict-strategy.md`（v0.2 回填）· `.team/members/miniapp-dev/` + `.team/members/design-maker/`
- ❌ 不可写：server/ · infra/

### §5.2 INVEST small（5 点）
- 时间盒 ≤ 8 小时

### §5.3 双装扮档协作
- miniapp-dev 主驾 · design-maker 协助（UI 视觉 + tokens 对齐）
- 单 commit 收尾

---

## §6 估点 / 时间盒
- 估点 5 点 · AI ~8 小时 · Human 实测：模拟器构造 conflict 场景 + 三态选择验证

---

**派单档结束 · 等 Human `start:COSTRA-151`（建议 Sprint-3 中后段 · 154+150 CLOSED 后）。**
