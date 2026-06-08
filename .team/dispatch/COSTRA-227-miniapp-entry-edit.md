# COSTRA-227 · 明细页条目编辑功能（Entry Edit — Modify Category / Note / Amount / Date）

> **触发**：`plan-dispatch:COSTRA-227`  
> **派单时间**：2026-06-03 16:41（Orchestrator）  
> **状态**：`implemented` · 实装完成 · typecheck/lint/test 全绿 · 等 Human 真机验收 + `approve:COSTRA-227`  
> **Owner**：`costra-miniapp-dev`  
> **优先级**：P1  
> **估点**：3  
> **Epic**：Epic-C 记账核心  
> **类型**：miniapp feature（前端编辑交互 + 本地持久化 + outbox 同步）  
> **硬约束**：本 dispatch 只定义卡；未到 `start:COSTRA-227` 前不得写业务代码。

---

## §0 SBAI 装扮路径

| 阶段 | Subagent | 状态 |
|---|---|---|
| **Card-Review R1** | `costra-card-reviewer-tech` + `costra-card-reviewer-product` | ✅ `PASS-WITH-FOLLOWUP 25/30 + 25/30` · R1 修订已 inline 合入 |
| **Dispatch 修订** | Orchestrator | ✅ 已根据 Tech P1-1/2/3 + Product P1-1/2/3 修订 |
| **实装** | `costra-miniapp-dev` | ✅ 完成（6 文件 · typecheck/lint/test 全绿） |
| **Review** | `costra-review-tech` + `costra-review-product` | ⏳ 等 Human 真机验收 |
| **Human T1 终审** | `approve:COSTRA-227` | ⏳ |

---

## §1 背景

### §1.1 当前事实

- 明细页（`pages/ledger/`）已实现日期分组流水列表、左滑删除、月份切换、筛选行。
- 当前 `onTapEntry` 仅重置滑动状态，**不支持点击进入编辑**。
- 记账 overlay（`components/expense-overlay/`）实现了新建条目的完整体验：分类网格 + 计算器键盘 + 备注输入 + 日期选择 + shared_type 切换。
- 后端 `PATCH /v1/entries/{entry_id}` 已实装（COSTRA-152），支持修改 `amount`、`category_id`、`note`、`occurred_at`、`shared_type`，需携带 `version` 乐观锁。
- 本地 `services/db.ts` 已有 `putEntry()` 可直接覆写 entry、`enqueue()` 可将 update op 推入 outbox。
- IA 文档（`docs/design/ia.md`）规划了 `entry-detail`（modal 形态），但交互流程文档未详细定义编辑交互细节。

### §1.2 直接动因

Human 在 COSTRA-223 验收后明确提出"明细页条目编辑（修改分类/备注/金额/时间）"作为下一个需求。用户需要在已记录的流水上修改错误信息，这是记账应用的核心诉求。

### §1.3 设计方案决策

**方案选择：复用 expense-overlay 编辑模式（推荐）**

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 新建 `pages/entry-detail` 独立页面 | 扩展性好 | 开发量大、路由跳转体验割裂 |
| B. **复用 expense-overlay 增加"编辑模式"** | 体验一致、复用度高、开发量小 | overlay 需支持编辑 prop |
| C. 内联编辑（在明细列表中直接修改） | 最轻量 | 空间不足、交互复杂 |

**采用方案 B**：点击明细页条目 → 打开 expense-overlay 并预填当前值 → 用户修改后保存 → 更新本地 + outbox 同步。

理由：
1. 与"记一笔"的交互认知一致（同一入口不同模式）；
2. 分类网格、计算器键盘、日期选择、备注输入已全部实现，无需重复开发；
3. IA 文档描述 entry-detail 为"modal 形态"，overlay 正好满足此形态；
4. 减少新页面路由，体验更流畅。

**IA 路径占位处置**：IA §5.2 的 `pages/entry-detail` 路由占位**不再独立实装**，由本卡 overlay 编辑模式完全覆盖其 modal 形态定义。后续不单独新建 `pages/entry-detail` 页面（§6 F1 禁止项已约束）。

---

## §2 设计事实源

**唯一设计权威**：

1. `design/ui/design_spec.md` §6.2（明细页）
2. `design/ui/interaction_flow.md` §4（明细页流转）
3. `docs/design/ia.md`（信息架构 · entry-detail modal 形态）

**关键设计提取**：

