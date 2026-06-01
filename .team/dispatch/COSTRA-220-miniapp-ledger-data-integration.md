# COSTRA-220 · 明细页真实数据完善 (Ledger Page Data Integration)

> **Owner**: miniapp-dev · **Est**: 3pt · **Dep**: COSTRA-219 (B4 ✅) · **Sprint**: Data-Layer Phase-C
> **状态**: Todo → Doing

---

## §A 背景

明细页（`pages/ledger`）在 COSTRA-203 开发了完整 UI 骨架 + COSTRA-219 替换了分类硬编码。但仍有多处 stub/hardcode 未对接真实数据：

1. 账本名硬编码 `'我的账本'`，切换仅改文字不刷数据
2. 多人家庭判断用 `!== 'solo'` 硬编码字符串
3. 成员筛选仅改文字不真实过滤
4. 记账成功后无 eventBus 响应式刷新（依赖 onShow）
5. 删除成功后无触觉反馈以外的 UX 增强

本卡聚焦可由前端独立完成的真实数据对接。多人家庭相关（头像/灰化/真实成员列表）依赖 D2 家庭成员 API，推到 D2+C5 阶段。

---

## §B 事实源

- **当前实现**: `miniprogram/pages/ledger/index.ts`（499 行）
- **当前模板**: `miniprogram/pages/ledger/index.wxml`
- **设计规范**: `design/ui/design_spec.md` §6.2 + `design/ui/interaction_flow.md` §4
- **Family 服务**: `miniprogram/services/family.ts`（FamilyContext: family_id + ledger_id）
- **Auth 响应**: login 接口返回 `default_family_id` + `default_ledger_id`
- **EventBus**: `miniprogram/utils/eventBus.ts`（COSTRA-201 已建）

---

## §C DoD (Definition of Done)

### C1: 扩展 FamilyContext 支持 family kind + ledger name

- [ ] 修改 `miniprogram/services/family.ts`：
  - `FamilyContext` 接口增加 `family_kind?: 'personal' | 'shared'` 和 `ledger_name?: string`
  - 新增 `getActiveFamilyKind(): Promise<'personal' | 'shared' | null>`
  - 新增 `getActiveLedgerName(): Promise<string>`（降级 '我的账本'）
- [ ] 确保 login 流程 `setActiveFamily` 时传入 kind + ledger_name（从 auth response 获取）
- [ ] 修改 `miniprogram/services/auth.ts` 或登录相关代码：设置 family context 时附带 kind/name

### C2: 账本名真实显示 + 切换后刷数据

- [ ] `_loadContext()` 中 `ledgerName` 改为从 `getActiveLedgerName()` 获取真实值
- [ ] `onTapLedgerName()` 切换逻辑改为：
  - 切换后更新 `_ledgerId` 和 `_familyId`（通过 `setActiveFamily` 持久化）
  - 切换后调 `_loadEntries()` 重新加载数据
  - MVP 阶段只有个人账本，ActionSheet 选项从 family context 获取
- [ ] 多人家庭判断改为 `kind === 'shared'`（替换 `!== 'solo'` 硬编码）

### C3: 成员筛选真实过滤逻辑

- [ ] `onTapMemberFilter()` 选择后记录筛选状态 `_memberFilter: 'all' | 'self'`
- [ ] `_buildDisplay()` 中根据 `_memberFilter` 过滤 entries（按 `created_by` 字段）
- [ ] 注意：当前本地 Entry 结构已有 `created_by`（db.ts 中定义），可直接用
- [ ] 筛选后重新计算 Header 汇总数字

### C4: eventBus 响应式刷新

- [ ] `onLoad()` 中订阅 eventBus `ENTRY_SAVED` 事件（记账覆盖层保存成功后 emit）
- [ ] `onLoad()` 中订阅 eventBus `ENTRY_DELETED` 事件（如有）
- [ ] 收到事件后调 `_loadEntries()` 刷新数据
- [ ] `onUnload()` 中取消订阅（防内存泄漏）
- [ ] expense-overlay 保存成功后 emit `ENTRY_SAVED` 事件（确认当前是否已 emit，若无则补）

