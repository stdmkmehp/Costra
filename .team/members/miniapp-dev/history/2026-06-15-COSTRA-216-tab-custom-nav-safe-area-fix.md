# COSTRA-216 · 修复 Tab 页 custom navigation 后页面标题顶部错位

> 日期：2026-06-15
> 角色：miniapp-dev（SBAI v1.1）
> 任务类型：fix
> commit: `307fa2b`

---

## §1 任务描述

Human 反馈：家庭页顶部被 COSTRA-215 改坏，标题位置不对，和状态栏/刘海区域重叠（见截图）。

**根因分析**：
COSTRA-215 将 family/statistics/mine/add-placeholder 改为 `navigationStyle: custom` 后，原来依赖原生导航栏避让的页面内容现在从屏幕顶端开始渲染；但这些页面没有自定义导航栏，也没有使用 safeArea metrics 做顶部 padding，导致标题顶到状态栏/刘海。

## §2 产出

### 修改文件清单（12 文件，+194/-35）

| 文件 | 变更说明 |
|------|----------|
| `miniprogram/pages/family/index.wxml` | 添加 page-nav 自定义导航栏 + 内容区包裹 |
| `miniprogram/pages/family/index.ts` | import getSafeAreaMetrics + onLoad 设置 statusBarHeight/navBarHeight |
| `miniprogram/pages/family/index.wxss` | 添加 .page-nav / .family__content 样式 |
| `miniprogram/pages/statistics/index.wxml` | 添加 page-nav 自定义导航栏 + 内容区包裹 |
| `miniprogram/pages/statistics/index.ts` | import getSafeAreaMetrics + onLoad 设置 statusBarHeight/navBarHeight |
| `miniprogram/pages/statistics/index.wxss` | 添加 .page-nav / .statistics__content 样式 |
| `miniprogram/pages/mine/index.wxml` | 添加 page-nav 导航栏 + mine__content 包裹全部内容 |
| `miniprogram/pages/mine/index.ts` | import getSafeAreaMetrics + onLoad 设置安全区指标 |
| `miniprogram/pages/mine/index.wxss` | 添加 .page-nav / .mine__content 样式 |
| `miniprogram/pages/add-placeholder/index.wxml` | 添加 page-safe-top 安全区占位 |
| `miniprogram/pages/add-placeholder/index.ts` | import getSafeAreaMetrics + onLoad 设置 navBarTotalHeight |
| `miniprogram/pages/add-placeholder/index.wxss` | 添加 .placeholder / .page-safe-top 样式 |

### 实现方案

使用已建立的 `getSafeAreaMetrics()`（COSTRA-214）：

- **family / statistics / mine**：添加最小自定义导航栏 `.page-nav`
  - `style="padding-top: {{statusBarHeight}}px; height: {{navBarHeight}}px;"`
  - 标题 32rpx, font-weight 600, 左对齐, padding-left 32rpx
  - 背景 #f1f2ec 与 page 背景一致
- **add-placeholder**：仅添加 `.page-safe-top` 占位（`height: {{navBarTotalHeight}}px`）

### 验收结果

- ✅ `npx tsc --noEmit` 0 错误
- ✅ `npm run lint` 0 错误  
- ✅ `npm run check:appjson` 通过（14 pages matched, 5/5 tabBar pass）
- ✅ husky pre-commit + commit-msg hooks 全部通过

## §3 关键决策

1. **复用 COSTRA-214 safeArea 服务**：不重复造轮子，直接 import `getSafeAreaMetrics()` 获取统一的安全区指标。
2. **最小化改动原则**：只加导航栏/安全区占位，不改业务 UI。family/statistics 保持骨架页风格。
3. **mine 页内容区包裹**：将原有 .mine 内所有内容包裹在 `.mine__content` 中，避免 padding 冲突。
4. **不影响 expense-overlay**：overlay 组件自身已有独立的安全区处理（COSTRA-214），本次改动只影响 Tab 骨架页。

## §4 遗留

无。本卡为纯 UI 修复，无后续依赖。

## §5 state.md diff

- §2 active tasks：新增 🔧 COSTRA-216 条目（最顶部）
- §3 交付历史索引：新增 `history/2026-06-15-costra-216-tab-custom-nav-safe-area-fix.md`
- §7 时间戳：新增 2026-06-15T COSTRA-216 条目（最顶部）
