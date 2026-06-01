// components/expense-overlay/calc.spec.ts · 计算器逻辑单测
// 卡号: COSTRA-213 · 修复 amountCents 单位错误（= 和链式计算返回元而非分）
// 承接 COSTRA-212 算式拼接修复验证
import { describe, it, expect } from 'vitest';
import {
  INITIAL_CALC_STATE,
  inputDigit, inputDot, inputOperator, inputBackspace, pressEquals,
} from './calc';

describe('components/expense-overlay/calc', () => {
  describe('COSTRA-213: amountCents 始终为分（cents）', () => {
    it('直接输入 9 → amountCents = 900（分）', () => {
      const calc = inputDigit(INITIAL_CALC_STATE, '9');
      expect(calc.display).toBe('9');
      expect(calc.amountCents).toBe(900); // toCents('9') = 900
    });

    it('9 + 9 - 9 = → amountCents = 900（分）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '9');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '9');
      calc = inputOperator(calc, '-');
      calc = inputDigit(calc, '9');
      calc = pressEquals(calc);
      expect(calc.display).toBe('9');
      expect(calc.amountCents).toBe(900); // toCents('9') = 900，不是 9
    });

    it('1 + 11 = → amountCents = 1200（分）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '1');
      calc = inputDigit(calc, '1');
      calc = pressEquals(calc);
      expect(calc.display).toBe('12');
      expect(calc.amountCents).toBe(1200); // toCents('12') = 1200
    });

    it('1.2 + 3.4 = → amountCents = 460（分）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDot(calc);
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = inputDot(calc);
      calc = inputDigit(calc, '4');
      calc = pressEquals(calc);
      expect(calc.display).toBe('4.6');
      expect(calc.amountCents).toBe(460); // toCents('4.6') = 460
    });

    it('12 + 8 + 10 = → 链式计算 amountCents = 3000（分）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '8');
      // 链式：输入第二个 + 时触发前序 12+8 计算
      calc = inputOperator(calc, '+');
      // 链式中途 amountCents 也必须是分
      expect(calc.amountCents).toBe(2000); // toCents('20') = 2000
      calc = inputDigit(calc, '1');
      calc = inputDigit(calc, '0');
      calc = pressEquals(calc);
      expect(calc.display).toBe('30');
      expect(calc.amountCents).toBe(3000); // toCents('30') = 3000
    });

    it('20 - 5 = → amountCents = 1500（分）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '2');
      calc = inputDigit(calc, '0');
      calc = inputOperator(calc, '-');
      calc = inputDigit(calc, '5');
      calc = pressEquals(calc);
      expect(calc.display).toBe('15');
      expect(calc.amountCents).toBe(1500); // toCents('15') = 1500
    });
  });

  describe('COSTRA-212: 算式拼接 display 正确性', () => {
    it('1 + 11 = → display "12"', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '1');
      calc = inputDigit(calc, '1');
      calc = pressEquals(calc);
      expect(calc.display).toBe('12');
    });

    it('12 + 8 = → display "20"', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '8');
      calc = pressEquals(calc);
      expect(calc.display).toBe('20');
    });

    it('1.2 + 3.4 = → display "4.6"', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDot(calc);
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = inputDot(calc);
      calc = inputDigit(calc, '4');
      calc = pressEquals(calc);
      expect(calc.display).toBe('4.6');
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
    it('1 + 2 + 3 = → 6（链式计算 display）', () => {
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
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('8');
      expect(calc.amountCents).toBe(800); // toCents('8') = 800
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
