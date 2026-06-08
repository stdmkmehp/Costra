# COSTRA-215 · 统一 Tab 页 custom navigation 修复 overlay 偏低

> 日期：2026-06-15
> 角色：miniapp-dev（SBAI v1.1）
> 任务类型：fix
> commit：`a058d50`

---

## 1 任务描述

诊断并修复非 ledger Tab 页打开记账 overlay 时整体偏低、露出原生导航栏标题的问题。

**根因**：
- `ledger/index.json` 已配置 `navigationStyle: "custom"`，overlay `position: fixed` 从屏幕顶部开始定位，正常。
- `statistics` / `family` / `mine` / `add-placeholder` 四个页面使用默认原生导航栏（仅有 `navigationBarTitleText`），页面内 `position: fixed` 从导航栏下方开始计算，导致 overlay 整体下移，原生导航标题暴露在 overlay 上方。

**截图证据**（Orchestrator 提供）：
- ledger 页打开 overlay：正常，从屏幕顶部开始。
- statistics 页打开 overlay：整体偏低，"统计"原生导航标题露在 overlay 上方。

## 2 产出

| 文件 | 变更 |
|------|------|
| `miniprogram/pages/statistics/index.json` | 添加 `"navigationStyle": "custom"`，移除 `navigationBarTitleText` |
| `miniprogram/pages/family/index.json` | 添加 `"navigationStyle": "custom"`，移除 `navigationBarTitleText` |
| `miniprogram/pages/mine/index.json` | 添加 `"navigationStyle": "custom"`，移除 `navigationBarTitleText` |
| `miniprogram/pages/add-placeholder/index.json` | 添加 `"navigationStyle": "custom"`，移除 `navigationBarTitleText` |

**统计**：4 文件 +4 / -21

## 3 关键决策

1. **统一 custom 策略**：所有可能挂载 `<expense-overlay />` 的 Tab 页面必须统一 `navigationStyle: "custom"`，确保 overlay fixed 定位基准一致（从屏幕顶部开始）。
2. **不扩展 UI 本轮范围**：去掉 `navigationBarTitleText` 后页面内标题暂时缺失（skeleton 骨架页），派单明确说明"当前 skeleton 页可保留页面内标题，后续正式页面再统一自定义 nav"，本轮不做额外 UI 补充。
3. **不改 overlay 逻辑**：overlay 组件本身无问题，问题出在宿主页面的导航模式不一致。

## 4 遗留

- **P2**：statistics/family/mine 三个页面去掉原生导航后缺少页面内标题文字。当前为 skeleton 骨架页，后续正式页面开发时需统一实现自定义导航栏组件（可复用 ledger 页的 nav-bar 模式）。不在本轮处理。
- **P3**：add-placeholder 是中间跳转页（点击 [+] 后立即 redirect 到 ledger），custom navigation 影响较小但为一致性已同步修改。

## 5 state.md diff

- §2 active tasks：新增 `COSTRA-215 🔧`
- §3 交付历史索引：新增本条 history 指向
- §7 时间戳：更新为 2026-06-15T