- 明细页单条记录点击 → 打开编辑 overlay（而非跳转新页面）
- 编辑 overlay 与新建 overlay 视觉一致，仅：
  - 顶部标题从"记一笔"变为"编辑"
  - 保存按钮文案从"记一笔 ✓"变为"保存"
  - 预填已有数据（金额/分类/备注/日期/shared_type）
  - 底部额外增加"删除"入口（可选 · P2 可后置，当前已有左滑删除兜底）

---

## §3 数据层对接

### §3.1 本地存储

- 读取：`getEntry(clientRefId)` → 获取完整 Entry 对象
- 写入：`putEntry(entry)` → 更新 entry + 标记 `dirty: true`
- outbox：`enqueue({ op: 'update', entity: 'entry', client_ref_id, base_version: entry.version, payload: { ...changedFields } })`

### §3.2 后端 API

```
PATCH /v1/entries/{entry_id}
Content-Type: application/json
Authorization: Bearer <token>

{
  "version": <current_version>,      // 必填 · 乐观锁
  "amount": <int · cents>,            // 可选
  "category_id": "<uuid>",           // 可选
  "note": "<string ≤200>",           // 可选
  "occurred_at": "<ISO 8601>",       // 可选
  "shared_type": "personal"|"shared" // 可选
}
```

### §3.3 乐观锁与冲突处理

- 本地编辑时读取 `entry.version`（可能为 undefined 如果尚未同步到服务端）。
- outbox enqueue 时 `base_version` 为当前 `entry.version ?? null`。
- 若 sync push 返回 409 Conflict，由 syncScheduler 现有冲突处理逻辑 cover（当前行为：标记冲突 → 下次 pull 覆盖）。
- **本卡不引入新的冲突 UI**（已有 COSTRA-151 候选卡专门处理 conflict UI）。

---

## §4 状态管理与组件改造

### §4.1 expense-overlay 组件改造

#### 4.1.1 架构关键决策：编辑模式绕过 `SHOW_EXPENSE_OVERLAY` 事件

**问题**：当前 overlay 通过 `eventBus.on(SHOW_EXPENSE_OVERLAY)` → `_show()` 触发显示。`_show()` 内部会**全量重置**所有字段（calc、note、selectedTier1Id、selectedTier2Id、recordDate、entryType 等），如果编辑模式也走此路径，预填值会被立即覆盖。

**解决方案**：编辑模式**不触发** `SHOW_EXPENSE_OVERLAY` 事件，改由明细页通过 `this.selectComponent('#expense-overlay').openEditMode(entry)` 方法直接调用。

```typescript
// expense-overlay 新增公开方法（methods 块内）
openEditMode(entry: Entry) {
  // 1. 设置编辑模式标志
  // 2. 存储原始 entry 引用（用于后续 diff）
  // 3. 预填所有字段（金额/分类/备注/日期/类型/shared_type）
  // 4. 显示 overlay（设置 visible: true）
  // ⚠️ 不走 _show() 全量重置路径
}
```

新建模式仍走原有 `SHOW_EXPENSE_OVERLAY` → `_show()` 路径，**两条路径互不干扰**。

#### 4.1.2 组件当前无 `properties` 块

当前 `expense-overlay` 组件声明只有 `options` + `data` + `lifetimes` + `methods`，**没有 `properties` 块**。本卡不通过 properties 注入编辑状态（避免 observer 与 `_show()` 重置竞态），而是通过上述 `openEditMode(entry)` 方法调用直接控制。

#### 4.1.3 editMode 时行为差异

| 维度 | 新建模式 | 编辑模式 |
|---|---|---|
| 触发路径 | `eventBus(SHOW_EXPENSE_OVERLAY)` → `_show()` | `selectComponent.openEditMode(entry)` |
| 标题 | "记一笔" | "编辑" |
| 金额初始值 | "0" | 预填 `entry.amount`（cents → 元） |
| 分类初始值 | 空 | 预填 `entry.category_id` 高亮对应分类 |
| 备注初始值 | 空 | 预填 `entry.note` |
| 日期初始值 | 今天 | 预填 `entry.occurred_at`（本地时区解析） |
| 类型初始值 | 支出 | `entry.type`（expense/income）—— **只读展示，不可切换** |
| 收支切换交互 | 可左右滑动切换 | **禁用**：swipe 不响应，indicator 灰化（opacity 0.4） |
| shared_type 初始值 | 按当前账本默认 | 预填 `entry.shared_type` |
| 保存按钮文案 | "记一笔 ✓" | "保存" |
| 保存逻辑 | `putEntry(new)` + `enqueue(create)` | `putEntry(updated)` + `enqueue(update)` |
| 保存后事件 | `entryCreated` | `entryUpdated`（新事件） |
| 关闭行为 | 丢弃未提交内容 | 同新建模式：无 dirty check，直接丢弃（与新建一致的轻量原则） |

