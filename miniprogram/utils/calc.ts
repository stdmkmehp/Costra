// utils/calc.ts · 计算器状态机（状态机 + decimal.js 精算）
// COSTRA-227: 从 components/expense-overlay/calc.ts 抽取为公共模块
// 卡号: COSTRA-204 / COSTRA-212 / COSTRA-213 · 交互规范: interaction_flow.md §2 Step 3~5
// ADR-0002: 金额计算必须走 decimal.js
// COSTRA-213: 修复 pressEquals / 链式 inputOperator 中 amountCents 返回元而非分的 bug
//
// 2026-07-16 扩展：
//   1. 运算符从 `+ -` 扩展到 `+ - * /`；display 中乘除以 × ÷ 展示，data-key 与内部 op 仍用 * /。
//   2. 采用「链式即时求值」，不遵循数学优先级——`2 + 3 × 4 =` 结果为 20 而非 14，
//      与 iOS 原生计算器（非科学模式）一致。链式除法可能出现 `100 ÷ 3 × 3 = 99.99` 的
//      截断副作用，属可接受行为。
//   3. 除法结果统一走 formatResult(toFixed(2))，四舍五入到分；除以 0 直接返回 0，
//      pressEquals 遇除零守卫为「不产生结果」（外层负责 toast/振动提示）。
//   4. 新增 pressClear（AC 一键清空）与 inputPaste（粘贴键覆盖当前操作数）。
//
// 2026-07-16 review 修复：
//   R1 (P0-2): 计算结果统一走 finalizeResult()，超上限（整数 >8 位）/非安全整数 → error='overflow'，
//              保持 display/accumulator 原样、amountCents=0，避免污染 DB。
//   R2 (P1-1): 链式 inputOperator 的除零/溢出反馈与 pressEquals 对齐（error 显式传出，
//              外层 UI 统一根据 calc.error 决定 toast/振动）。
//   R3: 新增 CalcState.error（'overflow' | 'divzero' | null），替代原本 UI 层靠
//       "display === before" 的隐式约定，语义明确、可测。

import Decimal from './vendor/decimal';
import { toCents } from './money';

/** 键盘右下角按钮状态 */
export type ActionButtonState = 'done' | 'equals';

/** 计算错误类型（用于 UI 层触发 toast/振动反馈） */
export type CalcError = 'overflow' | 'divzero';

/** 运算符类型（COSTRA-212: 提取为类型别名供 replaceRightOperand 使用 · 2026-07-16 加入 * /） */
type Operator = '+' | '-' | '*' | '/';

/** 运算符 → 展示符号（display / 分隔查找均以此为准） */
const OP_DISPLAY: Record<Operator, string> = { '+': '+', '-': '-', '*': '×', '/': '÷' };

/** 金额整数位上限（与 inputDigit / parseClipboardToAmount 对齐） */
const MAX_INT_DIGITS = 8;

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
  /**
   * 最近一次计算的错误（若有）。UI 层据此决定是否给用户反馈：
   *   - 'divzero'：除以 0
   *   - 'overflow'：结果整数位 >8 位或超过 JS 安全整数
   *   - null：无错误
   * 任何后续输入（数字/运算符/退格/AC/粘贴）都会清零此字段，
   * 保证 UI 反馈只在触发那一次响应，不会在下一次 setData 再次触发。
   */
  error: CalcError | null;
}

