# COSTRA-213 · 修复计算表达式保存金额出现 0.09 的单位错误

> 日期: 2026-06-13
> 角色: miniapp-dev（SBAI v1.1）
> 卡号: COSTRA-213
> 类型: fix
> commit: `c5902fe`

---

## §1 任务描述

用户反馈：直接记 `9` 和输入 `9+9-9` 后保存，在明细页显示结果不一样。截图显示 `lifestyle_phone` 显示 `¥0.09`，而 `lifestyle_beauty` 显示 `¥9.00`。表达式路径出现金额单位错误——计算结果被当作元而非分存储。

## §2 产出

### 修改文件（2 文件 +73/-17）

| 文件 | 改动 |
|------|------|
| `miniprogram/components/expense-overlay/calc.ts` | pressEquals 第 348 行：`result.toNumber()` → `safeToCents(resultStr)`；inputOperator 链式计算第 264 行：同改 |
| `miniprogram/components/expense-overlay/calc.spec.ts` | 全面重写：新增 COSTRA-213 专章 6 条 amountCents 单位断言；修复旧断言从元值改为分值（如 `toBe(12)` → `toBe(1200)`）；总计 19 测全绿 |

### 根因

**两处 `amountCents` 赋值使用了 `result.toNumber()` 返回元值，跳过了 `toCents` 转换：**

1. **`pressEquals`**（第 348 行）：用户输入 `9+9-9=` 时，`evaluate()` 返回 `Decimal(9)`，`toNumber()` 得到 **9**（元），但 `amountCents` 约定必须是分。保存后 `toYuan(9) = "0.09"` → 明细显示 `¥0.09` ✅ 完美匹配截图。

2. **`inputOperator` 链式计算**（第 264 行）：链式场景如 `12+8+10=` 中间步骤同样返回元值。

3. **对比正确路径**：`inputDigit` 直接输入数字走 `safeToCents(digit)` 正确返回分（如 `toCents('9') = 900`）。唯独 `pressEquals` 和链式 `inputOperator` 漏掉了 `toCents` 转换。

4. **测试也掩盖了 bug**：COSTRA-212 的测试断言 `expect(calc.amountCents).toBe(12)` 等断的是元值，说明 bug 从那时就存在但未被捕获。

## §3 关键决策

- **修复方案**：将两处 `result.toNumber()` 统一改为 `safeToCents(resultStr)`，与 `inputDigit` / `calcAmountCents` / `inputBackspace` 等所有其他路径保持一致。
- **不引入新函数**：复用已有的 `safeToCents` 内部函数（封装了 `toCents` + try/catch）。
- **测试策略**：新增 `COSTRA-213: amountCents 始终为分（cents）` 专章，覆盖直接输入、表达式、链式计算、小数共 6 个场景的 amountCents 分值断言。

## §4 遗留

无。本次为纯 bugfix，根因清晰、修复完整、测试全覆盖。

## §5 state.md diff

- §2 active tasks：新增 `🔧 COSTRA-213` 进行中条目
- §3 交付历史索引：新增 `2026-06-13 · history/2026-06-13-costra-213-calc-amountCents-unit-fix.md`
- §7 时间戳：新增 `2026-06-13T14:16:00+08:00` 条目