### §4.2 明细页改造

```typescript
// pages/ledger/index.ts
onTapEntry(e: WechatMiniprogram.TouchEvent) {
  // ① 左滑展开状态下：仅收起滑动，不打开编辑
  if (this.data.swipingRefId) {
    this._resetAllSwipe();
    return;
  }
  // ② 正常点击：打开编辑 overlay
  const refId = e.currentTarget.dataset.refid;
  const entry = this._findRawEntry(refId);  // 从 _allEntries 中找到原始 Entry
  if (!entry) return;
  // 通过 selectComponent 方法调用打开编辑模式
  // ⚠️ 不使用 setData props，不触发 SHOW_EXPENSE_OVERLAY 事件
  const overlay = this.selectComponent('#expense-overlay');
  if (overlay) {
    overlay.openEditMode(entry);
  }
}
```

**注意**：
- 不在 `pages/ledger/data` 块中新增 `editEntry`/`editMode` 字段（无需 wxml props 绑定）。
- `ledger/index.wxml` 中 `<expense-overlay id="expense-overlay" />` 只需确保有 `id` 属性，无需其他 prop 绑定。
- 需实现 `_findRawEntry(refId)` 辅助方法：从 `this._allEntries` 中查找完整 Entry 对象（区别于 DisplayEntry）。

### §4.3 eventBus 新增事件

在 `services/eventBus.ts` **源文件** `EventNames` 对象内新增条目（非外部赋值）：

```typescript
// services/eventBus.ts · EventNames 对象中新增
export const EventNames = {
  // ... 已有事件 ...
  ENTRY_UPDATED: 'entryUpdated',      // 新增
} as const;
```

明细页监听 `ENTRY_UPDATED` → 重新 build 当前月份 display（与 `ENTRY_CREATED` 类似刷新逻辑）。

---

## §5 交互实现要点

### §5.1 点击条目进入编辑

0. **左滑展开状态下点击条目** → 仅收起左滑删除区域，**不打开编辑 overlay**（交互优先级：滑动重置 > 编辑入口）。
1. 用户在明细页**点击**某条流水（非左滑状态下）。
2. 通过 `selectComponent('#expense-overlay').openEditMode(entry)` 打开 overlay，预填该条目所有字段。
3. 用户可修改：金额（计算器）、分类（网格点选）、备注（输入框）、日期（picker）、shared_type（仅多人账本）。
4. **收支类型（expense/income）不可切换**：swipe 手势不响应，类型 indicator 保持只读展示（灰化 opacity 0.4）。
5. 点击"保存"→ 更新本地 → enqueue update → 关闭 overlay → 明细页即时刷新。
6. 若用户未修改任何字段直接保存 → 不写入、不 enqueue，直接关闭（无 toast）。
7. 关闭 overlay（下拉/点击蒙层）→ 无 dirty check，直接丢弃修改（与新建模式行为一致）。

### §5.2 编辑预填细节

- **金额**：`entry.amount`（cents）→ 转元字符串填入 calc display（如 1234 → "12.34"）。
- **分类**：根据 `entry.category_id` 定位一级/二级分类并高亮。若分类已删除（category_id 在当前分类列表中找不到对应项）→ 网格中无高亮项，分类区域显示灰色提示文字"原分类已删除，请重新选择"。用户**必须**重新选择分类后才能保存（保存按钮禁用直至选定新分类）。
- **备注**：直接填入 note 输入框。
- **日期**：`entry.occurred_at`（ISO UTC 字符串）→ **使用本地时区**解析为 `YYYY-MM-DD` 字符串填入 datePicker value（与 `getLocalDateValue()` 方向一致，确保跨日 entry 显示正确日期）。
- **类型**：根据 `entry.type` 设置 expense/income 面板展示（只读，不可切换）。

**字段比较规则**（用于判定无变更场景）：
- 金额：cents 整数严格相等（`===`）
- 分类：category_id 字符串相等
- 备注：trim 后字符串相等
- 日期：解析后的 `YYYY-MM-DD` 字符串相等（不比较时分秒）
- shared_type：字符串相等（含 null 比较）

### §5.3 保存逻辑

