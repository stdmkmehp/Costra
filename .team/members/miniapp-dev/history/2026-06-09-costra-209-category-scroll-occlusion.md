# COSTRA-209 · 记账覆盖层分类防键盘遮挡滚动与打开重置

> task_type: feature
> 卡号: COSTRA-209
> 日期: 2026-06-09
> commit: `e84cdd1`

---

## 1. 任务描述

Human 反馈两个交互缺失：

1. **需求1 - 防遮挡滚动**：选中下半区分类时，应滚动到键盘上方安全区，而不是屏幕最上方。设计文档 `design/ui/design_spec.md §6.3` 明确要求：若分类会被键盘遮挡，则丝滑滚动确保选中分类移动到键盘上方安全可视区；若不会被遮挡则不滚动。
2. **需求2 - 打开重置**：每次打开记账覆盖层时，分类滚动位置必须重置到顶部。当前问题：打开记账 → 滚动分类 → 退出 → 再打开，仍停留在上次滚动位置。

## 2. 产出

### 修改文件（2 文件 +100/-4）

1. **`miniprogram/components/expense-overlay/index.wxml`** (+6/-2)
   - scroll-view 添加 `scroll-top="{{categoryScrollTop}}"` + `scroll-with-animation="{{true}}"` + `bindscroll="onCategoryScroll"`
   - 一级分类 item 添加 `id="cat-tier1-{{item.id}}"`
   - 二级分类 item（展开面板 + 去重全局列表）添加 `id="cat-sub-{{item.id}}"`

2. **`miniprogram/components/expense-overlay/index.ts`** (+94/-2)
   - 新增常量 `KEYPAD_SHEET_ESTIMATED_HEIGHT_PX = 300`（键盘面板估算高度 px）
   - 新增常量 `SAFE_MARGIN_PX = 16`（安全间距 px，对应设计稿 24rpx）
   - data 新增 `categoryScrollTop: 0`（scroll-view 的 scroll-top 绑定值）
   - 新增方法 `onCategoryScroll(e)`：记录 scroll-view 当前滚动偏移到实例属性 `_currentScrollTop`
   - 新增方法 `_ensureCategoryVisibleAboveKeypad(selector)`：防遮挡滚动核心逻辑
     - 通过 `wx.createSelectorQuery().in(this)` 查询目标元素和 `.category-scroll` 的 bounding rect
     - 计算安全底线 = scrollRect.bottom - keypadHeight - safeMargin
     - 如果目标元素底部超过安全底线，计算 delta 并 setData categoryScrollTop
     - 如果目标元素在安全区内，不滚动
   - `_show()` 中添加滚动位置重置逻辑：先设 `categoryScrollTop: 1`，setTimeout 50ms 后设 `0`
   - `onTapTier1`：展开子分类后 setTimeout 调用 `_ensureCategoryVisibleAboveKeypad('#cat-sub-默认子分类id')`
   - `onTapSubCategory`：直选二级分类后 setTimeout 调用 `_ensureCategoryVisibleAboveKeypad('#cat-sub-subId')`
   - `onTapExpandedChild`：展开面板切换子分类后 setTimeout 调用 `_ensureCategoryVisibleAboveKeypad('#cat-sub-subId')`

## 3. 关键决策

1. **键盘高度用估算值而非 query**：键盘弹出前无法 query `.keypad-sheet` 实际高度（DOM 尚未渲染），故用 `KEYPAD_SHEET_ESTIMATED_HEIGHT_PX = 300` 估算。键盘弹出后 scroll-view 因 flex:1 自动缩小，此时 `_ensureCategoryVisibleAboveKeypad` 的 query 会获取更精确的 scrollRect，安全底线计算更准确。
2. **setTimeout 替代 nextTick**：微信小程序 Component 的 TypeScript 类型定义中 `nextTick` 属性不存在（`TS2339`），改用 `setTimeout(fn, 50)` 确保 setData 渲染完成后再查询元素位置。
3. **`_currentScrollTop` 作为实例属性而非 data**：methods 中只能声明函数，不能声明 number 属性（TS2322）。改为在 `onCategoryScroll` 中动态挂载到 `this` 实例上，通过 `Record<string, number>` 类型断言访问。
4. **滚动重置用 1→0 两步赋值**：小程序 scroll-view 不会响应同值赋值（如从 0 设 0），故先设 1 再设 0 确保触发滚动。
5. **不使用 scroll-into-view**：scroll-into-view 会将元素滚到 scroll-view 顶部，不符合设计要求（应滚到键盘上方而非屏幕最上方）。使用 scroll-top + scroll-with-animation 实现精确位置控制。

## 4. 遗留

- **P2 - 键盘高度估算值可能因设备/屏幕尺寸不同而有偏差**：当前 `KEYPAD_SHEET_ESTIMATED_HEIGHT_PX = 300` 基于 iPhone 标准屏估算。在小屏设备上可能偏高（滚动过多），大屏上可能偏低（遮挡未完全消除）。可后续优化为：键盘弹出后 query `.keypad-sheet` 实际高度并缓存，后续调用使用缓存值。
- **P2 - setTimeout 50ms 延迟在低端设备上可能不够**：setData 渲染完成时间因设备性能而异。若出现 query 返回 null 的情况，可考虑增加延迟或使用 `wx.nextTick`（需升级基础库类型定义）。

## 5. state.md diff

- §2 active tasks：新增 `✅ COSTRA-209 记账覆盖层分类防键盘遮挡滚动与打开重置已交付`
- §3 交付历史索引：新增 `2026-06-09 · history/2026-06-09-costra-209-category-scroll-occlusion.md`
- §7 时间戳：更新为 `2026-06-09T15:30:00+08:00`
