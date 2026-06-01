# COSTRA-208 补丁: 一级分类四列网格修复

> 日期: 2026-06-08
> 角色: miniapp-dev（SBAI v1.1）
> 任务类型: fix
> 卡号: COSTRA-208
> commit: `b06e181`

---

## 1 任务描述

Human 反馈：COSTRA-208 重写后的记账覆盖层中，**二级分类一行四个正常**，但**一级分类纵向单列堆叠**，未按 design_spec.md §6.3 要求的一行 4 个展示。

截图证据：8 个一级分类（餐饮/交通/购物/生活/旅行/文娱/汽车/其他）每个独占一行垂直排列。

## 2 产出

| 文件 | 改动 |
|------|------|
| `miniprogram/components/expense-overlay/index.wxss` | +5 / -3 行 |

**具体改动**：
- 新增 `.category-section--tier1 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 8rpx; column-gap: 0; }`
- 移除未使用的 `.category-grid` 规则（原代码中无任何 wxml 元素使用此 class）

## 3 关键决策

1. **根因定位**：`.category-section--tier1` 容器只有 `.category-section` 的 `padding: 8rpx 0`，**缺少 `display: grid` 声明**。其子元素 `.category-tier1` 是 `display: flex; flex-direction: column` 的块级元素，默认纵向堆叠。对比 `.category-section--tier2` 已有完整的 grid 布局定义。
2. **使用 `minmax(0, 1fr)` 而非 `1fr`**：防止 grid item 内容（96rpx 图标 + 文字）撑破列宽导致溢出或不均匀。
3. **保留 `.category-tier1` 内部 flex 布局不变**：grid cell 内部仍用 flex column 居中图标和文字，这是正确的——grid 控制行列分布，flex 控制 item 内部排版。
4. **移除废弃的 `.category-grid` 规则**：wxml 中没有任何元素使用该 class，属重写遗留死代码。

## 4 遗留

- 无。本修复为纯 CSS 布局修正，不影响逻辑层。
- P0/P1/P2 均无。

## 5 state.md diff

- §2 active tasks：新增 🔧 COSTRA-208 补丁条目，原 🆕 重写条目标记 ✅
- §3 交付历史索引：新增 `history/2026-06-08-costra-208-tier1-grid.md`
- §7 时间戳：更新为 `2026-06-08T13:25:00+08:00`

---

## 验收确认

- [x] 一级分类严格一行 4 个（grid 4 列）
- [x] 二级分类保持一行 4 个（未改动）
- [x] `npx tsc --noEmit` 0 错误
- [x] `npm run lint` 0 错误
- [x] commit message 含 `Refs: COSTRA-208`
- [x] scope `miniapp` 在白名单内
- [x] husky hooks 全绿（lint + typecheck）