### C5: UX 增强

- [ ] 删除条目后条目行加退出动画（translateX → 全宽滑出 + opacity → 0，300ms）
- [ ] 空状态增加引导文案或图标（当前仅 "本月暂无收支记录" 文字）
- [ ] 月份切换后滚动到顶部（scrollTop reset）

### C6: 闸门通过

- [ ] `npm run typecheck` 全绿
- [ ] `npm run lint` 全绿
- [ ] `npm run check:appjson` 全绿
- [ ] 既有单测不回归

---

## §D 可写范围

```
miniprogram/services/family.ts               — 修改（扩展 FamilyContext）
miniprogram/pages/ledger/index.ts            — 修改
miniprogram/pages/ledger/index.wxml          — 修改（可能微调）
miniprogram/pages/ledger/index.wxss          — 修改（动画/空状态样式）
miniprogram/components/expense-overlay/index.ts — 修改（确保 emit ENTRY_SAVED）
miniprogram/utils/eventBus.ts                — 修改（如需新增事件常量）
.team/members/miniapp-dev/state.md           — 更新
.team/members/miniapp-dev/history/           — 新增
```

**禁写**：`server/` / `design/` / `api/`

---

## §E 技术约束

1. **不新增后端 API**：仅利用现有数据（FamilyContext / local DB entries.created_by / auth response）
2. **多人家庭判断**：改用 `family_kind === 'shared'`（COSTRA-164 已在 auth response 返回 family 信息）
3. **eventBus 事件名遵循既有命名规范**（大写常量：`ENTRY_SAVED` / `SHOW_EXPENSE_OVERLAY` / `HIDE_EXPENSE_OVERLAY` 同族）
4. **成员筛选 MVP**：仅支持 '全部' / '仅看自己'（比对 entries 的 created_by 与当前 userId）
5. **userId 来源**：从 auth token 或 storage 中获取当前登录用户 ID
6. **不引入新依赖**

---

## §F 强制阅读清单

1. `miniprogram/pages/ledger/index.ts` — 当前实现（理解所有 stub 位置）
2. `miniprogram/pages/ledger/index.wxml` — 模板结构
3. `miniprogram/services/family.ts` — FamilyContext 当前结构
4. `miniprogram/utils/eventBus.ts` — 事件总线用法
5. `miniprogram/components/expense-overlay/index.ts` — 保存逻辑（确认是否 emit 事件）
6. `miniprogram/services/db.ts` — Entry 类型定义（确认 created_by 字段）
7. `design/ui/interaction_flow.md` §4 — 明细页交互规范

---

## §G 时间预算

| 阶段 | 预估 |
|------|------|
| 阅读参考代码 | 10 min |
| C1: FamilyContext 扩展 | 10 min |
| C2: 账本切换真实化 | 15 min |
| C3: 成员筛选过滤 | 15 min |
| C4: eventBus 响应式刷新 | 10 min |
| C5: UX 增强 | 15 min |
| C6: 闸门验证 + 修复 | 10 min |
| state.md 更新 | 5 min |
| **合计** | **~90 min** |

---

## §H 验收标准

1. 编译检查全绿
2. 账本名显示真实名称（不再硬编码）
3. 多人家庭判断基于 family kind（不再用字符串 'solo'）
4. 成员筛选 "仅看自己" 确实只显示自己的记录，汇总数字同步更新
5. 记账保存后明细页自动刷新（无需切 Tab 再回来）
6. 月份切换滚动到顶部
7. 无回归

---

## §I 不包含（推迟到 D2+C5）

以下功能依赖后端家庭成员 API，本卡不实现：
- 真实家庭成员列表获取（需 D2 API）
- 成员头像显示
- 已退出成员头像灰化
- 多账本真实列表切换（当前只有个人账本）
- Header 数字 counter 过渡动画（低优先级 polish，可后续卡独立做）
