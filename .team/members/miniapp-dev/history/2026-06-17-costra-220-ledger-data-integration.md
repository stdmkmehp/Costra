# COSTRA-220 · 明细页真实数据完善

> task_type: feature · owner: miniapp-dev · date: 2026-06-17

## 1 任务描述

将明细页的 stub/硬编码替换为真实数据对接，包括：扩展 FamilyContext 支持 family kind + ledger name、账本名真实显示 + 切换刷数据、成员筛选真实过滤、eventBus 响应式刷新、UX 增强。

## 2 产出

### 2.1 修改文件清单

| 文件 | 变更说明 |
|------|----------|
| `miniprogram/services/family.ts` | 扩展 FamilyContext 增加 `family_kind?: FamilyKind` + `ledger_name?: string`；新增 `getActiveFamilyKind()` 和 `getActiveLedgerName()` 函数 |
| `miniprogram/services/auth.ts` | 4 处 `setActiveFamily` 调用补充 `family_kind: 'personal'` + `ledger_name`（mock 路径 '我的账本' / 真实链路 '日常账本'） |
| `miniprogram/services/db.ts` | Entry 接口新增 `created_by?: string \| null` 字段（对应 OpenAPI sync wire `user_id` / DB `created_by`） |
| `miniprogram/services/eventBus.ts` | EventNames 新增 `ENTRY_SAVED` 常量 |
| `miniprogram/pages/ledger/index.ts` | 完整重写：_loadContext 使用 getActiveFamilyKind/getActiveLedgerName；多人判断改为 kind==='shared'；成员筛选 _memberFilter + created_by 过滤 + 重建汇总；onLoad 订阅 ENTRY_SAVED + onUnload 取消；月份切换 scrollTop reset |
| `miniprogram/pages/ledger/index.wxml` | scroll-view 绑定 scroll-top={{listScrollTop}}；空状态从纯文字改为 icon+标题+引导文案 |
| `miniprogram/pages/ledger/index.wxss` | 空状态样式重写：flex-column + icon 64rpx + title 30rpx/500 + hint 26rpx/tertiary |
| `miniprogram/components/expense-overlay/index.ts` | import getToken；_saveEntry 写入 created_by=当前 userId；保存成功后 emit ENTRY_SAVED |
| `miniprogram/services/family.spec.ts` | 新增 T7~T10 四个测试（getActiveFamilyKind / getActiveLedgerName 正常+降级+无 storage） |

### 2.2 闸门

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run check:appjson` ✅
- `npm run test` 99/99 ✅（新增 4 测试）

## 3 关键决策

1. **family_kind 来源**：当前 AuthTokenPair 不返回 family_kind，login/refresh 时硬编码 `'personal'`（首登创建的一定是 personal family）。未来 D2 阶段接入 GET /families API 后从服务端获取真实值覆盖。
2. **ledger_name 来源**：同理，mock 路径用 '我的账本'，真实链路用 '日常账本'（server bootstrap 创建的 ledger name）。
3. **Entry.created_by**：本地 Entry 接口新增可选字段。sync wire 字段名是 `user_id`（对应 DB `created_by`），但 applyServerChanges 用 `raw as Entry` 直接转换，字段名不匹配。当前 MVP 仅对本地创建的 entry 有 created_by，服务端 pull 回来的 entry 暂无此字段（需 sync 协议适配）。MVP 阶段"仅看自己"过滤基于本地创建的 entry 生效，服务端同步的 entry 降级显示。
4. **成员筛选 MVP**：仅 '全部' / '仅看自己'，按 created_by 过滤 + 重新计算汇总。
5. **eventBus 策略**：onLoad 订阅 ENTRY_SAVED → 刷新，onUnload 取消订阅防泄漏。保存成功后 overlay emit ENTRY_SAVED + HIDE 顺序（ENTRY_SAVED 在 HIDE 之前 emit，确保 ledger 页刷新时 overlay 已关闭）。

## 4 遗留

- **P1**: sync wire 字段名 `user_id` 与本地 Entry `created_by` 不对齐。服务端 pull 回来的 entry 缺 `created_by` 字段，"仅看自己"筛选对 sync 拉取的条目无效。需后续 sync 协议适配或 applyServerChanges 字段映射。
- **P2**: 多账本切换仍为 stub（MVP 只有个人账本，ActionSheet 显示"当前只有一个账本" Toast）。D2 阶段接入家庭列表 API 后扩展。
- **P2**: dispatch §C5 提到的"删除条目退出动画（translateX → 全宽滑出 + opacity → 0, 300ms）"暂未实现。当前删除是即时移除 + 重建。动画效果需额外 CSS transition + JS 定时，可独立卡交付。

## 5 state.md diff

- §2 active tasks: +COSTRA-220（✅ 交付）
- §3 交付历史索引: +2026-06-17 COSTRA-220 条目
- §6 遗留: COSTRA-204 遗留中 3 项标记 ✅ 已由 COSTRA-219/220 解决
- §7 时间戳: 2026-06-17T18:20:00+08:00
