# COSTRA-208 · 记账覆盖层完全重写

> 日期: 2026-06-01
> 角色: miniapp-dev (SBAI v1.1)
> 任务类型: refactor
> Commit: `74a90e4`

---

## 1. 任务描述

COSTRA-208 要求从需求出发完全重写记账覆盖层（`expense-overlay`），不沿用旧布局。

**背景**: COSTRA-204/206/207 多次尝试修复"分类网格下半屏空白"问题均未解决。Human 明确要求不要在问题代码上修补，而是重新理解需求、重新实现。

## 2. 产出

### 修改文件（3 个，全部完全重写）

| 文件 | 变更 |
|------|------|
| `miniprogram/components/expense-overlay/index.wxml` | 完全重写 - 新架构 overlay→shell→header+scroll-view+keypad-sheet |
| `miniprogram/components/expense-overlay/index.wxss` | 完全重写 - 新 class 前缀 expense-*/category-*/keypad-* |
| `miniprogram/components/expense-overlay/index.ts` | 完全重写 - 清理 swiper/旧字段，改用 entryType 驱动 |

### 统计

- **3 文件 +252/-335**（净减 83 行）
- **验证**: typecheck ✅ 0 错误, lint ✅ 0 错误, test 69/69 ✅, check:appjson ✅
- **Commit message**: `refactor(miniapp): rewrite expense-overlay from scratch with flex scroll layout`
- **Footer**: `Refs: COSTRA-208`

### 未修改文件（复用）

- `categories.ts` — 分类数据纯逻辑无 UI 债务，完整保留
- `calc.ts` — 计算器状态机纯函数无 UI 债务，完整保留

## 3. 关键决策

### 架构决策：flex column 布局替代所有历史方案

**旧架构的问题链**:
1. COSTRA-204 原始实现用 `<swiper>` → 微信 swiper 裁剪机制导致 scroll-view 高度异常
2. COSTRA-206 补丁用 JS 动态计算 `swiperHeight` → 仍不稳定
3. COSTRA-206 补丁2 用 `catchtouchmove` → 导致 scroll-view 无法滚动
4. COSTRA-207 移除 swiper 改用 `category-panel` + 双 scroll-view(wx:if/wx:elif) → 结构仍复杂

**新架构（本次实现）**:
```
.expense-overlay (fixed, inset:0, z-index:9999)
  └─ .expense-shell (height:100vh, display:flex, flex-direction:column)
       ├─ .expense-header (flex:0 0 auto)        ← 取消 + 支出·收入指示器
       ├─ .category-scroll (flex:1, min-height:0) ← scroll-view 自动填满！
       │    ├─ .category-section--tier1           ← 一级分类 grid 4列
       │    ├─ .category-divider                  ← 分隔线
       │    ├─ .category-section--tier2           ← 二级分类 grid 4列
       │    └─ .category-bottom-spacer            ← 安全区占位
       └─ .keypad-sheet (wx:if=keypadVisible)     ← 键盘出现时自动挤压 scroll-view
```

### 关键约束满足

| # | 约束 | 实现方式 |
|---|------|----------|
| 1 | 初始打开无键盘 | `keypadVisible: false`，`keypad-sheet` 用 `wx:if` 控制渲染 |
| 2 | 分类区域填满屏幕 | `.category-scroll { flex: 1; min-height: 0; }` — 禁止 JS 计算高度 |
| 3 | 可滚动到底部 | `scroll-view scroll-y enhanced show-scrollbar=false` + 底部 spacer |
| 4 | 选中后键盘弹出 | `onTapTier1` / `onTapSubCategory` 中设置 `keypadVisible: true` |
| 5 | 无 swiper | 彻底移除，收支切换用轻量横滑手势(onTouchStart/End) + 点击文字 |
| 6 | 新 class 命名 | 全部使用 `expense-*`, `category-*`, `keypad-*` 前缀 |

### 横滑手势实现

- 绑定在 `scroll-view` 上（而非外层 view），避免阻止纵向滚动
- 判定条件: `Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5`
- 左滑→收入，右滑→支出

## 4. 遗留

- **P0 无**
- **P1 无**
- **P2**:
  - 分类数据仍硬编码（categories.ts），后续卡对接 API 替换
  - 账本选项列表仍硬编码为单个"我的账本"
  - 金额显示区暂无千分位格式化
  - Human 模拟器实测待执行（确认"二级分类可滚动到其他/人情/捐赠/丢失"）

## 5. state.md diff

- §2 active tasks: 新增 🆕 COSTRA-208 条目（最顶部）
- §3 交付历史索引: 新增 `2026-06-01-costra-208-expense-overlay-rewrite.md`
- §7 时间戳: 新增 `2026-06-01T13:20:00+08:00` 条目
