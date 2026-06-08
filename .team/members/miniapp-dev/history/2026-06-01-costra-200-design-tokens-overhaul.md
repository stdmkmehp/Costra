# COSTRA-200 · 设计令牌全面重写

> task_type: feature · 2026-06-01 · miniapp-dev

## 1. 任务描述

UI-Refactor Phase-A 第一步：彻底重写 miniprogram 的设计令牌和全局样式，从旧色彩体系（`#2F7A78`/`#FAFAFA`）切换到新设计文档 `design/ui/design_spec.md` §2 规定的暖灰白/油墨暖黑/微信绿色彩体系。

## 2. 产出

| 交付物 | 文件 | 变更量 |
|--------|------|--------|
| D1: tokens/index.ts 全面重写 | `miniprogram/tokens/index.ts` | +150/-56 |
| D2: app.wxss 全面重写 | `miniprogram/app.wxss` | +200/-99 |
| D3: app.json window 配色更新 | `miniprogram/app.json` | 3 行修改 |
| D4: tokens.json 同步更新 | `miniprogram/tokens/tokens.json` | +106/-42 |

**总计**: 4 文件, +376/-94 行, commit `49ebd51`

### 关键变更明细

- **tokens/index.ts**: 弃用 `color.brand`(primary/primaryHover/primaryPressed/secondary/accent)，新建 `color.base`(warmInk/boneWhite) + `color.accent`(wxGreen/wxBlue) + `color.semantic`(success/warning/danger/info) + `color.role`(bg/text/border/amount/icon 完整分组)；新增 `typography`(fontSize/fontWeight/lineHeight/letterSpacing)、`shadow`(subtle)、`blur`(navBar/tabBar)、`animation`(duration/easing)；`meta.version` 从 `'0.1.0'` → `'2.0.0'`
- **app.wxss**: CSS 变量全面对齐新 tokens；移除 `@media (prefers-color-scheme: dark)` 深色模式块；新增排版原子类 `.text-display` ~ `.text-mini`；`.btn-primary` 改用微信绿 `#07C160` + 圆角 `8rpx`；`page` 基线 background `#f1f2ec` + color `#1c1b1a`；**保留旧变量兼容别名**（DEPRECATED）确保现有页面不崩溃
- **app.json**: `navigationBarBackgroundColor` `#2F7A78` → `#f1f2ec`；`navigationBarTextStyle` `white` → `black`；`backgroundColor` `#FAFAFA` → `#f1f2ec`
- **tokens.json**: JSON 格式同步对齐 index.ts v2.0.0 全部新结构

## 3. 关键决策

1. **旧变量兼容别名保留**：11 个页面 wxss 文件仍引用旧 CSS 变量名（如 `--color-danger`/`--color-success`/`--color-bg-app` 等），本卡按 §H 约束不修改页面文件。在 app.wxss `page` 块内添加旧变量→新变量的兼容别名映射（标注 DEPRECATED），确保现有页面不崩溃。后续 COSTRA-20x 逐页迁移后删除。
2. **深色模式彻底移除**：设计文档 `design_spec.md` §2 明确"抛弃暗黑模式，采用单一暖灰白背景"，移除 `@media (prefers-color-scheme: dark)` 块。
3. **金额色语义翻转**：旧体系 expense=`#D64545`(红色)，新体系 expense=`#1c1b1a`(油墨暖黑)、income=`#07C160`(微信绿)。支出用暖黑而非红色，符合"家庭纸质账本"的克制质感。
4. **shadow 从两级精简为一级**：旧体系有 `shadow-sm`/`shadow-lg`，新体系按设计文档"极少使用阴影"原则精简为仅 `shadow-subtle` 一个层级，兼容别名中保留 `shadow-sm`/`shadow-lg` 防页面崩溃。

## 4. 遗留 / 后续

- **P1 · 页面 wxss 旧变量迁移**：11 个页面 wxss 文件仍使用旧 CSS 变量名（`--color-danger`/`--color-success`/`--color-bg-app` 等），需后续 COSTRA-20x 逐页替换为新变量 + 移除兼容别名
- **P2 · tabBar 配色**：`app.json` tabBar 颜色仍为旧值（`#9E9E9E`/`#2F7A78`/`#FFFFFF`），下一卡 COSTRA-201 将整体重做为 custom-tab-bar，本卡不涉及
- **P2 · tokens.ts 在页面 TS 中的旧引用**：若页面 .ts 文件引用了 `tokens.color.brand.*` 等旧路径，typecheck 会报错——目前 tsc --noEmit 通过，说明暂无 .ts 文件直接引用旧路径

## 5. state.md diff

- §2 active tasks: +COSTRA-200 行
- §3 交付历史索引: +COSTRA-200 条目
- §7 时间戳: +2026-06-01T15:00:00+08:00 行
