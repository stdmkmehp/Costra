// components/expense-overlay/calc.ts · 记账覆盖层计算器逻辑（状态机 + decimal.js 精算）
// 卡号: COSTRA-204 / COSTRA-212 / COSTRA-213 · 交互规范: interaction_flow.md §2 Step 3~5
// ADR-0002: 金额计算必须走 decimal.js
// COSTRA-213: 修复 pressEquals / 链式 inputOperator 中 amountCents 返回元而非分的 bug

import Decimal from '../../utils/vendor/decimal';
import { toCents } from '../../utils/money';

/** 键盘右下角按钮状态 */
export type ActionButtonState = 'done' | 'equals';

/** 运算符类型（COSTRA-212: 提取为类型别名供 replaceRightOperand 使用） */
type Operator = '+' | '-';

/** 计算器内部状态 */
export interface CalcState {
  /** 显示文字 */
  display: string;
  /** 当前累加值 */
  accumulator: string;
  /** 待运算的操作符 */
  pendingOp: Operator | null;
  /** 上次输入的是否为运算符 */
  lastInputIsOp: boolean;
  /** 是否刚按了 = 得出结果 */
  justEvaluated: boolean;
  /** 右下角按钮状态 */
  actionState: ActionButtonState;
  /** 最终金额（cents · 0 表示未就绪） */
  amountCents: number;
}

export const INITIAL_CALC_STATE: CalcState = {
  display: '0',
  accumulator: '0',
  pendingOp: null,
  lastInputIsOp: false,
  justEvaluated: false,
  actionState: 'done',
  amountCents: 0,
};