export const INITIAL_CALC_STATE: CalcState = {
  display: '0',
  accumulator: '0',
  pendingOp: null,
  lastInputIsOp: false,
  justEvaluated: false,
  actionState: 'done',
  amountCents: 0,
  error: null,
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

/** 从 display 文字中提取左操作数（运算符之前的部分 · 使用 OP_DISPLAY 分隔符） */
function extractLeftOperand(display: string, op: Operator): string {
  const sep = ' ' + OP_DISPLAY[op] + ' ';
  const opIndex = display.lastIndexOf(sep);
  if (opIndex === -1) return display.trim();
  return display.slice(0, opIndex).trim();
}

/** 替换 display 中右操作数（COSTRA-212: 替代 replace(/[^+-]*$/, '') 正则）
 *
 * 根因：原正则 `replace(/[^+-]*$/, '')` 会把 `'1 + 1'` 变成 `'1 +'`，
 * 再拼成 `'1 +11'`，导致 extractLeftOperand 找不到 `' + '` 空格包围的运算符。
 * 新函数精确查找 `' op '` 位置，只替换运算符之后的部分。
 *
 * 2026-07-16: 分隔符改用 OP_DISPLAY[op]（乘除是 × ÷ 而非 * /）。
 */
function replaceRightOperand(display: string, op: Operator | null, rightOperand: string): string {
  if (!op) return rightOperand;
  const opPattern = ' ' + OP_DISPLAY[op] + ' ';
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
    case '*': return left.times(right);
    case '/':
      // 除零守卫：返回 0，外层 pressEquals 会额外拦截保持 display 不变
      if (right.isZero()) return new Decimal(0);
      return left.dividedBy(right);
    default: return right;
  }
}

/** 计算当前金额（cents）· 纯数字时直接转 · 有运算符时计算 */
function calcAmountCents(
  currentOperand: string,
  pendingOp: Operator | null,
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
    case '*': result = left.times(right); break;
    case '/':
      if (right.isZero()) return 0;
      result = left.dividedBy(right);
      break;
    default: result = right; break;
  }
  // 中间态 amountCents（用户还未按 =/切换运算符），超上限时返回 0 而不是抛错，
  // 让保存入口的 amountCents>0 兜底继续把关；display 由外层守护。
  const resultStr = formatResult(result);
  if (!isResultInRange(resultStr)) return 0;
  return safeToCents(resultStr);
}

/**
 * 计算结果是否在允许范围内：
 *   - 整数位 ≤ MAX_INT_DIGITS（8）
 *   - 转 cents 后仍是 JS 安全整数（Number.isSafeInteger）
 * 与 inputDigit / parseClipboardToAmount 的整数位约束对齐。
 */
function isResultInRange(resultStr: string): boolean {
  const intPart = resultStr.replace(/^-/, '').split('.')[0] || '0';
  if (intPart.length > MAX_INT_DIGITS) return false;
  const cents = safeToCents(resultStr);
  if (!Number.isSafeInteger(cents)) return false;
  return true;
}

/**
 * 计算结果的统一 finalize 入口（2026-07-16 review 修复 P0-2 / P1-1）。
 *
 * 承担三件事：
 *   1. 除零守卫：pendingOp==='/' 且 accumulator=='0' → { ok:false, reason:'divzero' }
 *   2. 溢出守卫：结果整数位 >8 或 cents 非安全整数 → { ok:false, reason:'overflow' }
 *   3. 正常：返回 { ok:true, resultStr, amountCents }
 *
 * 由 pressEquals / 链式 inputOperator 共同调用，保证除零/溢出反馈路径完全一致。
 */
type FinalizeResult =
  | { ok: true; resultStr: string; amountCents: number }
  | { ok: false; reason: CalcError };

function finalizeResult(calc: CalcState): FinalizeResult {
  // 除零
  if (calc.pendingOp === '/' && safeDecimal(calc.accumulator).isZero()) {
    return { ok: false, reason: 'divzero' };
  }

  const result = evaluate(calc);
  const resultStr = formatResult(result);

  // 溢出（整数位 >8 或转 cents 非安全整数）
  if (!isResultInRange(resultStr)) {
    return { ok: false, reason: 'overflow' };
  }

  return { ok: true, resultStr, amountCents: safeToCents(resultStr) };
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
      error: null,
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
      error: null,
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
    error: null,
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
      error: null,
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
      error: null,
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
    error: null,
  };
}