```typescript
async onSaveEdit() {
  // 1. 收集当前表单状态
  // 2. 与原始 entry 对比，提取 changedFields
  // 3. 如果 changedFields 为空 → 直接关闭
  // 4. 更新本地 entry：
  //    entry.amount = newAmount;
  //    entry.category_id = newCategoryId;
  //    entry.note = newNote;
  //    entry.occurred_at = newOccurredAt;
  //    entry.shared_type = newSharedType;
  //    entry.updated_at = new Date().toISOString();
  //    entry.dirty = true;
  //    await putEntry(entry);
  // 5. enqueue update：
  //    await enqueue({
  //      op: 'update',
  //      entity: 'entry',
  //      client_ref_id: entry.client_ref_id,
  //      base_version: entry.version ?? null,
  //      payload: changedFields,
  //    });
  // 6. eventBus.emit(EventNames.ENTRY_UPDATED)
  // 7. 关闭 overlay + toast "已保存"
}
```

### §5.4 级联更新

编辑保存后，明细页须**即时**重算：
- 月度总支出/总收入/结余
- 对应日期分组的日汇总
- 条目显示内容（金额/分类名/图标/备注）

**日期修改导致条目跨日期分组移动**：
- 若修改后日期仍在当月 → 条目从原日期分组移至新日期分组，两个分组的日汇总重算。
- 若修改后日期**跨月**（不属于当前明细页显示月份）→ 条目从当月列表中**消失**（行为同删除），月度汇总重算。可选：toast 提示"条目已移至 {年月}"。不做跨月页面跳转。

实现：监听 `ENTRY_UPDATED` → `this._buildDisplay()` 或更精细的局部更新。

### §5.5 触觉反馈

- 保存成功后：`wx.vibrateShort({ type: 'light' })` — 轻微反馈表示确认。

---

## §6 禁止事项

| ID | 禁止 | 原因 |
|---|---|---|
| F1 | 禁止新建独立 `pages/entry-edit` 路由页面 | 方案 B 复用 overlay，不增加路由 |
| F2 | 禁止在 overlay 中引入新的 swiper 或 scroll-view 高度 JS 计算 | COSTRA-208/211 架构决策 · flex 布局 |
| F3 | 禁止修改 `entry.type`（expense↔income）在编辑模式 | 类型变更语义复杂，P2 后续考虑 |
| F4 | 禁止硬删除条目 · 编辑模式不提供删除入口（左滑删除已覆盖） | 关注点分离 |
| F5 | 禁止 mock/fallback 数据代替真实 entry 编辑 | 必须操作真实本地存储 |
| F6 | 禁止绕过乐观锁 · enqueue 必须携带 `base_version` | 数据一致性 |
| F7 | 禁止引入新的冲突解决 UI | COSTRA-151 候选卡专项 |

---

## §7 DoD（Definition of Done）

### 功能闭环

- [ ] 明细页点击条目 → 打开 expense-overlay 编辑模式 → 预填所有字段
- [ ] 左滑删除区域展开时点击条目 → 仅收起左滑，**不**打开编辑 overlay
- [ ] 可修改金额、分类、备注、日期
- [ ] 多人账本条目可修改 shared_type
- [ ] 收支类型（expense/income）在编辑模式下不可切换，swipe 无响应
- [ ] 保存 → 本地 `putEntry` + `enqueue(update)` → overlay 关闭 → 明细页即时刷新
- [ ] 无变更时保存 → 不写入不 enqueue · 直接关闭（无 toast）
- [ ] 级联更新：月度汇总/日汇总/条目内容实时重算
- [ ] 日期修改至跨月 → 条目从当月列表消失 · 月度汇总重算 · 无崩溃

### 工程质量

- [ ] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] `npm test -- --run` 现有 99 测试不回退
- [ ] `npm run check:appjson` 通过
- [ ] 新增 calc.spec.ts 测试：编辑模式金额预填 → 修改 → 提取 cents 正确性
- [ ] 新增 entryEdit 相关测试：update op enqueue payload 正确性

### 设计还原

- [ ] 编辑 overlay 与新建 overlay 视觉一致，仅标题/按钮文案不同
- [ ] 编辑模式下收支切换 swipe 区域不可交互，视觉有禁用态标识（灰化/opacity 降低）
- [ ] 预填状态下分类高亮正确
- [ ] 已删除分类：网格无高亮 + 灰色提示文字 + 保存按钮禁用
- [ ] 日期 picker 显示正确日期（本地时区）
- [ ] 保存后 toast 反馈"已保存"

### 联动验证

- [ ] 编辑后条目在下次 syncScheduler push 时正确同步到服务端
- [ ] 编辑后如切换月份再切回 → 数据仍为编辑后值（本地持久化验证）
- [ ] 编辑多人账本条目的 shared_type → 协作页聚合数据正确反映变化
- [ ] 将条目日期改为跨月 → 当月列表中条目消失 · 切换到目标月份可看到该条目

---

## §8 依赖与风险

### 依赖

