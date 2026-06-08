# COSTRA-212 · 修复记账页备注多次编辑、计算器算式错误、滚动动画不丝滑

> task_type: fix · 2026-06-12 · miniapp-dev

---

## 1. 任务描述

Human 反馈三个问题：
1. 备注输入后无法再次修改——备注 placeholder 和 input 用 `wx:if/wx:else` 切换，input 被销毁重建导致二次编辑焦点不稳定
2. 计算器输入 `1+11=` 结果为 `11`，应为 `12`——`calc.ts` 中 `replace(/[^+-]*$/, '')` 正则把 `'1 + 1'` 变成 `'1 +'`，拼成 `'1 +11'`，`extractLeftOperand` 找不到 `' + '` 空格包围的运算符
3. 分类防遮挡滚动位置 OK，但动画不丝滑，像一帧切过去——`scroll-with-animation` 在 enhanced scroll-view 上程序化设置 `scroll-top` 时表现不稳定

## 2. 产出

### 2.1 备注可多次编辑（WXML + WXSS + TS）

- **index.wxml**：移除 `wx:if="{{!noteFocused}}"` / `wx:else` 切换，改为 placeholder 和 input 同时保留，用 `is-hidden` / `is-visible` class 控制显隐
- **index.wxss**：`.keypad-note` 改为 `position: relative; flex: 1`；placeholder 用 `opacity: 0; pointer-events: none` 隐藏；input 用 `position: absolute` 叠放 + `opacity: 0; pointer-events: none` 隐藏，`.is-visible` 时 `opacity: 1; pointer-events: auto`
- **index.ts**：`onTapNote()` 增加"先 false 再 nextTick true"逻辑，确保二次编辑时 focus 稳定触发

### 2.2 计算器算式修复（calc.ts）

- 新增 `Operator` 类型别名（`'+' | '-'`）
- 新增 `replaceRightOperand(display, op, rightOperand)` 辅助函数：精确查找 `' op '` 位置，只替换运算符之后的部分
- 在 `inputDigit`、`inputDot`、`inputBackspace` 三处替换 `replace(/[^+-]*$/, '')` 正则为 `replaceRightOperand`
- `CalcState.pendingOp` 类型从内联 `'+' | '-' | null` 改为 `Operator | null`

### 2.3 滚动插值动画（index.ts + index.wxml）

- **index.wxml**：移除 `scroll-with-animation="{{true}}"` 属性
- **index.ts**：
  - 新增常量 `SCROLL_ANIM_DURATION_MS = 220`、`SCROLL_ANIM_FRAME_MS = 16`
  - 新增 `_animateCategoryScrollTo(target)` 方法：easeOutCubic 分段插值，每 16ms setData 一次，220ms 完成
  - `_scrollAnimationToken` 递增机制：新动画自动取消旧动画，防止组件关闭/再次点击分类时旧动画继续运行
  - `_ensureSelectedNearKeyboard` 中直接 `setData({ categoryScrollTop })` 改为调用 `_animateCategoryScrollTo`

### 2.4 单测（calc.spec.ts）

- 新建 `miniprogram/components/expense-overlay/calc.spec.ts`
- 14 条测试：4 条 COSTRA-212 算式拼接修复（1+11=12, 12+8=20, 20-5=15, 1.2+3.4=4.6）+ 10 条基本功能覆盖

### 文件变更汇总

| 文件 | 变更 |
|------|------|
| `miniprogram/components/expense-overlay/index.wxml` | 备注区域结构重写 + 移除 scroll-with-animation |
| `miniprogram/components/expense-overlay/index.wxss` | 备注区域样式重写（叠放+显隐） |
| `miniprogram/components/expense-overlay/index.ts` | onTapNote 修复 + _animateCategoryScrollTo + 常量 |
| `miniprogram/components/expense-overlay/calc.ts` | replaceRightOperand + Operator 类型 + 三处正则替换 |
| `miniprogram/components/expense-overlay/calc.spec.ts` | **新建** 14 条单测 |

**5 文件 +280/-29 · commit `741fbb3`**

## 3. 关键决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | 备注区域用 class 显隐替代 wx:if/wx:else | input 销毁重建导致 focus 不稳定；保留 DOM 节点避免二次编辑时重建 |
| D2 | 新增 replaceRightOperand 替代正则 | `replace(/[^+-]*$/, '')` 会吃掉运算符后的空格，导致 `'1 +11'` 无法匹配 `' + '` |
| D3 | JS 分段插值动画替代 scroll-with-animation | enhanced scroll-view 程序化设置 scroll-top 时原生动画不稳定，JS 插值可控且兼容 |
| D4 | easeOutCubic 220ms | 用户感知"即时但有过渡"，避免瞬移感 |
| D5 | _scrollAnimationToken 递增取消旧动画 | 防止组件关闭/快速切换分类时旧动画继续运行导致异常 |

## 4. 遗留

- **P0**：无
- **P1**：无
- **P2**：
  - `pressEquals` 中 `amountCents` 使用 `result.toNumber()` 返回元而非分（已有行为，非本次引入，但与字段名 `cents` 语义不一致 · 待后续卡统一）
  - outbox.spec.ts 1 条已有失败（`next_retry_at > Date.now()` 时序问题 · 非本次引入）

## 5. state.md diff

- §2 active tasks：新增 COSTRA-212 ✅ 条目
- §3 交付历史索引：新增 `2026-06-12-costra-212-note-calc-scroll-fix.md` 条目
- §7 时间戳：更新为 `2026-06-12T14:10:00+08:00`
