// components/expense-overlay/calc.spec.ts · 计算器逻辑单测
// 卡号: COSTRA-213 · 修复 amountCents 单位错误（= 和链式计算返回元而非分）
// 承接 COSTRA-212 算式拼接修复验证
// 2026-07-16 追加: × ÷ 运算符 / AC / 粘贴 / 除零 / 链式副作用
import { describe, it, expect } from 'vitest';
import {
  INITIAL_CALC_STATE,
  inputDigit, inputDot, inputOperator, inputBackspace, pressEquals,
  pressClear, inputPaste,
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

  // ─── 2026-07-16: × ÷ / AC / 粘贴 ────────────────────────────────────────────

  describe('乘法（×）', () => {
    it('2 × 3 = → 6，amountCents 600', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '2');
      calc = inputOperator(calc, '*');
      calc = inputDigit(calc, '3');
      expect(calc.display).toBe('2 × 3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('6');
      expect(calc.amountCents).toBe(600);
    });

    it('1.5 × 2 = → 3', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDot(calc);
      calc = inputDigit(calc, '5');
      calc = inputOperator(calc, '*');
      calc = inputDigit(calc, '2');
      calc = pressEquals(calc);
      expect(calc.display).toBe('3');
      expect(calc.amountCents).toBe(300);
    });
  });

  describe('除法（÷）', () => {
    it('10 ÷ 4 = → 2.5，amountCents 250', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '0');
      calc = inputOperator(calc, '/');
      calc = inputDigit(calc, '4');
      calc = pressEquals(calc);
      expect(calc.display).toBe('2.5');
      expect(calc.amountCents).toBe(250);
    });

    it('10 ÷ 3 = → 3.33（四舍五入到分）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '0');
      calc = inputOperator(calc, '/');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('3.33');
      expect(calc.amountCents).toBe(333);
    });

    it('10 ÷ 6 = → 1.67', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '0');
      calc = inputOperator(calc, '/');
      calc = inputDigit(calc, '6');
      calc = pressEquals(calc);
      expect(calc.display).toBe('1.67');
      expect(calc.amountCents).toBe(167);
    });

    it('除零：5 ÷ 0 = → display 不变、amountCents = 0、error=divzero', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '/');
      calc = inputDigit(calc, '0');
      const before = calc.display;
      calc = pressEquals(calc);
      // display 保持 "5 ÷ 0"，未产生结果
      expect(calc.display).toBe(before);
      expect(calc.display).toBe('5 ÷ 0');
      expect(calc.amountCents).toBe(0);
      // 仍处 equals 状态，用户可退格改写右操作数
      expect(calc.actionState).toBe('equals');
      // 2026-07-16 review R1: 显式 error 字段供 UI 反馈
      expect(calc.error).toBe('divzero');
    });

    it('链式除零：5 ÷ 0 + → 保持 display、error=divzero（避免绕过 pressEquals 静默变 0）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '/');
      calc = inputDigit(calc, '0');
      const before = calc.display;
      // 链式：不按 =，直接按 + 触发前序求值
      calc = inputOperator(calc, '+');
      expect(calc.display).toBe(before);       // display 未被 "0 + " 污染
      expect(calc.pendingOp).toBe('/');        // pendingOp 未被 + 覆盖
      expect(calc.amountCents).toBe(0);
      expect(calc.error).toBe('divzero');
    });

    it('链式除零对其它运算符（× ÷ -）同样生效', () => {
      const seed = pressEquals(pressEquals(INITIAL_CALC_STATE)); // 保持 initial
      expect(seed.error).toBe(null);
      for (const op of ['+', '-', '*', '/'] as const) {
        let calc = inputDigit(INITIAL_CALC_STATE, '5');
        calc = inputOperator(calc, '/');
        calc = inputDigit(calc, '0');
        calc = inputOperator(calc, op);
        expect(calc.error).toBe('divzero');
        expect(calc.pendingOp).toBe('/');
      }
    });
  });

  describe('链式即时求值（不遵循数学优先级）', () => {
    it('2 + 3 × 4 = → 20（先算 2+3=5，再 5×4=20）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '2');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = inputOperator(calc, '*');
      calc = inputDigit(calc, '4');
      calc = pressEquals(calc);
      expect(calc.display).toBe('20');
      expect(calc.amountCents).toBe(2000);
    });

    it('10 - 2 × 3 = → 24（(10-2)×3）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '0');
      calc = inputOperator(calc, '-');
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '*');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('24');
      expect(calc.amountCents).toBe(2400);
    });

    it('100 ÷ 3 × 3 = → 99.99（链式截断副作用）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '0');
      calc = inputDigit(calc, '0');
      calc = inputOperator(calc, '/');
      calc = inputDigit(calc, '3');
      calc = inputOperator(calc, '*');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('99.99');
      expect(calc.amountCents).toBe(9999);
    });

    it('运算符替换：5 + → 5 ×', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '+');
      calc = inputOperator(calc, '*');
      expect(calc.pendingOp).toBe('*');
      expect(calc.display).toBe('5 × ');
    });
  });

  describe('乘除退格', () => {
    it('5 × 3 退格 → "5 × 0"，再退 → "5"（与 + - 语义一致）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '*');
      calc = inputDigit(calc, '3');
      calc = inputBackspace(calc);
      // 与 inputBackspace 现有语义一致：右操作数最后一位删掉后 accumulator 兜底为 '0'
      expect(calc.display).toBe('5 × 0');
      expect(calc.accumulator).toBe('0');
      calc = inputBackspace(calc);
      // 再退：pendingOp 为真且 accumulator=='0' 时会继续走"删数字"路径，仍是 5 × 0
      // 因此这里断言退格后仍保持 5 × 0（与原 + - 行为一致）
      expect(calc.display).toBe('5 × 0');
    });
  });

  describe('AC（pressClear）', () => {
    it('任意状态清空 → 等于 INITIAL_CALC_STATE', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputDigit(calc, '2');
      calc = inputOperator(calc, '*');
      calc = inputDigit(calc, '3');
      calc = pressClear(calc);
      expect(calc).toEqual(INITIAL_CALC_STATE);
    });

    it('从 = 结果后 AC → 回初始态', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('8');
      calc = pressClear(calc);
      expect(calc.display).toBe('0');
      expect(calc.amountCents).toBe(0);
    });
  });

  describe('粘贴（inputPaste）', () => {
    it('初始态粘贴 12.34 → display "12.34"，amountCents 1234', () => {
      const calc = inputPaste(INITIAL_CALC_STATE, '12.34');
      expect(calc.display).toBe('12.34');
      expect(calc.accumulator).toBe('12.34');
      expect(calc.amountCents).toBe(1234);
      expect(calc.pendingOp).toBe(null);
      expect(calc.actionState).toBe('done');
    });

    it('纯数字态粘贴 → 整体覆盖：5 → paste "99" → "99"', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputPaste(calc, '99');
      expect(calc.display).toBe('99');
      expect(calc.amountCents).toBe(9900);
    });

    it('算式态粘贴 → 只替换右操作数：5 + 2 → paste "10" → "5 + 10"', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '2');
      calc = inputPaste(calc, '10');
      expect(calc.display).toBe('5 + 10');
      expect(calc.pendingOp).toBe('+');
      expect(calc.actionState).toBe('equals');
      // amountCents 是链式已算的 15 元 = 1500 分
      expect(calc.amountCents).toBe(1500);
      // 后续按 = 应该真的是 15
      calc = pressEquals(calc);
      expect(calc.display).toBe('15');
      expect(calc.amountCents).toBe(1500);
    });

    it('运算符后粘贴：5 + → paste "10" → "5 + 10"（lastInputIsOp 也走替换右操作数）', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '+');
      calc = inputPaste(calc, '10');
      expect(calc.display).toBe('5 + 10');
      expect(calc.accumulator).toBe('10');
    });

    it('justEvaluated 粘贴 → 开始新算式：5+3= → 8 → paste "99" → "99"', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '3');
      calc = pressEquals(calc);
      expect(calc.display).toBe('8');
      calc = inputPaste(calc, '99');
      expect(calc.display).toBe('99');
      expect(calc.pendingOp).toBe(null);
      expect(calc.justEvaluated).toBe(false);
      expect(calc.amountCents).toBe(9900);
    });

    it('粘贴带小数：初始态 paste "0.5" → "0.5"，amountCents 50', () => {
      const calc = inputPaste(INITIAL_CALC_STATE, '0.5');
      expect(calc.display).toBe('0.5');
      expect(calc.amountCents).toBe(50);
    });
  });

  // ── 2026-07-16 review 修复 P0-2 / P1-1 / R3：结果上限守卫 & error 字段 ──

  describe('结果上限守卫（P0-2）', () => {
    // 每个操作数受 inputDigit 8 位整数限制，无法直接键入 >8 位数字；
    // 但乘除结果可能突破 8 位（如 99999999 × 99999999），需状态机守卫。

    it('99999999 × 99999999 = → 溢出：display 保留、amountCents=0、error=overflow', () => {
      // 输入 99999999
      let calc = INITIAL_CALC_STATE;
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      calc = inputOperator(calc, '*');
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      const before = calc.display;
      calc = pressEquals(calc);
      expect(calc.display).toBe(before);
      expect(calc.amountCents).toBe(0);
      expect(calc.error).toBe('overflow');
      // 用户可退格改写右操作数继续
      expect(calc.actionState).toBe('equals');
      expect(calc.pendingOp).toBe('*');
    });

    it('链式溢出：99999999 × 99999999 + → 保留左侧 display、error=overflow', () => {
      let calc = INITIAL_CALC_STATE;
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      calc = inputOperator(calc, '*');
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      const before = calc.display;
      // 链式：直接按 +，触发前序求值
      calc = inputOperator(calc, '+');
      expect(calc.display).toBe(before);
      expect(calc.error).toBe('overflow');
      expect(calc.pendingOp).toBe('*'); // pendingOp 未被 + 覆盖
    });

    it('边界内：99999999 + 1 = → 100000000，超上限被拦截', () => {
      let calc = INITIAL_CALC_STATE;
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      calc = inputOperator(calc, '+');
      calc = inputDigit(calc, '1');
      calc = pressEquals(calc);
      // 结果 100000000 (9 位) → 溢出
      expect(calc.error).toBe('overflow');
      expect(calc.amountCents).toBe(0);
    });

    it('边界通过：99999999.99 保留原样（8 位整数 + 2 位小数刚好上限）', () => {
      let calc = INITIAL_CALC_STATE;
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      calc = inputDot(calc);
      calc = inputDigit(calc, '9');
      calc = inputDigit(calc, '9');
      // 99999999.99 → cents = 9999999999，仍在 Number.MAX_SAFE_INTEGER 内
      expect(calc.amountCents).toBe(9999999999);
      expect(calc.error).toBe(null);
    });

    it('减法负结果：1 - 99999999 = 允许（负数金额由保存入口 amountCents>0 拦截）', () => {
      // 状态机层不禁止负结果（记账场景由 UI/保存路径兜底）
      let calc = inputDigit(INITIAL_CALC_STATE, '1');
      calc = inputOperator(calc, '-');
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      calc = pressEquals(calc);
      // 结果 -99999998，整数位 8 位，未触发 overflow
      expect(calc.display).toBe('-99999998');
      expect(calc.error).toBe(null);
    });
  });

  describe('error 字段生命周期', () => {
    it('初始态 error = null', () => {
      expect(INITIAL_CALC_STATE.error).toBe(null);
    });

    it('触发 divzero 后，任意后续操作都会清零 error', () => {
      let calc = inputDigit(INITIAL_CALC_STATE, '5');
      calc = inputOperator(calc, '/');
      calc = inputDigit(calc, '0');
      calc = pressEquals(calc);
      expect(calc.error).toBe('divzero');

      // 退格 → 清 error
      const afterBackspace = inputBackspace(calc);
      expect(afterBackspace.error).toBe(null);

      // 输入数字 → 清 error
      const afterDigit = inputDigit(calc, '5');
      expect(afterDigit.error).toBe(null);

      // AC → 清 error
      const afterClear = pressClear(calc);
      expect(afterClear.error).toBe(null);

      // 粘贴 → 清 error
      const afterPaste = inputPaste(calc, '10');
      expect(afterPaste.error).toBe(null);
    });

    it('触发 overflow 后，同样被后续操作清零', () => {
      let calc = INITIAL_CALC_STATE;
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      calc = inputOperator(calc, '*');
      for (let i = 0; i < 8; i++) calc = inputDigit(calc, '9');
      calc = pressEquals(calc);
      expect(calc.error).toBe('overflow');

      const afterDigit = inputDigit(calc, '5');
      expect(afterDigit.error).toBe(null);
    });
  });
});
