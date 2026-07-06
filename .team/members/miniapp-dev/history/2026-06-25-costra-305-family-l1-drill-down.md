# COSTRA-305 · 协作页排行榜 L1 三级下钻 + tabbar 遮挡修复

- **task_type**: feature
- **date**: 2026-06-25
- **author**: miniapp-dev (装扮型 subagent)

---

## 1. 任务描述

改造协作页（`pages/family/`）排行榜的下钻交互：

1. 成员支出行的二级(L1)点击**不再跳转统计页**（删除 `pendingStatisticsAction` 写入 + `wx.switchTab`）
2. 为「公共支出」和「各成员支出」的二级(L1 一级分类)新增**三级列表**：展示该一级分类下金额最高的若干条流水明细，展示格式参考统计页 L3
3. 修复下钻列表滚动到底时最后一行被 tabbar 遮挡的 bug

## 2. 产出

### 修改文件清单（4 文件）

| 文件 | 改动摘要 | 行数变化 |
|------|---------|---------|
| `miniprogram/services/familyApi.ts` | 新增 `FamilyEntryDetailItem`、`FamilySummaryDrillDownResponse` 接口 + `drillDownFamilyL1Entries` API 函数 + `_familyDrillCache` 页面级缓存 + `invalidateFamilyCache` 同步清理 | +90 |
| `miniprogram/pages/family/index.ts` | 扩展 `L1Display`(+5 字段) + 新增 `EntryRow` 接口 + `L1_ENTRIES_VISIBLE` 常量 + `formatEntryDate`/`formatEntryTime` 辅助 + 重写 `onTapL1` + 新增 `_loadL1Entries` + 扩展 `_collapseAllRows` + `_buildDrilldownRows` 按 categoryId 保留展开态 + `_mapToL1Display` 补默认值 | +166 |
| `miniprogram/pages/family/index.wxml` | L1 行加 `--open` class + 三级流水明细块(loading/数据行/has_more/空态) | +35 |
| `miniprogram/pages/family/index.wxss` | `.family-l1__row--open` + `.family-l3*` 系列(15 类) + `.family__content` padding-bottom 修复 tabbar 遮挡 | +124 |

### 六闸全绿

- typecheck: 0 errors ✅
- lint: 0 new errors (2 pre-existing warnings) ✅
- test: 150/150 ✅
- check:appjson ✅
- check:tooling ✅
- check:whitelist ✅

## 3. 关键决策

### D1: onTapL1 交互统一

公共行与成员行统一为"展开/收起三级流水"。原 COSTRA-302 设计中公共行 L1 不响应、成员行跳转统计页，本次改造后所有 L1 行为一致。`PendingStatisticsAction` 接口仍然导出（统计页 `pages/statistics/index.ts` 仍 import 消费），仅删除了协作页的写入代码。

### D2: API 调用与缓存策略

- 新增 API: `GET /v1/families/{familyId}/summary/drill-down` 对齐后端契约
- 缓存: `_familyDrillCache`（Map）与统计页 `_drillCache` 同模式，page-lifetime + 由 `invalidateFamilyCache` 主动清理
- limit=L1_ENTRIES_VISIBLE+1 (=11)：多查 1 条探测 has_more
- `_collapseAllRows` scope 变更时同步清空 entries/entriesLoaded（旧明细失效）

### D3: 样式体系

- L3 块使用 `.family-l3*` 前缀（非直接复用统计页 `.l3*`），避免跨页样式污染
- 协作页 `.family-l1` 已有 `padding-left:56rpx` 缩进，L3 块在 L1 内以 `padding-left:24rpx` 再缩进
- 不使用负 margin（避免协作页 `.family__scroll` 没有 `overflow-x:hidden` 防护的横向溢出问题）

### D4: tabbar 遮挡修复

- 根因: `.family__content` 仅 `padding-bottom:32rpx`，tabbar 是 `position:fixed;bottom:0`
- 修复: `padding: 0 32rpx calc(32rpx + 160rpx + env(safe-area-inset-bottom))`
- 对齐统计页 `.bottom-spacer` 经验值

## 4. 遗留

- **P2**: `PendingStatisticsAction` + `AppWithBootstrap.globalData.pendingStatisticsAction` 在协作页已无写入方。若统计页未来不再需要此接口，可清理。当前保留不动（统计页 COSTRA-303 仍在消费）。
- **P3**: family/index.ts 达 1813 行，虽 typecheck/lint 通过但已偏长。后续可考虑拆分辅助函数到 `pages/family/formatters.ts` 或 `pages/family/viewModels.ts`（与统计页拆分模式一致）。

## 5. state.md diff

- §2: 新增 COSTRA-305 WIP 条目
- §3: 新增 history 索引条目
- §7: 更新时间戳 2026-06-25T09:55:00+08:00
