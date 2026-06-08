# COSTRA-206 补丁: swiper 高度动态计算修复分类网格不满屏

> 日期: 2026-06-05
> 角色: miniapp-dev（SBAI v1.1）
> 类型: fix
> 卡号: COSTRA-206
> commit: `7ff7cdd`

---

## 任务描述

Human 反馈记账覆盖层打开后，一级分类和二级分类网格只占上半屏，下半屏是空白的。

根因分析：微信小程序 `<swiper>` 组件**不支持 CSS `flex: 1` 自动撑高**。swiper 默认高度为 150px，必须通过显式设置 `height` px 值或 wxss 中 `calc()` 来指定确切高度。当前 `.overlay__swiper` 写的 `flex: 1; min-height: 0;` 对 swiper 完全无效。

## 产出

### 修改文件（3 文件 +15/-4）

| 文件 | 改动 |
|------|------|
| `miniprogram/components/expense-overlay/index.ts` | data 新增 `swiperHeight` 字段；`lifetimes.attached` 中通过 `wx.getSystemInfoSync()` + `wx.getMenuButtonBoundingClientRect()` 动态计算可用高度 |
| `miniprogram/components/expense-overlay/index.wxml` | swiper 元素新增 `style="height: {{swiperHeight}}px;"` |
| `miniprogram/components/expense-overlay/index.wxss` | `.overlay__swiper` 移除无效的 `flex: 1; min-height: 0;`，改为注释说明高度由 JS 控制 |

### 验证

- `npx tsc --noEmit` ✅ 无类型错误
- `npm run lint` ✅ 全绿
- husky pre-commit hooks ✅ 双 PASS 后提交

## 关键决策

1. **计算公式**：`swiperHeight = windowHeight - headerBottom`，其中 `headerBottom = menuBtn.bottom + 8px`。使用胶囊按钮底部作为 header 区域下界比硬编码导航栏高度更准确（兼容不同机型）。
2. **时机选择**：在 `attached` 生命周期中一次性计算（组件创建时），而非每次 `_show()` 时重算——因为窗口高度在组件存活期间不变。
3. **键盘弹出处理**：当前方案不缩减 swiper 高度——keypad-panel 是 `flex-shrink: 0` 固定在底部的 overlay 子元素，swiper 高度为"无键盘时填满剩余空间"。键盘弹出时 swiper 内容区域自然被遮挡（scroll-view 可滚动），无需额外高度切换逻辑。
4. **降级安全**：若 `getMenuButtonBoundingClientRect` 异常返回 `{bottom:0}`，则 `swiperHeight ≈ windowHeight`，header 被轻微遮挡但不影响核心功能。

## 遗留

无遗留问题。

## state.md diff

- §2 active tasks: 新增 🆕 COSTRA-206 补丁条目
- §3 交付历史索引: 新增 `2026-06-05-costra-206-swiper-height-fix.md` 条目
- §7 时间戳: 新增本次交付时间戳
