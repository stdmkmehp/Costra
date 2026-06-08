# COSTRA-207 · 移除swiper根治分类网格空白

> 日期: 2026-06-07
> 角色: miniapp-dev (SBAI v1.1)
> 任务类型: fix
> commit: `24243fb`

---

## 1. 任务描述

记账覆盖层初始态分类网格下半屏大面积空白。此前已尝试隐藏 TabBar、动态 swiperHeight、移除 catchtouchmove 均未解决。

**根因**：`<scroll-view>` 嵌套在 `<swiper-item>` 内，微信小程序实际渲染中 swiper/swiper-item 裁剪机制导致可滚动容器高度计算异常，分类内容被截断，剩余区域显示为空白。

本次做结构性修复：**彻底移除 `<swiper>`，改用普通 flex view 面板 + scroll-view + 轻量自定义横滑手势。**

## 2. 产出

### 修改文件（3 文件，+155/-145）

| 文件 | 改动 |
|------|------|
| `miniprogram/components/expense-overlay/index.wxml` | 删除 swiper/swiper-item 结构(约135行)，替换为 category-panel(view) + 双 scroll-view(wx:if/wx:elif)，绑定 touchstart/touchend 手势事件 |
| `miniprogram/components/expense-overlay/index.wxss` | 删除 `.overlay__swiper` 样式，新增 `.category-panel { flex:1; min-height:0; overflow:hidden; }` |
| `miniprogram/components/expense-overlay/index.ts` | 删除 swiperHeight data 字段、attached() 中 wx.getSystemInfoSync/getMenuButtonBoundingClientRect 高度计算、onSwiperChange 方法；新增 onPanelTouchStart/onPanelTouchEnd 轻量横滑手势方法 |

### 验证结果

- `npx tsc --noEmit` — **0 错误**
- `npm run lint` (eslint) — **0 错误**
- husky pre-commit hooks 双 PASS
- commit message footer 含 `Refs: COSTRA-207`

## 3. 关键决策

1. **结构性修复 vs 局部补丁**：不再继续给 swiper 打补丁（前3轮补丁均失败），直接删除 swiper 是根因修复。
2. **横滑手势阈值**：`Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5`——60px 最小位移 + 横纵比 1.5:1，避免纵向滚动时误触发切换。
3. **不使用 catchtouchmove**：category-panel 不绑 catchtouchmove，确保内部 scroll-view 纵向滚动不受阻。
4. **pure field 存储 touch 坐标**：`_panelTouchStartX` / `_panelTouchStartY` 通过 `(this as unknown as Record<string, number>)` 存取，不污染 data 触发渲染。

## 4. 遗留

- **P0 无**
- **P1 无**
- **P2**：横滑手势无视觉反馈（如指示器滑动动画），后续可考虑加 CSS transform 过渡增强体验（非阻塞）

## 5. state.md diff

- §2 active tasks：新增 COSTRA-207 🆕 条目
- §3 交付历史索引：新增 history/2026-06-07-costra-207-remove-swiper-fix-blank.md 条目
- §7 时间戳：新增 2026-06-07T14:30 条目
