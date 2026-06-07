# COSTRA-302 · 协作页 multi 模式重构（统计页同款手风琴 + 年度可用 + L1 跳转）

> task_type: feature
> date: 2026-06-23
> commit: `0136ad5`
> branch: dev

---

## 1. 任务描述

将协作页（`pages/family/index`）的旧「下钻列表」（detail-list / detail-row / contribution-item / category-item）整体重构为与统计页排行区**风格、样式、交互完全一致**的手风琴下钻列表（family-rank），同时实装年度维度（移除"即将上线"toast）+ 成员行 L1 跳转统计页（pendingStatisticsAction 通道）。

**设计事实源**：`docs/design/family-page-tech-spec.md` §4

---

## 2. 产出

| 文件 | 变更 | 行数变化 |
|------|------|---------|
| `miniprogram/pages/family/index.ts` | 重写类型 + 新增 _buildDrilldownRows / _mapToL1Display / onTapDrilldownRow / onTapL1 / _collapseAllRows + 年度相关方法 | ~+138 net |
| `miniprogram/pages/family/index.wxml` | 删旧 detail-list 块 + 新增 family-rank 手风琴 wxml（spec §4.7）+ 双 picker 时间导航 | 重写 |
| `miniprogram/pages/family/index.wxss` | 删旧 detail-row/contribution-item/category-item 样式 + 新增 family-rank/family-l1/shared-contributions 样式 | 重写 |
| `miniprogram/app.ts` | AppGlobalData 新增 pendingStatisticsAction 字段 | +11 |

**总计**：4 文件 +382/-391

---

## 3. 关键决策

| # | 决策 | 原因 |
|---|------|------|
| 1 | `DrilldownRow.expanded` 放行自身而非全局 `expandedRow` | 手风琴 toggle 只需 map 一次 → immutable setData 更简洁 |
| 2 | `_buildDrilldownRows` 接收 `slotByUserId` 参数而非内部重建 | 复用已在 _buildMultiDisplay 构建的 Map · 避免遍历两次 members |
| 3 | L1_VISIBLE = 6（与统计页 viewModels.ts 对齐） | spec §1.5 明确要求一致 |
| 4 | `_loadSummary` 不再接收 month 参数 · scope 由 dimension/state 内部决定 | 调用点减少传参负担 · 与 spec §4.4 _loadSummary 签名一致 |
| 5 | year picker `value` 格式 `YYYY-01-01`（参照统计页 line 44~45） | 微信 picker fields="year" 需要完整日期作为 value · 取回 value 统一 split('-')[0] |
| 6 | 公共行垫付贡献从「仅 expanded=false 时显示」改为「常驻显示」 | spec §1.4 q4 决策 A 明确「行下常驻」 |
| 7 | 成员行 label 格式改为 `${nickname}的个人支出`（spec §4.3） | 旧代码是 `${nickname}个人支出`（缺「的」字），对齐 spec |
| 8 | `PendingStatisticsAction` 类型在 family/index.ts export · app.ts 用内联类型 | 避免循环依赖；COSTRA-303 统计页 import 可从 family 页 re-export |

---

## 4. 遗留

| 优先级 | 内容 | 归属 |
|--------|------|------|
| P0 | 统计页消费 pendingStatisticsAction（自动切成员/月-年/展开 L1） | COSTRA-303 |
| P2 | 真机验收 §7 各路径（月度/年度/Solo 无回归/SYNC_DONE/边界） | COSTRA-304 |

---

## 5. state.md diff

```diff
§2 +✅ COSTRA-302 条目
§3 +history 索引条目
§7 时间戳 → 2026-06-23T15:40:00+08:00
```
