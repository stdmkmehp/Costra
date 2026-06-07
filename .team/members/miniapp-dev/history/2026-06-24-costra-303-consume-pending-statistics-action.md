# COSTRA-303 · 统计页消费 pendingStatisticsAction（自动切成员/月-年/展开 L1）

- **task_type**: feature
- **date**: 2026-06-24
- **status**: done（待 commit + 真机验收）

---

## 1. 任务描述

实装 `pages/statistics/index.ts` 对 `globalData.pendingStatisticsAction` 的消费逻辑：
- 协作页点击成员行 L1 → 写入 pending → switchTab → 统计页 onShow 读取 pending → 自动切维度/月-年/成员 tab → 拉数据 → 自动展开对应 L1

设计源：`docs/design/family-page-tech-spec.md` §4.2 / §4.6 / §5.2

## 2. 产出

| 文件 | 变更类型 | 行数变化 |
|------|---------|---------|
| `miniprogram/pages/statistics/index.ts` | 修改 | 854 → 945（+91） |

### 具体改动点

- **A. 抽出 `_handleL1Tap(memberKey, l1Id, silent?)`**：把 `onTapL1` 主体搬入私有方法，原 `onTapL1` 改为 thin wrapper。新增 `silent: boolean = false` 第三参，silent=true 时 catch 块不弹 toast。
- **B. `_consumePendingAction()` 实装**：5 步流程——(1) 切维度 → (2) 切月/年 → (3) 切成员 tab → (4) `_loadData()` → (5) `_handleL1Tap(…, silent: true)`
- **C. `onShow` 接入**：首次/再次都读 pending；再次切回有 pending 时走完整消费流程（有意识的"不重建 DOM"例外）；首次进入在 `_loadContext` + `_loadData` 后消费 pending
- **D. 自动展开 L1 兼容性**：`_handleL1Tap` 内 `if (idx < 0) return` 静默不展开；silent 模式不弹 toast
- **E. 类型/import**：type-only import `PendingStatisticsAction` from family/index；`AppWithBootstrap` 接口扩展 `globalData.pendingStatisticsAction`

## 3. 关键决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | 首次进入接受两次拉数据（loadData + consumePending 内 loadData） | 简化逻辑一致性，额外延迟 < 500ms；优化需将 pending 消费前置到 loadContext 后 loadData 前，代码复杂度不值 |
| 2 | 再次切回有 pending 时主动重建数据状态 | 这是对"不重建 DOM"约束的有意识例外：dim/month/member 可能都变了，不重建会卡在旧画面 |
| 3 | `_buildMemberSwitchUpdate` 调用 tap=true + 再覆写 `memberSwiperDuration = 0` | tap=true 已设 duration=0（现有实现），冗余覆写为防御性编码保证语义 |
| 4 | memberKey 找不到降级到 'all' 而非不切 | 家庭成员可能在协作页跳转后变化（退出/被移除），降级到全局视角更合理 |
| 5 | 不直接调 onSwitchDimension / onMonthChange / onTapMemberTab | 它们依赖 e.currentTarget.dataset，无法程序触发；直接调底层方法 |

## 4. 遗留

- 无 P0/P1 遗留
- 可选优化（P3）：首次进入时将 pending 提前消费合并为单次 loadData —— 不影响正确性，仅影响首次进入 < 500ms 延迟

## 5. state.md diff

- §2：新增 COSTRA-303 已完成条目
- §3：新增 history 索引条目
- §7：时间戳更新为 2026-06-24T16:10:00+08:00