/** 安全创建 Decimal */
function safeDecimal(val: string): Decimal {
  try {
    const d = new Decimal(val || '0');
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
}

/** 安全转分 */
function safeToCents(val: string): number {
  try {
    return toCents(val);
  } catch {
    return 0;
  }
}

/** 格式化计算结果（去尾零，保留2位小数） */
export function formatResult(d: Decimal): string {
  if (!d.isFinite()) return '0';
  const fixed = d.toFixed(2);
  if (fixed.includes('.')) {
    const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
    return trimmed || '0';
  }
  return fixed;
}

/** 从 display 文字中提取左操作数（运算符之前的部分） */
function extractLeftOperand(display: string, op: string): string {
  const opIndex = display.lastIndexOf(' ' + op + ' ');
  if (opIndex === -1) return display.trim();
  return display.slice(0, opIndex).trim();
}

/** 替换 display 中右操作数（COSTRA-212: 替代 replace(/[^+-]*$/, '') 正则）
 *
 * 根因：原正则 `replace(/[^+-]*$/, '')` 会把 `'1 + 1'` 变成 `'1 +'`，
 * 再拼成 `'1 +11'`，导致 extractLeftOperand 找不到 `' + '` 空格包围的运算符。
 * 新函数精确查找 `' op '` 位置，只替换运算符之后的部分。
 */
function replaceRightOperand(display: string, op: Operator | null, rightOperand: string): string {
  if (!op) return rightOperand;
  const opPattern = ' ' + op + ' ';
  const opIndex = display.lastIndexOf(opPattern);
  if (opIndex === -1) return rightOperand;
  return display.slice(0, opIndex + opPattern.length) + rightOperand;
}

/** 执行算式计算（decimal.js） */
function evaluate(calc: CalcState): Decimal {
  if (!calc.pendingOp) {
    return safeDecimal(calc.accumulator);
  }

  const leftStr = extractLeftOperand(calc.display, calc.pendingOp);
  const left = safeDecimal(leftStr);
  const right = safeDecimal(calc.accumulator);

  switch (calc.pendingOp) {
    case '+': return left.plus(right);
    case '-': return left.minus(right);
    default: return right;
  }
}

/** 计算当前金额（cents）· 纯数字时直接转 · 有运算符时计算 */
function calcAmountCents(
  currentOperand: string,
  pendingOp: '+' | '-' | null,
  leftOperand: string | null,
): number {
  if (!pendingOp || !leftOperand) {
    return safeToCents(currentOperand);
  }
  const left = safeDecimal(leftOperand);
  const right = safeDecimal(currentOperand);
  let result: Decimal;
  switch (pendingOp) {
    case '+': result = left.plus(right); break;
    case '-': result = left.minus(right); break;
    default: result = right; break;
  }
  return safeToCents(formatResult(result));
}

// ─── 导出的纯函数计算器操作 ────────────────────────────────────────────────────

/** 输入数字 */
export function inputDigit(calc: CalcState, digit: string): CalcState {
  // 刚按了 =，开始新输入
  if (calc.justEvaluated) {
    return {
      display: digit,
      accumulator: digit,
      pendingOp: null,
      lastInputIsOp: false,
      justEvaluated: false,
      actionState: 'done',
      amountCents: safeToCents(digit),
    };
  }

  // 上次输入的是运算符，开始新的操作数
  if (calc.lastInputIsOp) {
    const newDisplay = calc.display + digit;
    return {
      display: newDisplay,
      accumulator: digit,
      pendingOp: calc.pendingOp,
      lastInputIsOp: false,
      justEvaluated: false,
      actionState: 'equals',
      amountCents: calcAmountCents(digit, calc.pendingOp, calc.accumulator),
    };
  }

  // 追加数字（限制显示长度）
  const currentOperand = calc.accumulator === '0' ? digit : calc.accumulator + digit;
  // 小数点后最多2位
  if (currentOperand.includes('.') && currentOperand.split('.')[1]?.length > 2) return calc;
  // 整数部分最多8位
  const intPart = currentOperand.split('.')[0];
  if (intPart.length > 8 && !currentOperand.includes('.')) return calc;

  let newDisplay: string;
  if (calc.pendingOp) {
    // COSTRA-212: 使用 replaceRightOperand 替代 replace(/[^+-]*$/, '') 正则
    newDisplay = replaceRightOperand(calc.display, calc.pendingOp, currentOperand);
  } else {
    newDisplay = currentOperand;
  }

  return {
    display: newDisplay,
    accumulator: currentOperand,
    pendingOp: calc.pendingOp,
    lastInputIsOp: false,
    justEvaluated: false,
    actionState: calc.pendingOp ? 'equals' : 'done',
    amountCents: calc.pendingOp
      ? calcAmountCents(currentOperand, calc.pendingOp, extractLeftOperand(calc.display, calc.pendingOp))
      : safeToCents(currentOperand),
  };
}

/** 输入 00 */
export function inputDoubleZero(calc: CalcState): CalcState {
  if (calc.accumulator === '0' && !calc.pendingOp) return calc;
  let result = inputDigit(calc, '0');
  if (calc.accumulator !== '0') {
    result = inputDigit(result, '0');
  }
  return result;
}

/** 输入小数点 */
export function inputDot(calc: CalcState): CalcState {
  if (calc.justEvaluated) {
    return {
      display: '0.',
      accumulator: '0.',
      pendingOp: null,
      lastInputIsOp: false,
      justEvaluated: false,
      actionState: 'done',
      amountCents: 0,
    };
  }

  if (calc.lastInputIsOp) {
    const newDisplay = calc.display + '0.';
    return {
      display: newDisplay,
      accumulator: '0.',
      pendingOp: calc.pendingOp,
      lastInputIsOp: false,
      justEvaluated: false,
      actionState: 'equals',
      amountCents: 0,
    };
  }

  if (calc.accumulator.includes('.')) return calc;

  const currentOperand = calc.accumulator + '.';
  let newDisplay: string;
  if (calc.pendingOp) {
    // COSTRA-212: 使用 replaceRightOperand 替代 replace(/[^+-]*$/, '') 正则
    newDisplay = replaceRightOperand(calc.display, calc.pendingOp, currentOperand);
  } else {
    newDisplay = currentOperand;
  }

  return {
    display: newDisplay,
    accumulator: currentOperand,
    pendingOp: calc.pendingOp,
    lastInputIsOp: false,
    justEvaluated: false,
    actionState: calc.pendingOp ? 'equals' : 'done',
    amountCents: 0,
  };
}

/** 输入运算符 + / - */
export function inputOperator(calc: CalcState, op: '+' | '-'): CalcState {
  // 链式计算：已有待运算操作符且刚输入了数字 → 先计算前序结果
  if (calc.pendingOp && !calc.lastInputIsOp) {
    const result = evaluate(calc);
    const resultStr = formatResult(result);
    const newDisplay = resultStr + ' ' + op + ' ';
    return {
      display: newDisplay,
      accumulator: resultStr,
      pendingOp: op,
      lastInputIsOp: true,
      justEvaluated: false,
      actionState: 'equals',
      amountCents: safeToCents(resultStr),
    };
  }

  // 替换运算符
  if (calc.lastInputIsOp) {
    const prefix = calc.display.slice(0, -3);
    const newDisplay = prefix + ' ' + op + ' ';
    return {
      ...calc,
      display: newDisplay,
      pendingOp: op,
    };
  }

  // 首次运算符
  const newDisplay = calc.display + ' ' + op + ' ';
  return {
    display: newDisplay,
    accumulator: calc.accumulator,
    pendingOp: op,
    lastInputIsOp: true,
    justEvaluated: false,
    actionState: 'equals',
    amountCents: 0,
  };
}

/** 退格 */
export function inputBackspace(calc: CalcState): CalcState {
  if (calc.justEvaluated) {
    return { ...INITIAL_CALC_STATE };
  }

  if (calc.lastInputIsOp) {
    const newDisplay = calc.display.slice(0, -3);
    return {
      display: newDisplay || '0',
      accumulator: calc.accumulator,
      pendingOp: null,
      lastInputIsOp: false,
      justEvaluated: false,
      actionState: 'done',
      amountCents: safeToCents(calc.accumulator),
    };
  }

  let newAccumulator = calc.accumulator.slice(0, -1);
  if (!newAccumulator || newAccumulator === '-') newAccumulator = '0';

  let newDisplay: string;
  if (calc.pendingOp) {
    // COSTRA-212: 使用 replaceRightOperand 替代 replace(/[^+-]*$/, '') 正则
    newDisplay = replaceRightOperand(calc.display, calc.pendingOp, newAccumulator);
  } else {
    newDisplay = newAccumulator;
  }

  return {
    display: newDisplay,
    accumulator: newAccumulator,
    pendingOp: calc.pendingOp,
    lastInputIsOp: false,
    justEvaluated: false,
    actionState: calc.pendingOp ? 'equals' : 'done',
    amountCents: calc.pendingOp
      ? calcAmountCents(newAccumulator, calc.pendingOp, extractLeftOperand(calc.display, calc.pendingOp))
      : safeToCents(newAccumulator),
  };
}

/** 按 = 计算结果 */
export function pressEquals(calc: CalcState): CalcState {
  if (calc.actionState !== 'equals') return calc;

  const result = evaluate(calc);
  const resultStr = formatResult(result);
  return {
    display: resultStr,
    accumulator: resultStr,
    pendingOp: null,
    lastInputIsOp: false,
    justEvaluated: true,
    actionState: 'done',
    amountCents: safeToCents(resultStr),
  };
}
