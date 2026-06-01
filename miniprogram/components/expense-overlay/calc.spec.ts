// components/expense-overlay/calc.spec.ts · 计算器逻辑单测
// 卡号: COSTRA-212 · 验证算式拼接修复（1+11=12 等）
import { describe, it, expect } from 'vitest';
import {
  INITIAL_CALC_STATE,
  inputDigit, inputDot, inputOperator, inputBackspace, pressEquals,
} from './calc';

describe('components/expense-overlay/calc', () => {
  describe('COSTRA-212: 算式拼接修复', () => {
    it('1 + 11 = → 12', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '1');
      calc = inputDigit(calc, '1');
      calc = pressEquals(calc);
      expect(calc.display).toBe('12');
      expect(calc.amountCents).toBe(12);
    });

    it('12 + 8 = → 20', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '8');
      calc = pressEquals(calc);
      expect(calc.display).toBe('20');
      expect(calc.amountCents).toBe(20);
    });

    it('20 - 5 = → 15', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '2');
      calc = inputDigit(calc, '0');
      calc = inputOperator(calc, '-');
      calc = inputDigit(calc, '5');
      calc = pressEquals(calc);
      expect(calc.display).toBe('15');
      expect(calc.amountCents).toBe(15);
    });

    it('1.2 + 3.4 = → 4.6', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDot(calc);
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = inputDot(calc);
      calc = inputDigit(calc, '4');
      calc = pressEquals(calc);
      expect(calc.display).toBe('4.6');
      expect(calc.amountCents).toBe(4.6);
    });
  });

  describe('基本数字输入', () => {
    it('初始状态输入 1 → display "1"', () => {
      const calc = inputDigit(INITIAL_CALC_STATE, '1');
      expect(calc.display).toBe('1');
      expect(calc.accumulator).toBe('1');
    });

    it('连续输入 1 2 3 → display "123"', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '2');
      calc = inputDigit(calc, '3');
      expect(calc.display).toBe('123');
    });

    it('初始 0 再输入 0 → 仍为 "0"', () => {
      const calc = inputDigit(INITIAL_CALC_STATE, '0');
      expect(calc.display).toBe('0');
    });
  });

  describe('运算符输入', () => {
    it('1 + 2 + 3 = → 6（链式计算）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('6');
    });

    it('运算符替换：1 + → 1 -', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputOperator(calc, '+');
      calc = inputOperator(calc, '-');
      expect(calc.pendingOp).toBe('-');
      expect(calc.display).toBe('1 - ');
    });
  });

  describe('退格', () => {
    it('123 退格 → 12', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '2');
      calc = inputDigit(calc, '3');
      calc = inputBackspace(calc);
      expect(calc.display).toBe('12');
      expect(calc.accumulator).toBe('12');
    });

    it('1 + 12 退格 → 1 + 1', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '1');
      calc = inputDigit(calc, '2');
      calc = inputBackspace(calc);
      expect(calc.display).toBe('1 + 1');
      expect(calc.accumulator).toBe('1');
    });

    it('= 结果后退格 → 回到初始状态', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = pressEquals(calc);
      // pressEquals 不改变状态（actionState=done），需要先走运算符路径
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('8');
      calc = inputBackspace(calc);
      expect(calc.display).toBe('0');
    });
  });

  describe('小数点', () => {
    it('重复输入小数点被忽略', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDot(calc);
      calc = inputDot(calc);
      expect(calc.display).toBe('1.');
    });

    it('小数点后最多 2 位', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDot(calc);
      calc = inputDigit(calc, '2');
      calc = inputDigit(calc, '3');
      calc = inputDigit(calc, '4'); // 应被忽略
      expect(calc.display).toBe('1.23');
    });
  });
});