/** 输入运算符 + / - / * / / （链式即时求值 · 2026-07-16 扩展乘除） */
export function inputOperator(calc: CalcState, op: Operator): CalcState {
  const opDisplay = OP_DISPLAY[op];

  // 链式计算：已有待运算操作符且刚输入了数字 → 先计算前序结果
  //   2026-07-16 R2: 走 finalizeResult 统一守卫除零/溢出，与 pressEquals 对齐。
  //   任一失败：保持原 display/accumulator/pendingOp，写入 error 字段供 UI 反馈；
  //   用户可退格改右操作数继续。
  if (calc.pendingOp && !calc.lastInputIsOp) {
    const res = finalizeResult(calc);
    if (!res.ok) {
      return { ...calc, error: res.reason, amountCents: 0 };
    }
    const newDisplay = res.resultStr + ' ' + opDisplay + ' ';
    return {
      display: newDisplay,
      accumulator: res.resultStr,
      pendingOp: op,
      lastInputIsOp: true,
      justEvaluated: false,
      actionState: 'equals',
      amountCents: res.amountCents,
      error: null,
    };
  }

  // 替换运算符（前后各 3 字符：空格 + 单字符 + 空格 · × ÷ 皆单字符宽度）
  if (calc.lastInputIsOp) {
    const prefix = calc.display.slice(0, -3);
    const newDisplay = prefix + ' ' + opDisplay + ' ';
    return {
      ...calc,
      display: newDisplay,
      pendingOp: op,
      error: null,
    };
  }

  // 首次运算符
  const newDisplay = calc.display + ' ' + opDisplay + ' ';
  return {
    display: newDisplay,
    accumulator: calc.accumulator,
    pendingOp: op,
    lastInputIsOp: true,
    justEvaluated: false,
    actionState: 'equals',
    amountCents: 0,
    error: null,
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
      error: null,
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
    error: null,
  };
}

/** 按 = 计算结果（2026-07-16 R1/R2: 除零/溢出统一走 finalizeResult） */
export function pressEquals(calc: CalcState): CalcState {
  if (calc.actionState !== 'equals') return calc;

  const res = finalizeResult(calc);
  if (!res.ok) {
    // 失败：display / accumulator / pendingOp 全部保留，用户可退格改写继续。
    // error 字段告诉 UI 层触发对应反馈（divzero → toast「不能除以 0」；overflow → 「金额超出上限」）。
    return { ...calc, error: res.reason, amountCents: 0 };
  }

  return {
    display: res.resultStr,
    accumulator: res.resultStr,
    pendingOp: null,
    lastInputIsOp: false,
    justEvaluated: true,
    actionState: 'done',
    amountCents: res.amountCents,
    error: null,
  };
}

// ─── AC 与 粘贴（2026-07-16 新增）─────────────────────────────────────────────

/**
 * AC（All Clear）：一键清空所有输入，回到初始态。
 * 语义等同重置为 INITIAL_CALC_STATE，与「回到未记账」视觉一致。
 */
export function pressClear(_calc: CalcState): CalcState {
  return { ...INITIAL_CALC_STATE };
}

/**
 * 粘贴：将剪贴板归一后的元字符串注入到「当前操作数」位置。
 *
 * 上下文语义：
 *  - 初始态 / justEvaluated / 纯数字态：整体替换（覆盖 display 与 accumulator）。
 *  - 算式态（有 pendingOp）：只替换右操作数，左操作数与运算符保留，
 *    如 `5 + 2` 粘贴 `10` → `5 + 10`。
 *
 * 前置：yuanStr 必须是已由 parseClipboardToAmount 校验过的合法元字符串
 * （非空、非零、整数位 ≤8、最多 2 位小数、去尾零）。此处不再做合法性校验。
 */
export function inputPaste(calc: CalcState, yuanStr: string): CalcState {
  // 算式态：粘贴到右操作数位置
  if (calc.pendingOp && !calc.justEvaluated) {
    const leftStr = extractLeftOperand(calc.display, calc.pendingOp);
    return {
      display: replaceRightOperand(calc.display, calc.pendingOp, yuanStr),
      accumulator: yuanStr,
      pendingOp: calc.pendingOp,
      lastInputIsOp: false,
      justEvaluated: false,
      actionState: 'equals',
      amountCents: calcAmountCents(yuanStr, calc.pendingOp, leftStr),
      error: null,
    };
  }

  // 初始 / justEvaluated / 纯数字：整体替换
  return {
    display: yuanStr,
    accumulator: yuanStr,
    pendingOp: null,
    lastInputIsOp: false,
    justEvaluated: false,
    actionState: 'done',
    amountCents: safeToCents(yuanStr),
    error: null,
  };
}
