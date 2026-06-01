# COSTRA-206 补丁2: expense-overlay 分类网格无法滚动根因修复

> 日期: 2026-06-06
> 角色: miniapp-dev（SBAI v1.1 · 装扮型 subagent）
> 任务类型: fix
> Commit: `614aaae`
> 卡号: COSTRA-206

---

## 1. 任务描述

Human 反复反馈：打开记账覆盖层后，一级分类（2行）+ 二级分类（只显示3行共12个），下半屏空白。实际上去重后的支出二级分类有约 44 个（应占 11 行），但只显示了前 3 行，且用户**无法手指滚动**查看更多分类。

## 2. 产出

### 修改文件
- `miniprogram/components/expense-overlay/index.wxml`（+8/-3）

### 具体改动（4 处）

| # | 位置 | 改动 | 原因 |
|---|------|------|------|
| 1 | 第 6~9 行 `.overlay` | **移除** `catchtouchmove="noop"` | 主因：catch 吞掉 touchmove 导致内部 scroll-view 无法滚动 |
| 2 | 第 13 行 `.overlay__header` | **新增** `catchtouchmove="noop"` | header 不需滚动，防底层穿透 |
| 3 | 第 170 行 `.keypad-panel` | **新增** `catchtouchmove="noop"` | 键盘不需滚动，防底层穿透 |
| 4 | 第 45/109 行两个 `<scroll-view>` | **新增** `style="height: {{swiperHeight}}px;"` | 次因：替代 CSS `height:100%` 在 swiper-item 中可能不精确 |

### 验证结果
- `npx tsc --noEmit` → ✅ exitCode 0（无类型错误）
- `npm run lint` (eslint) → ✅ exitCode 0（无 lint 错误）
- husky pre-commit hooks → ✅ 全部通过
- commit message footer → ✅ `Refs: COSTRA-206`

## 3. 关键决策

### 根因判定：双重叠加问题

**根因 1（主因，P0）—— `catchtouchmove` 阻断 scroll-view 滚动**
- `index.wxml` 原第 6 行：`<view class="overlay" catchtouchmove="noop">`
- `catchtouchmove` 是 **catch** 不是 bind，它会**捕获并吞掉所有 touchmove 事件**
- 微信小程序中，当父元素 catch 了 touchmove，子元素 scroll-view 的原生滚动手势识别会被抑制
- 这是微信小程序的已知行为，不是 bug

**根因 2（次因，P1）—— scroll-view 高度依赖 CSS `height: 100%` 不够精确**
- 原 wxss 第 101 行 `.category-scroll { height: 100%; }`
- 虽然 swiper 已动态设置 style height，但 swiper-item 内部 `%` 高度解析在某些场景下可能不稳定
- 改为与 swiper 相同的显式 `swiperHeight` px 值更稳妥

### 方案选型：为什么不用其他方案

| 方案 | 可行性 | 弃用原因 |
|------|--------|----------|
| overlay 保持 catch + scroll-view 加 catch 空方法 | ⚠️ 不确定 | 微信小程序事件机制中，scroll-view 自身的触摸处理优先级低于外层 catch，空方法无法恢复滚动 |
| 给 page 加 overflow:hidden | ❌ 不可行 | 小程序 page 不支持 CSS overflow 控制，且会影响全局布局 |
| 用 `disable-scroll` 页面属性 | ⚠️ 部分可行 | 只能页面级设置，无法按覆盖层显隐动态切换 |
| **当前方案：外层移除 + 子区域加 catch** | ✅ 最佳 | 精准控制：需要滚动的区域不加 catch，不需要滚动的区域加 catch 防穿透 |

## 4. 遗留 / 待观察

- **P2（待实测）**：移除外层 catchtouchmove 后，用户在覆盖层空白背景区域（非 scroll-view 范围内）滑动时，底层页面是否会穿透滚动？理论上 overlay 是 fixed 全屏遮罩，touch 事件不会穿透到下层；但如果出现异常，可考虑在 `.overlay__content` 的非 swiper 区域加一层透明 catch 容器。
- **P3（低优）**：`index.ts` 的 `noop()` 方法保留未删除（header 和 keypad-panel 仍在引用），无需改动。

## 5. State.md Diff

### §2 active tasks 新增
```
+ 🆕 COSTRA-206 补丁2: catchtouchmove 阻断 scroll-view 滚动已修复（2026-06-06 · ... · commit 614aaae）
```

### §3 交付历史索引新增
```
+ 2026-06-06 · history/2026-06-06-costra-206-scrollview-scroll-fix.md · COSTRA-206 补丁2...
```

### §7 时间戳新增
```
+ 2026-06-06T13:10:00+08:00 · COSTRA-206 补丁2 交付（... · commit 614aaae）
```
