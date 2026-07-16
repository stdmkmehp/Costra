// components/expense-overlay/calc.ts · 重导出自 utils/calc.ts
// COSTRA-227: 计算器逻辑已抽取为公共模块，此文件保留兼容性重导出
// 2026-07-16: 追加 pressClear / inputPaste
export {
  INITIAL_CALC_STATE,
  inputDigit, inputDot,
  inputOperator, inputBackspace, pressEquals,
  pressClear, inputPaste,
  type CalcState,
  type ActionButtonState,
} from '../../utils/calc';