| 依赖 | 状态 | 阻塞否 |
|---|---|---|
| `components/expense-overlay/` 已实现 | ✅ 完成 | 否 |
| `services/db.ts` putEntry / getEntry | ✅ 完成 | 否 |
| `services/outbox.ts` enqueue | ✅ 完成 | 否 |
| `services/eventBus.ts` | ✅ 完成 | 否 |
| `services/categoryService.ts` | ✅ 完成 | 否 |
| 后端 `PATCH /v1/entries/{entry_id}` | ✅ COSTRA-152 已实装 | 否 |
| 明细页 `pages/ledger/` | ✅ 完成 | 否 |

### 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| expense-overlay 改造影响新建流程回退 | P1 | editMode 开关隔离；新建模式仍走 `SHOW_EXPENSE_OVERLAY` → `_show()` 原路径不变 |
| `_show()` 全量重置覆盖预填状态 | P1 | 编辑模式绕过 `SHOW_EXPENSE_OVERLAY` 事件，使用 `openEditMode()` 方法直接调用，完全不经过 `_show()` |
| entry 无 version（未同步新建条目） | P2 | base_version 允许 null · 同步后补 version |
| 分类已删除的条目编辑时分类显示 | P2 | 网格无高亮 + 灰色提示 + 保存按钮禁用直至重新选择 |
| 日期编辑跨日时区边界 | P2 | `occurred_at` → 本地日期解析统一使用 `new Date(occurred_at)` + 本地 `getFullYear/getMonth/getDate` |

---

## §9 文件变更预估

| 文件 | 操作 | 变更说明 |
|---|---|---|
| `miniprogram/components/expense-overlay/index.ts` | M | 新增 `openEditMode(entry)` 方法 · 编辑预填逻辑 · 保存分支 · 收支切换禁用 |
| `miniprogram/components/expense-overlay/index.wxml` | M | 条件渲染标题/按钮文案 · 收支切换禁用态视觉 |
| `miniprogram/pages/ledger/index.ts` | M | onTapEntry 改造（selectComponent 调用）· `_findRawEntry` 辅助 · 监听 ENTRY_UPDATED |
| `miniprogram/pages/ledger/index.wxml` | M | overlay 标签增加 `id="expense-overlay"` |
| `miniprogram/services/eventBus.ts` | M | EventNames 对象新增 `ENTRY_UPDATED` 条目 |
| `miniprogram/components/expense-overlay/calc.spec.ts` | M | 新增编辑模式金额预填测试 |

预计 **6 个文件**变更，新增约 **150~250 行**。

---

## §10 验收路径建议

### 手动验收（Human / QA）

0. 条目处于左滑删除展开状态 → 点击条目 → 删除区收起，overlay **不**弹出。
1. 进入明细页 → 点击某条支出 → overlay 弹出 · 金额/分类/备注/日期均已预填。
2. 尝试在编辑 overlay 中左右滑动分类区域切换收支 → **无响应**（类型锁定）。
3. 修改金额为新值 → 保存 → 明细页对应条目金额即时更新 · 月汇总重算。
4. 修改分类 → 保存 → 条目图标/名称更新。
5. 修改备注 → 保存 → 条目 label 更新。
6. 修改日期到当月另一天 → 保存 → 条目移动到对应日期分组。
7. 修改日期到跨月（如当前 6 月改为 5 月某天）→ 保存 → 条目从当月列表消失 · 月汇总重算。切换到目标月份 → 可看到该条目。
8. 多人账本：修改 shared_type → 保存 → 协作页聚合正确。
9. 不修改任何字段直接点保存 → overlay 直接关闭，**无** toast（与有修改时的"已保存" toast 形成对比）。
10. 编辑后切换月份再切回 → 数据保持编辑后值。
11. 编辑后等 sync push 完成 → 服务端数据已更新（可通过 API 直接查询验证）。

### 自动化验证

- `npm run typecheck` + `npm run lint` + `npm test -- --run` + `npm run check:appjson`

---

## §11 关联卡片

| 卡号 | 关系 |
|---|---|
| `COSTRA-203` | 明细页基础实现 · 本卡在其基础上增加编辑入口 |
| `COSTRA-208/209/211/212` | expense-overlay 重写系列 · 本卡扩展其能力 |
| `COSTRA-152` | 后端 PATCH entries API · 本卡前端消费该 API |
| `COSTRA-220` | 明细页真实数据 · 本卡在其基础上增加编辑 |
| `COSTRA-151` | conflict UI（后续卡）· 本卡不引入冲突 UI |
| `COSTRA-223` | 协作页 · 编辑 shared_type 后协作页数据须正确 |
