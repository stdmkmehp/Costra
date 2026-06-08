// utils/money.spec.ts · decimal.js 金额工具单测
// 卡号: COSTRA-102 · D2.10
import { describe, it, expect } from 'vitest';
import { toCents, toYuan, parseAmountInputToCents } from './money';

describe('utils/money', () => {
  describe('toCents', () => {
    it('浮点精度：toCents("0.1") + toCents("0.2") 应 === 30（cents · 不复现 0.1+0.2 = 0.30000000000000004）', () => {
      expect(toCents('0.1') + toCents('0.2')).toBe(30);
    });

    it('负数：toCents("-1.23") === -123', () => {
      expect(toCents('-1.23')).toBe(-123);
    });
  });

  describe('toYuan', () => {
    it('基本：toYuan(30) === "0.30"', () => {
      expect(toYuan(30)).toBe('0.30');
    });

    it('整元补零：toYuan(12300) === "123.00"', () => {
      expect(toYuan(12300)).toBe('123.00');
    });
  });

  describe('parseAmountInputToCents', () => {
    it('键盘输入："12.34" → 1234', () => {
      expect(parseAmountInputToCents('12.34')).toBe(1234);
    });

    it('容错：空串 → 0；含字母 → 清洗后取数字', () => {
      expect(parseAmountInputToCents('')).toBe(0);
      expect(parseAmountInputToCents('abc5.67def')).toBe(567);
    });
  });
});
