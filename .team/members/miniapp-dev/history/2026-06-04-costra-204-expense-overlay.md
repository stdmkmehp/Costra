# COSTRA-204 · 记账覆盖层全新开发

> task_type: feature
> 交付日期: 2026-06-04
> commit: `cd9cc88`

---

## 1. 任务描述

COSTRA-204 是 UI 重构系列中最复杂的组件：将 COSTRA-201 创建的 `components/expense-overlay/` 占位组件（仅显示"记账功能开发中"）全面实装为完整的全屏记账覆盖层。

核心交互包括：收支 swiper 切换、双层分类网格（场景A 点击一级展开 + 场景B 直选二级归属映射）、自定义计算器键盘（4x4 布局 + 右下角状态机 + 链式计算 + decimal.js 精算）、账本归属切换 + 费用性质开关、备注输入、保存逻辑（putEntry + enqueue outbox）。

## 2. 产出

### 代码文件（5 文件 · +1451/-27）

| 文件 | 行数 | 说明 |
|------|------|------|
| `components/expense-overlay/categories.ts` | 179 | 分类数据模块（硬编码8+3一级分类+去重映射+buildDedupedSubCategories） |
| `components/expense-overlay/calc.ts` | 332 | 计算器状态机（CalcState + inputDigit/Dot/Operator/Backspace/Equals 纯函数 + decimal.js 精算） |
| `components/expense-overlay/index.ts` | 425 | 主组件（显隐控制+swiper+分类交互+键盘分发+账本切换+保存） |
| `components/expense-overlay/index.wxml` | 226 | 模板（swiper双面板+分类网格+展开子类+计算器面板+操作行） |
| `components/expense-overlay/index.wxss` | 376 | 样式（覆盖层slide-up/down+分类网格4列+键盘4x4+金额显示+fade动画） |

### 质量闸门

- ✅ `npx tsc --noEmit` — 0 errors
- ✅ `npm run lint` — 0 errors, 0 warnings
- ✅ `npm run check:appjson` — 14 pages matched
- ✅ `npm run check:whitelist` — 3 envs matched
- ✅ `npm run check:tooling` — 3/3 rules pass
- ✅ `npm run test` — 69/69 passed

## 3. 关键决策

1. **模块拆分**：原单文件 956 行超 500 行限制，拆为 `categories.ts`（分类数据）+ `calc.ts`（计算器状态机）+ `index.ts`（主组件）三个模块。拆分边界遵循"数据/逻辑/视图"三分离原则。

2. **计算器状态机设计**：采用纯函数式设计（`inputDigit(calc, digit) → newCalc`），而非在 Component methods 里直接 mutate。优势：逻辑可独立测试、无副作用、setData 一次性触发。

3. **分类数据硬编码**：按 category_dictionary.md 完整硬编码所有一级/二级分类 + 去重映射表。DEDUP_MAPPING 覆盖了 5 个重叠二级分类（餐饮/机票/零食/买菜/饮料）。后续卡对接 API 替换。

4. **场景 A vs 场景 B 交互差异**：
   - 场景 A（点击一级）：展开子分类 + 弱化其他一级(dimmedTier1Ids opacity 0.2) + 自动选中首个子分类
   - 场景 B（直选二级）：不触发一级展开 + 查 DEDUP_MAPPING 归属 + scroll-into-view 防遮挡

5. **金额计算严格 decimal.js**：calc.ts 中所有加减运算走 `Decimal.plus/minus`，最终通过 `toCents()` 转为整数分存储。与 ledger/index.ts 保持一致。

6. **账本切换动态响应**：`showSharedToggle` 由 `isMultiMemberLedger && entryType === 'expense'` 联动控制，CSS fade 动画过渡。

## 4. 遗留

- **P2-1**：分类数据硬编码，后续卡对接 API 替换（categories.ts 整文件替换）
- **P2-2**：账本选项列表硬编码为单个"我的账本"，对接 family list API 后扩展
- **P2-3**：多人家庭账本判定 `isMultiMember` 硬编码 false，待对接真实 family 数据
- **P2-4**：金额显示区暂无千分位格式化（大额输入时显示较密，后续优化）

## 5. state.md diff

- §2 active tasks：+COSTRA-204 记账覆盖层全新开发已交付
- §3 交付历史索引：+2026-06-04 COSTRA-204 记账覆盖层全新开发
- §6 遗留问题：+COSTRA-204 遗留 4 条 P2
- §7 时间戳：+2026-06-04T12:00:00+08:00
